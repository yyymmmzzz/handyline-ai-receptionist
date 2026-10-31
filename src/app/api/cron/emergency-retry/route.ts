import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { placeEmergencyCall } from "@/lib/emergency-call";
import { getDefaultBoss } from "@/lib/order";
import { notifyBossOfNewOrder } from "@/lib/notify";

/**
 * Cron endpoint — retry emergency outbound calls for unanswered urgent jobs.
 *
 * Schedule: every 5 minutes. Hit this from any external cron (Vercel Cron,
 * GitHub Actions, EasyCron, or a simple shell loop).
 *
 * Logic:
 *   1. Find all urgent work orders with outbound_attempts < 3
 *      AND last_outbound_at < 5 min ago
 *      AND status still 'urgent' (not callback_initiated)
 *   2. Place a new outbound call
 *   3. Bump outbound_attempts + last_outbound_at
 *   4. If outbound_attempts reaches max_attempts (default 3), fall back to SMS
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Auth is MANDATORY, and it fails closed.
  //
  // The old check was `if (cronSecret && authHeader !== ...)` — which meant
  // that with CRON_SECRET unset the whole comparison was skipped and the
  // endpoint was callable by anyone on the internet. It is not a harmless
  // read-only endpoint: it places outbound calls to the boss. Verified on
  // 2026-10-31 — an unauthenticated POST ran and retried 16 urgent orders.
  //
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` whenever
  // CRON_SECRET is set on the project, so requiring it costs the cron
  // nothing once the variable is configured.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(
      "[cron] CRON_SECRET is not set — refusing to run. This endpoint places " +
        "outbound calls and must not be publicly callable.",
    );
    return NextResponse.json(
      {
        error: "cron_secret_not_configured",
        hint:
          "Set CRON_SECRET in the Vercel environment. Vercel Cron then sends it " +
          "as 'Authorization: Bearer $CRON_SECRET'.",
      },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const maxAttempts = Number(process.env.EMERGENCY_MAX_ATTEMPTS || "3");
  const retryIntervalMin = Number(process.env.EMERGENCY_RETRY_INTERVAL_MINUTES || "5");

  // Find candidates: urgent status, not yet answered, last attempt older than interval
  const cutoff = new Date(Date.now() - retryIntervalMin * 60 * 1000).toISOString();
  const { data: candidates, error: qErr } = await supabase
    .from("work_orders")
    .select("id, customer_name, customer_phone, issue_type, issue_details, summary, outbound_attempts, last_outbound_at")
    .eq("ai_decision", "urgent")
    .eq("status", "urgent")
    .lt("outbound_attempts", maxAttempts)
    .or(`last_outbound_at.is.null,last_outbound_at.lt.${cutoff}`);

  if (qErr) {
    console.error("[cron] Query error:", qErr);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ retried: 0, candidates: 0 });
  }

  const boss = await getDefaultBoss();
  if (!boss) {
    return NextResponse.json({ error: "no_boss" }, { status: 500 });
  }

  const results: Array<{ orderId: string; callId: string | null; attempts: number; fellBackToSms: boolean }> = [];

  for (const order of candidates) {
    const nextAttempts = (order.outbound_attempts || 0) + 1;
    const result = await placeEmergencyCall(
      { phone: boss.phone, owner_name: boss.owner_name },
      order as Parameters<typeof placeEmergencyCall>[1],
    );

    if (result.success && result.callId) {
      await supabase
        .from("work_orders")
        .update({
          outbound_attempts: nextAttempts,
          last_outbound_at: new Date().toISOString(),
          outbound_call_id: result.callId,
        })
        .eq("id", order.id);

      results.push({ orderId: order.id, callId: result.callId, attempts: nextAttempts, fellBackToSms: false });
    } else {
      // Place failed — bump attempts, fall back to SMS at max
      await supabase
        .from("work_orders")
        .update({
          outbound_attempts: nextAttempts,
          last_outbound_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      const fellBackToSms = nextAttempts >= maxAttempts;
      if (fellBackToSms) {
        // Last attempt — make sure the SMS gets through
        try {
          const { data: full } = await supabase
            .from("work_orders")
            .select("*")
            .eq("id", order.id)
            .single();
          if (full) {
            await notifyBossOfNewOrder(boss, full as Parameters<typeof notifyBossOfNewOrder>[1]);
          }
        } catch (e) {
          console.error("[cron] Fallback SMS error:", e);
        }
      }

      results.push({ orderId: order.id, callId: null, attempts: nextAttempts, fellBackToSms });
    }
  }

  return NextResponse.json({ retried: results.length, results });
}
