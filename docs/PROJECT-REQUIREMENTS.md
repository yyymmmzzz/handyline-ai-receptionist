# HandyLine AI — Product Requirements Document

> Audience: product, operations, sales, partners, new hires.
> Last updated: 2026-09-24 — reflects the shipped MVP for US Alex / Handy Works,
> plus the MY H-Master placeholder.

---

## 1. Product vision

HandyLine AI is a 24/7 AI phone receptionist purpose-built for independent
home-services contractors. It picks up every call, qualifies the request
against the contractor's actual service area and trade list, gives an
honest price range, escalates genuine crises to a human on-call line, and
hands off complex conversations to a human dispatcher — all while writing
clean, structured work orders into the contractor's dashboard.

We are **not** a generic call center, and we are **not** a generic AI
chatbot. Every prompt, every pricing rule, every closing line is tuned
for one persona: a small-business contractor (1–10 employees, $500k–$5M
annual revenue) who personally answers the phone today and would rather
be on a roof.

The product is operated under the HandyLine brand; the parent product is
Bookloh EMS (facilities management SaaS). The AI receptionist is the first
productized surface of Bookloh's contractor operations stack.

---

## 2. Target users

### 2.1 Contractor (the customer)

**Primary persona — Alex, US, plumbing/handyman hybrid (Bellaire, TX)**

- Owner-operator with 1–3 field techs. Co-owner runs admin.
- 5.0★ on Google, 13 in-house trades + 4 sub-contracted (roofing, gas,
  panel, AC). 25-mile service radius around 77401.
- Hours Mon–Sat 8–5, Sun 9–3. Holiday calls get a recorded response.
- Books ~$3k/month of work from inbound calls; misses 1 in 4 calls today.
- Pain point: his own phone rings while he is on a job. Callers hang up.
- Why he cares about HandyLine: he wants every lead captured and triaged
  before he is back at the truck.

**Secondary persona — H-Master, MY, security systems (Bintulu, Sarawak)**

- 6 trade lines (security, alarm, CCTV, autogate, access control, smart
  door lock). ~MYR pricing. en-MY locale.
- Same pain: bilingual callers (Bahasa Malaysia + Manglish/English) who
  need quote range + site visit slot.
- Why HandyLine: bilingual switching, MYR pricing, MY service-area check
  by postcode.

### 2.2 End caller (the home owner)

- US: a homeowner in 77401+ zip code with a leaking water heater, broken
  garbage disposal, or "my dad needs a grab bar installed".
- MY: a Bintulu resident wanting a CCTV quote.
- Tolerance: low. Will hang up after 2 bad interactions. Expects a human
  tone, not a "press 1 for sales" tree.

### 2.3 Internal user

- The contractor himself (Alex) is the dashboard user. He needs to:
  - See new leads within 60 seconds of the call ending.
  - Listen to the recording.
  - Mark a lead as "won", "lost", "callback needed".
  - Forward a lead to his field techs.

---

## 3. Core problems solved

| # | Problem | HandyLine answer |
|---|---------|------------------|
| 1 | Missed calls after hours / on job | AI picks up 24/7, no voicemail black hole |
| 2 | Triage overhead ("is this in my trade? in my area?") | AI asks the questions and only notifies on qualified leads |
| 3 | Price-shoppers ghosting after a quote | Upfront price range + trip fee, so callers self-filter |
| 4 | Genuine emergencies going to voicemail | AI escalates water-leak / gas / panel / HVAC-out to on-call human in <30s |
| 5 | No clean record of what was promised | Every call → structured work order with summary, follow-up priority, topics |
| 6 | Bilingual caller friction (MY) | EN + Manglish + BM switching, MYR pricing, postcode validation |

---

## 4. Functional requirements

### 4.1 Core receptionist flow

**In scope:**

- Inbound phone call answered in <3 rings by Vapi-powered AI voice.
- AI introduces itself using the contractor's business name.
- Captures: what the issue is, customer zip code, urgency, caller name.
- Validates zip code against contractor's service area (US: zip prefix,
  MY: postcode range).
- Validates issue against contractor's trade list (`service_trades`).
- For accepted calls: returns a price range (low/high) including trip fee
  + fuel surcharge + per-mile overage.
- For rejected calls (out of area / out of trade): politely declines,
  suggests calling back during business hours for non-emergencies.
- Always asks "Anything else I can help with?" before ending.
- Closing line: "I will certainly call to follow up. Have a good day."

**Out of scope (v1):**

- Outbound calls (only inbound).
- SMS/WhatsApp self-service.
- Customer-facing dashboard (only the contractor sees the dashboard).
- Multi-language detection beyond EN + Manglish.

### 4.2 Emergency escalation

- AI has a `flag_urgent` tool for: active leak, gas smell, electrical
  spark, no-heat infant home, lockout-with-kid-inside.
- Flagging auto-triggers Twilio → contractor's on-call phone (US: +1
  512-712-6713). The AI bridges the call so the contractor hears the
  caller's voice live.
- Twilio retries up to N times (configurable; default 3, interval 5min).
- The work order is flagged `urgent` and pinned to the top of the
  dashboard.

### 4.3 Human handoff (demo shipped; full integration in flight)

- AI can call `flag_uncertain` to defer to a human dispatcher when it
  cannot resolve the call itself.
- A standalone demo at `/human-handoff-demo` shows the meeting-minutes
  pipeline: raw transcript → GPT-4o-mini structured summary (attendees,
  decisions, action items, follow-ups) → JSON output cached by SHA-256.
- Real integration (`transferCall` Vapi tool with continuous recording)
  is scoped for Phase 1 — see `HUMAN-HANDOFF-DESIGN.md`.

### 4.4 Dashboard

- Routes: `/` (landing), `/orders/[id]` (work order detail), `/preview`
  (shareable order preview for customer), `/config` (boss settings),
  `/admin/llm-stats` (LLM usage & cost).
- Customer preview link: boss can share a public, no-login page with the
  caller to confirm the quote, time window, and contact info.

### 4.5 Multi-region

- One contractor = one Boss row = one Vapi assistant = one phone number.
- Routing by Vapi `assistantId`, not by phone number, so two contractors
  in the same country code never collide.
- Each boss carries its own `country`, `currency`, `locale`, `timezone`,
  `service_trades`, `price_list`, `hours_of_operation`.
- US (USD / en-US / America/Chicago) is production.
- MY (MYR / en-MY / Asia/Kuala_Lumpur) has placeholder assistant; full
  prompt + service area pending.
- SG and ID are reserved env slots but no assistant yet.

---

## 5. Pricing model

### 5.1 Trip fee + per-trade range

- Every quote has a fixed **trip fee** (US: $89 base) + **fuel surcharge**
  (15 free miles, then $2/mile overage) + **per-trade range**.
- Per-trade range comes from the contractor's `price_list` table.
- Caller sees the **all-in range** ("$189 to $389 total") — never just
  labor.
- This intentionally prices out tire-kickers; the contractor is happy
  to lose 30% of price-shoppers.

### 5.2 Margin & revenue

- AI cost per call: ~$0.10 (Vapi + GPT-4o-mini + ElevenLabs).
- Pricing to contractor (v1 plan): $X / month per phone number + per-call
  overage (see business plan `HandyLine AI 商业计划书_v0.3.pptx`).

---

## 6. Voice & TTS rules

- Voice model: **ElevenLabs `eleven_turbo_v2_5`**.
- Numbers must be spelled out ("seven one three, seven four two,
  two three eight seven") — ElevenLabs misreads raw digits.
- Currency symbols and `$` are read poorly → spell out "dollars".
- Hyphens in numbers ("two-hundred") misread → use "two hundred".
- No Chinese characters in US prompt (Chinese characters break
  English TTS).
- Closing vocabulary: "Have a good day" / "Cheers" — never "Bye".
- Before hangup: always "Anything else I can help with?" (except urgent
  escalation).

---

## 7. Service area validation

- US: zip prefix list (e.g. 770.., 774.., 775..) configurable per boss.
- MY: postcode range (e.g. 93000–98000 Sarawak).
- Out-of-area callers: politely declined; offered the original
  contractor's number if known, or general advice to search.

---

## 8. Conversation outcomes

Every call ends with one of:

| AI decision | Meaning | Dashboard status |
|-------------|---------|------------------|
| `accepted` | AI booked a qualified lead | `pending` (contractor confirms) |
| `urgent` | Flagged via `flag_urgent` | `urgent` (top of list) |
| `unsure` | Deferred to human via `flag_uncertain` | `callback` |
| `rejected` | Out of area / out of trade | `rejected` |

Each work order also carries:
- `customer_name_extracted` (regex + LLM)
- `intent_summary` (1-sentence description)
- `customer_tendency` (scheduling / price_shopping / complaint / urgent /
  uncertain / etc.)
- `mentioned_topics` (lowercase phrases)
- `follow_up_priority` (high / medium / low / none)
- `transcript` (full turn-by-turn with role + ts)
- `recording_url` (audio persisted to Supabase Storage; never expires,
  unlike Vapi's 30-minute presigned URL)

---

## 9. Non-goals (v1)

- Generic call center features (ACD, IVR trees, hold queues).
- Outbound campaigns.
- Two-way SMS / WhatsApp.
- Customer self-service portal.
- Multi-language detection (only EN + Manglish / BM partial).
- Multiple contractors sharing one phone number (1 customer = 1
  assistant, period).

---

## 10. Success metrics

| Metric | Target | How measured |
|--------|--------|--------------|
| Pickup rate | >99% of inbound calls answered | Vapi `ended` events vs total |
| Capture-to-quote rate | >70% of qualified leads get a quote | AI decision breakdown |
| False-positive urgent | <5% of `flag_urgent` are not actually urgent | Manual review of urgent queue |
| Customer satisfaction | >4.5/5 from post-call survey (planned) | TBD |
| Time-to-lead-notify | <60s from call end to dashboard visible | `created_at` delta |
| Per-call cost | <$0.15 | `llm_usage` table + Vapi usage |

---

## 11. Roadmap

### Shipped (as of 2026-09-24)

- ✅ Vapi + GPT-4o-mini + ElevenLabs receptionist pipeline
- ✅ 4 Vapi tools: `check_and_quote`, `flag_urgent`, `flag_uncertain`,
  `end_call`
- ✅ Multi-region routing (US Alex production, MY H-Master placeholder)
- ✅ Country-aware validation (US zip prefix, MY postcode range)
- ✅ Twilio emergency escalation with retry
- ✅ Dashboard with order detail, customer preview, boss config
- ✅ Human Handoff + Recording demo at `/human-handoff-demo`
- ✅ Multi-region import script (`import-vapi-calls.js` / `-webcalls.js`)
- ✅ 34-check static config validator
- ✅ 32-case user test plan

### Next 30 days

- 🔄 Phase 1 of `HUMAN-HANDOFF-DESIGN.md`: real Vapi `transferCall`
  integration + continuous recording
- 🔄 Vercel project rename (currently still "demo")
- 🔄 Boss self-service onboarding flow (sign up → pick trades → pick
  hours → auto-provision Vapi assistant)

### Next 90 days

- 🔲 MY H-Master full production prompt + service area + MYR pricing
- 🔲 SG / ID market validation (1 design partner each)
- 🔲 Post-call SMS summary to caller
- 🔲 Boss self-serve analytics page (call volume, conversion, top
  rejected reasons)

### Out of scope (next 90 days)

- Outbound campaigns
- WhatsApp / Messenger
- Multi-tenant single-assistant (still 1 boss = 1 assistant)

---

## 12. Glossary

- **Boss** — the contractor customer (one row in `bosses` table).
- **Work order** — the output of one phone call (one row in `work_orders`).
- **Trade** — a service line (e.g. plumbing, CCTV). A boss has a list of
  trades they perform.
- **Assistant** — a Vapi assistant configuration. 1:1 with a Boss.
- **Region** — country code (US / MY / SG / ID) the assistant operates in.
- **Hot transfer** — bridging a live call to the contractor's phone with
  the AI still on the line, used for emergencies.