#!/usr/bin/env node
/**
 * test-call-extraction.js — REGRESSION TEST (read-only).
 *
 * Replays the REAL end-of-call-report payloads that Vapi delivered (stored in
 * Supabase `call_events`) through the production extraction code and asserts
 * the fields that were silently broken:
 *
 *   1. tool calls are found          → ai_decision / summary / issue_type
 *   2. the AI's own turns are kept   → transcript has both sides
 *   3. the recording URL is found    → recording_url is persisted
 *
 * Before the fix every production call came out as ai_decision="unsure",
 * summary=NULL, issue_type=NULL, recording_url=NULL and a one-sided
 * transcript.
 *
 * Usage:  node scripts/test-call-extraction.js
 * Exit 0 = all assertions passed.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ENV = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const SUPABASE_ACCESS_TOKEN = get("SUPABASE_ACCESS_TOKEN");
const PROJECT_REF = "cggqxaxunqxsgurgmiqh";

// ---------------------------------------------------------------- compile TS
function buildExtraction() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "call-extraction-"));
  execFileSync(
    "npx",
    [
      "tsc",
      path.join(ROOT, "src/lib/call-extraction.ts"),
      path.join(ROOT, "src/lib/types.ts"),
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--skipLibCheck",
      "--esModuleInterop",
      "--moduleResolution",
      "node",
    ],
    { cwd: ROOT, stdio: "pipe" },
  );
  return require(path.join(outDir, "call-extraction.js"));
}

// ------------------------------------------------------------------ Supabase
async function mgmtQuery(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return JSON.parse(await r.text());
}

// ---------------------------------------------------------------------- main
let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

(async () => {
  console.log("→ compiling src/lib/call-extraction.ts …");
  const { extractCallData, buildTranscript, detectAIQualityIssues } = buildExtraction();

  const bosses = await mgmtQuery(`select * from bosses limit 1;`);
  const boss = bosses[0];
  if (!boss) throw new Error("no boss row found");

  const rows = await mgmtQuery(`
    select ce.created_at, ce.vapi_call_id, ce.payload::text as p
    from call_events ce
    where ce.event_type='end-of-call-report'
    order by ce.created_at desc;
  `);
  console.log(`→ ${rows.length} stored end-of-call-report payloads\n`);

  let withEndCall = 0;
  let withTradeCheck = 0;
  let withBotTurn = 0;
  let withRecording = 0;

  for (const row of rows) {
    const payload = JSON.parse(row.p);
    const message = payload.message;
    const callId = row.vapi_call_id;
    const raw = message.messages || [];

    const extracted = extractCallData(boss, message);
    const transcript = buildTranscript(message);

    // --- 1. tool calls must be visible -----------------------------------
    const rawToolCalls = raw.flatMap((m) => m.toolCalls || []);
    const rawEndCall = rawToolCalls.find((t) => t.function?.name === "end_call");
    const rawTrade = rawToolCalls.find((t) => t.function?.name === "check_and_quote");

    // Vapi sends tool arguments as a JSON *string*, not an object.
    const argsOf = (t) => {
      const a = t?.function?.arguments;
      if (typeof a === "string") {
        try {
          return JSON.parse(a);
        } catch {
          return {};
        }
      }
      return a || {};
    };

    if (rawEndCall) {
      withEndCall++;
      const rawArgs = argsOf(rawEndCall);
      const expected = rawArgs.outcome;
      check(
        `decision for ${callId}`,
        extracted.decision === expected,
        `expected "${expected}", got "${extracted.decision}"`,
      );
      const expectedSummary = rawArgs.summary;
      check(
        `summary for ${callId}`,
        typeof expectedSummary === "string" && extracted.summary === expectedSummary,
        `expected "${expectedSummary}", got "${extracted.summary}"`,
      );
    }

    if (rawTrade) {
      withTradeCheck++;
      const tradeArgs = argsOf(rawTrade);
      check(
        `issue_type for ${callId}`,
        extracted.issueType === tradeArgs.issue_type,
        `expected "${tradeArgs.issue_type}", got "${extracted.issueType}"`,
      );
      const zip = tradeArgs.zipcode;
      if (zip) {
        check(
          `zipcode for ${callId}`,
          extracted.customerZipcode === zip,
          `expected "${zip}", got "${extracted.customerZipcode}"`,
        );
      }
    }

    // --- 2. both sides of the conversation -------------------------------
    const rawBotTurns = raw.filter((m) => m.role === "bot").length;
    const rawUserTurns = raw.filter((m) => m.role === "user").length;
    const tBot = transcript.filter((t) => t.role === "assistant").length;
    const tUser = transcript.filter((t) => t.role === "user").length;
    if (rawBotTurns > 0) {
      withBotTurn++;
      check(
        `AI turns kept for ${callId}`,
        tBot === rawBotTurns,
        `expected ${rawBotTurns} bot turns, transcript has ${tBot}`,
      );
    }
    check(
      `customer turns kept for ${callId}`,
      tUser === rawUserTurns,
      `expected ${rawUserTurns} user turns, transcript has ${tUser}`,
    );
    check(
      `no empty transcript rows for ${callId}`,
      transcript.every((t) => t.text.trim().length > 0),
    );

    // --- 3. recording URL must be reachable --------------------------------
    const rec = message.recordingUrl || message.artifact?.recordingUrl;
    if (rec) {
      withRecording++;
      check(
        `recording url for ${callId}`,
        typeof rec === "string" && rec.includes(callId),
        "recording url does not reference the call",
      );
    }
  }

  console.log(`payloads with end_call        : ${withEndCall}`);
  console.log(`payloads with check_and_quote : ${withTradeCheck}`);
  console.log(`payloads with AI turns        : ${withBotTurn}`);
  console.log(`payloads with a recording URL : ${withRecording}`);
  console.log(`\n✅ assertions passed: ${pass}`);
  if (failures.length) {
    console.log(`❌ assertions failed: ${failures.length}\n`);
    for (const f of failures) console.log(`   - ${f}`);
    process.exit(1);
  }
  // --- AI misbehaviour detection ------------------------------------------
  // The 2026-10-14 opener echo must be caught mechanically, so a call that
  // went wrong is visible without reading the transcript.
  const openerLoop = detectAIQualityIssues([
    { role: "assistant", text: "Handy Works service desk. What's the issue?" },
    { role: "user", text: "Hi. Um, do you guys install TV now?" },
    { role: "assistant", text: "What's the issue?" },
    { role: "user", text: "Do you install TV now?" },
    { role: "assistant", text: "What's the issue?" },
  ]);
  check(
    "detects the opener echo",
    openerLoop.includes("repeated_turn") && openerLoop.includes("opener_echo"),
    `flags: ${openerLoop.join(",") || "none"}`,
  );

  const healthy = detectAIQualityIssues([
    { role: "assistant", text: "Handy Works service desk. What's the issue?" },
    { role: "user", text: "My roof is leaking, I'm in 77047" },
    { role: "assistant", text: "Roofing work runs four hundred to two thousand five hundred. What's your ZIP code?" },
    { role: "user", text: "77047, tomorrow morning, Mike, 713-555-0100" },
    { role: "assistant", text: "Got it, Mike. I will certainly call to follow up. Anything else?" },
  ]);
  check(
    "a normal call is not flagged",
    healthy.length === 0,
    `flags: ${healthy.join(",") || "none"}`,
  );

  const deadLine = detectAIQualityIssues([
    { role: "assistant", text: "Handy Works service desk. What's the issue?" },
    { role: "assistant", text: "Are you there?" },
    { role: "assistant", text: "Hello?" },
  ]);
  check(
    "detects a dead line (customer never spoke)",
    deadLine.includes("no_customer_turn"),
    `flags: ${deadLine.join(",") || "none"}`,
  );

  console.log("All extraction assertions passed.");
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
