# Vercel deployment guide

**Current state (2026-10-30): the site is already live.** The Vercel project
`demo` is connected to the GitHub repo `yyymmmzzz/handyline-ai-receptionist`
with automatic deployments enabled.

```
Production URL: https://demo-navy-chi-47.vercel.app
Project:        demo   (prj_uVTUUJuMqenAxleB1K7aw1tS2PK2)
```

> **Deploying is `git push origin main`.** There is no build step to run
> locally and no `vercel login` needed. If you renamed the repo, the Vercel
> project still points at the old name — rename it in the dashboard
> (Settings → General → Project Name) so future deploys keep working.

---

## Deploying a code change

```bash
cd "/Users/yimozhang/Business/Handy Bookloh/handyline-ai-receptionist"
npx tsc --noEmit                 # must be clean
node scripts/test-static-config.js   # 62 checks
git add -A && git commit -m "…"
git push origin main             # ← this is the deploy
```

Vercel builds and swaps the production alias automatically (1–3 minutes).
Confirm it landed:

```bash
curl -sS --http1.1 -o /dev/null -w "%{http_code}\n" https://demo-navy-chi-47.vercel.app/
```

> Use `curl`, not Node `fetch` — Node's TLS stack times out against this
> domain on some networks.

---

## Environment variables

Code deploys work without touching environment variables. Two of them are
still missing on Vercel and are worth adding:

| Variable | Why it matters | How to add |
|---|---|---|
| `CRON_SECRET` | Protects `/api/cron/keepalive` and `/api/cron/emergency-retry` | `npx vercel login` then `./scripts/push-cron-env.sh` |
| `SUPABASE_ACCESS_TOKEN` | Lets the keepalive job restore an idle Supabase project | same |

Until `CRON_SECRET` is set, `/api/cron/keepalive` reports
`restoreEnabled: false` — meaning that if the free-tier Supabase project is
paused for 7 days of inactivity, nothing will bring it back automatically.

Everything else is already set on Vercel.

---

## Full list of variables (for a fresh project)

Only needed if you ever stand up a brand-new Vercel project from scratch.
Copy the values from `.env.local` — Vercel does **not** read `.env` files, so
every one has to be added by hand under Settings → Environment Variables.

### Supabase
```
NEXT_PUBLIC_SUPABASE_URL        = https://cggqxaxunqxsgurgmiqh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY   = (copy from .env.local)
SUPABASE_SERVICE_ROLE_KEY       = (copy from .env.local — secret)
```

### Vapi
```
VAPI_API_KEY                    = (copy from .env.local — secret)
VAPI_ASSISTANT_ID               = 42523b3e-fbaf-436a-a26a-2a6853a12ad7
NEXT_PUBLIC_VAPI_ASSISTANT_ID   = 42523b3e-fbaf-436a-a26a-2a6853a12ad7
NEXT_PUBLIC_VAPI_PUBLIC_KEY     = (copy from .env.local)
VAPI_EMERGENCY_ASSISTANT_ID      = 7e2507a3-f349-4128-b117-5d3f35dae0cb
VAPI_PHONE_NUMBER_ID             = b73a9ba1-fca1-4eed-b58d-82652e57a2a4
```

### Twilio
```
TWILIO_ACCOUNT_SID   = (copy from .env.local — secret)
TWILIO_AUTH_TOKEN    = (copy from .env.local — secret)
TWILIO_PHONE_NUMBER  = the number SMS is sent from — must be owned by THIS Twilio account
TWILIO_BOSS_PHONE    = +17137422387   (Alex's phone — emergency escalation)
```

> `TWILIO_PHONE_NUMBER` **must** be a number our Twilio account owns. The Vapi
> AI line is not, so sending "from" it through Twilio can never work — that is
> why every SMS notification used to fail. After the human line is bought,
> `scripts/activate-human-line.js` points this at the new number.

### App config
```
WEBHOOK_SECRET                     = (copy from .env.local)
NEXT_PUBLIC_APP_URL                = https://demo-navy-chi-47.vercel.app
NEXT_PUBLIC_VAPI_PUBLIC_KEY        = (copy from .env.local)
CRON_SECRET                        = (copy from .env.local)
SUPABASE_ACCESS_TOKEN              = (copy from .env.local)
OPENAI_API_KEY                     = (copy from .env.local — secret)
EMERGENCY_RETRY_INTERVAL_MINUTES   = 5
EMERGENCY_MAX_ATTEMPTS             = 3
```

### Optional
```
GOOGLE_MAPS_API_KEY = (if you have one — secret)
```

---

## Pointing Vapi at the deployment

Vapi's `serverUrl` must be the Vercel domain, not a local tunnel:

```
https://demo-navy-chi-47.vercel.app/api/vapi/tools
```

If you ever need to pull the remote environment down:

```bash
npx vercel login                       # browser sign-in
npx vercel link                        # attach to the project
npx vercel env pull .env.production    # download remote env
```

Or add a single variable:

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
# paste the value, press enter
```

---

## First run after a deploy

1. Open `https://demo-navy-chi-47.vercel.app/` — the dashboard should load.
2. Open `/human-calls` — the human line status banner tells you whether the
   line can actually take a call yet.
3. Check `/api/cron/keepalive` — it should report `restoreEnabled: true`
   once `CRON_SECRET` and `SUPABASE_ACCESS_TOKEN` are set.
4. Make a real test call to the AI line and confirm the work order appears
   with a transcript and a summary.
