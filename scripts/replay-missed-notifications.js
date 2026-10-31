#!/usr/bin/env node
/**
 * replay-missed-notifications.js — tell the boss about the jobs he was never
 * told about.
 *
 * WHY THIS EXISTS (2026-10-31)
 * ---------------------------
 * The Twilio trial expired. Every notification to the merchant failed and
 * the `notifications` table recorded all 80 of them — but nothing ever READ
 * that table, so the dashboard showed the jobs as if all was well. By the
 * time someone looked, 26 open production jobs sat there with the AI having
 * booked them and the merchant knowing nothing.
 *
 * This finds those jobs and re-notifies him. It talks to
 * /api/admin/replay-notifications, which runs the REAL production notify
 * path (same probe, same message format, same delivery log) — so a replay
 * is indistinguishable from the original notification, and the dashboard's
 * "undelivered" banner clears on its own once the delivery succeeds.
 *
 * DRY RUN BY DEFAULT. Nothing is sent unless you pass --apply, because this
 * makes a customer's phone ring.
 *
 * Usage:
 *   node scripts/replay-missed-notifications.js                 # report only
 *   node scripts/replay-missed-notifications.js --days=7        # last 7 days
 *   node scripts/replay-missed-notifications.js --apply         # one SMS per job
 *   node scripts/replay-missed-notifications.js --apply --digest  # ONE summary SMS
 *
 * The digest is the sane choice above a handful of jobs: 26 separate texts
 * is a wall of noise, one message is a list the merchant can act on.
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

const WEBHOOK_SECRET = get("WEBHOOK_SECRET");
const APP_URL = (get("NEXT_PUBLIC_APP_URL") || "https://demo-navy-chi-47.vercel.app").replace(/\/$/, "");

if (!WEBHOOK_SECRET) {
  console.error("✗ WEBHOOK_SECRET missing from .env.local");
  process.exit(1);
}

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const num = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const v = Number(hit.split("=")[1]);
  return Number.isFinite(v) ? v : fallback;
};

const days = num("days", 30);
const limit = num("limit", 50);
const apply = has("--apply");
const digest = has("--digest");
const includeRejected = has("--include-rejected");

const payload = JSON.stringify({ days, limit, apply, digest, includeRejected });

console.log(`→ ${apply ? "SENDING" : "DRY RUN"} — ${days} day window${digest ? ", digest mode" : ""}`);
console.log(`→ POST ${APP_URL}/api/admin/replay-notifications`);
console.log();

let out;
try {
  // curl, not fetch: Node's HTTP stack times out against this deployment
  // often enough that it cannot be trusted for a job that must not silently
  // half-run.
  out = execFileSync(
    "curl",
    [
      "-sS",
      "--http1.1",
      "--max-time",
      "120",
      "-X",
      "POST",
      `${APP_URL}/api/admin/replay-notifications`,
      "-H",
      "Content-Type: application/json",
      "-H",
      `x-admin-token: ${WEBHOOK_SECRET}`,
      "--data",
      payload,
    ],
    { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
} catch (err) {
  console.error("✗ Request failed:", err instanceof Error ? err.message : String(err));
  if (err.stdout) console.error(err.stdout);
  process.exit(1);
}

let json;
try {
  json = JSON.parse(out);
} catch {
  console.error("✗ Response was not JSON:");
  console.error(out.slice(0, 800));
  process.exit(1);
}

if (json.error) {
  console.error(`✗ ${json.error}`);
  process.exit(1);
}

if (json.mode === "dry-run") {
  console.log(`scanned            : ${json.scanned} open production job(s) in the window`);
  console.log(`missed             : ${json.missed}`);
  console.log(`selected           : ${json.selected}`);
  if (json.skippedForLimit) {
    console.log(`skipped (limit)    : ${json.skippedForLimit}`);
  }
  console.log();
  if (!json.jobs.length) {
    console.log("✓ Nothing was missed — every open job in this window has a successful delivery.");
    console.log("  (Delivery success is judged by each job's LATEST attempt.)");
    process.exit(0);
  }
  console.log("Jobs that never reached the boss:");
  for (const j of json.jobs) {
    console.log(
      `  • ${j.summary} — ${j.customer} ${j.phone}  [${j.decision}/${j.status}]  last attempt: ${j.lastAttempt}${
        j.lastError ? ` (${j.lastError})` : ""
      }`,
    );
  }
  console.log();
  console.log("Nothing was sent. To deliver:");
  console.log(
    digest
      ? "  node scripts/replay-missed-notifications.js --apply --digest"
      : "  node scripts/replay-missed-notifications.js --apply",
  );
  console.log("  (add --include-rejected to also replay out-of-scope jobs)");
  process.exit(0);
}

// apply mode
console.log(`attempted          : ${json.attempted}`);
console.log(`delivered          : ${json.delivered}`);
console.log(`failed             : ${json.failed}`);
console.log();
for (const r of json.results || []) {
  console.log(`  ${r.delivered ? "✓" : "✗"} ${r.summary}${r.error ? ` — ${r.error}` : ""}`);
}
if (json.failed > 0) {
  console.log();
  console.log("  Some deliveries failed. Check the Twilio account state —");
  console.log("  node scripts/check-human-line.js reports what the account is doing.");
}
