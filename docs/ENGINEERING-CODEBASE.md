# HandyLine AI — Engineering Codebase Documentation

> Audience: engineers picking up this codebase, contractors' technical
> leads, and partners integrating with HandyLine.
> Last updated: 2026-09-24 — reflects code at commit `2a8253e` plus the
> multi-region import-script changes.

---

## 1. System architecture

```
┌─────────────┐    phone     ┌─────────────────────────┐
│   Caller    │ ───────────► │  Vapi (voice + LLM)     │
└─────────────┘              │  Assistant (per boss)   │
                             └────────────┬────────────┘
                                          │ tool calls (HTTPS)
                                          │ webhook (HTTPS, signed)
                                          ▼
                             ┌─────────────────────────┐
                             │  Next.js App (Vercel)   │
                             │  /api/vapi/tools        │
                             │  /api/vapi/webhook      │
                             │  /api/twilio/* (urgent) │
                             └────────────┬────────────┘
                                          │ Supabase JS client
                                          ▼
                             ┌─────────────────────────┐
                             │  Supabase               │
                             │  - Postgres (bosses,    │
                             │    work_orders, trades, │
                             │    price_list, llm_usage│
                             │  - Storage (recordings, │
                             │    persistent audio)    │
                             └────────────┬────────────┘
                                          │ Realtime + REST
                                          ▼
                             ┌─────────────────────────┐
                             │  Next.js dashboard      │
                             │  /orders /preview       │
                             │  /config /admin         │
                             └─────────────────────────┘

External helpers:
- Twilio: emergency call bridging
- OpenAI: GPT-4o-mini for call summarization & meeting minutes
- ElevenLabs: TTS (voice)
- Google Maps: distance / service-area validation
```

---

## 2. Tech stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 14 (App Router) | One repo, Vercel-native, serverless API routes |
| Language | TypeScript (strict) | Type safety for boss data model |
| UI | React + Tailwind + shadcn/ui | Fast prototyping, good defaults |
| Voice | Vapi | Built-in LLM + TTS + STT + tool calling |
| LLM | GPT-4o-mini | Cost vs quality tradeoff |
| TTS | ElevenLabs `eleven_turbo_v2_5` | Quality + reasonable cost |
| DB | Supabase Postgres | Realtime + RLS + Storage in one |
| Telephony (emergency) | Twilio | Cheap, well-documented |
| Hosting | Vercel | Auto-deploy from GitHub |
| Tests | Plain Node scripts | No framework overhead |

No state library — every page fetches from Supabase directly with SSR.
No ORM — PostgREST + hand-written REST helpers in `src/lib/supabase.ts`.

---

## 3. Directory layout

```
handyline-ai-receptionist/
├── src/
│   ├── app/                    Next.js App Router
│   │   ├── page.tsx            Landing
│   │   ├── orders/[id]/        Work order detail
│   │   ├── preview/            Customer shareable preview
│   │   ├── human-handoff-demo/ Standalone meeting-minutes demo
│   │   ├── config/             Boss config panel
│   │   ├── landing/            Marketing landing
│   │   ├── sea/                SEA market page
│   │   ├── test/               Internal test page
│   │   └── api/
│   │       ├── vapi/
│   │       │   ├── tools/      Vapi tool dispatcher (4 tools)
│   │       │   └── webhook/    Vapi end-of-call-report handler
│   │       ├── twilio/
│   │       │   ├── emergency-twiml/       TwiML for emergency calls
│   │       │   ├── emergency-decision/     Branch AI bridge vs hangup
│   │       │   └── emergency-status/      Twilio status callback
│   │       ├── cron/emergency-retry/      Cron: retry missed urgent
│   │       ├── boss/callback/             Boss phone callback handler
│   │       ├── admin/
│   │       │   ├── reclassify/            Manual re-classification
│   │       │   └── llm-stats/             LLM usage & cost
│   │       ├── v1/                       External partner API
│   │       ├── human-handoff-demo/summarize/  OpenAI meeting minutes
│   │       └── dev/                      Dev seed / clear / simulate
│   ├── components/ui/          shadcn/ui primitives
│   └── lib/                    Business logic — the heart of the app
│       ├── order.ts            Boss routing + work-order creation
│       ├── validation.ts       Country-aware service area + trade check
│       ├── call-summary.ts     Regex-based call summarization
│       ├── openai-summarize.ts LLM-based call summarization (preferred)
│       ├── vapi-event-handler.ts Dispatch Vapi events
│       ├── emergency-call.ts   Twilio retry logic
│       ├── notify.ts           Boss notification (SMS/email)
│       ├── sample-transcripts.ts Hard-coded demo transcripts
│       ├── types.ts            DB types (bosses, work_orders, ...)
│       ├── supabase.ts         Supabase client (anon + service role)
│       └── utils.ts            Misc utilities
│
├── scripts/                    Node.js ops scripts (run with `node`)
│   ├── import-vapi-calls.js    Pull historical Vapi calls → work_orders
│   ├── import-vapi-webcalls.js Same + dashboard webCalls (stricter filter)
│   ├── create-vapi-assistant*.js / update-vapi-assistant*.js
│   ├── create-emergency-assistant.js / update-emergency-assistant.js
│   ├── test-static-config.js   34-check env/DB/Vapi config validator
│   ├── test-conversations.js   24 LLM behavior scenarios (uses OpenAI)
│   ├── test-scenarios.js       End-to-end Vapi call scenarios
│   ├── analyze-calls.js        Read-only analysis of production calls
│   ├── seed-demo-data.js / seed-my-demo-data.js
│   ├── clear-test-data.js      Dev seed cleanup
│   ├── vercel-env-push.sh      One-shot env sync to Vercel
│   └── lib/call-summary.js     JS port of call-summary.ts
│
├── supabase/
│   ├── schema.sql              Canonical schema (reference only)
│   ├── migrations/             11 ordered SQL migrations (apply all)
│   └── config.toml             supabase CLI config
│
├── vapi/
│   ├── assistant.json          US Alex — full config (4 tools)
│   ├── assistant-my.json       MY H-Master placeholder
│   ├── assistant-sg.json       SG (empty)
│   ├── system-prompt.md        US Alex system prompt (5767 chars)
│   ├── system-prompt-my.md     MY placeholder
│   └── system-prompt-sg.md     SG placeholder
│
├── docs/                       11 design docs + 2 handover docs
│
├── public/                     Static assets
├── .env.local                  All secrets (NOT in git)
├── .env.example                Placeholder schema
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json / package-lock.json
└── HANDOVER.md / README.md / SETUP.md
```

---

## 4. Data model

### 4.1 Tables

```
bosses
  id                              uuid PK
  name                            text
  phone_number                    text          E.164
  vapi_assistant_id               uuid UNIQUE
  vapi_phone_number               text
  address, city, state, zip       text
  country                         text          US | MY | SG | ID
  currency                        text          USD | MYR | SGD | IDR
  locale                          text          en-US | en-MY | ...
  timezone                        text          America/Chicago | ...
  hours_of_operation              jsonb         {"mon": {"open": "08:00", ...}}
  trip_fee                        numeric       default 89
  free_distance_miles             numeric       default 15
  surcharge_per_mile              numeric       default 2
  service_radius_miles            numeric       default 25
  service_zip_prefixes            text[]        ["770", "774", ...]
  service_postcode_ranges         jsonb         [{"from": "93000", "to": "98000"}]
  notification_phone              text
  created_at, updated_at          timestamptz

service_trades
  boss_id                         uuid FK → bosses
  trade_key                       text          "plumbing", "hvac", ...
  display_name                    text
  is_coordinated                  boolean       true if sub-contracted
  urgency_threshold               text          "any" | "urgent_only" | "none"
  notes                           text

price_list
  boss_id                         uuid FK
  trade_key                       text
  labor_low, labor_high           numeric
  typical_hours                   numeric
  notes                           text

work_orders
  id                              uuid PK
  boss_id                         uuid FK
  customer_name, customer_phone   text
  customer_zipcode                text
  issue_type                      text
  accepted_topics, rejected_topics text[]
  ai_decision                     text          accepted|urgent|unsure|rejected
  ai_decision_reason              text
  quote_low, quote_high           numeric
  pricing_breakdown               jsonb
  summary                         text
  customer_name_extracted         text
  intent_summary                  text
  customer_tendency               text
  mentioned_topics                text[]
  follow_up_priority              text          high|medium|low|none
  follow_up_notes                 text
  follow_up_recommended           boolean
  transcript_coherence            text
  transcript                      jsonb         [{role, text, ts}, ...]
  recording_url                   text          permanent Supabase Storage URL
  status                          text          pending|urgent|callback|rejected|won|lost
  data_source                     text          production|seed|simulation
  vapi_call_id                    text UNIQUE
  created_at                      timestamptz

llm_usage
  id                              uuid PK
  call_id                         text
  model                           text          gpt-4o-mini
  prompt_tokens, completion_tokens int
  cost_usd                        numeric
  purpose                         text          summarize|classify|extract
  created_at                      timestamptz
```

### 4.2 Migration order

Apply in numeric order via `supabase db push`:

```
001_add_service_zip_prefixes.sql   Add service_zip_prefixes to bosses
002_add_pricing.sql                Add trip_fee, fuel surcharge, surcharge_per_mile
003_add_outbound_tracking.sql      Outbound call audit fields
004_add_data_source.sql            work_orders.data_source
005_add_followup_intent.sql        follow_up_* fields on work_orders
006_add_accepted_rejected_coherence.sql  accepted_topics / rejected_topics / transcript_coherence
007_add_llm_usage.sql              llm_usage table
008_add_summary_hash.sql           Cache key for call summaries
009_add_country.sql                bosses.country
010_add_bosses_country.sql         bosses full i18n fields (currency, locale, tz, ...)
011_seed_h_master_boss.sql         Seed MY H-Master row
```

Each migration is idempotent and additive. Never edit a past migration —
write a new one.

---

## 5. Boss routing — the heart of the system

**One core invariant**: `Boss = Vapi assistant = Phone number = Supabase boss row`.
Never share an assistant across two bosses.

### 5.1 Routing by `assistantId`

```typescript
// src/lib/order.ts
export async function getBossByVapiAssistantId(
  assistantId: string,
): Promise<Boss | null> {
  // SELECT * FROM bosses WHERE vapi_assistant_id = ?
  // Returns the boss row or null
}
```

Every Vapi webhook and tool call carries an `assistantId` (or
`call.assistantId` on webhooks). We resolve the boss once per request and
thread the boss object through the rest of the handler.

### 5.2 Why not route by phone number?

Two contractors can share a country code (e.g. +1 US). If we routed by
caller-ID, a customer calling boss A's number from a phone previously
associated with boss B's service area would misroute. Assistant IDs are
unique and never collide.

### 5.3 Fallback chain

```
getBossByVapiAssistantId(assistantId)
  → null
getBossByCountry(detectCountryFromPhone(callerNumber))
  → null
getBossDefault()      // for dev/seed data only
```

The fallback chain is **only** for dev seed data. In production every Vapi
tool call should resolve via assistantId. If it doesn't, that's a bug
(see `KNOWN ISSUES` #2).

---

## 6. Vapi tools (the AI's 4 superpowers)

The Vapi assistant is configured with **exactly 4 tools**. Each maps 1:1
to an HTTPS endpoint under `/api/vapi/tools`:

### 6.1 `check_and_quote`

**Purpose**: full validation + price quote in one call.

**Args**: `{ zipcode: string, issue_type: string }`

**Flow**:
1. `validation.ts` → `validateService(boss, zipcode, issue_type)`
   - Checks `service_zip_prefixes` (US) or `service_postcode_ranges` (MY)
   - Checks `service_trades` table for `trade_key`
   - Returns `{ in_area: bool, in_trade: bool, distance_miles?: number }`
2. If both true → `get_price_quote(boss, issue_type)` returns
   `{ range: {low, high}, trip_fee, fuel_surcharge, total_low, total_high, ... }`
3. If false → return rejection reason

**Returns**: structured JSON the AI narrates back to the caller.

### 6.2 `flag_urgent`

**Purpose**: mark the work order urgent and trigger Twilio bridge.

**Args**: `{ reason: string, customer_phone: string }`

**Side effects**:
- Creates `work_orders` row with `ai_decision=urgent`, `status=urgent`
- Fires Twilio call to `boss.notification_phone` with TwiML that bridges
  the customer on the original call
- `emergency-call.ts` handles retry (default 3 attempts, 5 min apart)

### 6.3 `flag_uncertain`

**Purpose**: AI couldn't decide — defer to human callback.

**Args**: `{ reason: string }`

**Side effects**:
- Creates `work_orders` row with `ai_decision=unsure`, `status=callback`
- Pushes notification to boss's dashboard "callback" queue

### 6.4 `end_call`

**Purpose**: cleanly end the call with a structured outcome.

**Args**: `{ outcome: "accepted"|"urgent"|"unsure"|"rejected", summary: string }`

**No side effects** beyond recording the outcome on the work order. The
AI is required to call this *after* any other tool call and *before*
saying goodbye.

### 6.5 Why exactly 4 tools?

Vapi allows more, but every extra tool is a potential prompt-injection
vector and a context-window tax. Four is enough to cover 100% of the
call scenarios we care about, and each maps cleanly to one business
decision.

---

## 7. Vapi webhook (`/api/vapi/webhook`)

Triggered on `end-of-call-report`. Reads `call.artifact.messages`,
extracts the last `end_call` arguments (or `flag_urgent` / `flag_uncertain`
if no `end_call`), and writes/updates the work order.

**Critical implementation detail**: Vapi presigned recording URLs expire
in 30 minutes. We download the audio inside the webhook handler and
re-upload to Supabase Storage at `call-recordings/{call_id}.wav`. The
permanent URL is what's stored on the work order.

**Idempotency**: webhook is safe to receive twice. The work order has a
unique index on `vapi_call_id`; re-receipt updates the row rather than
inserting a duplicate.

---

## 8. Twilio emergency flow

```
Caller dials boss number
  → Vapi answers, AI engages
  → AI detects emergency → flag_urgent tool
    → create work_orders row (status=urgent)
    → Twilio.placeCall(boss.notification_phone, url=/api/twilio/emergency-twiml)
      → Twilio calls boss, plays TwiML <Dial> bridging caller + AI still on line
      → Boss hears caller live, can take over
  → cron/emergency-retry handles missed urgent escalations (3 tries, 5 min)
```

TwiML templates live in `src/app/api/twilio/emergency-twiml/route.ts`.

---

## 9. Human Handoff demo (`/human-handoff-demo`)

Standalone demo that runs the meeting-minutes pipeline without involving
Vapi. The user picks one of 4 hard-coded transcripts, the page POSTs to
`/api/human-handoff-demo/summarize`, which calls GPT-4o-mini with
`response_format: json_object` and returns a structured `MeetingMinutes`
object (attendees, decisions, action items, follow-ups).

Cached by SHA-256 of the transcript on Supabase to avoid repeat OpenAI
calls. The page is fully client-rendered.

This is a **demo**; real human handoff via Vapi's `transferCall` tool
with continuous recording is the Phase 1 plan in
`docs/HUMAN-HANDOFF-DESIGN.md`.

---

## 10. Key library deep-dives

### 10.1 `src/lib/order.ts` (24 KB — the routing core)

Three exported functions:

- `getBossByVapiAssistantId(assistantId)` — the primary lookup
- `getBossByCountry(country)` — fallback for seed/dev data
- `getBossDefault()` — returns the first boss (dev only; refuses in
  production unless `NODE_ENV !== 'production'`)

Plus `detectCountryFromPhone(phoneNumber: string): "US"|"MY"|"SG"|"ID"|null`
which uses phone-number-prefix heuristics (e.g. +1 → US, +60 → MY).

### 10.2 `src/lib/validation.ts` (11 KB)

`validateService(boss, zipcode, issue_type)`:
- US: prefix-match against `boss.service_zip_prefixes`
- MY: range-match against `boss.service_postcode_ranges`
- Distance check via Google Maps if a `customer_address` is also given

`getPriceQuote(boss, issue_type, distance_miles)`:
- Returns the structured `{ range, trip_fee, fuel_surcharge, total_low,
  total_high, ... }` JSON.

### 10.3 `src/lib/call-summary.ts` (20 KB)

Pure regex-based extraction of:
- `customerNameExtracted` (e.g. "my name is Bob" → "Bob")
- `intentSummary` (rule-based first sentence)
- `customerTendency` (scheduling / price_shopping / complaint / etc.)
- `mentionedTopics` (lowercased noun phrases)
- `followUpPriority` (priority based on decision + topics)

### 10.4 `src/lib/openai-summarize.ts` (12 KB)

LLM version of the above using GPT-4o-mini with `response_format:
json_object`. Used by the Vercel webhook path (where OpenAI is fast and
reachable) but **not** by the local import script (China → OpenAI 30s+
timeouts).

The import script falls back to the regex version automatically.

---

## 11. API endpoints summary

| Path | Method | Purpose |
|------|--------|---------|
| `/api/vapi/tools` | POST | Vapi dispatches 4 tools here |
| `/api/vapi/webhook` | POST | Vapi end-of-call-report |
| `/api/twilio/emergency-twiml` | POST | TwiML for emergency bridge |
| `/api/twilio/emergency-decision` | POST | Branch AI bridge vs hangup |
| `/api/twilio/emergency-status` | POST | Twilio call status callback |
| `/api/cron/emergency-retry` | POST | Cron retry missed urgents |
| `/api/boss/callback` | POST | Boss phone callback |
| `/api/admin/reclassify` | POST | Manual re-classification |
| `/api/admin/llm-stats` | GET | LLM cost analytics |
| `/api/human-handoff-demo/summarize` | POST | GPT-4o-mini meeting minutes |
| `/api/v1/assistants` | GET/POST | Partner API |
| `/api/v1/singlish-eval` | POST | Singlish evaluation |
| `/api/dev/seed` | POST | Dev seed |
| `/api/dev/clear` | POST | Clear dev seed |
| `/api/dev/simulate-call` | POST | Fake call for testing |

---

## 12. System prompt rules

Located in `vapi/system-prompt.md` (US Alex — 5767 chars). Key invariants
enforced by prompt:

1. **Spelled-out numbers**: AI must read phone numbers and zip codes as
   word sequences ("seven one three ..."), not raw digits.
2. **No `$` or `%`**: read as "dollars" / "percent".
3. **No Chinese characters**: ElevenLabs breaks on CJK glyphs in EN
   prompt.
4. **Always ask "Anything else I can help with?"** before `end_call`
   (except during `flag_urgent` flow).
5. **Closing vocabulary**: "I will certainly call to follow up. Have a
   good day." / "Cheers." — never "Bye" or "See ya".
6. **Tool usage order**: `check_and_quote` first (when applicable), then
   `flag_*` if needed, then `end_call` last.
7. **No speculation**: if unsure, `flag_uncertain` rather than guess.

The MY prompt (`vapi/system-prompt-my.md`) and SG prompt
(`vapi/system-prompt-sg.md`) follow the same structure but are
placeholders awaiting real MY/SG business data.

---

## 13. Environment variables

26 keys live in `.env.local` (see HANDOVER.md for the full list). The
five critical ones:

| Var | Used by |
|-----|---------|
| `VAPI_API_KEY` | All Vapi requests (server only) |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | Client-side Vapi widget |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB writes (bypasses RLS) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side reads (RLS-enforced) |
| `OPENAI_API_KEY` | Server-side call summarization |

Plus per-region Vapi assistant IDs (`VAPI_ASSISTANT_ID`,
`VAPI_MY_ASSISTANT_ID`, `VAPI_SG_ASSISTANT_ID`, `VAPI_ID_ASSISTANT_ID`).

The import scripts read `.env.local` directly with `fs.readFileSync` and
regex parsing — Node doesn't auto-load `.env.local`.

---

## 14. Scripts catalog

| Script | Purpose | Usage |
|--------|---------|-------|
| `test-static-config.js` | 34-check env/DB/Vapi validator | `node scripts/test-static-config.js [--live]` |
| `test-conversations.js` | 24 LLM behavior scenarios | requires OpenAI API access |
| `test-scenarios.js` | End-to-end Vapi calls | uses Twilio test creds |
| `import-vapi-calls.js` | Pull historical calls (multi-region) | `node scripts/import-vapi-calls.js [--regions us,my] [--write] [--boss-id <uuid>]` |
| `import-vapi-webcalls.js` | Same + dashboard webCalls | same flags |
| `analyze-calls.js` | Read-only analysis | `node scripts/analyze-calls.js` (hardcoded call IDs) |
| `create-vapi-assistant*.js` | Provision a new assistant | `--region us|my|sg|id` |
| `update-vapi-assistant*.js` | PATCH an existing assistant | reads JSON in same dir |
| `create-emergency-assistant.js` | Provision the US urgent assistant | one-shot |
| `seed-demo-data.js` / `seed-my-demo-data.js` | Dev seed | one-shot |
| `clear-test-data.js` | Clean dev seed | one-shot |
| `vercel-env-push.sh` | Sync `.env.local` → Vercel | bash, one-shot |

### Multi-region import flags (added 2026-09-22)

```
node scripts/import-vapi-calls.js                # dry-run, regions us+my
node scripts/import-vapi-calls.js --write         # actually write
node scripts/import-vapi-calls.js --regions my   # only MY
node scripts/import-vapi-calls.js --regions us,my --write
node scripts/import-vapi-calls.js --boss-id <uuid> --write
```

Defaults to DRY-RUN. Must pass `--write` to commit. This is a behavior
change from the legacy `--dry-run` flag (which still works but is
implied).

---

## 15. Testing strategy

Three layers:

1. **Static config (`test-static-config.js`)** — 34 checks against
   `.env.local`, Supabase schema, Vapi assistant config, and known IDs.
   Runs in <5s. **Run this first** when debugging "is it set up?".
2. **Conversation behavior (`test-conversations.js`)** — 24 simulated
   call transcripts through GPT-4o-mini to verify the AI's decision
   logic. Requires OpenAI API access (won't run from China — defer to
   CI).
3. **End-to-end (`test-scenarios.js`)** — actually calls Vapi with
   Twilio test creds. Slow, expensive, only run on staging.

In addition, `docs/US-USER-TEST-CASES.md` contains **32 user-level test
cases** for the dashboard UX (not automated; manual QA).

---

## 16. Deployment

Vercel auto-deploys from the `main` branch of
`github.com/yyymmmzzz/handyline-ai-receptionist`.

**Pre-deploy checklist:**

1. `npm install` clean
2. `node scripts/test-static-config.js` passes
3. `supabase db push` (apply any new migrations)
4. Manual smoke test on Vercel preview URL

**Required Vercel env vars**: same 26 as `.env.local` — use
`./scripts/vercel-env-push.sh` to one-shot sync.

**Project state at handoff**: Vercel project is still named "demo" (id
`prj_uVTUUJuMqenAxleB1K7aw1tS2PK2`). Rename to `handyline-ai-receptionist`
when convenient.

---

## 17. Known issues & TODOs

1. **Vapi 14-day retention window** — calls older than 14 days return
   `400 retention window exceeded`. Old historical calls cannot be
   re-imported unless Vapi plan is upgraded.
2. **Fallback routing in production** — `getBossDefault()` exists and is
   technically callable. It must never fire in production. Add a guard
   in the webhook to refuse if assistantId doesn't resolve.
3. **MY H-Master placeholder** — `vapi/system-prompt-my.md` is a stub
   awaiting real MY business data. The assistant exists and would answer
   calls but with placeholder behavior.
4. **OpenAI from China unreachable** — `import-vapi-calls.js` auto-falls
   back to regex. Vercel deployment path is unaffected.
5. **No boss self-service onboarding** — adding a new boss today means
   running scripts by hand (provision Vapi assistant, seed boss row,
   push env, redeploy). See roadmap.

---

## 18. Glossary

- **Boss** — contractor customer record
- **Work order** — one phone call's structured output
- **Trade** — service line a boss performs
- **Hot transfer** — bridging live call to boss's phone with AI still on
- **Cold transfer** — handing off call and disconnecting AI (not used)
- **Capture** — a successfully qualified lead (decision=accepted)
- **Retention** — Vapi's 14-day call log window on Pro tier