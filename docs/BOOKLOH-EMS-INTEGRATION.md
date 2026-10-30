# Bookloh EMS ↔ HandyLine AI Integration Research

**Author:** Mavis · **Date:** 2026-08-24 · **Status:** Research draft (v0.1)

## TL;DR

HandyLine AI (the current demo) is **a module of Bookloh EMS**, not a
standalone product. The integration is mandatory: every AI-handled call
must push a "pending confirmation" event into the EMS calendar within 10 seconds, and
the AI must read the EMS calendar + boss config before it can quote prices
or suggest time slots.

This doc covers three dimensions:
1. **Product research** — what data flows and why
2. **Technical research** — how the systems connect (architecture, protocols)
3. **Development research** — concrete API contracts and build order

---

## 0. Background — What is Bookloh EMS?

From the PRD (`Bookloh AI Receptionist Product Requirements Document (PRD).docx` v0.1, 2026-08-12):

> "Bookloh AI Receptionist (a new module of Bookloh EMS, not a standalone product)"

Bookloh EMS is the parent system — an **event management / calendar /
scheduling platform** for the 1-10 person home-services contractor. It
already has:
- Calendar ("EMS Calendar") with existing events
- Boss config (price list, FAQs, service radius, business hours)
- Customer profiles ("profile") with service history
- Multi-channel push (App + SMS)
- Outbound call triggering (the existing Twilio emergency flow
  re-uses Bookloh EMS outbound)

HandyLine AI is the **inbound voice layer** that feeds orders into it.

> ⚠️ **Critical gap:** the demo has `Plug into real Bookloh EMS API` as
> a TODO in `SETUP.md` (line 354). The EMS API contract is **not yet
> documented**. We must either (a) wait for the EMS team to publish
> OpenAPI, or (b) propose a contract ourselves and have EMS confirm.

---

## 1. Product Research

### 1.1 What data does HandyLine AI **push to** Bookloh EMS?

| # | Event / Data | Direction | Trigger | PRD Ref |
|---|---|---|---|---|
| 1 | **New work order** ("pending confirmation" calendar event) | AI → EMS | End of call, within 10s | §5.7 "work order creation" |
| 2 | **Recording URL** (audio file) | AI → EMS | Same as #1 | §5.7 "summary + recording all inside" |
| 3 | **Full transcript** (raw + LLM-extracted) | AI → EMS | Same as #1 | §1.2 "structured work order" |
| 4 | **Structured summary** (name, intent, tendency, follow-up) | AI → EMS | Same as #1 | §5.7 P0 |
| 5 | **Pricing breakdown** (quote low/high, trip fee) | AI → EMS | Same as #1 | §5.7 "quote / intended time" |
| 6 | **Urgent flag** (outbound already triggered) | AI → EMS | End of call, decision=urgent | §5.9 "AI calls directly" |
| 7 | **Call status update** (confirmed / rejected / rescheduled) | AI → EMS | After callback, async | §5.7 "boss confirmation" |
| 8 | **Call duration, cost, Vapi metadata** | AI → EMS | End of call (for billing) | §3.4 (BP) |

### 1.2 What data does Bookloh EMS **push to** HandyLine AI?

| # | Event / Data | Direction | Trigger | PRD Ref |
|---|---|---|---|---|
| 9 | **Boss config** (price list, FAQs, radius, hours, trades) | EMS → AI | On assistant boot + on update | §3 "combine with boss backend config" |
| 10 | **Existing calendar slots** (for "intended time" suggestion) | EMS → AI | Per call, before suggesting time | §6 "boss's existing EMS calendar schedule" |
| 11 | **Customer profile** (history, prefs, blacklist, VIP flag) | EMS → AI | Inbound call (by phone) | §1.2 "profile" |
| 12 | **Whitelist numbers** (skip AI, direct to boss) | EMS → AI | Per call, before answering | §5.1 "whitelist direct connect" |
| 13 | **Routing config** (after_hours / always / busy) | EMS → AI | On assistant boot | §3.2 "three modes" |
| 14 | **Outbound call result** (boss picked up / voicemail / no answer) | EMS → AI | After Twilio call ends | §5.9 "IVR decision menu" |
| 15 | **Recording consent rules** (one-party / two-party by state) | EMS → AI | Per call, by area code | §5.2 "adjust per state law" |
| 16 | **Push delivery status** (SMS/App read) | EMS → AI | Async, for analytics | §5.9 "push channel configuration" |

### 1.3 What is shared (both sides need read access)?

- **Customer identity** (phone-number-as-key): who called, history, contact
  prefs, opt-out / PDPA / CCPA flags
- **Boss config** (read-write on EMS side, read on AI side)
- **Work order state machine**: created → confirmed → in_progress → completed
  (or rejected, callback, urgent)
- **Billing events** (per-minute Vapi cost, Twilio cost) — for invoicing

### 1.4 What's NEVER shared (secrets stay local)

- Vapi API key, OpenAI key, ElevenLabs credential
- Twilio auth token
- Boss personal phone number (boss sees, AI uses internally only)
- Boss's own call recordings (boss's, not customer's)

---

## 2. Technical Research

### 2.1 Architecture options

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. EMS is master, AI pushes via webhook** | Single source of truth (EMS), AI is stateless client | AI needs EMS up to function; tight coupling | ✅ **Recommended for P0** |
| **B. Each has its own DB, sync via CDC** | Loose coupling, both can run independently | Complex conflict resolution, eventual consistency | Overkill for v1 |
| **C. Shared database** | Simplest writes | Couples schema, breaks "module" boundary | ❌ PRD says EMS already has its DB |
| **D. AI is master, EMS polls AI** | AI works offline | Reverses authority; PRD says EMS is owner | ❌ |

**Decision: A.** EMS owns the canonical data; HandyLine AI is a write-only
worker for orders, and a read-only consumer for boss config / customer
profile. Two flows:

```
[Outbound — AI writes]
  Call ends → AI normalizes → POST /v1/work_orders → EMS validates →
  EMS creates calendar event → EMS returns event_id → AI records event_id

[Inbound — AI reads]
  Incoming call → AI fetches /v1/bosses/{phone_owner} + /v1/customers/{caller}
  → AI uses data for tool calls → call ends → write flow above
```

### 2.2 Protocol choice

| Concern | Choice | Why |
|---|---|---|
| **Wire format** | JSON over HTTPS | Both Next.js; trivial client lib |
| **Auth** | OAuth 2.0 client_credentials (server-to-server) | No shared secret in code; rotatable; auditable |
| **Transport (sync)** | REST + OpenAPI 3.0 spec | Simpler than gRPC for 5–10 endpoints |
| **Transport (async)** | Webhooks (AI → EMS) + Webhooks (EMS → AI) | Real-time without polling |
| **Webhook auth** | HMAC SHA-256 signature in `X-Bookloh-Signature` header | Industry standard (Stripe model) |
| **Idempotency** | `Idempotency-Key` header on every POST (UUID) | Retries safe |
| **Rate limit** | 100 req/sec per service account | Plenty for current scale |
| **Versioning** | `/v1/` in URL; deprecate after 6 months | Standard |

### 2.3 Data consistency model

- **AI is "at-least-once" writer** (Vapi webhook can retry). EMS must
  be idempotent on `vapi_call_id` (already in our schema as
  `work_orders.vapi_call_id` — perfect for this).
- **EMS is "best-effort" for reads** (cached on AI side, refreshed every
  5 min). Stale data is acceptable for boss config; not for urgent
  routing.
- **Conflict resolution**: EMS wins. If AI sends a stale config update,
  EMS validates against current state.

### 2.4 Failure handling

| Failure | Detection | Recovery |
|---|---|---|
| EMS webhook down when AI tries to push | HTTP 5xx | Retry with exponential backoff (1s, 5s, 30s, 5min) × 5; then queue + alert |
| EMS webhook 4xx (validation) | Response body | Log + alert; do not retry (would never succeed) |
| AI can't fetch boss config | HTTP 5xx on read | Use cached config from last successful fetch; fall back to defaults |
| AI can't fetch customer profile | HTTP 404 (new caller) | Treat as new customer; AI continues |
| Network partition between AI and EMS | Both flows down | AI works in "degraded mode" — logs locally, retries push; user sees no impact during call |

### 2.5 Security

- **PII at rest**: EMS encrypts customer phone, name, address; AI
  re-uses EMS encryption (no second copy on AI side)
- **PII in transit**: TLS 1.3 only; mTLS optional for high-security
- **Recording URLs**: signed, time-limited URLs (Supabase Storage
  already supports this)
- **Webhook signatures**: HMAC SHA-256, rotating secret per service
  account; verify on receipt
- **PDPA / CCPA**: both sides must honor opt-out. If EMS marks
  customer `opted_out = true`, AI must skip recording and skip
  customer profile fetch.

---

## 3. Development Research

### 3.1 Proposed API contract (OpenAPI 3.0 sketch)

#### Endpoint 1 — `POST /v1/work_orders` (AI → EMS)

AI pushes a completed call as a work order. EMS creates the calendar
event and returns the event_id.

```http
POST /v1/work_orders
Authorization: Bearer <oauth_token>
Idempotency-Key: <uuid>
X-Bookloh-Signature: hmac_sha256(body, secret)

{
  "external_call_id": "vapi_abc123",         // idempotency key
  "boss_id": "uuid",                          // from EMS
  "source": "handyline_ai",
  "country": "MY",
  "occurred_at": "2026-08-24T09:30:00Z",
  "ended_at": "2026-08-24T09:32:18Z",
  "duration_seconds": 138,
  "caller": {
    "phone": "+60178663118",
    "name_extracted": "Ahmad Razali",
    "address": "123 Jalan Sultan Iskandar, 97000 Bintulu",
    "zipcode": "97000"
  },
  "issue": {
    "type": "alarm",
    "details": "House alarm keep beeping every 30 minutes",
    "preferred_time": "Tomorrow morning (9am-12pm)"
  },
  "ai_decision": "accepted",                 // accepted|urgent|unsure|rejected
  "ai_decision_reason": null,
  "summary": "House alarm false trigger, RM289-1539",
  "intent_summary": "...",
  "customer_tendency": "scheduling",
  "mentioned_topics": ["alarm", "beeping", "sensor"],
  "follow_up_priority": "medium",
  "follow_up_recommended": true,
  "pricing": {
    "trip_fee": 89.0,
    "currency": "MYR",
    "range_low": 200.0,
    "range_high": 1500.0,
    "total_low": 289.0,
    "total_high": 1539.0
  },
  "media": {
    "recording_url": "https://...signed...",
    "transcript_url": "https://...signed.../transcript.json"
  },
  "metadata": {
    "vapi_call_id": "vapi_abc123",
    "vapi_cost_usd": 0.42,
    "transcription_provider": "assemblyai",
    "voice_id": "elevenlabs_xxx"
  }
}

→ 201 Created
{
  "work_order_id": "ems_wo_789",
  "calendar_event_id": "ems_evt_456",
  "status": "pending_confirmation",
  "deep_link": "https://ems.bookloh.com/work_orders/ems_wo_789"
}
```

#### Endpoint 2 — `GET /v1/bosses/{boss_id}/config` (AI ← EMS, cached 5min)

```http
GET /v1/bosses/{boss_id}/config
Authorization: Bearer <oauth_token>

→ 200 OK
{
  "boss_id": "uuid",
  "company_name": "H-Master Security Services",
  "phone": "+6086331118",
  "country": "MY",
  "currency": "MYR",
  "service_trades": ["security","alarm","cctv","autogate","access_control","door_lock","general"],
  "service_radius_km": 50,
  "service_postal_prefixes": ["97"],
  "price_list": { "alarm": {"low": 200, "high": 1500}, ... },
  "business_hours": { "mon": {"start": "08:00", "end": "17:30"}, ... },
  "faq": { "wifi_alarm": "Yes, our alarm supports WiFi/LAN...", ... },
  "routing_mode": "after_hours",
  "whitelist_numbers": ["+60123456789"]
}
```

#### Endpoint 3 — `GET /v1/customers/lookup?phone={phone}` (AI ← EMS, real-time)

```http
GET /v1/customers/lookup?phone=%2B60178663118
Authorization: Bearer <oauth_token>

→ 200 OK
{
  "customer_id": "ems_cust_123",
  "phone": "+60178663118",
  "name": "Ahmad Razali",
  "is_existing": true,
  "service_history": [
    { "date": "2025-12-15", "service": "alarm install", "amount": 1200 }
  ],
  "is_vip": false,
  "opted_out": false,
  "preferred_language": "en"
}

→ 404 Not Found  (new caller — AI treats as new customer)
```

#### Endpoint 4 — `GET /v1/bosses/{boss_id}/calendar/slots?from=...&to=...` (AI ← EMS)

```http
GET /v1/bosses/{boss_id}/calendar/slots?from=2026-08-25T00:00:00Z&to=2026-08-26T23:59:59Z

→ 200 OK
{
  "busy_slots": [
    { "start": "2026-08-25T09:00:00Z", "end": "2026-08-25T11:00:00Z", "label": "Service call at Taman Sukma" },
    { "start": "2026-08-25T14:00:00Z", "end": "2026-08-25T15:00:00Z", "label": "Customer call: Tan" }
  ],
  "free_windows": [
    { "start": "2026-08-25T11:00:00Z", "end": "2026-08-25T14:00:00Z", "label": "free" },
    { "start": "2026-08-25T15:00:00Z", "end": "2026-08-25T18:00:00Z", "label": "free" }
  ]
}
```

AI uses `free_windows` to suggest "tomorrow morning" / "tomorrow afternoon"
without revealing specific customer names (PDPA).

#### Endpoint 5 — `POST /v1/webhooks/subscribe` (EMS ↔ AI, EMS subscribes to AI events)

EMS subscribes to AI events: `call.ended`, `call.urgent`, `call.failed`.

```http
POST /v1/webhooks/subscribe
Authorization: Bearer <oauth_token>

{
  "subscriber": "bookloh_ems",
  "events": ["call.ended", "call.urgent", "call.failed"],
  "callback_url": "https://ems.bookloh.com/api/webhooks/handyline",
  "secret": "shared_hmac_secret"
}

→ 201 Created
{
  "subscription_id": "sub_xyz",
  "events": ["call.ended", "call.urgent", "call.failed"]
}
```

> Note: This is the **reverse** webhook — EMS subscribes to AI events.
> Most P0 work orders use the synchronous `POST /v1/work_orders` flow
> (driven by the AI knowing when the call ends). The webhook exists for
> reduntant delivery and for the urgent outbound call result.

#### Endpoint 6 — `POST /v1/work_orders/{id}/status` (AI → EMS, async update)

After the boss calls the customer back, AI (or the boss EMS UI) updates
the work order status.

```http
POST /v1/work_orders/ems_wo_789/status
{
  "status": "confirmed",      // pending|confirmed|in_progress|completed|cancelled
  "scheduled_for": "2026-08-25T11:00:00Z",
  "note": "Customer confirmed 11am visit"
}

→ 200 OK { "updated_at": "..." }
```

### 3.2 Where the integration lives in code

```
demo/
├── src/
│   ├── lib/
│   │   ├── bookloh-ems.ts           # NEW — client for EMS API
│   │   │   ├── pushWorkOrder()
│   │   │   ├── fetchBossConfig()
│   │   │   ├── lookupCustomer()
│   │   │   ├── fetchCalendarSlots()
│   │   │   └── updateWorkOrderStatus()
│   │   ├── boss-config-cache.ts     # NEW — 5min TTL cache for boss config
│   │   ├── webhook-signer.ts        # NEW — HMAC signer for outgoing webhooks
│   │   └── order.ts                  # MODIFIED — push to EMS after local insert
│   └── app/
│       └── api/
│           ├── ems/
│           │   └── webhook/
│           │       └── route.ts      # NEW — receives EMS callbacks
│           └── vapi/
│               └── webhook/
│                   └── route.ts      # MODIFIED — also emits call.ended event
└── .env.local
    ├── BOOKLOH_EMS_BASE_URL
    ├── BOOKLOH_EMS_CLIENT_ID
    ├── BOOKLOH_EMS_CLIENT_SECRET
    └── BOOKLOH_EMS_WEBHOOK_SECRET
```

### 3.3 Build order (incremental, ship-able at each step)

#### **M1 — Schema + auth (1-2 days)**
1. Define OpenAPI 3.0 spec for the 6 endpoints above
2. Set up OAuth 2.0 client_credentials flow between AI and EMS
3. Create `bookloh-ems.ts` client skeleton (no real calls yet)
4. Add `BOOKLOH_EMS_*` env vars to `.env.local` and Vercel
5. **Deliverable:** AI can authenticate to EMS; no business logic yet

#### **M2 — Push work order (3-4 days)** ← highest value, gets data flowing
1. Implement `pushWorkOrder()` with retry + idempotency
2. Hook into `createOrUpdateWorkOrder()` in `order.ts` to call push
   **after** local Supabase insert
3. Add retry queue (Supabase table `ems_push_queue`) for failed pushes
4. Build `/api/cron/ems-retry` to drain the queue
5. **Deliverable:** Every AI-handled call creates an EMS calendar event

#### **M3 — Pull boss config (2-3 days)**
1. Implement `fetchBossConfig()` with 5-min cache
2. Add boss config bootstrap on Vapi assistant boot
3. AI uses cached config for price list, FAQ, business hours
4. **Deliverable:** Single boss config in EMS, no duplication

#### **M4 — Customer lookup (2 days)**
1. Implement `lookupCustomer()`
2. On inbound call, AI looks up caller; surfaces "welcome back" if known
3. **Deliverable:** Existing customers get personalized greeting + history

#### **M5 — Calendar slots (2-3 days)**
1. Implement `fetchCalendarSlots()` with PDPA-safe filtering
2. AI uses `free_windows` to suggest "tomorrow morning / afternoon"
3. **Deliverable:** AI suggests time slots that respect boss's actual schedule

#### **M6 — Webhook subscribe (1-2 days)**
1. AI registers `call.ended` / `call.urgent` webhooks
2. EMS receives them as redundant delivery (push is the primary)
3. **Deliverable:** Belt-and-suspenders delivery for high-value orders

#### **M7 — Status update (1-2 days)**
1. Implement `updateWorkOrderStatus()`
2. Boss EMS UI can also send status; AI listens for updates
3. **Deliverable:** Two-way state machine sync

### 3.4 Effort estimate

| Phase | Scope | Calendar time | Engineer-weeks |
|---|---|---|---|
| M1 | Schema + auth | 1-2 days | 0.3 |
| M2 | Push work order | 3-4 days | 0.7 |
| M3 | Pull boss config | 2-3 days | 0.5 |
| M4 | Customer lookup | 2 days | 0.3 |
| M5 | Calendar slots | 2-3 days | 0.5 |
| M6 | Webhook subscribe | 1-2 days | 0.3 |
| M7 | Status update | 1-2 days | 0.3 |
| **Total** | | **12-18 days** | **~3 engineer-weeks** |

### 3.5 Open questions (need EMS team to confirm)

1. **Does Bookloh EMS already have an API?** Or do we propose one?
2. **What is the customer identity model?** phone-only, or phone+name+address?
3. **Calendar source of truth** — is the EMS calendar the only one, or does
   the boss also use Google Calendar? (PRD says external sync is P0 not
   done.)
4. **PDPA / CCPA scope** — does EMS already handle opt-out, or is that
   new?
5. **Push notification** — does EMS own the App push channel? AI currently
   has no App integration.
6. **Outbound call result** — the Twilio emergency IVR flow currently
   lives in AI (`emergency-call.ts`). Should EMS own this instead?
7. **Recording storage** — current plan: Supabase Storage. If EMS has its
   own S3, we should use that.
8. **Auth model** — single shared client_credentials, or per-boss
   credentials?

---

## 4. Recommendation

1. **Don't wait for the EMS team.** Propose the OpenAPI 3.0 spec in this
   doc and circulate for review. This is the fastest path to unblock.
2. **Ship M2 first** (push work orders). It's the highest value and
   smallest scope. Without it, every AI call is invisible to EMS.
3. **M3 and M5 second** (read boss config + calendar slots). These make
   the AI smart — it knows the boss's actual schedule and prices.
4. **Defer M6 and M7** (webhooks + status sync) until M2-M5 are stable.
5. **Re-use Supabase as the AI-side cache** for boss config (5min TTL).
   Avoid building a separate Redis for v1.

---

## 5. References

- PRD: `/Users/yimozhang/Business/Handy Bookloh/Bookloh AI Receptionist Product Requirements Document (PRD).docx`
- BP: `/Users/yimozhang/Business/Handy Bookloh/HandyLine AI Business Plan_v0.3.docx`
- BP change log: `/Users/yimozhang/Business/Handy Bookloh/BP_Change Log_v0.1→v0.2.md`
- SETUP.md TODO: `/Users/yimozhang/Business/Handy Bookloh/handyline-ai-receptionist/SETUP.md` line 354
- Current code: `/Users/yimozhang/Business/Handy Bookloh/handyline-ai-receptionist/`
