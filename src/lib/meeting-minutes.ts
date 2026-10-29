/**
 * meeting-minutes.ts — "turn a call into the notes a person would have taken".
 *
 * This module used to be a demo-only helper: the prompt lived in the
 * `/human-handoff-demo` route and was fed by hard-coded sample transcripts, so
 * the thing it was built for — "what did Alex write down after this call?" —
 * was never reachable in production.
 *
 * It now has exactly one implementation used by BOTH:
 *   - the production human line (`/api/human-line/recording`) → writes
 *     `work_orders.human_minutes` + the normal work-order columns, and
 *   - the human-call view (`/human-calls`) → renders the stored payload.
 *
 * Distinguish from `openai-summarize.ts`:
 *   - summarize.ts  → the triage summary the AI line writes on every call
 *                      (intent, tendency, follow-up priority)
 *   - this file     → the richer notes a *person* would have taken, including
 *                      explicit action items and key facts
 */

import OpenAI from "openai";

export const MEETING_MINUTES_PROMPT = `You are a meeting minutes generator for a home services contractor (handyman / home repair business) named Alex.

Given the transcript of a phone call between a CUSTOMER and ALEX (the contractor), produce a structured summary.

Output a JSON object with these EXACT fields:

{
  "summary": "<1-2 sentences: what the call was about>",
  "intent": "<what the customer wanted — be specific>",
  "key_facts": {
    "name": "<customer name if mentioned, else null>",
    "phone": "<customer phone if mentioned/confirmed, else null>",
    "address": "<address if mentioned, else null>",
    "issue": "<problem description in customer's own words, else null>",
    "trade_needed": "<plumbing/electrical/hvac/handyman/painting/etc.>",
    "timing": "<when they want service — 'asap' | 'tomorrow morning' | 'next week' | specific date>",
    "urgency_signals": "<any urgency indicators — 'water everywhere', 'no heat', 'before guests arrive', etc.>",
    "budget_signals": "<any price sensitivity mentioned>"
  },
  "action_items": [
    "<concrete action Alex should take, e.g. 'Call Sarah back to confirm Mon 9am'>",
    "<another action, or empty array if none>"
  ],
  "topics_mentioned": ["<short topic keywords>"],
  "customer_tendency": "<overall vibe — 'urgent and ready to book' | 'shopping around' | 'just curious' | 'frustrated' | 'returning customer'>",
  "follow_up_priority": "<'high' | 'medium' | 'low'>",
  "follow_up_recommendation": "<specific next step — e.g. 'Confirm Mon 9am by SMS tonight. Send quote range $200-400.'>"
}

Rules:
- Be CONCISE. Sentences ≤ 15 words.
- Use customer's own words where possible.
- If something wasn't mentioned, set field to null.
- "intent" should be actionable, not vague.
- "action_items" should be specific tasks.
- "follow_up_priority" is high if there's any urgency signal (water damage, no heat, customer upset).
- Return ONLY the JSON object, no markdown, no commentary.`;

/** Shape returned by MEETING_MINUTES_PROMPT. */
export interface MeetingMinutes {
  summary: string;
  intent: string;
  key_facts: {
    name: string | null;
    phone: string | null;
    address: string | null;
    issue: string | null;
    trade_needed: string;
    timing: string;
    urgency_signals: string;
    budget_signals: string;
  };
  action_items: string[];
  topics_mentioned: string[];
  customer_tendency: string;
  follow_up_priority: "high" | "medium" | "low";
  follow_up_recommendation: string;
}

export interface MinutesResult {
  /** null when the LLM could not be reached or returned nothing usable */
  minutes: MeetingMinutes | null;
  /** "llm" = model produced it, "none" = nothing produced */
  source: "llm" | "none";
  tokens: number;
  cost: number;
  /** Populated when source === "none" so failures are explainable, not silent. */
  error?: string;
}

/** Minimum transcript length worth sending to the model. */
const MIN_TRANSCRIPT_CHARS = 40;
/** GPT-4o-mini blended price per 1M tokens (in $0.15/M, out $0.60/M). */
const COST_PER_MILLION_TOKENS = 0.3;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x): x is string => !!x);
}

/**
 * Coerce whatever the model returned into a complete MeetingMinutes object.
 * A missing field must never crash the caller — a partial summary is far
 * better than losing the whole call's notes.
 */
export function normalizeMinutes(raw: unknown): MeetingMinutes | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  const kf = (o.key_facts && typeof o.key_facts === "object" ? o.key_facts : {}) as Record<string, any>;

  const priorityRaw = String(o.follow_up_priority || "").toLowerCase();
  const priority: "high" | "medium" | "low" =
    priorityRaw === "high" || priorityRaw === "medium" || priorityRaw === "low"
      ? priorityRaw
      : "low";

  const minutes: MeetingMinutes = {
    summary: str(o.summary) ?? "",
    intent: str(o.intent) ?? "",
    key_facts: {
      name: str(kf.name),
      phone: str(kf.phone),
      address: str(kf.address),
      issue: str(kf.issue),
      trade_needed: str(kf.trade_needed) ?? "general",
      timing: str(kf.timing) ?? "",
      urgency_signals: str(kf.urgency_signals) ?? "",
      budget_signals: str(kf.budget_signals) ?? "",
    },
    action_items: strArray(o.action_items),
    topics_mentioned: strArray(o.topics_mentioned),
    customer_tendency: str(o.customer_tendency) ?? "",
    follow_up_priority: priority,
    follow_up_recommendation: str(o.follow_up_recommendation) ?? "",
  };

  // Nothing usable at all → treat as a failure, not as an empty summary.
  if (!minutes.summary && !minutes.intent && minutes.action_items.length === 0) return null;
  return minutes;
}

/**
 * Generate meeting minutes for a finished call.
 *
 * NEVER throws. A human-answered call is valuable even if the notes fail, so
 * the caller must always get a result object it can write to the work order.
 */
export async function generateMeetingMinutes(
  transcriptText: string,
  opts: { customerName?: string | null; callerPhone?: string | null } = {},
): Promise<MinutesResult> {
  const text = (transcriptText || "").trim();
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    return { minutes: null, source: "none", tokens: 0, cost: 0, error: "transcript too short" };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { minutes: null, source: "none", tokens: 0, cost: 0, error: "OPENAI_API_KEY not configured" };
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userMessage =
      `Generate meeting minutes for this phone call transcript:\n\n${text}` +
      (opts.customerName ? `\n\nCustomer name (from caller ID): ${opts.customerName}` : "") +
      (opts.callerPhone ? `\nCaller phone: ${opts.callerPhone}` : "");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: MEETING_MINUTES_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const minutes = normalizeMinutes(JSON.parse(raw));
    if (!minutes) {
      return { minutes: null, source: "none", tokens: 0, cost: 0, error: "model returned nothing usable" };
    }

    const tokens = completion.usage?.total_tokens || 0;
    const cost = (tokens / 1_000_000) * COST_PER_MILLION_TOKENS;
    return { minutes, source: "llm", tokens, cost: Number(cost.toFixed(6)) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[meeting-minutes] generation failed: ${msg.slice(0, 160)}`);
    return { minutes: null, source: "none", tokens: 0, cost: 0, error: msg };
  }
}

/** Free-text trade words → the issue types the system knows about. */
const TRADE_MAP: Array<[RegExp, string]> = [
  [/\bplumb|drain|pipe|faucet|toilet|leak|water heater|garbage dispos/i, "plumbing"],
  [/\belectri|wiring|outlet|breaker|panel|light fixture|fuse/i, "electrical"],
  [/\bhvac|ac\b|air cond|furnace|heat pump|thermostat/i, "hvac"],
  [/\broof|shingle|gutter/i, "roofing"],
  [/\bhandyman|assembl|furniture|drill|shelf|door|window|paint|repair|mount/i, "handyman"],
];

/** Map the free-text trade mentioned in the minutes onto a known issue type. */
export function minutesTradeToIssueType(trade: string | null | undefined): string | null {
  if (!trade) return null;
  for (const [re, issue] of TRADE_MAP) {
    if (re.test(trade)) return issue;
  }
  return "general";
}

/**
 * Project the minutes onto the regular work_orders columns, so a human call
 * shows up in the main dashboard with the same fields an AI call has.
 *
 * Only non-empty values are returned — never blank out a column that another
 * pipeline (the triage summary) already filled in.
 */
export function minutesToOrderFields(minutes: MeetingMinutes): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (minutes.summary) out.summary = minutes.summary;
  if (minutes.intent) out.intent_summary = minutes.intent;
  if (minutes.customer_tendency) out.customer_tendency = minutes.customer_tendency;
  if (minutes.topics_mentioned.length) out.mentioned_topics = minutes.topics_mentioned;
  if (minutes.follow_up_recommendation) out.follow_up_notes = minutes.follow_up_recommendation;
  out.follow_up_priority = minutes.follow_up_priority;
  out.follow_up_recommended = minutes.follow_up_priority === "high" || minutes.follow_up_priority === "medium";

  if (minutes.key_facts.name) out.customer_name_extracted = minutes.key_facts.name;
  if (minutes.key_facts.address) out.customer_address = minutes.key_facts.address;
  if (minutes.key_facts.issue) out.issue_details = minutes.key_facts.issue;

  const issueType = minutesTradeToIssueType(minutes.key_facts.trade_needed);
  if (issueType) out.issue_type = issueType;

  // A 5-digit ZIP spoken on a recorded human call is worth keeping.
  const zip = minutes.key_facts.address?.match(/\b77\d{3}\b/)?.[0] || null;
  if (zip) out.customer_zipcode = zip;

  return out;
}
