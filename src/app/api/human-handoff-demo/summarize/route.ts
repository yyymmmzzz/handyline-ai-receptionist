import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import OpenAI from "openai";

/**
 * POST /api/human-handoff-demo/summarize
 *
 * Body: { transcript: string, customerName?: string, callerPhone?: string }
 * Returns: { cached: bool, summary: object, tokens: number, cost: number }
 *
 * Takes a phone call transcript and produces a "meeting minutes" style
 * structured summary using OpenAI gpt-4o-mini. Used by the standalone
 * /human-handoff-demo page.
 *
 * - Caches by transcript hash (SHA-256) — same transcript = same response, no cost
 * - Returns structured JSON matching the human_calls schema
 * - Costs ~$0.005 per call (gpt-4o-mini, ~600 tokens)
 */

export const dynamic = "force-dynamic";

const MEETING_MINUTES_PROMPT = `You are a meeting minutes generator for a home services contractor (handyman / home repair business) named Alex.

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

// Simple in-memory cache (cleared on server restart)
const cache = new Map<string, object>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transcript, customerName, callerPhone } = body;

    if (!transcript || typeof transcript !== "string" || transcript.length < 50) {
      return NextResponse.json(
        { error: "transcript required (min 50 chars)" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Hash for cache
    const hash = createHash("sha256")
      .update(transcript + (customerName || "") + (callerPhone || ""))
      .digest("hex")
      .slice(0, 16);

    // Check cache
    if (cache.has(hash)) {
      return NextResponse.json({
        cached: true,
        summary: cache.get(hash),
        hash,
      });
    }

    // Call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const userMessage = `Generate meeting minutes for this phone call transcript:\n\n${transcript}${
      customerName ? `\n\nCustomer name (from caller ID): ${customerName}` : ""
    }${callerPhone ? `\nCaller phone: ${callerPhone}` : ""}`;

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

    const raw = completion.choices[0].message.content || "{}";
    const summary = JSON.parse(raw);

    // Cache
    cache.set(hash, summary);

    const tokens = completion.usage?.total_tokens || 0;
    const cost = (tokens / 1_000_000) * 0.30; // gpt-4o-mini: $0.15/M input, $0.60/M output; blended ~$0.30/M

    return NextResponse.json({
      cached: false,
      summary,
      hash,
      tokens,
      cost: Number(cost.toFixed(6)),
    });
  } catch (e: any) {
    console.error("[/api/human-handoff-demo/summarize] error:", e);
    return NextResponse.json(
      { error: e.message || "Internal error" },
      { status: 500 }
    );
  }
}
