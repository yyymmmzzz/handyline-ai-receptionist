#!/usr/bin/env node
/**
 * check-human-line.js — how ready is the human-answering line?
 *
 * Prints the whole chain and what is still missing:
 *   1. Twilio account state (trial? expired? which numbers?)
 *   2. Does this number belong to the Twilio account?
 *   3. The boss configuration (human_line_enabled / number / ring / fallback)
 *   4. Are the webhook routes protected by a Twilio signature check?
 *   5. How many human calls have landed so far
 *
 * Run: node scripts/check-human-line.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const ENV = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const SID = get("TWILIO_ACCOUNT_SID");
const TOKEN = get("TWILIO_AUTH_TOKEN");
const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";

function httpsJson(url, { headers = {}, method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers, timeout: 20000 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function mgmtQuery(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  return JSON.parse(await r.text());
}

function ok(flag) {
  return flag ? "✓" : "✗";
}

async function main() {
  console.log("═".repeat(62));
  console.log("  HandyLine human line — readiness status");
  console.log("═".repeat(62));

  // 1. Twilio account
  console.log("\n[1] Twilio account");
  if (!SID || !TOKEN) {
    console.log("  ✗ .env.local has no TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  } else {
    const acc = await httpsJson(`https://api.twilio.com/2010-04-01/Accounts/${SID}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}` },
    });
    const a = acc.body || {};
    console.log(`  ${ok(acc.status === 200)} account reachable (HTTP ${acc.status})`);
    console.log(`    type=${a.type}  status=${a.status}`);
    if (a.type === "Trial") {
      console.log("    ⚠ Trial account: no SMS / outbound calls, and it must be upgraded after 14 days");
    }

    const nums = await httpsJson(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=50`,
      { headers: { Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}` } },
    );
    const list = nums.body?.incoming_phone_numbers || [];
    console.log(`  ${ok(list.length > 0)} numbers owned: ${list.length} — ${list.map((n) => n.phone_number).join(", ") || "(none)"}`);
    console.log(`    → the human line needs its own Twilio number (the Vapi AI line does not count)`);
  }

  // 2. Boss configuration
  console.log("\n[2] Customer configuration (bosses)");
  const bosses = await mgmtQuery(
    `select company_name, country, phone, human_line_enabled, human_line_number,
            human_answer_phone, human_line_ring_seconds, human_line_fallback,
            twilio_phone_number, ai_line_enabled
     from bosses order by company_name;`,
  );
  for (const b of bosses) {
    console.log(`  · ${b.company_name} (${b.country})`);
    console.log(`      AI line: ${b.ai_line_enabled ? "on" : "off"}   Human line: ${b.human_line_enabled ? "on" : "off"}`);
    console.log(`      Human line number: ${b.human_line_number || "(not set)"}`);
    console.log(`      Phone that rings: ${b.human_answer_phone || "(not set)"}`);
    console.log(`      Rings ${b.human_line_ring_seconds}s / no answer → ${b.human_line_fallback}`);
  }

  // 3. Route protection
  console.log("\n[3] Callback signature checks");
  const routes = [
    "src/app/api/human-line/voice/route.ts",
    "src/app/api/human-line/recording/route.ts",
    "src/app/api/human-line/no-answer/route.ts",
    "src/app/api/twilio/emergency-twiml/route.ts",
    "src/app/api/twilio/emergency-decision/route.ts",
    "src/app/api/twilio/emergency-status/route.ts",
  ];
  for (const r of routes) {
    const src = fs.readFileSync(path.join(ROOT, r), "utf-8");
    const guarded = src.includes("verifyTwilioSignature");
    console.log(`  ${ok(guarded)} ${r.replace("src/app/api", "")}`);
  }

  // 4. Human calls so far
  console.log("\n[4] Human calls so far");
  const calls = await mgmtQuery(
    `select call_type, count(*)::int as n from work_orders group by 1 order by 2 desc;`,
  );
  for (const c of calls) console.log(`  · ${c.call_type}: ${c.n}`);

  console.log("\n" + "═".repeat(62));
  console.log("  Read the ✓ / ✗ lines above for the verdict");
  console.log("═".repeat(62) + "\n");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
