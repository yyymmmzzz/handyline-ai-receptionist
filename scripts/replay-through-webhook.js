#!/usr/bin/env node
/**
 * replay-through-webhook.js — re-process stored calls using the DEPLOYED app.
 *
 * Why: the extraction fix lives in the Next.js app, and the LLM summariser
 * only works reliably where OpenAI is reachable — the Vercel deployment. So
 * instead of repairing rows from this laptop, we replay the stored
 * end-of-call-report payloads through the live webhook and let production
 * code re-derive every field.
 *
 * This also proves the deployed build actually contains the fix.
 *
 * Usage:
 *   node scripts/replay-through-webhook.js                 # all stored calls
 *   node scripts/replay-through-webhook.js <callId> ...    # specific calls
 *
 * Requires the deployment to be live at WEBHOOK_URL.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ENV = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";
const WEBHOOK_URL =
  get("NEXT_PUBLIC_APP_URL") + "/api/vapi/webhook" || "https://demo-navy-chi-47.vercel.app/api/vapi/webhook";

async function mgmtQuery(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

(async () => {
  const explicit = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const onlyIds = explicit.length ? new Set(explicit) : null;

  const rows = await mgmtQuery(`
    select ce.created_at, ce.vapi_call_id, ce.payload::text as p
    from call_events ce
    where ce.event_type='end-of-call-report'
    order by ce.created_at asc;
  `);

  console.log(`→ ${rows.length} stored end-of-call-report payloads`);
  console.log(`→ replaying through ${WEBHOOK_URL}\n`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const callId = row.vapi_call_id;
    // Prefix match, so a partial id is enough to select a call.
    if (onlyIds && ![...onlyIds].some((id) => callId.startsWith(id))) continue;

    const before = await mgmtQuery(
      `select id, ai_decision, summary, issue_type, customer_name_extracted, recording_url
       from work_orders where vapi_call_id='${callId}' limit 1;`,
    );
    const prior = before[0] || null;

    const payload = JSON.parse(row.p);
    // Node's TLS stack intermittently times out against the Vercel domain
    // from this network while curl is fine — so use curl for the POST.
    const out = execFileSync(
      "curl",
      [
        "-sS",
        "--http1.1",
        "--max-time",
        "60",
        "-w",
        "\n%{http_code}",
        "-X",
        "POST",
        WEBHOOK_URL,
        "-H",
        "Content-Type: application/json",
        "--data",
        JSON.stringify(payload),
      ],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    const cut = out.lastIndexOf("\n");
    const status = Number(out.slice(cut + 1).trim());
    const body = out.slice(0, cut);
    const res = { status, text: async () => body };
    if (res.status !== 200) {
      failed++;
      console.log(`✗ ${callId} — HTTP ${res.status} ${body.slice(0, 120)}`);
      continue;
    }
    ok++;
    console.log(`✓ ${callId} — ${res.status}`);
    await new Promise((r) => setTimeout(r, 1200)); // let the async write land
  }

  // Report the delta
  console.log("\n=== AFTER ===");
  const after = await mgmtQuery(`
    select created_at, vapi_call_id, ai_decision, summary, issue_type,
           customer_name_extracted, intent_summary, recording_url,
           jsonb_array_length(coalesce(transcript,'[]'::jsonb)) t_len
    from work_orders where created_at > '2026-10-01' order by created_at desc;
  `);
  for (const a of after) {
    const was = rows.find((r) => r.vapi_call_id === a.vapi_call_id);
    const perm = a.recording_url ? (a.recording_url.includes("/storage/v1/object/") ? "PERM" : "EPHEM") : "-";
    console.log(
      `${a.created_at.slice(5, 16)} | ${String(a.ai_decision).padEnd(8)} | ${String(a.issue_type).padEnd(15)} | ` +
        `name=${String(a.customer_name_extracted || "-").padEnd(8)} | t=${String(a.t_len).padEnd(3)} | rec=${perm.padEnd(6)} | ` +
        `${(a.summary || a.intent_summary || "(none)").slice(0, 48)}`,
    );
  }
  console.log(`\nreplayed ok=${ok} failed=${failed}`);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
