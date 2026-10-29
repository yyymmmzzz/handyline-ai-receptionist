/**
 * openai-summarize.ts — Optional LLM-based call summary extraction
 *
 * If OPENAI_API_KEY is set, we call gpt-4o-mini to extract all 9 call-summary
 * fields. If the LLM call fails (timeout, rate limit, network), we fall back
 * to the regex-based call-summary.ts (existing behavior).
 *
 * Cost: ~$0.001 per call (gpt-4o-mini at ~500-2000 input tokens).
 * Latency: +200-500ms to webhook processing.
 *
 * Caching: if a recent work_order has the same summary_hash (SHA-256 of
 * transcript + decision + issueType), skip the LLM call and reuse the
 * cached fields. Saves 5-10% on re-runs.
 *
 * Usage monitoring: every LLM call INSERTs into llm_usage table for
 * cost tracking and trend analysis.
 */

import OpenAI from "openai";
import { createHash } from "crypto";
import { summarizeCall, type CallSummary } from "./call-summary";
import { getServiceClient } from "./supabase";

// gpt-4o-mini pricing (as of 2026)
const COST_PER_M_INPUT = 0.15 / 1_000_000;    // $0.15 per 1M input tokens
const COST_PER_M_OUTPUT = 0.60 / 1_000_000;   // $0.60 per 1M output tokens

const SYSTEM_PROMPT = `You are a structured data extractor for a home services AI receptionist based in Houston, Texas.

The business handles: plumbing (faucets, sinks, toilets, drains, leaks, water heaters, disposals), electrical (outlets, switches, breakers, basic wiring, ceiling fans, light fixtures), handyman (furniture assembly, drywall patch, paint, fences, pressure washing, door hinges, TV mounts, garage door frame repair).

The business does NOT do: roofing, HVAC/AC service, foundation/slab leaks, electrical panel upgrades, landscaping, pest control, junk hauling, septic, full renovations.

Given a phone call transcript (with speaker roles: "user" = customer, "assistant" = AI receptionist), extract these fields as JSON:

{
  "customer_name": string | null,
  // Extract from "my name is X" / "I'm X" / "his name is X" / "this is X".
  // Reject non-name words: in, here, looking, sorry, going, just, etc.
  // If caller_id_name is provided in input, prefer it ONLY if transcript has no clear name.

  "intent_summary": string,
  // EXACTLY 1 sentence (15-30 words) describing what the customer actually
  // asked about. Lead with the specific problem (e.g. "Customer asked about
  // kitchen sink unclogging service in 77002") — NOT generic phrases like
  // "Customer called for help." Even if AI rejected, surface what customer wanted.

  "tendency": "scheduling" | "service_inquiry" | "price_shopping" | "considering" | "complaint" | "urgent" | "uncertain" | "info_general",
  // scheduling: explicitly setting appointment
  // service_inquiry: "do you do X?" / "can you handle Y?"
  // price_shopping: "how much" / "what's the rate"
  // considering: "let me think" / "call you back" / "maybe"
  // complaint: "terrible service" / "frustrated"
  // urgent: AC broken in Houston heat, no power, water leak, gas smell
  // uncertain: can't tell
  // info_general: chitchat

  "topics": string[],
  // 3-7 lowercase keywords (e.g. ["sink", "clogged", "kitchen", "77002"]).
  // One word per topic. Skip generic words like "issue" or "problem".

  "follow_up_priority": "high" | "medium" | "low" | "none",
  // high: customer wanted something the business DOES but AI rejected;
  //       OR AC/HVAC emergency in Houston weather (refer to partner);
  //       OR accepted but customer said "let me think about it"
  // medium: AI couldn't fully understand (speech unclear / off-topic);
  //         OR customer is "considering" callback
  // low: short / broken transcript, likely wrong number
  // none: clean accept/reject, no opportunity

  "follow_up_notes": string | null,
  // 1-sentence reason. Explain WHY the boss should call back. null if no
  // follow-up needed.
}

EXAMPLES:
- Transcript "Hi my name is Jordan. My sink is clogged. 77002. How much?" →
  {"customer_name":"Jordan","intent_summary":"Customer asked about sink unclogging service in 77002 and wanted pricing.","tendency":"price_shopping","topics":["sink","clogged","77002","plumbing"],"follow_up_priority":"high","follow_up_notes":"Pricing inquiry for a service we offer. Call back to confirm."}

- Transcript "Are you the plumber? My name is Matt. His name is Matt. 77001. AC broken." →
  {"customer_name":"Matt","intent_summary":"Customer reported a broken AC unit in 77001 and asked if we service it.","tendency":"service_inquiry","topics":["ac","77001","hvac"],"follow_up_priority":"high","follow_up_notes":"HVAC emergency — refer to partner HVAC contractor. Time-sensitive in Houston heat."}

- Transcript "Hello? Yeah. Okay. Thank you bye." →
  {"customer_name":null,"intent_summary":"Customer's speech was unclear and no service was discussed.","tendency":"info_general","topics":[],"follow_up_priority":"low","follow_up_notes":"Short or unclear call — call back only if you recognize the number."}

Return only valid JSON, no markdown fences, no commentary.`;

let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI | null {
  if (_openaiClient) return _openaiClient;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    _openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // The default client timeout is short enough that a slow response
      // silently dropped us into the regex fallback, which is why some calls
      // had a shallow intent summary. These transcripts are small, so 60s is
      // generous — and we retry twice before giving up.
      timeout: 60_000,
      maxRetries: 2,
    });
    return _openaiClient;
  } catch {
    return null;
  }
}

/** Compute SHA-256 of (transcript + decision + issueType) for cache lookup */
export function computeSummaryHash(
  transcript: Array<{ role: string; text: string }>,
  decision: string,
  issueType: string | null,
): string {
  const h = createHash("sha256");
  for (const m of transcript) h.update(`${m.role}:${m.text}\n`);
  h.update(`|decision=${decision}|issueType=${issueType ?? ""}|`);
  return h.digest("hex");
}

/**
 * Look up a cached CallSummary by hash. Returns null if no match.
 */
export async function findCachedSummary(
  hash: string,
): Promise<CallSummary | null> {
  if (!hash) return null;
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("work_orders")
      .select("customer_name_extracted, intent_summary, customer_tendency, mentioned_topics, follow_up_priority, follow_up_notes, follow_up_recommended, accepted_topics, rejected_topics, transcript_coherence, summary_source")
      .eq("summary_hash", hash)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    // ONLY a row produced by a successful LLM run may be reused. Rows written
    // by the regex fallback (summary_source != 'llm') can be empty, and
    // caching one of those locks the gap in permanently — the LLM never gets
    // another chance at that call.
    if (data.summary_source !== "llm") return null;
    // If the cached record has all the key fields populated, reuse it
    if (!data.intent_summary && !data.customer_name_extracted) return null;
    return {
      customerNameExtracted: data.customer_name_extracted ?? null,
      intentSummary: data.intent_summary ?? null,
      customerTendency: (data.customer_tendency as CallSummary["customerTendency"]) ?? "uncertain",
      mentionedTopics: (data.mentioned_topics as string[]) ?? [],
      acceptedTopics: (data.accepted_topics as string[]) ?? [],
      rejectedTopics: (data.rejected_topics as string[]) ?? [],
      followUpPriority: (data.follow_up_priority as CallSummary["followUpPriority"]) ?? "none",
      followUpNotes: data.follow_up_notes ?? null,
      followUpRecommended: !!data.follow_up_recommended,
      transcriptCoherence: (data.transcript_coherence as CallSummary["transcriptCoherence"]) ?? "medium",
    };
  } catch {
    return null;
  }
}

/** Log LLM usage to Supabase (best-effort, errors don't break the call) */
async function logLlmUsage(
  callId: string | null,
  source: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  costUsd: number,
): Promise<void> {
  try {
    const supabase = getServiceClient();
    await supabase.from("llm_usage").insert({
      call_id: callId,
      source,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      cost_usd: costUsd,
    });
  } catch (e) {
    // Best-effort — never break the LLM call
    console.warn(`[openai-usage-log] failed: ${(e as Error).message?.slice(0, 100)}`);
  }
}

export async function summarizeWithLLM(
  transcript: Array<{ role: string; text: string }>,
  callerIdName: string | null,
  issueType: string | null,
  decision: string,
  acceptedTopics: string[] = [],
  rejectedTopics: string[] = [],
  extraContext?: { durationSeconds?: number; callId?: string; source?: string },
): Promise<CallSummary> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured — caller should fall back to regex");
  }

  // Caching: skip LLM if a recent work_order has the same summary hash
  const hash = computeSummaryHash(transcript, decision, issueType);
  const cached = await findCachedSummary(hash);
  if (cached) {
    console.log(`[openai-summarize] cache hit for ${extraContext?.callId ?? "?"} (hash=${hash.slice(0, 8)}…)`);
    return cached;
  }

  const client = getOpenAIClient();
  if (!client) {
    throw new Error("OpenAI client unavailable");
  }

  const userPayload = {
    caller_id_name: callerIdName,
    ai_decision: decision,
    recognized_issue_type: issueType,
    call_duration_seconds: extraContext?.durationSeconds ?? null,
    ai_accepted_topics: acceptedTopics,
    ai_rejected_topics: rejectedTopics,
    transcript: transcript.map((m) => ({
      role: m.role,
      text: m.text,
    })),
  };

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 500,
  });

  const u = completion.usage;
  if (u) {
    const inCost = u.prompt_tokens * COST_PER_M_INPUT;
    const outCost = u.completion_tokens * COST_PER_M_OUTPUT;
    const cost = inCost + outCost;
    console.log(
      `[openai-usage] call=${extraContext?.callId ?? "?"} src=${extraContext?.source ?? "?"} ` +
      `in=${u.prompt_tokens}t out=${u.completion_tokens}t total=${u.total_tokens}t cost=$${cost.toFixed(6)}`,
    );
    // Persist for cost tracking dashboard
    await logLlmUsage(
      extraContext?.callId ?? null,
      extraContext?.source ?? "webhook",
      completion.model,
      u.prompt_tokens,
      u.completion_tokens,
      cost,
    );
  }

  const raw = completion.choices[0].message.content || "{}";
  const parsed = JSON.parse(raw);

  return {
    customerNameExtracted: parsed.customer_name ?? null,
    intentSummary: parsed.intent_summary ?? null,
    customerTendency: (parsed.tendency as CallSummary["customerTendency"]) ?? "uncertain",
    mentionedTopics: Array.isArray(parsed.topics) ? parsed.topics.map((t: string) => t.toLowerCase()) : [],
    acceptedTopics: Array.isArray(parsed.accepted_topics) ? parsed.accepted_topics : [],
    rejectedTopics: Array.isArray(parsed.rejected_topics) ? parsed.rejected_topics : [],
    followUpPriority: (parsed.follow_up_priority as CallSummary["followUpPriority"]) ?? "none",
    followUpNotes: parsed.follow_up_notes ?? null,
    followUpRecommended: ["high", "medium"].includes(parsed.follow_up_priority),
    transcriptCoherence: "medium",
  };
}

/**
 * Best-effort summarize: try LLM first, fall back to regex.
 * Returns CallSummary and a flag indicating which path was used.
 */
export async function summarizeWithFallback(
  transcript: Array<{ role: string; text: string }>,
  callerIdName: string | null,
  issueType: string | null,
  decision: string,
  acceptedTopics: string[] = [],
  rejectedTopics: string[] = [],
  extraContext?: { durationSeconds?: number; callId?: string; source?: string },
): Promise<{ summary: CallSummary; source: "llm" | "regex" | "regex-fallback" | "cache" }> {
  // Default source: webhook if callId present, else manual
  const source = extraContext?.source ?? (extraContext?.callId ? "webhook" : "manual");
  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await summarizeWithLLM(
        transcript,
        callerIdName,
        issueType,
        decision,
        acceptedTopics,
        rejectedTopics,
        { ...extraContext, source },
      );
      return { summary: result, source: "llm" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[openai-summarize] LLM failed, falling back to regex: ${msg.slice(0, 100)}`);
      // "regex-fallback" is NOT the same as "regex": it means the LLM was
      // reachable in principle but failed. Callers must not treat it as a
      // finished summary — otherwise a transient outage permanently degrades
      // the call (the fallback output gets cached and never re-derived).
      const out = summarizeCall(
        transcript,
        callerIdName,
        issueType,
        decision,
        acceptedTopics,
        rejectedTopics,
      );
      return { summary: out, source: "regex-fallback" };
    }
  }
  return {
    summary: summarizeCall(transcript, callerIdName, issueType, decision, acceptedTopics, rejectedTopics),
    source: "regex",
  };
}
