#!/usr/bin/env node
/**
 * dedupe-call-events.js — remove duplicate event rows left by replays.
 *
 * The webhook logs one row per event. Replaying a stored payload through the
 * live webhook (scripts/replay-through-webhook.js) adds a second copy of
 * every event, so a call can end up with N identical 'end-of-call-report'
 * rows. Keep the EARLIEST row per (vapi_call_id, event_type) and drop the
 * rest, then report what was removed.
 *
 * Dry run by default. Pass --apply to delete.
 *
 * Usage:
 *   node scripts/dedupe-call-events.js
 *   node scripts/dedupe-call-events.js --apply
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
const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";

async function mgmtQuery(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

(async () => {
  const dupes = await mgmtQuery(`
    select vapi_call_id, event_type, count(*)::int n, min(created_at) keep_at
    from call_events
    group by 1, 2
    having count(*) > 1
    order by n desc;
  `);

  console.log(`→ ${dupes.length} (call_id, event_type) groups have duplicates`);
  console.log(`→ mode: ${APPLY ? "APPLY (deletes)" : "DRY RUN"}\n`);

  let total = 0;
  for (const d of dupes) {
    const kill = await mgmtQuery(
      `select id, created_at from call_events
       where vapi_call_id='${d.vapi_call_id}' and event_type='${d.event_type}'
         and created_at > '${d.keep_at}'
       order by created_at;`,
    );
    const ids = kill.map((k) => k.id);
    console.log(`  ${d.vapi_call_id} ${d.event_type} — ${d.n} copies, keeping the first, removing ${ids.length}`);
    total += ids.length;
    if (APPLY && ids.length) {
      await mgmtQuery(
        `delete from call_events where id in (${ids.map((i) => `'${i}'`).join(",")});`,
      );
    }
  }

  console.log(`\n${total} duplicate row(s) ${APPLY ? "deleted" : "would be deleted"}`);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
