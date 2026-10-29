#!/usr/bin/env node
/**
 * backfill-extraction.js — repairs work orders written by the broken
 * extraction path (2026-10 → 2026-10-29).
 *
 * The old code read tool calls from `message.toolCallList` and the AI's turns
 * from role "assistant". Vapi actually sends tool calls inside
 * `message.messages[].toolCalls` and labels the AI's turns "bot". So every
 * production work order was written with:
 *     ai_decision = "unsure", summary = NULL, issue_type = NULL,
 *     quote_low/high = NULL, customer_zipcode = NULL, recording_url = NULL
 * and a transcript containing only the customer's half.
 *
 * This script replays the stored end-of-call-report payloads through the
 * fixed extraction and updates ONLY the derived fields. It never touches
 * fields a human may have edited (boss_decision, confirmed_at, status,
 * callback_initiated_at, outbound_*).
 *
 * Usage:
 *   node scripts/backfill-extraction.js            # dry run
 *   node scripts/backfill-extraction.js --apply    # write
 *   node scripts/backfill-extraction.js --apply --since 2026-10-01
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ENV = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const APPLY = process.argv.includes("--apply");
const sinceIdx = process.argv.indexOf("--since");
const SINCE = sinceIdx > -1 ? process.argv[sinceIdx + 1] : "2026-10-01";

const SUPABASE_URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";

// --------------------------------------------------------------- compile TS
function buildExtraction() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "call-extraction-"));
  execFileSync(
    "npx",
    [
      "tsc",
      path.join(ROOT, "src/lib/call-extraction.ts"),
      path.join(ROOT, "src/lib/types.ts"),
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--skipLibCheck",
      "--esModuleInterop",
      "--moduleResolution",
      "node",
    ],
    { cwd: ROOT, stdio: "pipe" },
  );
  return require(path.join(outDir, "call-extraction.js"));
}

async function mgmtQuery(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return JSON.parse(await r.text());
}

async function restPatch(table, filter, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return JSON.parse(await r.text());
}

/**
 * Try to copy a recording into permanent storage. The Vapi presigned URL
 * expires ~30 min after the call, so older calls simply cannot be recovered.
 */
async function persistRecording(url, callId) {
  if (!url) return null;
  const storagePath = `call-recordings/${callId}.wav`;
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/call-recordings/${callId}.wav`;

  const head = await fetch(`${SUPABASE_URL}/storage/v1/object/public/call-recordings/${callId}.wav`, {
    method: "HEAD",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (head.ok) return publicUrl;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let buf;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (buf.length < 1024) return null;

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/call-recordings/${callId}.wav`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "audio/wav",
      "x-upsert": "true",
    },
    body: buf,
  });
  return up.ok ? publicUrl : null;
}

(async () => {
  const { extractCallData, buildTranscript } = buildExtraction();

  const bosses = await mgmtQuery(`select * from bosses limit 1;`);
  const boss = bosses[0];
  if (!boss) throw new Error("no boss row");

  const payloads = await mgmtQuery(`
    select ce.created_at, ce.vapi_call_id, ce.payload::text as p
    from call_events ce
    where ce.event_type='end-of-call-report' and ce.created_at >= '${SINCE}'
    order by ce.created_at desc;
  `);
  console.log(`→ ${payloads.length} end-of-call-report payloads since ${SINCE}`);
  console.log(`→ mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  let changed = 0;
  for (const row of payloads) {
    const message = JSON.parse(row.p).message;
    const callId = row.vapi_call_id;

    const orders = await mgmtQuery(
      `select id, ai_decision, summary, issue_type, quote_low, quote_high,
              customer_zipcode, recording_url, status, transcript
       from work_orders where vapi_call_id = '${callId}' limit 1;`,
    );
    if (!orders.length) {
      console.log(`· ${callId} — no work order, skip`);
      continue;
    }
    const before = orders[0];

    const x = extractCallData(boss, message);
    const transcript = buildTranscript(message);

    const recUrl =
      message.artifact?.presignedMonoUrl ||
      message.artifact?.presignedStereoUrl ||
      message.artifact?.presignedCustomerUrl ||
      message.artifact?.presignedAssistantUrl ||
      message.recordingUrl ||
      message.artifact?.recordingUrl ||
      null;
    const recording_url = await persistRecording(recUrl, callId);

    const patch = {
      ai_decision: x.decision,
      ai_decision_reason: x.reason,
      summary: x.summary,
      issue_type: x.issueType,
      quote_low: x.quoteLow,
      quote_high: x.quoteHigh,
      pricing_breakdown: x.pricingBreakdown,
      customer_zipcode: x.customerZipcode,
      issue_details: x.issueDetails,
      preferred_time: x.preferredTime,
      accepted_topics: x.acceptedTopics,
      rejected_topics: x.rejectedTopics,
      transcript,
      ...(recording_url ? { recording_url } : {}),
      updated_at: new Date().toISOString(),
    };

    const diffs = [];
    for (const k of ["ai_decision", "summary", "issue_type", "quote_low", "quote_high", "customer_zipcode"]) {
      const b = before[k] ?? null;
      const a = patch[k] ?? null;
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        diffs.push(`${k}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
      }
    }
    if (recording_url && !before.recording_url) diffs.push(`recording_url: null → stored`);
    if (transcript.length) {
      const hadBot = before.transcript?.some?.((t) => t.role === "assistant");
      if (!hadBot) diffs.push(`transcript: +${transcript.filter((t) => t.role === "assistant").length} AI turns`);
    }

    if (!diffs.length) {
      console.log(`· ${callId} — already correct`);
      continue;
    }
    changed++;
    console.log(`→ ${callId}`);
    for (const d of diffs) console.log(`     ${d}`);
    if (APPLY) {
      await restPatch("work_orders", `id=eq.${before.id}`, patch);
      console.log("     ✓ written");
    }
  }

  console.log(`\n${changed} work order(s) ${APPLY ? "updated" : "would change"}`);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
