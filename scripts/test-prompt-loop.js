#!/usr/bin/env node
/**
 * test-prompt-loop.js
 *
 * MULTI-TURN REPLAY of the calls that exposed the prompt bugs, run against a
 * live chat model (gpt-4o-mini, same as Vapi) with the real system prompt.
 *
 * Why a separate script: test-conversations.js covers single turns. The
 * 2026-10-14 failure only shows up across turns — the AI answered "What's
 * the issue?" to three different customer turns in a row. A one-shot test
 * cannot see that pattern.
 *
 * The three replays are real transcripts from the Vapi call log:
 *   L1  2026-10-14 17:37Z  "do you guys install TV now?"  -> opener x3  (LOST CALL)
 *   L2  2026-10-14 17:35Z  "Do you install Gmail?"        -> opener x1  (recovered)
 *   L3  2026-10-29 01:04Z  "My roof is leaking"            -> correct   (must stay correct)
 *
 * Run:
 *   node scripts/test-prompt-loop.js
 *   node scripts/test-prompt-loop.js --prompt-file /tmp/old-prompt.md
 *   OPENAI_CHAT_BASE_URL=https://demo-navy-chi-47.vercel.app/api/admin/prompt-check \
 *     node scripts/test-prompt-loop.js
 *
 * Transport (see test-conversations.js):
 *   - default: POST api.openai.com directly
 *   - with OPENAI_CHAT_BASE_URL: POST that route, which forwards from Vercel
 *     (required on machines that cannot reach api.openai.com)
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
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const CHAT_BASE = process.env.OPENAI_CHAT_BASE_URL;
const ADMIN_TOKEN = process.env.WEBHOOK_SECRET;

const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const PROMPT_FILE = argOf("--prompt-file");

// --- helpers -----------------------------------------------------------------

function httpsJson(url, options, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = bodyObj === undefined ? null : JSON.stringify(bodyObj);
    const headers = { ...(options.headers || {}) };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: options.method || "GET",
        headers,
        timeout: options.timeout || 90000,
      },
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
    if (body) req.write(body);
    req.end();
  });
}

async function loadPrompt() {
  if (PROMPT_FILE) {
    const md = fs.readFileSync(PROMPT_FILE, "utf-8");
    const blocks = [...md.matchAll(/```\n([\s\S]+?)\n```/g)].map((m) => m[1]);
    return blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
  }
  if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) throw new Error("no Vapi credentials");
  const r = await httpsJson(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
  });
  if (r.status !== 200) throw new Error(`Vapi ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const p = r.body?.model?.systemPrompt || r.body?.systemPrompt || "";
  if (!p) throw new Error("live assistant has no systemPrompt");
  return p;
}

function loadAssistantCfg() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vapi", "assistant.json"), "utf-8"));
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "check_and_quote",
      description: "Combined trade + service area + price quote",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            enum: ["plumbing", "electrical", "hvac", "handyman", "painting", "tv_mounting", "furniture_assembly", "smart_home", "drywall", "pressure_washing", "fence_deck", "window_covering", "art_hanging", "roofing_shingle", "general"],
          },
          zipcode: { type: "string", description: "5-digit US zip" },
        },
        required: ["issue_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_urgent",
      description: "Mark call as URGENT",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_uncertain",
      description: "Mark call as needing callback",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  },
  {
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
  },
];

async function chat(messages) {
  const useProxy = !!CHAT_BASE;
  const target = useProxy ? new URL(CHAT_BASE) : null;
  const headers = { "Content-Type": "application/json" };
  if (useProxy) headers["x-admin-token"] = ADMIN_TOKEN;
  else headers["Authorization"] = `Bearer ${OPENAI_API_KEY}`;

  const r = await httpsJson(
    useProxy ? target.toString() : "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers,
      timeout: 90000,
    },
    {
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 150,
      messages,
      tools: TOOLS,
    },
  );
  if (r.status !== 200) {
    throw new Error(`chat ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
  return r.body;
}

// Mirrors what the live /api/vapi/tools returns when the customer has not
// given a ZIP yet: in_service is null, so no price may be quoted.
const NO_ZIP_TOOL_RESULT = { in_trade: true, matched_trade: "general", in_service: null };

async function botTurn(messages) {
  const r = await chat(messages);
  const msg = r.choices[0].message;
  const text = (msg.content || "").trim();
  const toolCall = msg.tool_calls?.[0];
  if (toolCall) {
    messages.push({ role: "assistant", content: text || null, tool_calls: msg.tool_calls });
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(
        toolCall.function.name === "check_and_quote" ? NO_ZIP_TOOL_RESULT : { ok: true },
      ),
    });
    const r2 = await chat(messages);
    const msg2 = r2.choices[0].message;
    return (msg2.content || "").trim();
  }
  return text;
}

// --- the replays -------------------------------------------------------------

const SCENARIOS = [
  {
    id: "L1",
    label: "2026-10-14 17:37Z — the lost call (opener x3)",
    turns: [
      "Hi. Um, do you guys install TV now?",
      "Do you install TV now?",
      "What kind of work do you offer",
    ],
    mustNotSay: [/what'?s the issue/i, /what is the issue/i, /what'?s the problem/i],
    firstReplyMustMatch: [/tv/i],
  },
  {
    id: "L2",
    label: "2026-10-14 17:35Z — the sibling call (opener x1)",
    turns: ["Do you install Gmail?", "Now do you do you mount TV"],
    mustNotSay: [/what'?s the issue/i, /what is the issue/i, /what'?s the problem/i],
    firstReplyMustMatch: [/outside|gmail|it work|email/i],
  },
  {
    id: "L3",
    label: "2026-10-29 01:04Z — the good call (must stay good)",
    turns: ["Hey. My roof is leaking. Uh, are you able to help me fix?"],
    mustNotSay: [/what'?s the issue/i, /what is the issue/i, /what'?s the problem/i],
    firstReplyMustMatch: [/zip/i],
  },
];

async function main() {
  const prompt = await loadPrompt();
  const cfg = loadAssistantCfg();
  const firstMessage = cfg.firstMessage;
  console.log("═".repeat(58));
  console.log("  Handy Works AI — multi-turn prompt replay");
  console.log(`  prompt: ${PROMPT_FILE ? PROMPT_FILE : "live Vapi assistant"} (${prompt.length} chars)`);
  console.log(`  transport: ${CHAT_BASE ? CHAT_BASE : "api.openai.com (direct)"}`);
  console.log("═".repeat(58));

  let passed = 0;
  let failed = 0;

  for (const s of SCENARIOS) {
    console.log(`\n  ${s.id} — ${s.label}`);
    const messages = [
      { role: "system", content: prompt },
      { role: "assistant", content: firstMessage },
    ];
    const issues = [];

    for (let i = 0; i < s.turns.length; i++) {
      messages.push({ role: "user", content: s.turns[i] });
      const reply = await botTurn(messages);
      messages.push({ role: "assistant", content: reply });
      console.log(`    customer: ${s.turns[i]}`);
      console.log(`    AI:       ${reply || "(empty)"}`);

      for (const re of s.mustNotSay) {
        if (re.test(reply)) {
          issues.push(`turn ${i + 1}: said "${reply}" (matches ${re})`);
        }
      }
      if (i === 0 && s.firstReplyMustMatch) {
        const ok = s.firstReplyMustMatch.some((re) => re.test(reply));
        if (!ok) issues.push(`turn 1: expected ${s.firstReplyMustMatch} in "${reply}"`);
      }
    }

    if (issues.length === 0) {
      passed++;
      console.log("    ✓ PASS");
    } else {
      failed++;
      console.log(`    ✗ FAIL`);
      issues.forEach((i) => console.log(`        - ${i}`));
    }
  }

  console.log("\n" + "═".repeat(58));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(58) + "\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ Test crashed:", e.message);
  if (!CHAT_BASE) {
    console.error(
      "  Tip: api.openai.com is unreachable from this machine.\n" +
        "  Run with OPENAI_CHAT_BASE_URL=https://demo-navy-chi-47.vercel.app/api/admin/prompt-check",
    );
  }
  process.exit(1);
});
