/**
 * meeting-minutes.ts — the shared prompt for "turn a call into structured notes".
 *
 * Originally lived inline in the /human-handoff-demo route. Both the demo and
 * the production human line now import it from here so there is exactly one
 * definition of what a meeting-minutes payload looks like.
 *
 * Distinguish from `openai-summarize.ts`:
 *   - summarize.ts  → the triage summary the AI line writes on every call
 *                      (intent, tendency, follow-up priority)
 *   - this file     → the richer notes a *person* would have taken, including
 *                      explicit action items and key facts
 *
 * The human line writes the result into the same work_orders columns the AI
 * line uses, so both stay visible in one dashboard.
 */

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
