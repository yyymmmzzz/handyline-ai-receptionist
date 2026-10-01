#!/usr/bin/env node
/**
 * test-static-config.js
 *
 * STATIC CONFIG TEST — no Vapi calls, no OpenAI calls.
 * Verifies that the AI receptionist's config is correct and complete.
 *
 * Checks:
 *  1. Vapi US assistant exists with correct model, voice, serverUrl
 *  2. System prompt contains all required patterns
 *  3. Tools are properly defined (4 tools, expected schemas)
 *  4. Supabase Alex boss has all 13 trades + correct phone + service area
 *  5. Vapi assistant ID matches the boss's vapi_assistant_id
 *
 * Run: node scripts/test-static-config.js
 *
 * Exit code: 0 = all pass, 1 = any fail
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

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALICE_BOSS_ID = "91e6d168-eb60-42cb-a230-062f27b8c714";

let passed = 0;
let failed = 0;
const results = [];

function pass(name, detail = "") {
  results.push({ status: "PASS", name, detail });
  passed++;
  console.log(`  ✓ ${name}${detail ? "  — " + detail : ""}`);
}
function fail(name, detail) {
  results.push({ status: "FAIL", name, detail });
  failed++;
  console.log(`  ✗ ${name}  — ${detail}`);
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// === TEST 1: Vapi assistant exists with correct config ===
// LOCAL=true validates ./vapi/assistant.json instead of the live Vapi
// assistant. Use it to verify edits BEFORE pushing to Vapi.
const LOCAL = process.argv.includes("--local");

async function testVapiAssistant() {
  console.log(`\n[1] Vapi US assistant${LOCAL ? " (LOCAL assistant.json — not pushed)" : " (LIVE Vapi API)"}`);

  if (LOCAL) {
    let a;
    try {
      a = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vapi", "assistant.json"), "utf8"));
    } catch (e) {
      fail("Read local assistant.json", e.message);
      return null;
    }
    pass("Read local assistant.json", `name: ${a.name}`);
    return checkAssistantShape(a);
  }

  if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
    fail("Vapi env vars", "VAPI_API_KEY or VAPI_ASSISTANT_ID missing");
    return null;
  }
  const res = await fetchJson(
    `https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`,
    { headers: { Authorization: `Bearer ${VAPI_API_KEY}` } }
  );
  if (res.status !== 200) {
    fail("Vapi API reachable", `status ${res.status}`);
    return null;
  }
  const a = res.body;
  pass("Vapi API reachable", `name: ${a.name}`);
  return checkAssistantShape(a);
}

// Shared shape checks — runs against both local and live assistant objects.
// Live Vapi API nests tools + systemPrompt under `model`; the local
// vapi/assistant.json keeps them at the top level. Normalize both.
function checkAssistantShape(a) {
  const m = a.model || {};
  const tools = a.tools || m.tools || [];
  const systemPrompt = a.systemPrompt || m.systemPrompt || "";

  // Model
  if (m.provider === "openai" && m.model === "gpt-4o-mini") {
    pass("Model is gpt-4o-mini");
  } else {
    fail("Model", `expected openai/gpt-4o-mini, got ${m.provider}/${m.model}`);
  }
  if (m.maxTokens && m.maxTokens <= 100) {
    pass(`maxTokens short (${m.maxTokens})`, "encourages brevity");
  } else {
    fail("maxTokens too high", `${m.maxTokens} — should be ≤ 100 to force short replies`);
  }
  if (m.temperature !== undefined && m.temperature <= 0.3) {
    pass(`Temperature stable (${m.temperature})`);
  } else {
    fail("Temperature", `${m.temperature} — should be ≤ 0.3 for consistency`);
  }

  // Voice
  const v = a.voice || {};
  if (v.provider === "11labs" && v.model === "eleven_turbo_v2_5") {
    pass("Voice is eleven_turbo_v2_5", "good for number reading");
  } else {
    fail("Voice model", `expected 11labs/eleven_turbo_v2_5, got ${v.provider}/${v.model}`);
  }

  // Server URL
  if (a.serverUrl && a.serverUrl.includes("vercel.app")) {
    pass("Server URL set", a.serverUrl);
  } else {
    fail("Server URL", `not set or not Vercel: ${a.serverUrl}`);
  }

  // First message — Alex asked to be called "Handy Works service desk",
  // NOT by his personal name (questionnaire Q8.4, 2026-09-30).
  if (a.firstMessage && a.firstMessage.includes("Handy Works")) {
    pass("First message OK", a.firstMessage);
  } else {
    fail("First message", a.firstMessage);
  }
  if (a.firstMessage && /\bAlex\b/.test(a.firstMessage)) {
    fail("First message uses owner first name", `must not say "Alex": ${a.firstMessage}`);
  } else {
    pass("First message avoids owner first name", a.firstMessage);
  }

  // Tools count
  if (tools.length === 4) {
    pass("Tools count = 4", "check_and_quote + flag_urgent + flag_uncertain + end_call");
  } else {
    fail("Tools count", `expected 4, got ${tools.length}: ${tools.map((t) => t.function?.name).join(", ")}`);
  }
  const toolNames = tools.map((t) => t.function?.name).sort();
  const expected = ["check_and_quote", "end_call", "flag_uncertain", "flag_urgent"];
  if (JSON.stringify(toolNames) === JSON.stringify(expected)) {
    pass("Tool names correct", toolNames.join(", "));
  } else {
    fail("Tool names", `expected ${expected.join(", ")}, got ${toolNames.join(", ")}`);
  }

  return { assistant: a, systemPrompt };
}

// === TEST 2: System prompt patterns ===
async function testSystemPrompt(assistant) {
  console.log("\n[2] System prompt content");
  if (!assistant) {
    fail("Skipped (no assistant data)");
    return;
  }
  const prompt = assistant.systemPrompt || "";

  const checks = [
    { pattern: /I will certainly/, name: "Uses 'I will certainly'" },
    { pattern: /Alex will call/, name: "No 'Alex will call' (old phrasing)", shouldFail: true },
    { pattern: /Have a good day/, name: "Uses 'Have a good day' closing" },
    { pattern: /Anything else/, name: "Has 'Anything else?' check" },
    { pattern: /twenty-five/, name: "Uses 'twenty-five' (not 25)" },

    // --- Trip fee (questionnaire 2026-09-30): no trip fee inside radius ---
    { pattern: /eighty-nine/, name: "No 'eighty-nine' trip fee (Alex has none)", shouldFail: true },
    { pattern: /NO trip fee/i, name: "States there is NO trip fee" },
    { pattern: /trip fee is payable|payable whether or not|small trip fee/i, name: "Out-of-area fee is not credited" },

    // --- Hours (questionnaire Section 2) ---
    { pattern: /closed Sunday/i, name: "Sunday is closed" },
    { pattern: /eight to six/i, name: "Weekdays close at 6pm (not 5pm)" },
    // Alex rejected Venmo (Q6.5). The prompt mentions Venmo only inside the
    // anti-pattern list as a thing to avoid, so a bare /Venmo/ test would
    // false-positive. Assert the payment line contents instead.
    { pattern: /Cash, check, Zelle, or credit card/i, name: "Payment line = cash/check/Zelle/card" },
    { pattern: /we take Venmo|accept[^.]{0,30}Venmo|Venmo, or|Venmo or /i, name: "Does not offer Venmo", shouldFail: true },
    { pattern: /three percent fee/i, name: "Discloses 3% card fee" },

    // --- License (questionnaire Section 0: Alex said no license) ---
    { pattern: /32094253104/, name: "No asserted license number", shouldFail: true },
    { pattern: /insured/i, name: "Says insured" },
    { pattern: /does not require a trade license|doesn't require a trade license/i, name: "Explains TX license nuance" },

    // --- Founding date (questionnaire 1.4: operating since 2024) ---
    { pattern: /since 2021|twenty twenty one|Started 2021/i, name: "No 'since 2021' claim", shouldFail: true },
    { pattern: /twenty twenty four|2024/, name: "Says operating since 2024" },

    // --- Scope narrowing (questionnaire 4.5 / 4.6) ---
    { pattern: /MINOR WORK ONLY/i, name: "Flags minor-only electrical/plumbing" },
    { pattern: /do not work on appliances/i, name: "Explicit no appliances" },
    { pattern: /shingle/i, name: "Handles shingle roofing" },
    { pattern: /commercial/i, name: "Handles commercial jobs" },

    // --- Callback cadence (questionnaire Section 5) ---
    { pattern: /after five minutes|five minutes/i, name: "5-min first retry" },
    { pattern: /ten more|after ten/i, name: "10-min second retry" },
    { pattern: /leave a voicemail/i, name: "Asks customer to leave voicemail after 3 misses" },

    { pattern: /plumbing/i, name: "Mentions plumbing" },
    { pattern: /electrical/i, name: "Mentions electrical" },
    { pattern: /hvac/i, name: "Mentions HVAC" },
    { pattern: /roofing/i, name: "Mentions roofing (or coordinates)" },
    { pattern: /gas/i, name: "Mentions gas (or coordinates)" },
    { pattern: /refer you to/i, name: "Uses 'refer you to' for partner work" },
    { pattern: /pest/i, name: "Mentions pest control (out of scope)" },
    { pattern: /nine one one|911/, name: "Mentions 911 for gas emergency" },
    { pattern: /Stay safe/, name: "Has 'Stay safe' for urgent" },
    { pattern: /open windows/i, name: "Says 'open windows' for gas" },
    { pattern: /\bBye\b/, name: "No bare 'Bye'", shouldFail: true },
    { pattern: /总的来说|大概/, name: "No Chinese (TTS misreads)", shouldFail: true },
    { pattern: /Alex and Abel/, name: "Mentions both co-owners" },
    { pattern: /Final price confirmed/i, name: "Uses price caveat (no final price promise)" },
  ];

  for (const c of checks) {
    const matched = c.pattern.test(prompt);
    if (c.shouldFail) {
      if (matched) {
        fail(c.name, "should NOT match but did");
      } else {
        pass(c.name);
      }
    } else {
      if (matched) {
        pass(c.name);
      } else {
        fail(c.name, "pattern not found in prompt");
      }
    }
  }
}

// === TEST 3: Supabase boss config ===
async function testBossConfig() {
  console.log("\n[3] Supabase Alex boss config");
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    fail("Supabase env vars", "missing");
    return;
  }
  const res = await fetchJson(
    `${SUPABASE_URL}/rest/v1/bosses?id=eq.${ALICE_BOSS_ID}&select=*`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (res.status !== 200 || !Array.isArray(res.body) || res.body.length === 0) {
    fail("Boss query", `status ${res.status}`);
    return;
  }
  const boss = res.body[0];
  pass("Boss row found", `id: ${boss.id}`);

  // Phone
  if (boss.phone === "+17137422387") {
    pass("Phone matches Handy Works website", boss.phone);
  } else {
    fail("Phone", `expected +17137422387, got ${boss.phone}`);
  }

  // Service trades
  const expectedTrades = [
    "plumbing", "electrical", "hvac", "handyman", "painting",
    "tv_mounting", "furniture_assembly", "smart_home", "drywall",
    "pressure_washing", "fence_deck", "window_covering", "general"
  ];
  const missing = expectedTrades.filter((t) => !(boss.service_trades || []).includes(t));
  if (missing.length === 0) {
    pass(`All ${expectedTrades.length}+ service trades present`, (boss.service_trades || []).join(", "));
  } else {
    fail("Missing trades", missing.join(", "));
  }

  // Regression guard (2026-10-01): "general" is the fallback issue_type used by
  // all four Vapi tool handlers when the model omits one
  // (src/app/api/vapi/tools/route.ts). If it is missing from service_trades,
  // unclassified calls fail the trade check and get wrongly declined.
  if ((boss.service_trades || []).includes("general")) {
    pass("Fallback trade 'general' present", "required by tool handlers");
  } else {
    fail("Fallback trade 'general' missing", "tool handlers default to 'general' — calls will be wrongly declined");
  }

  // Regression guard: hvac must stay. Alex priced AC repair at 150-600
  // (questionnaire 4.9.5); only full central AC install is referred.
  if ((boss.service_trades || []).includes("hvac")) {
    pass("Minor HVAC in scope", "AC repair + heater repair");
  } else {
    fail("HVAC missing from trades", "Alex quoted AC repair pricing — should be in scope");
  }

  // Vapi assistant ID linked
  if (boss.vapi_assistant_id === VAPI_ASSISTANT_ID) {
    pass("vapi_assistant_id linked to US assistant", boss.vapi_assistant_id);
  } else {
    fail("vapi_assistant_id mismatch", `boss has ${boss.vapi_assistant_id}, env has ${VAPI_ASSISTANT_ID}`);
  }

  // Service area
  if (boss.country === "US" && boss.service_base_zip === "77401") {
    pass("Service base is Bellaire 77401");
  } else {
    fail("Service base", `${boss.country}/${boss.service_base_zip}`);
  }

  // Owner name
  if (boss.owner_name && boss.owner_name.includes("Alex")) {
    pass("Owner name mentions Alex", boss.owner_name);
  } else {
    fail("Owner name", boss.owner_name);
  }
}

// === Main ===
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Handy Works AI - Static Config Test");
  console.log("═══════════════════════════════════════════");

  const assistant = await testVapiAssistant();
  await testSystemPrompt(assistant);
  await testBossConfig();

  console.log("\n═══════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("Failed checks:");
    results.filter((r) => r.status === "FAIL").forEach((r) => {
      console.log(`  ✗ ${r.name}: ${r.detail}`);
    });
    console.log();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ Test crashed:", e.message);
  process.exit(1);
});
