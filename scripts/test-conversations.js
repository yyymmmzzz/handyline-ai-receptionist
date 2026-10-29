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
 *
 * Requires: OPENAI_API_KEY in .env.local
 *
 * If api.openai.com is unreachable from this machine, set OPENAI_CHAT_BASE_URL
 * to the deployed /api/admin/prompt-check route — the request then runs from
 * Vercel, where OpenAI is reachable. The route needs x-admin-token =
 * WEBHOOK_SECRET. This is how prompt regressions get caught at all: the
 * opener-echo loop of 2026-10-14 survived because this suite could not run.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

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

// Load system prompt from Vapi assistant config (live)
// For speed, we also keep a local fallback copy.
const SYS_PROMPT_PATH = path.join(__dirname, "..", "vapi", "system-prompt.md");
const md = fs.readFileSync(SYS_PROMPT_PATH, "utf-8");
const codeBlocks = [...md.matchAll(/```\n([\s\S]+?)\n```/g)].map((m) => m[1]);
const SYSTEM_PROMPT = codeBlocks.reduce((a, b) => (b.length > a.length ? b : a), "");

// First message — read from the assistant config so the test always uses
// exactly what is live on Vapi. It used to be hardcoded here and went stale.
const ASSISTANT_CFG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vapi", "assistant.json"), "utf-8"),
);
const FIRST_MESSAGE = ASSISTANT_CFG.firstMessage;

// === Test cases ===
// Inlined here for speed; the canonical source is docs/US-USER-TEST-CASES.md
const CASES = [
  // Group A: Regular
  { id: "TC-001", category: "regular", customer: "Hi, my kitchen sink has been leaking for a couple of days. I'm in 77005.", expectDecision: "accepted", expectIn: ["plumbing", "in service", "eighty-nine"] },
  { id: "TC-002", category: "regular", customer: "Need a ceiling fan installed in my bedroom. I'm in 77030.", expectDecision: "accepted", expectIn: ["electrical", "in service"] },
  { id: "TC-003", category: "regular", customer: "I just bought a 65-inch TV, need it mounted on the wall. I'm in 77450, Katy.", expectDecision: "accepted", expectIn: ["tv mounting", "in service"] },
  { id: "TC-004", category: "regular", customer: "Need one bedroom painted, about 12 by 12. I'm in 77584, Pearland.", expectDecision: "accepted", expectIn: ["painting", "in service"] },
  { id: "TC-005", category: "regular", customer: "I want to install a smart lock on my front door. I live in 77006.", expectDecision: "accepted", expectIn: ["smart home", "in service"] },
  { id: "TC-006", category: "regular", customer: "My toilet keeps running. I'm at 77401.", expectDecision: "accepted", expectIn: ["plumbing", "in service"] },
  { id: "TC-007", category: "regular", customer: "Got an IKEA bookshelf, need it assembled. 77002.", expectDecision: "accepted", expectIn: ["furniture assembly", "in service"] },
  { id: "TC-008", category: "regular", customer: "Need a drywall patch, like a fist-sized hole. 77489.", expectDecision: "accepted", expectIn: ["drywall", "in service"] },
  { id: "TC-009", category: "regular", customer: "Storm knocked down one fence panel. Need it replaced. Sugar Land, 77479.", expectDecision: "accepted", expectIn: ["fence", "in service"] },
  { id: "TC-010", category: "regular", customer: "GFCI outlet in my bathroom keeps tripping. 77019.", expectDecision: "accepted", expectIn: ["electrical", "in service"] },
  // Group B: Urgent
  { id: "TC-U01", category: "urgent", customer: "My pipe just burst! Water is everywhere in my kitchen!", expectDecision: "urgent", expectIn: ["stay safe", "i will certainly"], mustNotHave: ["zip", "what's your"] },
  { id: "TC-U02", category: "urgent", customer: "I smell gas in my house, it's really strong!", expectDecision: "urgent", expectIn: ["911", "open windows"], mustNotHave: ["zip"] },
  { id: "TC-U03", category: "urgent", customer: "The whole house lost power and we don't know why.", expectDecision: "urgent", expectIn: ["stay safe", "i will certainly"] },
  // Group C: Out of scope
  { id: "TC-OS01", category: "out_of_scope", customer: "I have termites in my house, can you help?", expectDecision: "rejected", expectIn: ["outside our scope", "pest"] },
  { id: "TC-OS02", category: "out_of_scope", customer: "My pool pump is broken, can you fix it?", expectDecision: "rejected", expectIn: ["outside our scope", "pool"] },
  { id: "TC-OS03", category: "out_of_scope", customer: "I need help setting up my home WiFi network.", expectDecision: "rejected", expectIn: ["outside our scope", "it"] },
  // Group D: Out of service area
  { id: "TC-OSA01", category: "out_of_area", customer: "Need someone to fix my water heater. I'm in 75201, Dallas.", expectDecision: "rejected", expectIn: ["outside", "twenty-five"] },
  { id: "TC-OSA02", category: "out_of_area", customer: "I have a small drywall hole, I'm in San Antonio, 78201.", expectDecision: "rejected", expectIn: ["outside", "twenty-five"] },
  { id: "TC-OSA03", category: "out_of_area", customer: "I need some electrical work, in 78701 Austin.", expectDecision: "rejected", expectIn: ["outside", "twenty-five"] },
  // Group E: Customer behavior
  { id: "TC-B01", category: "behavior", customer: "I need to talk to a real person, not a bot.", expectDecision: "unsure", expectIn: ["i will certainly", "call you back"] },
  // Group F: Multiple issues
  { id: "TC-M01", category: "multiple", customer: "I have two things: a kitchen sink leak AND a TV I need mounted. 77005.", expectDecision: "accepted", expectIn: ["plumbing", "tv", "eighty-nine"] },
  // Group G: Sub-coordinated
  { id: "TC-S01", category: "coordinated", customer: "I have a roof leak, water coming in through the ceiling when it rains.", expectDecision: "accepted", expectIn: ["coordinate", "partner", "eighty-nine"] },
  { id: "TC-S02", category: "coordinated", customer: "Need a new gas line run to my kitchen for a new stove. 77005.", expectDecision: "accepted", expectIn: ["coordinate", "partner", "eighty-nine"] },
  // Group H: the customer asks a QUESTION instead of describing a problem.
  // Real call 2026-10-14: "do you guys install TV now?" -> "What's the issue?" x3.
  // The AI must answer the question; it must never ask what the issue is.
  { id: "TC-Q01", category: "question", customer: "Hi. Um, do you guys install TV now?", expectDecision: null, expectIn: ["tv mounting"], mustNotHave: ["what's the issue", "what is the issue"] },
  { id: "TC-Q02", category: "question", customer: "What kind of work do you offer?", expectDecision: null, expectIn: ["handyman"], mustNotHave: ["what's the issue", "what is the issue"] },
  { id: "TC-Q03", category: "question", customer: "Do you install Gmail?", expectDecision: null, expectIn: ["outside our scope"], mustNotHave: ["what's the issue", "what is the issue"] },
  { id: "TC-Q04", category: "question", customer: "Do you install TVs these days?", expectDecision: null, expectIn: ["tv mounting"], mustNotHave: ["what's the issue", "what is the issue"] },
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
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    if (useProxy) {
      headers["x-admin-token"] = ADMIN_TOKEN;
    } else {
      headers["Authorization"] = `Bearer ${OPENAI_API_KEY}`;
    }
    const req = https.request({
      hostname: useProxy ? target.hostname : "api.openai.com",
      path: useProxy ? target.pathname + target.search : "/v1/chat/completions",
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

// === Test runner ===
let passed = 0;
let failed = 0;
const results = [];

async function runCase(c) {
  // Tool definitions (same as the real Vapi assistant)
  const tools = [{
    type: "function",
    function: {
      name: "check_and_quote",
      description: "Combined trade + service area + price quote",
      parameters: {
        type: "object",
        properties: {
          issue_type: { type: "string", enum: ["plumbing", "electrical", "hvac", "handyman", "painting", "tv_mounting", "furniture_assembly", "smart_home", "drywall", "pressure_washing", "fence_deck", "window_covering", "general"] },
          zipcode: { type: "string", description: "5-digit US zip" },
        },
        required: ["issue_type"],
      },
    },
  }, {
    type: "function",
    function: {
      name: "flag_urgent",
      description: "Mark call as URGENT",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  }, {
    type: "function",
    function: {
      name: "flag_uncertain",
      description: "Mark call as needing callback",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  }, {
    type: "function",
    function: {
      name: "end_call",
      description: "End the call",
      parameters: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["accepted", "urgent", "unsure", "rejected"] },
          summary: { type: "string" },
        },
        required: ["outcome", "summary"],
      },
    },
  }];

  // First message (what the AI says)
  const firstMessage = FIRST_MESSAGE;

  // The conversation: AI greets, customer says their issue
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "assistant", content: firstMessage },
    { role: "user", content: c.customer },
  ];

  try {
    const r1 = await callOpenAI(messages, tools);
    const assistantMsg1 = r1.choices[0].message;
    const text1 = (assistantMsg1.content || "").trim();
    const toolCall1 = assistantMsg1.tool_calls?.[0];
    const toolName1 = toolCall1?.function?.name;
    const toolArgs1 = toolCall1 ? JSON.parse(toolCall1.function.arguments) : null;

    // If AI called check_and_quote, simulate the tool response
    if (toolName1 === "check_and_quote" && toolArgs1) {
      // Simulate: in scope (always for our test), in service (always for our test unless out_of_area case)
      const inService = c.category !== "out_of_area";
      const toolResponse = {
        in_trade: true,
        in_service: inService,
        distance_miles: 3,
        trip_fee: 89,
        fuel_surcharge: 0,
        total_trip_fee: 89,
        range_low: 120,
        range_high: 500,
        total_low: 209,
        total_high: 589,
      };
      messages.push({ role: "assistant", content: text1 || null, tool_calls: assistantMsg1.tool_calls });
      messages.push({ role: "tool", tool_call_id: toolCall1.id, content: JSON.stringify(toolResponse) });
    } else if (toolName1) {
      // Some other tool — feed it back as success
      messages.push({ role: "assistant", content: text1 || null, tool_calls: assistantMsg1.tool_calls });
      messages.push({ role: "tool", tool_call_id: toolCall1.id, content: JSON.stringify({ ok: true }) });
    } else {
      messages.push({ role: "assistant", content: text1 });
    }

    // Get the second AI response
    const r2 = await callOpenAI(messages, tools);
    const assistantMsg2 = r2.choices[0].message;
    const text2 = (assistantMsg2.content || "").trim();
    const toolCall2 = assistantMsg2.tool_calls?.[0];
    const toolName2 = toolCall2?.function?.name;
    const toolArgs2 = toolCall2 ? JSON.parse(toolCall2.function.arguments) : null;

    // Combine all AI text
    const allText = [text1, text2].filter(Boolean).join(" ");
    const allTools = [toolName1, toolName2].filter(Boolean);
    const lastTool = allTools[allTools.length - 1] || null;
    const lastToolArgs = toolName2 === "end_call" ? toolArgs2 : (toolName1 === "end_call" ? toolArgs1 : null);

    // === Score ===
    const issues = [];

    // 1. Decision (from end_call outcome)
    if (c.expectDecision === "accepted" || c.expectDecision === "urgent" || c.expectDecision === "rejected" || c.expectDecision === "unsure") {
      if (lastTool !== "end_call") {
        issues.push(`expected end_call, got: ${lastTool || "no tool"}`);
      } else if (lastToolArgs?.outcome !== c.expectDecision) {
        issues.push(`expected outcome=${c.expectDecision}, got ${lastToolArgs?.outcome}`);
      }
    }

    // 2. expectIn keywords
    for (const k of c.expectIn || []) {
      if (!allText.toLowerCase().includes(k.toLowerCase())) {
        issues.push(`missing keyword: "${k}"`);
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
      // Allow some digits (zip codes mentioned in response are OK)
      // Only flag price-like patterns
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
    if (/\bwhat'?s the issue\b/i.test(allText)) {
      issues.push("echoed the opening question");
    }

    // 8. Global guard — answering a customer question with a question.
    // Allowed: asking for the ZIP. Not allowed: asking what the issue is.
    if (/\bwhat'?s (the |your )?(problem|repair|issue)\b/i.test(allText)) {
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
  console.log("  (" + CASES.length + " cases)");
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
