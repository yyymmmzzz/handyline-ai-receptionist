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
    console.log("✓ 真人线已关闭 (human_line_enabled = false)");
    console.log("  号码保留在 human_line_number，随时可以再打开。");
    return;
  }

  if (!number) {
    console.error("✗ 用法: node scripts/activate-human-line.js <E.164 号码，例如 +15125550123>");
    console.error("   号码必须是在你这个 Twilio 账号名下买到的那个。");
    process.exit(1);
  }
  if (!/^\+[1-9]\d{7,14}$/.test(number)) {
    console.error(`✗ "${number}" 不是合法的 E.164 号码`);
    process.exit(1);
  }
  if (fallback && !["ai", "voicemail", "hangup"].includes(fallback)) {
    console.error(`✗ --fallback 只能是 ai / voicemail / hangup`);
    process.exit(1);
  }

  // Refuse a number that is not ours — the Vapi AI line is the most likely
  // mistake here, and pointing the human line at it would loop the customer.
  const VAPI_AI_LINE = get("TWILIO_PHONE_NUMBER");
  if (VAPI_AI_LINE && number === VAPI_AI_LINE && !get("HUMAN_LINE_NUMBER")) {
    console.error(`✗ "${number}" 看起来是 Vapi 的 AI 线号码，不能同时当真人线（会形成回环）。`);
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
  console.log("✓ 数据库已更新:");
  console.log("  ", JSON.stringify(res[0]));

  setEnv("TWILIO_PHONE_NUMBER", number);
  console.log("✓ .env.local 的 TWILIO_PHONE_NUMBER 已更新（短信通知用同一号码）");

  console.log("\n接下来在 Twilio 控制台设置这两个地址（每个号码一次）：");
  console.log(`  1. A CALL COMES IN  → ${APP_URL}/api/human-line/voice`);
  console.log(`  2. RECORDING STATUS → ${APP_URL}/api/human-line/recording`);
  console.log("\n设置好后跑 node scripts/check-human-line.js 复查，");
  console.log("再打这个号码：接听应转给 Alex，通话结束后录音会进网站。");
})().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
