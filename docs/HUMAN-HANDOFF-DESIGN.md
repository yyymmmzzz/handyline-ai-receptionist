# Human Handoff + Recording — Design Document

**Date:** 2026-09-13 · **Status:** Design (v0.1) · **Author:** Mavis

The first thing to answer: **how do human-answered calls get recorded?** The rest of the design follows from that answer.

---

## TL;DR

Use **Vapi's built-in `transferCall` tool** to bridge the AI receptionist to Alex's real phone. Vapi records the **entire call** (both AI portion and human portion) into a single audio file. The `end-of-call-report` webhook delivers the full recording URL + transcript to our server. We then use OpenAI to generate a "meeting minutes" style summary.

**Cost: ~$0.10-0.30 per human call** (5-10 min). Monthly 50 calls ≈ $5-15.

---

## 1. The core question: how do human-answered calls get recorded?

### Options evaluated

| Option | Approach | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. AI transfers to Alex via Vapi** | Vapi's `transferCall` tool dials Alex's phone, bridges the call, recording continues | Already in Vapi ecosystem; single phone number; recording seamless | Slight latency during transfer; cost of transferred minutes | ✅ **RECOMMENDED** |
| B. Alex uses personal phone + manual app | Alex installs a call recorder app, manually starts recording | Full control, no AI needed | Manual = forgotten; transcription hard; no AI handoff context | ❌ Not user-friendly |
| C. Twilio conference call | Twilio hosts a 3-way call, records it | Reliable | New vendor; more config | ❌ Adds complexity |
| D. Alex picks up first, AI is fallback | AI only answers when Alex doesn't | Simple, no transfer needed | Loses the AI "first line" benefits (cost, availability, screening) | ❌ Wrong model |

**Why Option A wins:**
- Vapi is already managing the call, so transfer + recording is built-in
- Customer hears ONE phone number, ONE greeting
- AI does the "pre-qualification" (zip, trade, urgency) — Alex only takes calls worth his time
- Recording is **uninterrupted** across the AI → human handoff
- Transcript is one continuous stream (easier for downstream AI summarization)

### How Vapi transfer + recording works (technical)

```
Customer dials +1-724-362-0422
  → Vapi answers, AI greets: "Handy Works, this is Alex. What's the issue."
  → AI collects: issue + zip + check_and_quote
  → Customer: "Can I speak to a real person?"
  → AI calls Vapi tool: transferCall(target: "+15127126713" = Alex's phone)
     ↳ Vapi puts customer on hold (brief hold music)
     ↳ Vapi dials Alex's phone
     ↳ If Alex answers: Vapi bridges the audio
     ↳ Recording continues seamlessly through the bridge
  → Alex and customer talk
  → Whoever hangs up first → call ends
  → Vapi sends end-of-call-report webhook to /api/vapi/webhook with:
     - recordingUrl (full audio, both portions)
     - stereoRecordingUrl (if stereo mode is on — separate AI vs human channels)
     - transcript (one continuous transcript)
     - messages (full message log)
     - duration, cost, etc.
```

The recording URL is a permanent Vapi-hosted MP3 file we can download for storage.

---

## 2. Architecture: end-to-end flow

```
                                ┌─────────────────────────────────┐
                                │        Vapi platform            │
[Customer]                      │                                 │
   │                            │  1. AI receptionist answers     │
   │ call +1-724-362-0422       │  2. AI does triage              │
   ├──────────────────────────► │  3. Customer asks for human     │
   │                            │  4. AI calls transferCall tool   │
   │                            │  5. Vapi dials Alex's phone     │
   │                            │  6. Recording continuous         │
   │                            │  7. Call ends                    │
   │                            │  8. Webhook to our server       │
   │                            └──────────┬──────────────────────┘
   │                                       │
   │                                       ▼
   │                            ┌─────────────────────────────────┐
   │                            │   /api/vapi/webhook              │
   │                            │   Next.js API route              │
   │                            │                                 │
   │                            │   • Detects human handoff        │
   │                            │   • Pulls recording from Vapi    │
   │                            │   • Uses existing Vapi transcript│
   │                            │   • Calls OpenAI gpt-4o-mini:    │
   │                            │     - Meeting minutes summary    │
   │                            │     - Customer intent extract    │
   │                            │     - Action items               │
   │                            │     - Follow-up priority          │
   │                            │   • Stores in Supabase            │
   │                            └──────────┬──────────────────────┘
   │                                       │
   │                                       ▼
   │                            ┌─────────────────────────────────┐
   │                            │     Supabase (storage + DB)      │
   │                            │                                 │
   │                            │  • human_calls table             │
   │                            │  • call_recordings bucket         │
   │                            │  • work_orders (extended)        │
   │                            └──────────┬──────────────────────┘
   │                                       │
   │                                       ▼
   │                            ┌─────────────────────────────────┐
   │                            │  Dashboard (existing)           │
   │                            │                                 │
   │                            │  • New "Human Calls" tab         │
   │                            │  • Each call: transcript +       │
   │                            │    summary + action items +      │
   │                            │    audio player                  │
   │                            │  • Mark as reviewed/done         │
   │                            └──────────┬──────────────────────┘
   │                                       │
   │                                       ▼
   │                            ┌─────────────────────────────────┐
   │                            │  Notification (optional)         │
   │                            │                                 │
   │                            │  • SMS to Alex with summary      │
   │                            │  • Push notification             │
   │                            │  • Email digest                  │
   │                            └─────────────────────────────────┘
```

---

## 3. Two transfer modes: blind vs warm

| Mode | What customer hears | What Alex hears | Pros | Cons |
|---|---|---|---|---|
| **Blind (MVP)** | Hold music → Alex says "Hello?" | "Hello?" — has to ask who's calling | Simple to implement | Alex doesn't know context; customer repeats themselves |
| **Warm** | Hold music → AI says "Hi Alex, [name] is on the line about [issue]" → bridge | Full context before pickup | Better UX; less repetition | AI has to talk to Alex before bridging (3-4 sec extra) |

**Recommendation:** Start with **blind** for MVP (faster ship), add warm transfer in v2.

If Alex is busy or doesn't pick up:
- Option A: Call goes to voicemail (still recorded) → AI calls customer back
- Option B: Call comes back to AI with a "sorry, no human available, want to leave a message or have Alex call back?"

---

## 4. Data model

### Option A: new table `human_calls` (recommended for clarity)

```sql
CREATE TABLE human_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boss_id UUID REFERENCES bosses(id) NOT NULL,
  -- Call metadata
  vapi_call_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  -- Recording + transcript
  recording_url TEXT NOT NULL,
  transcript TEXT NOT NULL,
  -- AI-extracted meeting minutes
  summary TEXT,                       -- 1-2 sentence summary
  intent TEXT,                        -- what customer wanted
  key_facts JSONB,                    -- {name, phone, address, issue, timing, ...}
  action_items JSONB,                 -- ["call back within 1 hour", "send quote", ...]
  topics_mentioned TEXT[],            -- ["plumbing", "kitchen sink", "leak"]
  customer_tendency TEXT,             -- "urgent", "shopping around", etc.
  follow_up_priority TEXT,            -- 'high' | 'medium' | 'low'
  follow_up_recommendation TEXT,      -- what Alex should do
  -- Workflow
  status TEXT DEFAULT 'pending',      -- 'pending' | 'reviewed' | 'completed' | 'archived'
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Linked AI call (if handoff from AI)
  ai_handoff_at TIMESTAMPTZ,         -- when AI transferred
  -- Cost tracking
  vapi_cost_usd NUMERIC,
  -- Source
  data_source TEXT DEFAULT 'production',
  country TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX human_calls_boss_id_idx ON human_calls(boss_id);
CREATE INDEX human_calls_status_idx ON human_calls(status) WHERE status = 'pending';
CREATE INDEX human_calls_priority_idx ON human_calls(follow_up_priority, created_at) WHERE status = 'pending';
```

### Option B: extend `work_orders` with `call_type` field

Add column `call_type TEXT DEFAULT 'ai_only'` ('ai_only' | 'ai_handoff' | 'human_direct').

Reuse existing columns (summary, intent, customer_name, etc.) for both.

**Trade-off:**
- A: clean separation, easy to query human calls separately
- B: unified view, can filter by call_type

**Recommendation: A** for clarity. The two are fundamentally different flows.

---

## 5. AI summarization prompt (meeting minutes)

```python
MEETING_MINUTES_PROMPT = """
You are a meeting minutes generator for a home services contractor
(handyman / home repair business).

Given the transcript of a phone call between a CUSTOMER and ALEX (the
contractor), produce a structured summary.

Output a JSON object with these fields:

{
  "summary": "<1-2 sentences: what the call was about>",
  "intent": "<what the customer wanted — be specific, e.g. 'get quote for kitchen sink leak repair, available tomorrow morning'>",
  "key_facts": {
    "name": "<if mentioned>",
    "phone": "<if confirmed>",
    "address": "<if mentioned>",
    "issue": "<problem description in customer's own words>",
    "trade_needed": "<plumbing/electrical/hvac/handyman/etc.>",
    "timing": "<when they want service — 'asap' | 'tomorrow morning' | 'next week'>",
    "urgency_signals": "<any signals — 'water everywhere', 'no heat', 'before guests arrive'>",
    "budget_signals": "<any mention of price sensitivity>"
  },
  "action_items": [
    "<concrete action Alex should take, e.g. 'call back within 1 hour to confirm appointment'>",
    ...
  ],
  "topics_mentioned": ["<short topic keywords>"],
  "customer_tendency": "<overall vibe — 'urgent and ready to book' | 'shopping around' | 'just curious' | 'frustrated with previous contractor'>",
  "follow_up_priority": "<'high' | 'medium' | 'low'>",
  "follow_up_recommendation": "<specific next step — e.g. 'Quote $200-500 range for plumbing. Schedule Mon 9-12am. Send text confirmation'>"
}

Rules:
- Be CONCISE. Sentences ≤ 15 words.
- Use customer's own words where possible (e.g. don't paraphrase their problem).
- If something wasn't mentioned, set field to null (don't guess).
- "intent" should be actionable, not vague.
- "action_items" should be specific tasks, not general advice.
- "follow_up_priority" is high if there's any urgency signal (water damage, no heat, customer is upset).
"""
```

We can use the same `summarizeWithLLM` infrastructure already in place (with caching).

---

## 6. Implementation phases

### Phase 1: Recording (2-3 days)

**Goal: human-answered calls get recorded; webhooks have the audio.**

1. Add `transferCall` tool to Vapi assistant config (next to existing 4 tools)
2. Configure Alex's phone (`+15127126713`) as the transfer target — make it env var so it's not in code
3. Add tool case in `src/app/api/vapi/tools/route.ts` — just call the Vapi transfer API
4. Test: call Vapi, AI answers, AI transfers, Alex answers, recording captures both sides
5. Verify `end-of-call-report` webhook has `recordingUrl` populated

**No new code** for transcription or summarization in this phase — we just verify recording works.

### Phase 2: Storage + transcript (1-2 days)

1. Migration 012: create `human_calls` table
2. Update webhook handler to detect transfer handoff (look for `transferCall` tool call in messages)
3. Save recording URL to Supabase Storage `call-recordings` bucket
4. Use Vapi's transcript field (already provided) — save to `human_calls.transcript`
5. Test: full end-to-end, see transcript in DB

### Phase 3: AI meeting minutes (1-2 days)

1. New file `src/lib/meeting-minutes.ts` with the prompt
2. Reuse `summarizeWithLLM` (cache by transcript hash)
3. Save structured fields to `human_calls` row
4. Test: see summary, intent, action items populated

### Phase 4: Dashboard (2-3 days)

1. New tab: "Human Calls" in main dashboard
2. Card view: customer name + phone + summary + action items + audio player + status badge
3. Detail view: full transcript, all key facts, action items checklist, mark as done button
4. Filter: status (pending/reviewed/done) + priority

### Phase 5: Notifications (1-2 days, optional)

1. SMS to Alex when human call ends (Twilio)
2. Push to a mobile app (out of scope for MVP)
3. Daily email digest of pending follow-ups

---

## 7. Edge cases to handle

| Edge case | How to handle |
|---|---|
| Alex doesn't answer (busy/on a job) | Call goes to voicemail; recording captures voicemail; AI sends SMS to customer "Alex will call back within 1 hour" |
| Alex declines transfer | "Sorry, Alex is unavailable right now. Can I take a message or have him call you back?" |
| Multiple transfers (Alex → technician) | Vapi supports nested transfers; record each separately |
| Call drops during transfer | Vapi sends `status-update` with `ended` reason; we save partial transcript |
| Recording fails | Vapi retries; if still fails, log and notify admin |
| Customer uses profanity / is abusive | Recording still captures; summary flags it; Alex can review before calling back |
| International caller (H-Master Malaysia) | Vapi supports global numbers; transfer to international cost is ~$0.10/min |
| Alex forwards to voicemail intentionally | "Alex is unavailable, please leave a message after the tone" — recorded |
| Recording over 1 hour | Vapi auto-splits; we stitch them back together |
| Multiple humans answer (Alex + Abel) | Round-robin or both receive simultaneous ring (Vapi supports) |

---

## 8. Decisions needed before implementation

1. **Transfer mode**: Blind (MVP) or warm transfer (v2)?
2. **Alex's fallback**: Voicemail recording + AI callback, or always-AI fallback?
3. **Notifications**: SMS / email / push / none? SMS has per-message cost (~$0.05/msg).
4. **Multiple staff**: Just Alex for now, or also Abel? (Recommended: just Alex for MVP)
5. **Data model**: new `human_calls` table (recommended) or extend `work_orders`?
6. **AI summary provider**: Use existing OpenAI gpt-4o-mini (recommended) or upgrade to gpt-4o for higher quality?
7. **Retention**: How long to keep human call recordings? (Recommended: 90 days then archive)
8. **Privacy notice**: When transferring, should AI say "this call is being recorded" again to Alex?

---

## 9. Cost estimate

Per human call (assume 5 min average):
- Vapi transfer: $0.05/min × 5 = $0.25
- Vapi recording: free (included)
- OpenAI summary: $0.01
- Supabase storage: $0.005
- SMS notification (optional): $0.05
- **Total: ~$0.30 per call**

Monthly (50 human calls):
- $15/month Vapi
- $0.50 OpenAI
- $0.25 storage
- $2.50 SMS
- **Total: ~$18/month for 50 calls**

Compare to:
- US receptionist answering: ~$1,200/month
- AI-only (no handoff): ~$5/month but loses complex cases

**Value: $18/month to capture complex jobs that AI can't close.** ROI is obvious if it converts even 1-2 extra jobs/month.

---

## 10. What I'm NOT including in MVP (deferred)

- Warm transfer (v2)
- Multiple staff routing (v2, after Abel joins)
- Push notifications (needs mobile app)
- Real-time transcription (Vapi provides post-call transcript; "live" is more complex)
- Sentiment analysis (could add to summary later)
- Auto-send quote to customer (would need pricing rules)
- Schedule appointment directly in calendar (needs Google Calendar integration)

---

## 11. Open questions for you

1. **Priority**: Is this MVP worth building before H-Master go-live, or after?
2. **Blind vs warm transfer**: Start with blind (simpler) or invest in warm from day 1?
3. **Notification**: SMS / email / none for MVP?
4. **Data model**: New table `human_calls` (my recommendation) or extend existing?
5. **AI quality**: Use gpt-4o-mini (cheap, fast) or gpt-4o (slower, better) for summaries?

Once you answer these, I'll start with Phase 1 (recording).
