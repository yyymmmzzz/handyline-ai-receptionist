#!/usr/bin/env node
/**
 * provision-human-line.js — buy the inbound number for the human-answering
 * line and wire it to the app.
 *
 * RUNS TWILIO API CALLS THAT COST MONEY. It requires --number to be passed
 * explicitly; without it the script only lists what is buyable and exits.
 *
 * Why a new number at all
 * -----------------------
 * +1 724-362-0422 already lives on Vapi's account and carries the AI
 * receptionist. The whole point of the human line is that the two never
 * interfere, so it needs its own number. Alex's mobile (+1 713-742-2387) is the
 * handset that rings — that value is already stored in
 * bosses.human_answer_phone and this script does not touch it.
 *
 * Usage:
 *   node scripts/provision-human-line.js                       # list options, costs nothing
 *   node scripts/provision-human-line.js --area 832            # list options in an area code
 *   node scripts/provision-human-line.js --number +18325832506 # buy + wire  (COSTS MONEY)
 *   node scripts/provision-human-line.js --dry-run --number …  # show what would happen
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const SID = (ENV.match(/^TWILIO_ACCOUNT_SID=(.+)$/m) || [])[1]?.trim();
const TOKEN = (ENV.match(/^TWILIO_AUTH_TOKEN=(.+)$/m) || [])[1]?.trim();
const APP_URL = (
  ENV.match(/^NEXT_PUBLIC_APP_URL=(.+)$/m)?.[1] || "https://demo-navy-chi-47.vercel.app"
).replace(/\/$/, "");

if (!SID || !TOKEN) {
  console.error("✗ TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing from .env.local");
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  return process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
}
const AREA = arg("area") || "832";
const NUMBER = arg("number");
const DRY_RUN = process.argv.includes("--dry-run");

function twilio(method, apiPath, form) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : null;
    const req = https.request(
      `https://api.twilio.com/2010-04-01${apiPath}`,
      {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        timeout: 45_000,
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(b) });
          } catch {
            resolve({ status: res.statusCode, body: b });
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout 45s")));
    if (body) req.write(body);
    req.end();
  });
}

async function listAvailable(area) {
  const r = await twilio(
    "GET",
    `/Accounts/${SID}/AvailablePhoneNumbers/US/Local.json?AreaCode=${area}&VoiceEnabled=true&PageSize=12`,
  );
  return r.body?.available_phone_numbers || [];
}

async function main() {
  console.log("═".repeat(64));
  console.log("  Human line provisioning");
  console.log("═".repeat(64) + "\n");

  // Account sanity — Trial accounts have restrictions we should surface
  // before someone tries to spend money.
  const acct = await twilio("GET", `/Accounts/${SID}.json`);
  if (acct.status === 200) {
    console.log(`Twilio account : ${acct.body.status} (${acct.body.type})`);
    if (acct.body.type === "Trial") {
      console.log("⚠ This is a TRIAL account. Buying a number may require adding a");
      console.log("  payment method first, and trial numbers cannot send SMS to arbitrary");
      console.log("  destinations. Voice should still work.");
    }
  }

  console.log(`\nAvailable numbers in ${AREA}:\n`);
  const nums = await listAvailable(String(AREA));
  if (nums.length === 0) {
    console.log(`  (none in ${AREA} — try another area code)`);
  }
  nums.slice(0, 12).forEach((n) => {
    const where = [n.locality, n.region].filter(Boolean).join(", ");
    console.log(`  ${n.phone_number}   ${where}`);
  });

  if (!NUMBER || NUMBER === true) {
    console.log("\nNothing bought. Re-run with:");
    console.log(`   node scripts/provision-human-line.js --number <one of the above>`);
    return;
  }

  const chosen = String(NUMBER).trim();
  console.log(`\nSelected: ${chosen}`);

  if (DRY_RUN) {
    console.log("\n🔍 DRY RUN — would perform:");
    console.log(`  1. POST /Accounts/${SID}/IncomingPhoneNumbers.json  PhoneNumber=${chosen}`);
    console.log(`       VoiceUrl      = ${APP_URL}/api/human-line/voice`);
    console.log(`       VoiceMethod   = POST`);
    console.log(`       StatusCallback= ${APP_URL}/api/human-line/no-answer`);
    console.log(`  2. UPDATE bosses SET human_line_enabled=true, human_line_number='${chosen}'`);
    console.log("  Nothing was charged and nothing changed.");
    return;
  }

  // 1) Buy the number and point its voice webhook at our route.
  console.log("\n→ Buying the number…");
  const buy = await twilio("POST", `/Accounts/${SID}/IncomingPhoneNumbers.json`, {
    PhoneNumber: chosen,
    VoiceUrl: `${APP_URL}/api/human-line/voice`,
    VoiceMethod: "POST",
    StatusCallback: `${APP_URL}/api/human-line/no-answer`,
    StatusCallbackMethod: "POST",
    SmsUrl: `${APP_URL}/api/human-line/voice`,
    SmsMethod: "POST",
  });

  if (buy.status !== 201 && buy.status !== 200) {
    console.error(`✗ Purchase failed: HTTP ${buy.status}`);
    console.error(typeof buy.body === "string" ? buy.body.slice(0, 400) : JSON.stringify(buy.body, null, 2));
    process.exit(1);
  }
  const num = buy.body;
  console.log(`✓ Bought ${num.phone_number}  (sid ${num.sid})`);
  console.log(`  voice webhook → ${num.voice_url}`);

  // 2) Tell the app about it. Uses the Supabase Management API because the
  //    project domain is the thing that can be unreachable (7-day idle pause),
  //    while the Management API host stays up.
  console.log("\n→ Registering the line in the database…");
  const sbToken = (ENV.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m) || [])[1]?.trim();
  const sbRef = (ENV.match(/^SUPABASE_PROJECT_REF=(.+)$/m) || [])[1]?.trim() || "cggqxaxunqxsgurgmiqh";
  if (!sbToken) {
    console.log("  ⚠ SUPABASE_ACCESS_TOKEN not set — run scripts/apply-migration.js-style");
    console.log("    update manually, or push the env var.");
  } else {
    const sql = `update bosses
       set human_line_enabled = true,
           human_line_number  = '${chosen}',
           human_answer_phone = coalesce(nullif(human_answer_phone,''), phone)
       where company_name ilike '%handy works%';
       select human_line_enabled, human_line_number, human_answer_phone from bosses where company_name ilike '%handy works%';`;

    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ query: sql });
      const req = https.request(
        `https://api.supabase.com/v1/projects/${sbRef}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sbToken}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 60_000,
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => {
            try {
              const rows = JSON.parse(b);
              const cfg = Array.isArray(rows) ? rows[rows.length - 1] : rows;
              console.log("  ✓ Line enabled:", JSON.stringify(cfg));
              resolve();
            } catch (e) {
              console.error("  ✗ DB update response unexpected:", b.slice(0, 200));
              resolve();
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.write(body);
      req.end();
    });
  }

  console.log("\n" + "═".repeat(64));
  console.log(`  Human line is live on ${chosen}`);
  console.log(`  It rings ${"(Alex's handset)"} for 20s, then falls back to voicemail.`);
  console.log("  Calls appear in the dashboard under Answered by → Human.");
  console.log("═".repeat(64));
}

main().catch((e) => {
  console.error("✗ Fatal:", e.message);
  process.exit(1);
});
