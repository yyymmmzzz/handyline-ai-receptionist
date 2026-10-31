import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getDefaultBoss } from "@/lib/order";
import { notifyBossOfNewOrder, notifyBossOfMissedJobs } from "@/lib/notify";
import type { WorkOrder } from "@/lib/types";

/**
 * POST /api/admin/replay-notifications
 *
 * Tell the boss about the jobs he was NEVER told about.
 *
 * WHY THIS EXISTS (2026-10-31)
 * ---------------------------
 * The Twilio trial expired and every notification failed. The `notifications`
 * table recorded all 80 failures — and nothing ever read it, so the jobs
 * looked normal on the dashboard. 26 open production jobs ended up in a
 * state where the AI had booked them and the merchant had heard nothing.
 *
 * Replaying them fixes two different things:
 *   1. the merchant finally hears about the work, and
 *   2. each job's latest delivery attempt becomes a SUCCESS, so the
 *      dashboard banner stops flagging it as undelivered.
 *
 * The dashboard decides "undelivered" from each job's own LATEST attempt,
 * so a successful replay genuinely clears the flag — no separate
 * bookkeeping, and no way for the banner to disagree with reality.
 *
 * DRY RUN BY DEFAULT. Sending is opt-in via { "apply": true }, because this
 * talks to a customer's phone.
 *
 * Auth: x-admin-token header matching WEBHOOK_SECRET (same convention as
 * /api/admin/prompt-check).
 *
 * Body:
 *   days    — how far back to look (default 30)
 *   apply   — actually send (default false = report only)
 *   digest  — send ONE message listing every job (default false = one
 *             message per job). A digest is the sane choice when the count
 *             is more than a handful.
 *   limit   — cap how many jobs to act on (default 50)
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-admin-token") || req.headers.get("x-webhook-secret");
  if (!process.env.WEBHOOK_SECRET || token !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { days?: number; apply?: boolean; digest?: boolean; limit?: number; includeRejected?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine — everything has a default.
  }

  const days = Math.min(Math.max(Number(body.days ?? 30), 1), 365);
  const apply = body.apply === true;
  const digest = body.digest === true;
  const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
  // Out-of-scope jobs need no action from the merchant, so replaying them
  // is noise. The live path does notify on them (a referral may be
  // wanted), but a backlog of old "❌ Out of scope" texts is not.
  const includeRejected = body.includeRejected === true;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = getServiceClient();

    // Open, production jobs in the window. `data_source is null` counts as
    // production — that is the convention the rest of the app uses.
    const { data: orders, error: qErr } = await supabase
      .from("work_orders")
      .select("*")
      .or("data_source.eq.production,data_source.is.null")
      .not("status", "in", "(completed,cancelled)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    if (qErr) {
      return NextResponse.json({ error: qErr.message }, { status: 500 });
    }

    const all = (orders || []) as WorkOrder[];
    const ids = all.map((o) => o.id);

    // Latest delivery attempt per job. The notification rows are ordered
    // newest first, so the first row seen for an id is the one that counts.
    const latest = new Map<string, { status: string; created_at: string; error: string | null }>();
    if (ids.length) {
      const { data: rows, error: nErr } = await supabase
        .from("notifications")
        .select("work_order_id, status, created_at, error")
        .in("work_order_id", ids)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (nErr) {
        return NextResponse.json({ error: nErr.message }, { status: 500 });
      }
      for (const r of rows || []) {
        const id = (r as { work_order_id: string }).work_order_id;
        if (id && !latest.has(id)) {
          latest.set(id, r as { status: string; created_at: string; error: string | null });
        }
      }
    }

    // A job is missed when it has no delivery attempt at all, or when its
    // most recent attempt failed.
    const missed = all.filter((o) => {
      if (!includeRejected && o.ai_decision === "rejected") return false;
      const l = latest.get(o.id);
      return !l || l.status === "failed";
    });

    const selected = missed.slice(0, limit);
    const report = selected.map((o) => ({
      id: o.id,
      createdAt: o.created_at,
      summary: o.summary || o.issue_type,
      customer: o.customer_name || o.customer_name_extracted || "unknown",
      phone: o.customer_phone,
      decision: o.ai_decision,
      status: o.status,
      lastAttempt: latest.get(o.id)?.status ?? "none",
      lastError: latest.get(o.id)?.error ?? null,
    }));

    if (!apply) {
      return NextResponse.json({
        ok: true,
        mode: "dry-run",
        days,
        digest,
        includeRejected,
        scanned: all.length,
        missed: missed.length,
        selected: selected.length,
        skippedForLimit: missed.length - selected.length,
        jobs: report,
        hint: "Nothing was sent. Re-run with { \"apply\": true } to deliver these.",
      });
    }

    if (!selected.length) {
      return NextResponse.json({ ok: true, mode: "apply", sent: 0, jobs: [] });
    }

    const boss = await getDefaultBoss();
    if (!boss) {
      return NextResponse.json({ error: "no_boss" }, { status: 500 });
    }

    if (digest) {
      await notifyBossOfMissedJobs(boss, selected);
    } else {
      for (const o of selected) {
        await notifyBossOfNewOrder(boss, o);
      }
    }

    // Report what the delivery log says NOW, so the caller sees whether it
    // actually went out rather than trusting that it did.
    const { data: after } = await supabase
      .from("notifications")
      .select("work_order_id, status, error, created_at")
      .in(
        "work_order_id",
        selected.map((o) => o.id),
      )
      .order("created_at", { ascending: false })
      .limit(2000);

    const latestAfter = new Map<string, { status: string; error: string | null; created_at: string }>();
    for (const r of after || []) {
      const id = (r as { work_order_id: string }).work_order_id;
      if (id && !latestAfter.has(id)) latestAfter.set(id, r as never);
    }

    const results = selected.map((o) => {
      const l = latestAfter.get(o.id);
      return {
        id: o.id,
        summary: o.summary || o.issue_type,
        delivered: l?.status === "sent",
        error: l?.error ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      mode: "apply",
      digest,
      attempted: selected.length,
      delivered: results.filter((r) => r.delivered).length,
      failed: results.filter((r) => !r.delivered).length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
