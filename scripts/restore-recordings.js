#!/usr/bin/env node
/**
 * restore-recordings.js — re-fetch AI call recordings and store them
 * permanently in Supabase Storage.
 *
 * WHY THIS EXISTS
 * ---------------
 * Vapi hands the webhook a recording URL that expires ~30 minutes after the
 * call. If the download misses that window the audio is gone from the
 * webhook's point of view — but `GET https://api.vapi.ai/call/{id}` re-signs
 * a FRESH presigned URL (valid ~12 hours) for as long as the call is inside
 * Vapi's 14-day call-history window.
 *
 * So a recording that failed to persist is not necessarily lost: it can be
 * pulled from the Vapi API and stored permanently afterwards.
 *
 * The recordings that are truly gone are the ones whose call has already
 * fallen out of the 14-day window (Vapi answers 400) or has been purged
 * (404). This script reports those explicitly instead of failing silently.
 *
 * Usage:
 *   node scripts/restore-recordings.js            # dry run
 *   node scripts/restore-recordings.js --apply
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const APPLY = process.argv.includes("--apply");
const VAPI_API_KEY = get("VAPI_API_KEY");
const SUPABASE_URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";
const BUCKET = "call-recordings";

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

const isPermanent = (url) => !!url && url.includes("/storage/v1/object/");

async function fetchWithTimeout(url, opts = {}, ms = 60_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function upload(callId, buf) {
  const up = await fetchWithTimeout(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${callId}.wav`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "audio/wav",
        "x-upsert": "true",
      },
      body: buf,
    },
    60_000,
  );
  if (!up.ok) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${callId}.wav`;
}

(async () => {
  const orders = await mgmtQuery(`
    select id, vapi_call_id, recording_url, created_at
    from work_orders
    where vapi_call_id is not null
      and recording_url is not null
      and recording_url not like '%/storage/v1/object/%'
    order by created_at desc;
  `);

  console.log(`→ ${orders.length} work order(s) hold a non-permanent recording URL`);
  console.log(`→ mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  let restored = 0;
  let unrecoverable = 0;
  for (const o of orders) {
    const r = await fetchWithTimeout(`https://api.vapi.ai/call/${o.vapi_call_id}`, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    }, 30_000);

    if (r.status !== 200) {
      unrecoverable++;
      console.log(`· ${o.vapi_call_id} — unrecoverable (Vapi HTTP ${r.status})`);
      continue;
    }

    const call = await r.json();
    const a = call.artifact || {};
    const src =
      a.presignedMonoUrl ||
      a.presignedStereoUrl ||
      a.presignedCustomerUrl ||
      a.presignedAssistantUrl ||
      null;
    if (!src) {
      unrecoverable++;
      console.log(`· ${o.vapi_call_id} — no presigned URL in the artifact`);
      continue;
    }

    const res = await fetchWithTimeout(src, {}, 90_000);
    if (!res.ok) {
      unrecoverable++;
      console.log(`· ${o.vapi_call_id} — download failed (HTTP ${res.status})`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) {
      unrecoverable++;
      console.log(`· ${o.vapi_call_id} — downloaded only ${buf.length} bytes`);
      continue;
    }

    const publicUrl = await upload(o.vapi_call_id, buf);
    if (!publicUrl) {
      unrecoverable++;
      console.log(`· ${o.vapi_call_id} — upload failed`);
      continue;
    }

    restored++;
    console.log(
      `→ ${o.vapi_call_id} — restored ${(buf.length / 1024).toFixed(0)} KB` +
        `${APPLY ? "" : " (dry run)"}`,
    );
    if (APPLY) {
      await mgmtQuery(
        `update work_orders set recording_url='${publicUrl}', updated_at=now() where id='${o.id}';`,
      );
      console.log("     ✓ recording_url now permanent");
    }
  }

  console.log(
    `\n${restored} recoverable, ${unrecoverable} unrecoverable (outside Vapi's 14-day window)`,
  );
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
