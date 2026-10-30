# HandyLine AI MVP Plan — For Early Partner Customers

**Author:** Mavis (mavis) · **Date:** 2026-08-26 · **Status:** Draft v0.1
**Target customers:** H-Master Security Services (first) + the next 3-5 early customers
**Time window:** 8-10 weeks to GA (General Availability)

---

## 0. Current State Audit

| Item | Current state | MVP gap |
|---|---|---|
| Database | Supabase Postgres + 11 migrations | ✅ Sufficient |
| Service layer | Vapi + Twilio + Next.js + Vercel | ✅ Sufficient |
| Multi-region | US + MY routing | ✅ Already supported |
| LLM summary | gpt-4o-mini + caching + cost monitoring | ✅ Sufficient |
| Customer data | 86 records (75 US + 11 MY demo) | ⚠️ demo data, not real customers |
| Auth | **None at all** | ❌ Anyone can see all data |
| Multi-tenancy | DB structure supports it but the code does not isolate | ❌ Shared dashboard |
| Self-service signup | None | ❌ Sales configures it manually |
| Payment / billing | None | ❌ No idea who to bill |
| Compliance | No Privacy Policy / ToS | ❌ Cannot sign customer contracts |
| Monitoring / alerting | Vercel + Supabase defaults | ⚠️ No proactive alerting |
| Backups | Supabase automatic | ⚠️ RPO/RTO unverified |
| Domain | `demo-navy-chi-47.vercel.app` | ❌ Customers cannot be shown a vercel subdomain |

---

## 1. MVP Definition

**For:** 1-5 early partner customers (already closed sales-led)
**Do:**
- A separate workspace per customer (data isolation)
- The boss logs in and sees their own calls + recordings + summaries
- We (the platform side) use an admin back office to see the global view
- Real phone numbers + real voice + real work orders
- Basic reliability (99%+ uptime, guaranteed retries)
- Basic compliance (PDPA / CCPA / call-recording disclosure)

**Don't (P0 non-goals):**
- Self-service signup
- Self-service configuration (the admin configures it for the customer)
- Payment system (sign contracts offline + bank transfer)
- Multiple languages (English first)
- Multiple boss accounts (1 boss per customer)
- Customer follow-up outbound calls
- Mobile App
- Self-hosting

---

## 2. Architecture Changes (demo → MVP)

### 2.1 Auth Layer (brand new)

**Approach: Supabase Auth + email/password login**

```
src/app/
├── (auth)/
│   ├── login/page.tsx           # boss login
│   ├── reset/page.tsx           # password reset
│   └── layout.tsx
├── (admin)/
│   ├── admin/
│   │   ├── page.tsx              # platform dashboard
│   │   ├── customers/page.tsx    # customer list
│   │   ├── llm-stats/page.tsx    # LLM cost
│   │   └── vapi-spend/page.tsx   # Vapi spend
│   └── layout.tsx
├── (boss)/
│   ├── dashboard/                # boss views their own work orders
│   │   ├── page.tsx
│   │   ├── orders/[id]/page.tsx
│   │   └── recordings/page.tsx
│   └── layout.tsx
└── api/
    ├── auth/...
    └── ...
```

**Supabase RLS policies:**
- `bosses`: each one can only see their own (`auth.uid() = owner_user_id`)
- `work_orders`: orders with their own boss_id
- `customers`: those with their own boss_id
- `call_events`: those with their own boss_id

### 2.2 Data Model Additions

Tables to add:

```sql
-- Users (boss accounts)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,            -- managed by Supabase Auth
  full_name TEXT,
  boss_id UUID REFERENCES bosses(id),  -- linked to the boss
  role TEXT DEFAULT 'boss',      -- 'boss' | 'admin' | 'staff'
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Customer subscription (basic plan)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boss_id UUID REFERENCES bosses(id) UNIQUE,
  plan TEXT DEFAULT 'trial',     -- 'trial' | 'starter' | 'pro' | 'enterprise'
  monthly_call_limit INT,
  monthly_call_used INT DEFAULT 0,
  status TEXT DEFAULT 'active',  -- 'active' | 'paused' | 'cancelled'
  started_at TIMESTAMPTZ DEFAULT now(),
  renews_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Work order status change log
CREATE TABLE work_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders(id),
  event TEXT,                    -- 'created' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  actor TEXT,                    -- 'ai' | 'boss' | 'customer' | 'system'
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 2.3 Business Flow Changes

**Onboarding (new customer):**
1. Sales closes the deal and signs the contract
2. Admin creates the customer at `/admin/customers`
   - Enter company name, address, business hours, price list, emergency rules
   - Choose a plan (trial / starter / pro)
3. The system automatically:
   - Creates a `users` row + a temporary password
   - Creates a `subscriptions` row
   - Creates a `bosses` row (existing logic)
   - Buys a +60/+1 number through the Vapi API
   - Creates the assistant + writes the system prompt through the Vapi API
   - Binds number → assistant
   - Sends a welcome email to the boss
4. Admin verifies: call in with a test phone and confirm the AI answers properly

**Inbound call routing:**
1. The customer dials the Vapi number
2. Vapi finds the matching assistant (one per customer)
3. The AI answers using the customer's system prompt + tools
4. Tool calls go through the same endpoint, but `getBossByCountry` becomes `getBossByVapiAssistantId` (more precise)
5. Call ends → webhook → writes work_order → pushes to the boss

**Boss workflow:**
1. The boss receives a push (SMS / WhatsApp / Email)
2. The boss logs into `/dashboard` to see the summary
3. The boss taps "Confirm" / "Reschedule" / "Reject" / "Callback"
4. Status changes are written to `work_order_events` + pushed back to EMS (if already integrated)

---

## 3. UI/UX Changes

### 3.1 Split the current `/` into 3 entry points

| Path | Who | What they see |
|---|---|---|
| `/login` | Boss | Login form |
| `/dashboard` | Boss | Their own work order list + recordings |
| `/admin` | Platform side | Global dashboard + customer management + cost monitoring |
| `/` | Public | Redirects to `/login` (not logged in) or `/dashboard` (logged in) |

### 3.2 Minimal boss dashboard

```
┌────────────────────────────────────┐
│ [Logo] H-Master Service Desk   [⚙] │
├────────────────────────────────────┤
│ Stats                              │
│ [Today: 5 calls] [Urgent: 1]       │
│ [Pending: 3] [Completed: 12]      │
├────────────────────────────────────┤
│ Work Orders         [Filter ▾]     │
│ ┌──────────────────────────────┐  │
│ │ 🟠 URGENT  Alarm triggered   │  │
│ │ Ahmad Razali · 97008 Bintulu  │  │
│ │ 5 min ago · [Listen] [Call]   │  │
│ └──────────────────────────────┘  │
│ ┌──────────────────────────────┐  │
│ │ ✅ ACCEPTED  CCTV install    │  │
│ │ ...                           │  │
│ └──────────────────────────────┘  │
└────────────────────────────────────┘
```

### 3.3 Recording playback + AI summary

On each work order detail page:
- Customer info (phone, name, address)
- Call recording (HTML5 audio + waveform)
- AI summary (name/intent/tendency/follow-up extracted by gpt-4o-mini)
- Price (trip fee + scope + urgency)
- Boss actions: Confirm / Reschedule / Reject / Callback

---

## 4. Phased Implementation (10 weeks)

### Phase 1: Infrastructure (1 week)

| # | Item | Time |
|---|---|---|
| 1.1 | Buy the domain `handyline.bookloh.com` (if available) | Half a day |
| 1.2 | Vercel custom domain + SSL | 1 hour |
| 1.3 | Sentry integration (error monitoring) | 2 hours |
| 1.4 | Better Uptime / Instatus (uptime monitoring) | 1 hour |
| 1.5 | Privacy Policy + Terms of Service pages | 1 day |
| 1.6 | Supabase backup verification + documentation | Half a day |

**Milestone:** Domain live + monitoring observable

### Phase 2: Auth + Customer Isolation (1.5 weeks)

| # | Item | Time |
|---|---|---|
| 2.1 | Supabase Auth + email/password login | 1 day |
| 2.2 | `users` table + migration 012 | Half a day |
| 2.3 | RLS policies on all tables | 1 day |
| 2.4 | Login / logout / password reset UI | 1 day |
| 2.5 | Boss `/dashboard` route (shows only their own) | 1 day |
| 2.6 | Admin `/admin` route (sees everything) | 1 day |
| 2.7 | Session persistence + error handling | Half a day |

**Milestone:** The boss can log in and see their own work orders

### Phase 3: Vapi Automation (1.5 weeks)

| # | Item | Time |
|---|---|---|
| 3.1 | `scripts/provision-customer.js`: API number purchase + assistant creation + number binding | 1 day |
| 3.2 | Modify the webhook route: `getBossByVapiAssistantId` replaces `getBossByCountry` | Half a day |
| 3.3 | Verify tool endpoint isolation by assistant | Half a day |
| 3.4 | Automatic recording upload + permanent storage (exists, verify) | Half a day |
| 3.5 | Failure retry + dead-letter queue | 1 day |
| 3.6 | Customer onboarding back office form | 1 day |

**Milestone:** The admin fills in the back office form, and 10 minutes later the customer's number is usable

### Phase 4: Production Polish (1.5 weeks)

| # | Item | Time |
|---|---|---|
| 4.1 | LLM summary prompt optimization (multiple scenarios) | 1 day |
| 4.2 | Work order state machine (accepted/confirmed/in_progress/completed/cancelled) | 1 day |
| 4.3 | Boss action UI (Confirm / Reschedule / Reject / Callback) | 1 day |
| 4.4 | SMS / Email push integration (Twilio + Resend) | 1 day |
| 4.5 | Recording player + waveform | Half a day |
| 4.6 | Error pages + loading states + empty states | Half a day |
| 4.7 | Customer support email + WhatsApp Business integration | Half a day |

**Milestone:** End to end usable

### Phase 5: H-Master Go-Live (1 week)

| # | Item | Time |
|---|---|---|
| 5.1 | Collect all of H-Master's real information (checklist already exists) | Waiting on you |
| 5.2 | Record the H-Master boss's voice | You |
| 5.3 | Create the H-Master account through the back office | Me |
| 5.4 | Get 10 test scripts working end to end | Together |
| 5.5 | Tune the prompt + pricing | Me |
| 5.6 | Provision the real phone number | Half a day |
| 5.7 | Boss training (30-minute remote video call) | Half a day |
| 5.8 | Observe for 1 week after go-live | Ongoing |

**Milestone:** The H-Master boss is using the AI receptionist

### Phase 6: Customers 2-3 (ongoing)

Repeat the H-Master process. Each additional customer takes ~1 day.

---

## 5. Resources & Cost Estimate

### 5.1 Manpower

| Role | Effort |
|---|---|
| Full-stack development (you + me) | 10 weeks focused |
| Sales (you) | Ongoing |
| Customer success (you) | Ongoing |

### 5.2 Monthly Operating Cost (estimated for 5 customers)

| Item | Unit price | Monthly usage | Monthly cost |
|---|---|---|---|
| Vapi numbers (5) | $1.50/month | 5 | $7.50 |
| Vapi calls | $0.05/minute | 500 minutes | $25 |
| OpenAI (LLM summary) | $0.001/call | 500 calls | $0.50 |
| ElevenLabs (voice clone) | $5/month/voice | 5 | $25 |
| Twilio SMS | $0.05/message | 200 | $10 |
| Supabase | $25/month (Pro) | 1 | $25 |
| Vercel | $20/month (Pro) | 1 | $20 |
| Sentry | $0 (free tier) | - | $0 |
| Domain | $15/year | 1 | $1.25 |
| **Subtotal** | | | **~$114/month** |

At 5 customers / 500 calls per month = **$0.23 per call**. The price per customer must be at least $30/month to break even.

### 5.3 One-time Costs

| Item | Cost |
|---|---|
| Domain (first year) | $15 |
| Design / logo | In-house (zero) |
| Legal / Privacy Policy | In-house template (zero) or lawyer $500-1000 |
| Vapi initial credit | $5 |

---

## 6. Pricing Model (proposal)

| Plan | Monthly fee | Call allowance | Overage | Target customer |
|---|---|---|---|---|
| Trial | Free for 14 days | 50 calls | Cut off | Evaluation period |
| Starter | $99/month | 200 calls | $0.50/call | Teams of 1-3 people |
| Pro | $299/month | 1000 calls | $0.30/call | Teams of 5-10 people |
| Enterprise | Negotiated | Negotiated | - | Large |

Reference:
- US market receptionist salary $2700/month
- Our $99-299 = 4-11% of the salary
- Even if only 1/10 of customers pick Pro, it covers the costs

---

## 7. Risks & Decision Points

### 7.1 Key Decisions (need your call)

| Decision | Options | My recommendation |
|---|---|---|
| Domain | handyline.bookloh.com / handyline.ai / Other | handyline.ai (if available) |
| Auth approach | Supabase Auth (recommended) / Clerk / NextAuth | Supabase Auth (fewest new dependencies) |
| Payment approach | Stripe / iPay88 / Manual bank transfer | Offline first, Stripe after 3 customers |
| Data storage region | Supabase Singapore / US | Singapore (SEA customers) |
| Self-service vs sales | Sales-led / Self-service / Hybrid | Sales-led (up to 5 customers) |

### 7.2 Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Poor call quality for customers (STT misrecognition) | Medium | High | More testing + the boss listens in during week 1 |
| Vapi number application rejected (MY regulation) | Medium | High | Apply to multiple carriers in parallel as backup |
| Customer PDPA complaint | Low | Medium | Recording disclosure + auto-delete after 30 days + fast response |
| Call costs out of control | Low | Medium | LLM caching + call duration limit + monthly cap |
| H-Master churn (single account) | Medium | High | Monthly review + continuous prompt optimization |

---

## 8. Week 1 Concrete Actions (to be done this week)

| Day | Action |
|---|---|
| Day 1 (today) | Confirm the domain + decide the auth approach + sign up for a Sentry account |
| Day 2 | Migration 012: `users` + `subscriptions` + `work_order_events` tables |
| Day 3 | Auth foundation: Supabase Auth + login page + first version of the RLS policies |
| Day 4 | Boss dashboard route (v1, simplified) |
| Day 5 | Deploy to the `handyline.bookloh.com` domain + Sentry integration + get the internal test working |

**Weekend:** An internal user (you) walks through the H-Master onboarding flow to simulate real usage.

---

## 9. What It Looks Like After 10 Weeks

| Dimension | Now | After the MVP |
|---|---|---|
| Number of customers | 1 (H-Master, waiting to be provisioned) | 3-5 |
| Auth | None | Supabase Auth + RLS |
| Domain | vercel.app subdomain | Custom domain + SSL |
| Boss login | Impossible | See their own work orders + recordings + take action |
| Admin back office | Simple dashboard | Customer management + cost monitoring + call statistics |
| Payments | None | Offline contract + bank transfer |
| Monitoring | Vercel default | Sentry + Uptime + custom alerts |
| Compliance | None | Privacy Policy + ToS + PDPA |
| Reliability | Default | 99% uptime + retries + backup verification |
| Docs | SETUP.md | DEPLOYMENT.md + ONBOARDING.md + API.md |

---

## 10. Open Questions (Need Your Decision)

1. **Which domain to use?** handyline.ai / handyline.bookloh.com / Other?
2. **Auth approach confirmed:** Is Supabase Auth OK, or do you want Clerk / self-built?
3. **Data storage region:** Supabase Singapore or US? H-Master is in Sarawak, so the SG region is more compliant.
4. **Billing method:** Really start offline, or do you want Stripe?
5. **Trial policy:** How long a trial for H-Master? Is a deposit charged?
6. **Pricing model:** Are the 4 plans above acceptable? Starting at $99 for starter?

**Without these decisions, the 10-week plan cannot start.** Once you decide, I will start Phase 1.

