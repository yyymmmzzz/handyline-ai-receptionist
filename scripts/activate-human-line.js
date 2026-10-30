#!/usr/bin/env node
/**
 * activate-human-line.js — turn the human-answering line on.
 *
 * Run this ONCE a Twilio number has been bought. It wires the number into
 * everything that needs it:
 *   - bosses.human_line_number   (the number customers dial)
 *   - bosses.twilio_phone_number  (Twilio's number for this customer)
 *   - bosses.human_line_enabled   (the switch the voice webhook checks)
 *   - .env.local TWILIO_PHONE_NUMBER (so SMS notifications use the same line)
 *   - .env.local HUMAN_LINE_NUMBER  (so the guard below can tell the human
 *     line apart from the Vapi AI line — both are Twilio numbers, and the AI
 *     line must never be dialled as the human line or the customer loops)
 *
 * Usage:
 *   node scripts/activate-human-line.js +15125550123
 *   node scripts/activate-human-line.js +15125550123 --fallback ai
 *   node scripts/activate-human-line.js --disable
 *
 * It does NOT configure the Twilio console — the voice webhook URL and the
 * recording callback URL have to be set there (the script prints the exact
 * URLs to paste).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const ENV = fs.readFileSync(ENV_PATH, "utf-8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";
const APP_URL = (get("NEXT_PUBLIC_APP_URL") || "https://demo-navy-chi-47.vercel.app").replace(/\/$/, "");
const ALEX_BOSS_ID = "91e6d168-eb60-42cb-a230-062f27b8c714";

async function mgmtQuery(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300));
  }
}

function setEnv(key, value) {
  let text = fs.readFileSync(ENV_PATH, "utf-8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    text = text.replace(/\n*$/, "\n") + `${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, text);
}

const argv = process.argv.slice(2);
const disable = argv.includes("--disable");
const fallbackIdx = argv.indexOf("--fallback");
const fallback = fallbackIdx >= 0 ? argv[fallbackIdx + 1] : null;
const number = argv.find((a) => a.startsWith("+"));

(async () => {
  if (disable) {
    await mgmtQuery(`update bosses set human_line_enabled = false where id = '${ALEX_BOSS_ID}';`);
    console.log("✓ Human line disabled (human_line_enabled = false)");
    console.log("  The number stays in human_line_number, so it can be switched back on.");
    return;
  }

  if (!number) {
    console.error("✗ Usage: node scripts/activate-human-line.js <E.164 number, e.g. +15125550123>");
    console.error("   The number must be one you bought on this Twilio account.");
    process.exit(1);
  }
  if (!/^\+[1-9]\d{7,14}$/.test(number)) {
    console.error(`✗ "${number}" is not a valid E.164 number`);
    process.exit(1);
  }
  if (fallback && !["ai", "voicemail", "hangup"].includes(fallback)) {
    console.error(`✗ --fallback must be one of ai / voicemail / hangup`);
    process.exit(1);
  }

  // Refuse a number that is not ours — the Vapi AI line is the most likely
  // mistake here, and pointing the human line at it would loop the customer.
  const VAPI_AI_LINE = get("TWILIO_PHONE_NUMBER");
  if (VAPI_AI_LINE && number === VAPI_AI_LINE && !get("HUMAN_LINE_NUMBER")) {
    console.error(`✗ "${number}" looks like the Vapi AI line number — it cannot also be the human line (that would loop the customer).`);
    process.exit(1);
  }

  const sets = [
    `human_line_number = '${number}'`,
    `twilio_phone_number = '${number}'`,
    `human_line_enabled = true`,
  ];
  if (fallback) sets.push(`human_line_fallback = '${fallback}'`);
  const res = await mgmtQuery(
    `update bosses set ${sets.join(", ")} where id = '${ALEX_BOSS_ID}' returning company_name, human_line_number, human_line_enabled, human_line_fallback;`,
  );
  console.log("✓ Database updated:");
  console.log("  ", JSON.stringify(res[0]));

  setEnv("TWILIO_PHONE_NUMBER", number);
  setEnv("HUMAN_LINE_NUMBER", number);
  console.log("✓ TWILIO_PHONE_NUMBER in .env.local updated (SMS notifications use the same number)");
  console.log("✓ HUMAN_LINE_NUMBER in .env.local updated (marks the human line vs the Vapi AI line)");

  console.log("\nNext, set these two URLs in the Twilio console (once per number):");
  console.log(`  1. A CALL COMES IN  → ${APP_URL}/api/human-line/voice`);
  console.log(`  2. RECORDING STATUS → ${APP_URL}/api/human-line/recording`);
  console.log("\nWhen that is done, re-run node scripts/check-human-line.js to verify,");
  console.log("then call the number: the call should reach Alex, and the recording should land on the site after the call ends.");
})().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
