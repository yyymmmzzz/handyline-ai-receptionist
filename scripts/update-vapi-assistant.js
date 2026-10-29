#!/usr/bin/env node
/**
 * update-vapi-assistant.js
 *
 * PATCH Vapi main US assistant (Alex / Handy Works). Re-runnable.
 *
 * Reads:
 *   - vapi/system-prompt.md (full prompt, code-fenced)
 *   - vapi/assistant.json (model, voice, first message, delays, tools)
 *
 * Before running:
 *   1. Edit vapi/system-prompt.md (prompt body)
 *   2. Edit vapi/assistant.json (model/voice/delays/tools)
 *   3. Then: node scripts/update-vapi-assistant.js
 *
 * Idempotent — re-running PATCHes the same assistant.
 */

const fs = require("fs");
const path = require("path");

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

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
if (!VAPI_API_KEY) {
  console.error("✗ Missing VAPI_API_KEY in .env.local");
  process.exit(1);
}
if (!ASSISTANT_ID) {
  console.error("✗ Missing VAPI_ASSISTANT_ID in .env.local");
  process.exit(1);
}

const https = require("https");

// Read assistant.json (model, voice, firstMessage, delays, tools)
const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vapi", "assistant.json"), "utf-8"),
);

// Refuse to send with placeholder values (skip systemPrompt + serverUrlSecret — filled from elsewhere)
const SKIP_PLACEHOLDER_KEYS = new Set(["systemPrompt", "serverUrlSecret"]);
function checkPlaceholders(obj, path = "") {
  for (const [k, v] of Object.entries(obj)) {
    const full = `${path}.${k}`;
    if (SKIP_PLACEHOLDER_KEYS.has(k)) continue;
    if (typeof v === "string" && v.includes("<<") && v.includes(">>")) {
      throw new Error(`Placeholder not filled: ${full} = ${v}`);
    }
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      checkPlaceholders(v, full);
    }
  }
}
try {
  checkPlaceholders(cfg);
} catch (e) {
  console.error(`✗ ${e.message}`);
  console.error("  → Fill in placeholders in vapi/assistant.json");
  process.exit(1);
}

// Read system prompt markdown and inject into the model config
// The .md file has 2+ code blocks: "First Message" (small) then "Full System Prompt" (the main one)
// We want the LARGEST one (or the 2nd one)
const sysPromptPath = path.join(__dirname, "..", "vapi", "system-prompt.md");
const md = fs.readFileSync(sysPromptPath, "utf-8");
const codeBlocks = [...md.matchAll(/```\n([\s\S]+?)\n```/g)].map((m) => m[1]);
if (codeBlocks.length === 0) {
  console.error("✗ Could not find code-fenced prompt block in system-prompt.md");
  process.exit(1);
}
// Pick the largest code block (the full system prompt)
const match = codeBlocks.reduce((a, b) => (b.length > a.length ? b : a), "");
cfg.model.systemPrompt = match;

console.log(`→ PATCH https://api.vapi.ai/assistant/${ASSISTANT_ID}`);
console.log(`  name: ${cfg.name}`);
console.log(`  model: ${cfg.model.provider}/${cfg.model.model} (temp=${cfg.model.temperature}, maxTokens=${cfg.model.maxTokens})`);
console.log(`  voice: ${cfg.voice.provider}/${cfg.voice.voiceId} (model ${cfg.voice.model})`);
console.log(`  firstMessage: ${(cfg.firstMessage || "").slice(0, 60)}`);
console.log(`  tools: ${cfg.tools.length}`);
console.log(`  silenceTimeout: ${cfg.silenceTimeoutSeconds}s / responseDelay: ${cfg.responseDelaySeconds}s / llmDelay: ${cfg.llmRequestDelaySeconds}s`);
console.log(`  systemPrompt: ${cfg.model.systemPrompt.length} chars`);

if (process.env.SET_SERVER_URL_SECRET === "1" && !process.env.WEBHOOK_SECRET) {
  console.error("✗ SET_SERVER_URL_SECRET=1 but WEBHOOK_SECRET is not set — refusing to push.");
  process.exit(1);
}

const body = JSON.stringify({
  name: cfg.name,
  model: {
    provider: cfg.model.provider,
    model: cfg.model.model,
    temperature: cfg.model.temperature,
    maxTokens: cfg.model.maxTokens,
    systemPrompt: cfg.model.systemPrompt,
    tools: cfg.tools,
  },
  voice: cfg.voice,
  credentialIds: process.env.ELEVENLABS_CREDENTIAL_ID
    ? [process.env.ELEVENLABS_CREDENTIAL_ID]
    : [],
  firstMessage: cfg.firstMessage,
  endCallPhrases: cfg.endCallPhrases || [],
  endCallFunctionEnabled: cfg.endCallFunctionEnabled !== false,
  silenceTimeoutSeconds: cfg.silenceTimeoutSeconds,
  responseDelaySeconds: cfg.responseDelaySeconds,
  llmRequestDelaySeconds: cfg.llmRequestDelaySeconds,
  maxDurationSeconds: cfg.maxDurationSeconds,
  serverUrl: cfg.serverUrl,
  // serverUrlSecret is deliberately NOT included.
  //
  // The live assistant currently has no secret, and the deployed webhook
  // tolerates a missing header (it only rejects a MISMATCHED one). Pushing
  // our local WEBHOOK_SECRET would make Vapi start sending a header — and
  // if that value differs from the one on Vercel, every webhook would 401
  // and the whole pipeline would go dark. We cannot compare the two from
  // here, so leave the live value untouched.
  //
  // Opt in deliberately once the Vercel env is confirmed to match:
  //   SET_SERVER_URL_SECRET=1 node scripts/update-vapi-assistant.js
  ...(process.env.SET_SERVER_URL_SECRET === "1"
    ? { serverUrlSecret: process.env.WEBHOOK_SECRET || cfg.serverUrlSecret }
    : {}),
});

const req = https.request(
  {
    hostname: "api.vapi.ai",
    path: "/assistant/" + ASSISTANT_ID,
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const a = JSON.parse(data);
        console.log(`\n✓ Vapi assistant updated`);
        console.log(`  ID: ${a.id}`);
        console.log(`  Model: ${a.model?.provider}/${a.model?.model}`);
        console.log(`  Voice: ${a.voice?.provider}/${a.voice?.voiceId}/${a.voice?.model}`);
        console.log(`  Tools: ${a.model?.tools?.length}`);
        console.log(`  firstMessage: ${(a.firstMessage || "").slice(0, 60)}`);
      } else {
        console.error(`\n✗ Vapi API error ${res.statusCode}`);
        console.error(data.slice(0, 1000));
        process.exit(1);
      }
    });
  },
);
req.on("error", (e) => console.error("✗", e.message));
req.write(body);
req.end();
