#!/usr/bin/env node
/**
 * test-conversations.js
 *
 * MOCK CONVERSATION TEST — runs each User Test Case through the
 * ACTUAL system prompt + OpenAI gpt-4o-mini (same model Vapi uses).
 * No real Vapi calls. No phone numbers needed. Verifies that the
 * LLM responds with the expected decision and uses TTS-friendly
 * spelled-out numbers.
 *
 * This is faster, cheaper, and more reliable than real phone tests.
 * Use it to catch prompt regressions. Then do real phone tests for
 * final validation.
 *
 * Run: node scripts/test-conversations.js
 *      OPENAI_CHAT_BASE_URL=https://demo-navy-chi-47.vercel.app/api/admin/prompt-check \
 *        node scripts/test-conversations.js
 *      node scripts/test-conversations.js --prompt-file scripts/fixtures/system-prompt-2026-09-30.md
 *
 * Requires: OPENAI_API_KEY in .env.local
 *
 * If api.openai.com is unreachable from this machine, set OPENAI_CHAT_BASE_URL
 * to the deployed /api/admin/prompt-check route — the request then runs from
 * Vercel, where OpenAI is reachable. The route needs x-admin-token =
 * WEBHOOK_SECRET. This is how prompt regressions get caught at all: the
 * opener-echo loop of 2026-10-14 survived because this suite could not run.
 *
 * Expectations follow the CURRENT prompt policy (Alex's answered
 * questionnaire): no trip fee inside the 25 mile radius, gas / central AC /
 * panel / full roof / slab / appliance / renovation are referred out,
 * shingle roofing is in scope.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("✗ Missing OPENAI_API_KEY in .env.local");
  process.exit(1);
}

const argv = process.argv.slice(2);
const PROMPT_FILE = argv.includes("--prompt-file") ? argv[argv.indexOf("--prompt-file") + 1] : null;

// Load system prompt: the live one by default, a fixture with --prompt-file
let SYSTEM_PROMPT;
if (PROMPT_FILE) {
  const md = fs.readFileSync(PROMPT_FILE, "utf-8");
  const codeBlocks = [...md.matchAll(/```\n([\s\S]+?)\n```/g)].map((m) => m[1]);
  SYSTEM_PROMPT = codeBlocks.reduce((a, b) => (b.length > a.length ? b : a), "");
} else {
  const md = fs.readFileSync(path.join(__dirname, "..", "vapi", "system-prompt.md"), "utf-8");
  const codeBlocks = [...md.matchAll(/```\n([\s\S]+?)\n```/g)].map((m) => m[1]);
  SYSTEM_PROMPT = codeBlocks.reduce((a, b) => (b.length > a.length ? b : a), "");
}

// First message — read from the assistant config so the test always uses
// exactly what is live on Vapi. It used to be hardcoded here and went stale.
const ASSISTANT_CFG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vapi", "assistant.json"), "utf-8"),
);
const FIRST_MESSAGE = ASSISTANT_CFG.firstMessage;

// === Test cases ===
// Inlined here for speed; the canonical source is docs/US-USER-TEST-CASES.md
//
// expectIn     — every keyword must appear
// expectAnyIn  — each group is a set of alternatives; one of them must appear
// mustNotHave  — none of these may appear
const CASES = [
  // Group A: Regular — the customer states the problem, the AI quotes and
  // asks for time + name, the customer answers, the AI closes the call.
  // turns[] is the customer side of the conversation (the AI replies between).
  { id: "TC-001", category: "regular", turns: ["Hi, my kitchen sink has been leaking for a couple of days. I'm in 77005.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["plumbing"] },
  { id: "TC-002", category: "regular", turns: ["Need a ceiling fan installed in my bedroom. I'm in 77030.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["electrical"] },
  { id: "TC-003", category: "regular", turns: ["I just bought a 65-inch TV, need it mounted on the wall. I'm in 77450, Katy.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["tv mounting"] },
  { id: "TC-004", category: "regular", turns: ["Need one bedroom painted, about 12 by 12. I'm in 77584, Pearland.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["painting"] },
  { id: "TC-005", category: "regular", turns: ["I want to install a smart lock on my front door. I live in 77006.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["smart home"] },
  { id: "TC-006", category: "regular", turns: ["My toilet keeps running. I'm at 77401.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["plumbing"] },
  { id: "TC-007", category: "regular", turns: ["Got an IKEA bookshelf, need it assembled. 77002.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["furniture assembly"] },
  { id: "TC-008", category: "regular", turns: ["Need a drywall patch, like a fist-sized hole. 77489.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["drywall"] },
  { id: "TC-009", category: "regular", turns: ["Storm knocked down one fence panel. Need it replaced. Sugar Land, 77479.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectAnyIn: [["fence", "panel", "deck"]] },
  { id: "TC-010", category: "regular", turns: ["GFCI outlet in my bathroom keeps tripping. 77019.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["electrical"] },
  // Group B: Urgent
  { id: "TC-U01", category: "urgent", turns: ["My pipe just burst! Water is everywhere in my kitchen!"], expectDecision: "urgent", expectIn: ["stay safe", "i will certainly"], mustNotHave: ["zip", "what's your"] },
  { id: "TC-U02", category: "urgent", turns: ["I smell gas in my house, it's really strong!"], expectDecision: "urgent", expectIn: ["nine one one", "open windows"], mustNotHave: ["zip"] },
  { id: "TC-U03", category: "urgent", turns: ["The whole house lost power and we don't know why."], expectDecision: "urgent", expectIn: ["stay safe", "i will certainly"] },
  // Group C: Out of scope
  { id: "TC-OS01", category: "out_of_scope", turns: ["I have termites in my house, can you help?", "No, that's it."], expectDecision: "rejected", expectAnyIn: [["outside our scope", "outside what we do ourselves"]] },
  { id: "TC-OS02", category: "out_of_scope", turns: ["My pool pump is broken, can you fix it?", "No, that's it."], expectDecision: "rejected", expectAnyIn: [["outside our scope", "outside what we do ourselves"]] },
  { id: "TC-OS03", category: "out_of_scope", turns: ["I need help setting up my home WiFi network.", "No, that's it."], expectDecision: "rejected", expectAnyIn: [["outside our scope", "outside what we do ourselves"]] },
  // Group D: Out of service area
  { id: "TC-OSA01", category: "out_of_area", turns: ["Need someone to fix my water heater. I'm in 75201, Dallas.", "No, that's it."], expectDecision: "rejected", expectIn: ["outside"] },
  { id: "TC-OSA02", category: "out_of_area", turns: ["I have a small drywall hole, I'm in San Antonio, 78201.", "No, that's it."], expectDecision: "rejected", expectIn: ["outside"] },
  { id: "TC-OSA03", category: "out_of_area", turns: ["I need some electrical work, in 78701 Austin.", "No, that's it."], expectDecision: "rejected", expectIn: ["outside"] },
  // Group E: Customer behavior
  { id: "TC-B01", category: "behavior", turns: ["I need to talk to a real person, not a bot."], expectDecision: "unsure", expectIn: ["i will certainly", "call you back"] },
  // Group F: Multiple issues
  { id: "TC-M01", category: "multiple", turns: ["I have two things: a kitchen sink leak AND a TV I need mounted. 77005.", "Tomorrow morning. Mike, 713-555-0100."], expectDecision: "accepted", expectIn: ["plumbing", "tv"] },
  // Group G: Sub-coordinated / roofing
  // A roof leak is a normal roofing job (shingle replacement is in scope),
  // which is how the real 2026-10-29 roof call was handled: ZIP -> quote ->
  // accepted. The urgent path is covered by TC-U01..U03.
  // Water coming through the ceiling matches the prompt's urgent signal
  // ("active leak damaging walls or ceilings"), so urgent is the
  // policy-correct outcome here. The 2026-10-29 roof call ("my roof is
  // leaking", no ceiling mentioned) stayed a normal roofing job.
  { id: "TC-S01", category: "coordinated", turns: ["I have a roof leak, water coming in through the ceiling when it rains."], expectDecision: "urgent", expectIn: ["stay safe"] },
  // Gas is referred out per the answered questionnaire, so rejected is correct.
  { id: "TC-S02", category: "coordinated", turns: ["I need a new gas line run to my kitchen for a new stove. 77005.", "No, that's it."], expectDecision: "rejected", expectAnyIn: [["outside our scope", "outside what we do ourselves"]] },
  // Group H: the customer asks a QUESTION instead of describing a problem.
  // Real call 2026-10-14: "do you guys install TV now?" -> "What's the issue?" x3.
  // The AI must answer the question; it must never ask what the issue is.
  { id: "TC-Q01", category: "question", turns: ["Hi. Um, do you guys install TV now?", "Seven seven zero four seven. Tomorrow morning. Mike, 713-555-0100."], expectDecision: null, expectIn: ["tv mounting"], mustNotHave: ["what's the issue", "what is the issue"] },
  { id: "TC-Q02", category: "question", turns: ["What kind of work do you offer?", "Seven seven zero four seven. Tomorrow morning. Mike, 713-555-0100."], expectDecision: null, expectIn: ["handyman"], mustNotHave: ["what's the issue", "what is the issue"] },
  { id: "TC-Q03", category: "question", turns: ["Do you install Gmail?", "No, that's it."], expectDecision: null, expectAnyIn: [["outside our scope", "outside what we do ourselves"]], mustNotHave: ["what's the issue", "what is the issue"] },
  { id: "TC-Q04", category: "question", turns: ["Do you install TVs these days?", "Seven seven zero four seven. Tomorrow morning. Mike, 713-555-0100."], expectDecision: null, expectIn: ["tv mounting"], mustNotHave: ["what's the issue", "what is the issue"] },
];

// === OpenAI call ===
// Two transports:
//   1. direct  — POST api.openai.com (needs OpenAI reachable from here)
//   2. proxy   — POST OPENAI_CHAT_BASE_URL, which forwards to OpenAI from
//                the deployed app (needed when this machine cannot reach it)
const CHAT_BASE = process.env.OPENAI_CHAT_BASE_URL;
const ADMIN_TOKEN = process.env.WEBHOOK_SECRET;

function callOpenAI(messages, tools) {
  return new Promise((resolve, reject) => {
    const useProxy = !!CHAT_BASE;
    const target = useProxy ? new URL(CHAT_BASE) : null;
    const body = JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 150,
      messages,
      tools,
    });

    if (useProxy) {
      // Node's TLS stack intermittently times out against the Vercel domain
      // from this network while curl is fine — so use curl for the proxy hop.
      try {
        const out = execFileSync(
          "curl",
          [
            "-sS",
            "--http1.1",
            "--max-time",
            "90",
            "-w",
            "\n%{http_code}",
            "-X",
            "POST",
            target.toString(),
            "-H",
            "Content-Type: application/json",
            "-H",
            `x-admin-token: ${ADMIN_TOKEN}`,
            "--data",
            body,
          ],
          { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
        );
        const cut = out.lastIndexOf("\n");
        const status = Number(out.slice(cut + 1).trim());
        const data = out.slice(0, cut);
        if (status < 200 || status >= 300) {
          reject(new Error(`chat ${status}: ${data.slice(0, 200)}`));
          return;
        }
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
      return;
    }

    const headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Parse error: ${data.slice(0, 200)}`));
          }
        } else {
          reject(new Error(`OpenAI ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// === Tool simulation ===
// Mirrors what the live /api/vapi/tools returns, using the current Alex
// pricing config (no trip fee inside the 25 mile radius).
const PRICE_LIST = {
  hvac: [150, 600], drywall: [150, 800], general: [75, 500], handyman: [75, 400],
  painting: [200, 1500], plumbing: [120, 500], electrical: [120, 500],
  fence_deck: [200, 2000], smart_home: [80, 600], art_hanging: [100, 400],
  tv_mounting: [90, 200], roofing_shingle: [400, 2500], window_covering: [75, 400],
  pressure_washing: [150, 600], furniture_assembly: [75, 250],
};

function simulateTool(name, args, c) {
  if (name === "check_and_quote") {
    const trade = args?.issue_type || "general";
    const band = PRICE_LIST[trade] || PRICE_LIST.general;
    if (!args?.zipcode) {
      // No ZIP yet — the live route returns in_service: null, so no price.
      return { in_trade: true, matched_trade: trade, in_service: null };
    }
    if (c.category === "out_of_area") {
      return {
        in_trade: true,
        matched_trade: trade,
        in_service: false,
        reason: "outside the 25 mile service area",
        distance_miles: 180,
      };
    }
    return {
      in_trade: true,
      matched_trade: trade,
      in_service: true,
      distance_miles: 3,
      trip_fee: 0,
      fuel_surcharge: 0,
      total_trip_fee: 0,
      range_low: band[0],
      range_high: band[1],
      total_low: band[0],
      total_high: band[1],
      currency_symbol: "$",
    };
  }
  return { ok: true };
}

/**
 * Coarse mirror of the app's fallback: when the AI never calls end_call,
 * the work order still gets a decision — the app classifies it from the
 * transcript. The harness does the same so a case reflects what the
 * PRODUCT ends up with, not whether the model remembered a tool call.
 * The end_call hit rate is printed separately so the signal is not lost.
 */
function inferOutcomeFromSpeech(text) {
  const t = text.toLowerCase();
  if (/stay safe|nine one one|\b911\b|gas smell|burst pipe|water is everywhere/.test(t)) return "urgent";
  if (/outside what we do ourselves|outside our scope|we don'?t do that work|refer you to/.test(t)) return "rejected";
  if (/i will certainly call to follow up|got it,/.test(t)) return "accepted";
  return "unsure";
}

// === Test runner ===
let passed = 0;
let failed = 0;
const results = [];
const endCallMisses = [];

async function runCase(c) {
  // Use the REAL tool definitions from vapi/assistant.json — the same ones
  // Vapi serves. A terser hand-written copy (end_call described as just
  // "End the call") makes the model skip the tool call entirely, which
  // produced fake failures in this suite.
  const tools = ASSISTANT_CFG.tools.map((t) => (t.function ? t : { type: "function", function: t }));

  // A real call is MULTI-TURN: the customer states the problem, the AI quotes
  // and asks for time + name, the customer answers, and only then does the AI
  // close the call with end_call. Asserting end_call after a single customer
  // utterance tests nothing, so each case carries the customer's side of the
  // conversation in turns[].
  const customerTurns = c.turns || (c.customer ? [c.customer] : []);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "assistant", content: FIRST_MESSAGE },
  ];

  try {
    const texts = [];
    const toolCalls = [];
    let endCallArgs = null;

    for (const utterance of customerTurns) {
      messages.push({ role: "user", content: utterance });

      // One AI turn = up to 3 model rounds (model -> tool results -> model ...)
      for (let round = 0; round < 3; round++) {
        const r = await callOpenAI(messages, tools);
        const assistantMsg = r.choices[0].message;
        const text = (assistantMsg.content || "").trim();
        if (text) texts.push(text);

        const calls = assistantMsg.tool_calls || [];
        if (calls.length === 0) break;

        for (const call of calls) {
          const name = call.function?.name;
          let args = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch { args = {}; }
          toolCalls.push(name);
          if (name === "end_call") endCallArgs = args;
        }

        // Feed every tool call back — OpenAI rejects a tool_calls message that
        // is not followed by one tool message per tool_call_id.
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: assistantMsg.tool_calls,
        });
        for (const call of calls) {
          const name = call.function?.name;
          let args = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch { args = {}; }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(simulateTool(name, args, c)),
          });
        }
        if (endCallArgs) break;
      }
      if (endCallArgs) break;
    }

    const allText = texts.join(" ");
    const lastTool = toolCalls[toolCalls.length - 1] || null;
    const issues = [];

    // 1. Decision — from end_call when the AI called it, otherwise from the
    //    transcript (same fallback the app applies).
    const finalOutcome = endCallArgs?.outcome || inferOutcomeFromSpeech(allText);
    if (!endCallArgs) endCallMisses.push(c.id);
    if (c.expectDecision) {
      if (finalOutcome !== c.expectDecision) {
        issues.push(`expected outcome=${c.expectDecision}, got ${finalOutcome}`);
      }
    }

    // 2. expectIn keywords
    for (const k of c.expectIn || []) {
      if (!allText.toLowerCase().includes(k.toLowerCase())) {
        issues.push(`missing keyword: "${k}"`);
      }
    }

    // 2b. expectAnyIn — each group is a set of alternatives
    for (const group of c.expectAnyIn || []) {
      if (!group.some((k) => allText.toLowerCase().includes(k.toLowerCase()))) {
        issues.push(`missing one of: ${group.map((k) => `"${k}"`).join(" / ")}`);
      }
    }

    // 3. mustNotHave
    for (const k of c.mustNotHave || []) {
      if (allText.toLowerCase().includes(k.toLowerCase())) {
        issues.push(`unexpected keyword: "${k}"`);
      }
    }

    // 4. No digit characters in prices (TTS rule)
    const pricePattern = /\$\d|\b\d+ dollars?|\b\d+ to \d+|\b\d+-\d+/g;
    if (pricePattern.test(allText)) {
      const matches = allText.match(pricePattern);
      const priceMatches = matches.filter(m => /\$|\bdollars?|\bto \d|\d-\d/.test(m));
      if (priceMatches.length > 0) {
        issues.push(`possible TTS-bad number: ${priceMatches.join(", ")}`);
      }
    }

    // 5. No Chinese characters
    if (/[\u4e00-\u9fff]/.test(allText)) {
      issues.push("contains Chinese characters (TTS misreads)");
    }

    // 6. Response length (should be short, ≤ 80 tokens ≈ ≤ 60 words)
    const wordCount = allText.split(/\s+/).filter(Boolean).length;
    if (wordCount > 80) {
      issues.push(`too long: ${wordCount} words`);
    }

    // 7. Global guard — the AI must never echo the opening question.
    // The 2026-10-14 loop was exactly this, and it cost a real call.
    if (/\bwhat['’]?s the issue\b/i.test(allText)) {
      issues.push("echoed the opening question");
    }

    // 8. Global guard — asking "what's the problem" instead of acting.
    // Allowed: asking for the ZIP. Not allowed: re-asking what the issue is.
    if (/\bwhat['’]?s (the |your )?(problem|repair)\b/i.test(allText)) {
      issues.push("asked what the problem is instead of answering");
    }

    if (issues.length === 0) {
      passed++;
      results.push({ id: c.id, status: "PASS" });
    } else {
      failed++;
      results.push({ id: c.id, status: "FAIL", issues, text: allText.slice(0, 200) });
    }
  } catch (e) {
    failed++;
    results.push({ id: c.id, status: "ERROR", error: e.message });
  }
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Handy Works AI - Conversation Test");
  console.log(`  (${CASES.length} cases, prompt ${PROMPT_FILE || "repo"})`);
  console.log(`  transport: ${CHAT_BASE ? CHAT_BASE : "api.openai.com (direct)"}`);
  console.log("═══════════════════════════════════════════\n");

  for (const c of CASES) {
    process.stdout.write(`  ${c.id} (${c.category})... `);
    await runCase(c);
    const r = results[results.length - 1];
    if (r.status === "PASS") {
      console.log("✓");
    } else {
      console.log(`✗ ${r.issues ? r.issues.join("; ") : r.error}`);
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(
    `  end_call called by the AI: ${CASES.length - endCallMisses.length}/${CASES.length}` +
      (endCallMisses.length ? ` — missed in ${endCallMisses.join(", ")} (the app infers these from the transcript)` : ""),
  );
  console.log("═══════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("Failed cases:\n");
    for (const r of results.filter((r) => r.status !== "PASS")) {
      console.log(`  ${r.id}: ${r.status}`);
      if (r.issues) r.issues.forEach((i) => console.log(`    - ${i}`));
      if (r.error) console.log(`    - ${r.error}`);
      if (r.text) console.log(`    AI: "${r.text}..."`);
    }
    console.log();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ Test crashed:", e.message);
  process.exit(1);
});
