#!/usr/bin/env node
/**
 * test-human-line.js — end-to-end check of the human-answering line.
 *
 * Simulates exactly what Twilio sends, including the X-Twilio-Signature
 * header, and verifies the whole chain:
 *
 *   1. an unsigned / wrongly signed request is REJECTED (the security fix)
 *   2. /api/human-line/voice returns TwiML that dials Alex's phone
 *   3. /api/human-line/no-answer returns the configured fallback
 *   4. /api/human-line/recording turns a finished recording into a work
 *      order with call_type='human', a stored recording, a transcript and a
 *      summary
 *
 * Step 4 needs a number that maps to the customer, so the script sets
 * bosses.human_line_number to a placeholder for the duration of the test and
 * restores it afterwards. The work order it creates is deleted afterwards too
 * — it is test data, not a lead.
 *
 * Run: node scripts/test-human-line.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ENV = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const TWILIO_AUTH_TOKEN = get("TWILIO_AUTH_TOKEN");
const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";
const BASE_URL = (get("NEXT_PUBLIC_APP_URL") || "https://demo-navy-chi-47.vercel.app").replace(/\/$/, "");
const ALEX_BOSS_ID = "91e6d168-eb60-42cb-a230-062f27b8c714";
const TEST_NUMBER = "+15550100000"; // reserved fictional 555-0100 range

let passed = 0;
let failed = 0;
function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? "  — " + detail : ""}`);
}
function fail(name, detail) {
  failed++;
  console.log(`  ✗ ${name}  — ${detail}`);
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
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300));
  }
}

/** Twilio's signature: HMAC-SHA1(url + sorted params, authToken), base64 */
function twilioSignature(url, params) {
  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, k) => acc + k + params[k], "");
  return crypto.createHmac("sha1", TWILIO_AUTH_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

function postForm(path, params, { sign = true, overrideUrl = null } = {}) {
  const url = overrideUrl || `${BASE_URL}${path}`;
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const args = ["-sS", "--http1.1", "--max-time", "120", "-w", "\n%{http_code}", "-X", "POST", url,
    "-H", "Content-Type: application/x-www-form-urlencoded"];
  if (sign) args.push("-H", `X-Twilio-Signature: ${twilioSignature(url, params)}`);
  args.push("--data", body);
  const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const cut = out.lastIndexOf("\n");
  return { status: Number(out.slice(cut + 1).trim()), body: out.slice(0, cut) };
}

async function main() {
  console.log("═".repeat(62));
  console.log("  真人接听线 — 端到端自测");
  console.log(`  target: ${BASE_URL}`);
  console.log("═".repeat(62));

  // --- 0. Put the customer on the test number for the duration of the test.
  const before = await mgmtQuery(
    `select human_line_number, human_line_enabled, human_line_fallback, human_answer_phone
     from bosses where id = '${ALEX_BOSS_ID}';`,
  );
  const original = before[0];
  await mgmtQuery(
    `update bosses set human_line_number = '${TEST_NUMBER}', human_line_enabled = true
     where id = '${ALEX_BOSS_ID}';`,
  );
  console.log(`\n  (测试期间 human_line_number = ${TEST_NUMBER}，结束后恢复)`);

  const createdOrderIds = [];
  try {
    // --- 1. Security: an unsigned request must be refused.
    console.log("\n[1] 签名校验");
    const noSig = postForm("/api/human-line/voice", { From: "+17130000000", To: TEST_NUMBER }, { sign: false });
    noSig.status === 403
      ? pass("无签名请求被拒绝", "HTTP 403")
      : fail("无签名请求被拒绝", `期望 403，实际 ${noSig.status}`);

    const badSig = postForm(
      "/api/human-line/voice",
      { From: "+17130000000", To: TEST_NUMBER },
      { sign: false },
    );
    // (same as above, but also make sure a wrong-but-present signature fails)
    const wrongSigBody = execFileSync(
      "curl",
      ["-sS", "--http1.1", "--max-time", "60", "-o", "/dev/null", "-w", "%{http_code}",
       "-X", "POST", `${BASE_URL}/api/human-line/voice`,
       "-H", "Content-Type: application/x-www-form-urlencoded",
       "-H", "X-Twilio-Signature: AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
       "--data", `From=%2B17130000000&To=${encodeURIComponent(TEST_NUMBER)}`],
      { encoding: "utf8" },
    );
    Number(wrongSigBody) === 403
      ? pass("错误签名被拒绝", "HTTP 403")
      : fail("错误签名被拒绝", `期望 403，实际 ${wrongSigBody}`);

    // --- 2. voice: TwiML that dials Alex.
    console.log("\n[2] /api/human-line/voice");
    const voice = postForm("/api/human-line/voice", {
      From: "+17130000000",
      To: TEST_NUMBER,
      CallSid: "CA_TEST_VOICE",
    });
    if (voice.status === 200) {
      pass("返回 200");
      voice.body.includes("<Dial") ? pass("TwiML 里有 <Dial>") : fail("TwiML 里有 <Dial>", voice.body.slice(0, 160));
      voice.body.includes("+17137422387")
        ? pass("拨号目标是 Alex 的手机", "+17137422387")
        : fail("拨号目标是 Alex 的手机", voice.body.slice(0, 200));
      voice.body.includes(`timeout="20"`) || voice.body.includes("timeout=")
        ? pass("设置了无人接听超时")
        : fail("设置了无人接听超时", voice.body.slice(0, 200));
    } else {
      fail("voice 回调", `HTTP ${voice.status} ${voice.body.slice(0, 160)}`);
    }

    // --- 3. no-answer: the configured fallback.
    console.log("\n[3] /api/human-line/no-answer");
    const noAnswer = postForm("/api/human-line/no-answer", {
      From: "+17130000000",
      To: TEST_NUMBER,
      CallSid: "CA_TEST_NOANSWER",
      DialCallDuration: "20",
    });
    if (noAnswer.status === 200) {
      pass("返回 200");
      noAnswer.body.includes("<Response>") ? pass("返回合法 TwiML") : fail("返回合法 TwiML", noAnswer.body.slice(0, 160));
    } else {
      fail("no-answer 回调", `HTTP ${noAnswer.status} ${noAnswer.body.slice(0, 160)}`);
    }

    // --- 4. recording: a finished recording becomes a work order.
    console.log("\n[4] /api/human-line/recording（录音 → 工单）");
    const audio = await mgmtQuery(
      `select recording_url from work_orders where recording_url is not null order by created_at desc limit 1;`,
    );
    if (!audio.length) {
      fail("找一段现成录音做测试素材", "库里没有录音");
    } else {
      const recordingUrl = audio[0].recording_url;
      const callSid = "CA_TEST_RECORDING";
      const rec = postForm("/api/human-line/recording", {
        RecordingUrl: recordingUrl,
        RecordingStatus: "completed",
        CallSid: callSid,
        To: TEST_NUMBER,
        From: "+17130000000",
        CallerName: "Test Caller",
        RecordingContentType: "audio/wav",
      });
      if (rec.status === 200) {
        pass("返回 200");
        let body = {};
        try { body = JSON.parse(rec.body); } catch { /* keep the raw text */ }
        if (body.workOrderId) {
          pass("生成了工单", body.workOrderId);
          createdOrderIds.push(body.workOrderId);
          const row = await mgmtQuery(
            `select call_type, ai_decision, recording_url, transcript, summary, summary_source, line_label, status
             from work_orders where id = '${body.workOrderId}';`,
          );
          const o = row[0] || {};
          o.call_type === "human" ? pass("call_type = human") : fail("call_type = human", String(o.call_type));
          o.recording_url ? pass("录音已保存", o.recording_url.slice(0, 70) + "…") : fail("录音已保存", "空");
          const tlen = Array.isArray(o.transcript) ? o.transcript.length : 0;
          tlen > 0 ? pass("转写已生成", `${tlen} 行`) : fail("转写已生成", "空");
          o.summary ? pass("摘要已生成", String(o.summary).slice(0, 70)) : fail("摘要已生成", "空");
          o.line_label ? pass("线路标签", o.line_label) : fail("线路标签", "空");
        } else {
          fail("生成了工单", rec.body.slice(0, 200));
        }
      } else {
        fail("recording 回调", `HTTP ${rec.status} ${rec.body.slice(0, 200)}`);
      }
    }
  } finally {
    // --- cleanup ---------------------------------------------------
    for (const id of createdOrderIds) {
      await mgmtQuery(`delete from work_orders where id = '${id}';`);
    }
    // The no-answer path records a "nobody answered" callback of its own.
    await mgmtQuery(`delete from work_orders where vapi_call_id like 'twilio-%CA_TEST%';`);
    await mgmtQuery(
      `update bosses set human_line_number = ${original.human_line_number ? `'${original.human_line_number}'` : "null"},
       human_line_enabled = ${original.human_line_enabled},
       human_line_fallback = '${original.human_line_fallback}' where id = '${ALEX_BOSS_ID}';`,
    );
    console.log(`\n  (已清理测试工单 ${createdOrderIds.length} 条，配置已恢复)`);
  }

  console.log("\n" + "═".repeat(62));
  console.log(`  结果: ${passed} 通过, ${failed} 失败`);
  console.log("═".repeat(62) + "\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
