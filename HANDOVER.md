# HandyLine AI Receptionist — Complete Engineering Handover Package

> A quick-read guide for the incoming development team. Read README.md + SETUP.md + docs/MVP-PLAN.md first,
> then work through the "onboarding order" in this document.

**Handover date**: 2026-09-24
**Packaged by**: Mimatt (Product + Operations) / Engineering session Mavis
**Version**: as of commit `2a8253e`

---

## 1. What this project is

HandyLine AI is an **AI phone receptionist** for home services contractors in North America / Southeast Asia:

- **Core flow**: customer calls the contractor's phone → Vapi (voice) → GPT-4o-mini handles the call → AI decides to accept / decline / hand off to a human / escalate as an emergency
- **Data**: orders / work orders are written to Supabase and visualized in the Dashboard
- **Multi-region**: 1 Vapi assistant = 1 Boss (contractor) = 1 Supabase boss row
- **Production customers**: US Alex / Handy Works (live), MY H-Master Security (placeholder assistant)

---

## 2. What to do in the first week after taking over (by priority)

### Day 1: Get it running locally

```bash
# 1) Unzip into any directory and cd into the project root
cd handyline-ai-receptionist

# 2) Install dependencies
npm install    # node_modules is excluded from the zip

# 3) .env.local is already in the zip — use it as is. To swap the secrets, copy .env.example and edit it

# 4) Pull the database migrations into the Supabase project (using the supabase CLI)
supabase link --project-ref <your-project-ref>     # cggqxaxunqxsgurgmiqh
supabase db push                                  # apply all of migrations/

# 5) Start it
npm run dev
# Go to http://localhost:3000
```

### Day 2: Understand the architecture

Must read (in order):
1. **README.md** — project overview
2. **SETUP.md** — full-stack configuration for Vercel + Supabase + Vapi + Twilio
3. **docs/MVP-PLAN.md** — overall product plan
4. **docs/MULTI-REGION-ARCHITECTURE.md** — multi-region data model (core)
5. **src/lib/types.ts** — data models such as Boss / WorkOrder
6. **src/lib/order.ts** — `getBossByVapiAssistantId()` / `getBossByCountry()` are the core of routing
7. **src/app/api/vapi/tools/route.ts** — the actual backend for AI tool calls
8. **src/app/api/vapi/webhook/route.ts** — the Vapi end-of-call webhook

> **Currently blocked on two external accounts (2026-10-31).**
> `docs/TWILIO-UPGRADE-RUNBOOK.md` — the Twilio trial has expired, so every
> notification to the merchant fails and the human-answering line cannot be
> bought until the account is upgraded. Read this before touching `notify.ts`
> or `emergency-call.ts`.
> `scripts/push-cron-env.sh` — pushes `CRON_SECRET` and
> `SUPABASE_ACCESS_TOKEN` into Vercel. The Vercel device code it prints is
> only valid for 10 minutes, so the login has to happen in the same
> terminal that runs it.

### Day 3: Run the test scripts to verify the environment

```bash
# Static config validation — no external network needed, 34 checks
node scripts/test-static-config.js

# Live Vapi config validation (reads .env.local and calls the Vapi API)
node scripts/test-static-config.js --live

# Import historical calls into work_orders (dry-run by default, check the output before using --write)
node scripts/import-vapi-calls.js                  # multi-region only
node scripts/import-vapi-calls.js --regions us --write
node scripts/import-vapi-calls.js --regions my --write
```

---

## 3. Key technical decisions (don't change them casually)

| # | Decision | Why | Where |
|---|------|--------|--------|
| 1 | 1 Boss = 1 Vapi Assistant = 1 Phone Number | Simplifies multi-tenancy; avoids assistant cross-contamination | `src/lib/order.ts` `getBossByVapiAssistantId()` |
| 2 | Routing by Vapi assistantId (not phone number) | Country codes can repeat; assistantId is unique | `src/app/api/vapi/tools/route.ts` |
| 3 | gpt-4o-mini + eleven_turbo_v2_5 | Cost vs quality balance | `vapi/assistant.json` |
| 4 | TTS digits must be spelled out ("seven one three ...") | ElevenLabs reads digits unreliably | `vapi/system-prompt.md` |
| 5 | Must ask "Anything else?" before ending the call | User experience | system prompt |
| 6 | Recording + transcript + price preview must be stored in Supabase Storage first | Vapi presigned URL expires after 30min | `scripts/import-vapi-calls.js` |
| 7 | SEA scope: start with MY only | Focus resources | `docs/SEA-MARKET-TECH-STACK.md` |

---

## 4. Quick directory map of the package

```
handyline-ai-receptionist/
├── .env.local                    ⚠ contains all secrets, use it as is
├── .env.example                  placeholder schema
├── README.md / SETUP.md          onboarding + deployment
├── HANDOVER.md                   ← you are reading this
├── package.json / package-lock.json
├── next.config.js / tailwind.config.ts / tsconfig.json
├── src/                          ← Next.js App Router
│   ├── app/                      routing + page.tsx + api/
│   │   ├── api/
│   │   │   ├── vapi/             Vapi webhook + tools (core)
│   │   │   ├── twilio/           Twilio emergency routing
│   │   │   ├── cron/             scheduled jobs (emergency retry)
│   │   │   ├── boss/             Boss callback
│   │   │   ├── dev/              dev seed / simulated calls (can be turned off in production)
│   │   │   ├── admin/            admin APIs (reclassify / llm-stats)
│   │   │   ├── v1/               v1 APIs (assistants / singlish-eval)
│   │   │   └── human-handoff-demo/  AI→human handoff demo
│   │   ├── orders/[id]/          work order detail
│   │   ├── preview/              customer preview link
│   │   ├── human-handoff-demo/   AI→human demo UI
│   │   ├── landing/              marketing landing
│   │   └── config/               Boss config panel
│   ├── components/ui/            shadcn/ui base components
│   └── lib/                      ← business core
│       ├── order.ts              Boss routing + order processing
│       ├── validation.ts         service area validation (by country)
│       ├── call-summary.ts       transcript summary (regex fallback)
│       ├── openai-summarize.ts   LLM summary (preferred)
│       ├── vapi-event-handler.ts Vapi event dispatch
│       ├── emergency-call.ts     emergency call retry
│       ├── types.ts              database types
│       └── ...
├── scripts/                      ← ops scripts (can be run by cron directly in production)
│   ├── import-vapi-calls.js      real call sync → work_orders (multi-domain + dry-run)
│   ├── import-vapi-webcalls.js   includes webCall dashboard testing
│   ├── create-vapi-assistant*.js  create a Vapi assistant
│   ├── update-vapi-assistant*.js update a Vapi assistant + system prompt
│   ├── test-static-config.js     34 static checks (must run)
│   ├── test-conversations.js     LLM behavior tests for 24 conversation scenarios
│   ├── analyze-calls.js          read-only analysis of historical calls
│   ├── seed-demo-data.js / seed-my-demo-data.js
│   ├── clear-test-data.js        clear the dev seed data
│   ├── vercel-env-push.sh        one-click push of env to Vercel
│   └── lib/call-summary.js       JS port of call-summary
├── supabase/
│   ├── schema.sql                full schema (reference)
│   ├── migrations/               11 ordered migrations (execute in number order)
│   └── config.toml               supabase CLI config
├── vapi/
│   ├── assistant.json            current US Alex config
│   ├── assistant-my.json         MY H-Master placeholder
│   ├── assistant-sg.json         SG (empty)
│   ├── system-prompt.md          US Alex system prompt (5767 characters)
│   ├── system-prompt-my.md       MY prompt
│   └── system-prompt-sg.md       SG prompt
├── docs/                         ← 11 design documents (read them by file name)
└── public/                       static assets
```

---

## 5. Secrets contained in .env.local (26 items)

All of them were brought over at packaging time, as the user requested. For the incoming team:

- As soon as Vercel receives the package, **immediately** switch to secrets you manage yourself
- Do not upload them to GitHub / Notion / public Slack channels
- After the handover is done, **destroy the local zip and rotate all keys**

```
VAPI_API_KEY                          # main Vapi account
VAPI_ASSISTANT_ID                     # US Alex
VAPI_EMERGENCY_ASSISTANT_ID           # US emergency escalation
VAPI_MY_ASSISTANT_ID                  # MY H-Master
VAPI_SG_ASSISTANT_ID                  # SG (empty, not enabled yet)
VAPI_ID_ASSISTANT_ID                  # ID (empty, not enabled yet)
VAPI_PHONE_NUMBER_ID                  # Vapi phone number record

NEXT_PUBLIC_VAPI_PUBLIC_KEY           # client-side public key
ELEVENLABS_CREDENTIAL_ID              # TTS credential
ELEVENLABS_VOICE_ID                   # TTS voice ID

SUPABASE_ACCESS_TOKEN                 # used by the supabase CLI
SUPABASE_DB_PASSWORD                  # direct DB password
SUPABASE_SERVICE_ROLE_KEY             # full power on the server side
NEXT_PUBLIC_SUPABASE_URL              # public URL
NEXT_PUBLIC_SUPABASE_ANON_KEY         # public anon key

TWILIO_ACCOUNT_SID                    # Twilio account
TWILIO_AUTH_TOKEN                     # Twilio auth
TWILIO_PHONE_NUMBER                   # Twilio number
TWILIO_BOSS_PHONE                     # Alex's real cell phone (emergency transfer target)

OPENAI_API_KEY                        # GPT-4o-mini summaries

GOOGLE_MAPS_API_KEY                   # distance / service area validation

VERCEL_OIDC_TOKEN                      # Vercel deployment
WEBHOOK_SECRET                        # Vapi webhook signature verification

EMERGENCY_MAX_ATTEMPTS                # emergency retry limit
EMERGENCY_RETRY_INTERVAL_MINUTES      # retry interval
NEXT_PUBLIC_APP_URL                   # public URL (demo-navy-chi-47.vercel.app)
```

---

## 6. Known pitfalls / TODO

1. **Vercel project rename was not done** — the dashboard still shows `demo` (prj_uVTUUJuMqenAxleB1K7aw1tS2PK2), while the repo has already been renamed to `handyline-ai-receptionist`. It can be changed later.
2. **Vapi 14-day retention** — old calls from August have expired and can no longer be pulled. If you need historical data, upgrade the Vapi plan.
3. **MY H-Master is a placeholder** — the assistant exists but the system prompt is a placeholder, waiting to be replaced with real data.
4. **OpenAI API direct connections time out from China** — the Vercel deployment environment is not affected.
6. **This package excludes `node_modules` / `.next` / `.git`** — just run `npm install` + `next build` again to regenerate them.

---

## 7. If the team needs to roll back

```bash
# find historical commits
git log --oneline | head -20

# roll back to a specific version
git checkout 2a8253e -- .
```

Latest commit on the current main branch: `2a8253e feat: standalone Human Handoff + Recording demo`

---

## 8. Emergency contact

- **Original project owner**: Mimatt (product and operations)
- **Communication channel**: see the top of the original README.md

Good luck with the handover.
