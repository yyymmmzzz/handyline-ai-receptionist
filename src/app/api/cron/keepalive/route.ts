import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * Cron endpoint — keep the Supabase project awake.
 *
 * WHY THIS EXISTS (2026-10-01)
 * ---------------------------
 * The Supabase free tier pauses a project after 7 days of inactivity. When
 * that happens the project domain stops resolving entirely:
 *
 *     cggqxaxunqxsgurgmiqh.supabase.co → NXDOMAIN
 *
 * which is not a timeout or a block — the name simply stops existing. Every
 * API route that touches Supabase then fails at DNS, so the AI's tool calls
 * and the Vapi webhook both break. This already happened once: the last real
 * call was 2026-09-05 and the project was paused around 09-12.
 *
 * A paused project also CANNOT be reached to be woken by hitting its own API,
 * so this route has a two-stage strategy:
 *
 *   1. Keepalive  — a cheap authenticated query against the project. Any
 *                   successful request resets the idle timer, which is all a
 *                   healthy project needs.
 *   2. Self-heal  — if stage 1 fails (project paused), call the Supabase
 *                   Management API to restore it. This needs
 *                   SUPABASE_ACCESS_TOKEN in the Vercel env; without it the
 *                   route degrades to stage 1 only and reports what to do.
 *
 * Schedule: declared in vercel.json, daily. Daily is far more often than the
 * 7-day pause window, and Vercel Hobby only allows daily cron anyway.
 *
 * Method: GET (Vercel Cron always issues GET) and POST (manual trigger).
 */

const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF || "cggqxaxunqxsgurgmiqh";

/** Cheap query that still counts as real activity. */
async function keepalive(): Promise<{ ok: boolean; detail: string }> {
  try {
    const supabase = getServiceClient();
    // 1-row select. Cheap, but a genuine query against the database.
    const { data, error } = await supabase
      .from("bosses")
      .select("id")
      .limit(1);

    if (error) {
      return { ok: false, detail: `query error: ${error.message}` };
    }
    return { ok: true, detail: `alive (${data?.length ?? 0} boss row visible)` };
  } catch (e) {
    // A paused project usually surfaces here as a DNS/connection failure.
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Ask the Supabase Management API to bring a paused project back up. */
async function restoreProject(): Promise<{ ok: boolean; detail: string }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    return {
      ok: false,
      detail:
        "SUPABASE_ACCESS_TOKEN not set in this environment — cannot auto-restore. " +
        "Restore manually, then the next daily run will keep it alive.",
    };
  }

  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    if (res.ok) {
      return {
        ok: true,
        detail: "restore requested — project is COMING_UP, expect ACTIVE in ~1-4 min",
      };
    }

    // 400 usually means "already restoring", which is fine.
    const body = await res.text();
    if (res.status === 400) {
      return { ok: true, detail: `restore returned 400 (likely already restoring): ${body.slice(0, 200)}` };
    }
    return { ok: false, detail: `restore failed: ${res.status} ${body.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function run(req: NextRequest) {
  const startedAt = Date.now();

  // Auth is split by how risky each stage is:
  //
  //   Stage 1 (keepalive) — a single authenticated SELECT. Worst case if
  //     public is that someone makes us run a read query. Harmless, and
  //     allowing it means the keepalive works even before CRON_SECRET is set.
  //
  //   Stage 2 (restore)  — changes infrastructure state, so it requires
  //     CRON_SECRET. If the secret is not configured we will not auto-restore;
  //     we report what to do instead.
  //
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET
  // is set on the project.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const authorized = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!cronSecret) {
    console.warn(
      "[keepalive] CRON_SECRET is not set — keepalive is public (read-only), " +
        "auto-restore is disabled. Set CRON_SECRET to enable self-healing.",
    );
  }

  // Stage 1 — keepalive
  const alive = await keepalive();
  console.log(`[keepalive] ${alive.ok ? "OK" : "FAIL"} — ${alive.detail}`);

  if (alive.ok) {
    return NextResponse.json({
      ok: true,
      stage: "keepalive",
      detail: alive.detail,
      restoreEnabled: authorized,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  }

  // Stage 2 — self-heal. Requires CRON_SECRET.
  console.warn(`[keepalive] project unreachable: ${alive.detail}`);

  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: false,
        stage: "restore-skipped",
        keepaliveError: alive.detail,
        restoreDetail:
          "CRON_SECRET is not set, so auto-restore is disabled. Restore manually: " +
          `POST https://api.supabase.com/v1/projects/${PROJECT_REF}/restore`,
        projectRef: PROJECT_REF,
        durationMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      },
      { status: 502 },
    );
  }

  if (!authorized) {
    return NextResponse.json(
      { error: "unauthorized", hint: "Restore requires Authorization: Bearer $CRON_SECRET" },
      { status: 401 },
    );
  }

  const restore = await restoreProject();
  console.warn(`[keepalive] restore ${restore.ok ? "OK" : "FAIL"} — ${restore.detail}`);

  return NextResponse.json(
    {
      ok: restore.ok,
      stage: "restore",
      keepaliveError: alive.detail,
      restoreDetail: restore.detail,
      projectRef: PROJECT_REF,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    },
    // Non-2xx so Vercel surfaces the failure in cron logs.
    { status: restore.ok ? 200 : 502 },
  );
}

// Vercel Cron issues GET. POST is kept for manual triggers and external crons.
export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
