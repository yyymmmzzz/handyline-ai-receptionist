# Twilio Upgrade Runbook — unblock SMS + the human line

**Status (verified 2026-10-31): BLOCKED.** The Twilio account's trial has
expired. Every notification to the merchant fails, and the human-answering
line cannot exist until a number is bought.

---

## 1. What is actually broken (verified, not guessed)

Measured against the live Twilio API on 2026-10-31:

| Check | Result |
|---|---|
| `GET /Accounts/{sid}` | `status: active`, `type: Trial` |
| `GET /Accounts/{sid}/Calls.json` | **HTTP 401 — "Your Trial account has expired. Please upgrade your account to gain access."** |
| `GET /AvailablePhoneNumbers/US/Local.json` | **HTTP 404 — the trial may not search for numbers** |
| `GET /Accounts/{sid}/IncomingPhoneNumbers.json` | **0 numbers owned** |
| `GET /Accounts/{sid}/Addresses.json` | **0 numbers** (no SMS sender either) |

The `status: active` field is misleading — the account object still says
active while every entitlement is gone. The trial expiry is what actually
blocks things.

### Blast radius

Two channels depend on this Twilio account, and **both are dead**:

1. **SMS to the boss** — `src/lib/notify.ts` sends the "new job" and
   "callback" texts. The `notifications` table holds **80 rows, all `failed`,
   zero `sent`**:
   - 42 × `No Twilio trial phone number is assigned for messaging…` (up to 2026-09-11)
   - 29 × `twilio_from_not_owned:+17243620422` (up to 2026-10-29 15:07)
   - 9 × `Your Trial account has expired` (2026-10-29 01:11)

   The most recent two production jobs (2026-10-29) were accepted by the AI
   and the merchant was never told.

2. **Emergency outbound call** — `src/lib/emergency-call.ts` dials the boss
   for `urgent` jobs. It uses the same account, so it fails too. The
   `/api/cron/emergency-retry` cron was observed retrying 16 urgent orders
   with `callId: null` (Twilio rejected the `from` number).

### What is NOT broken

- **The AI line still works.** `+1 (724) 362-0422` is a **Vapi-hosted**
  number, not a Twilio one. Vapi's own billing is untouched by the Twilio
  trial. The AI receptionist keeps taking calls and booking jobs.
- **The dashboard works.** It now shows a red "never reached the boss"
  banner, so the gap is visible instead of silent.

### The `from` number trap

`TWILIO_PHONE_NUMBER` currently holds `+17243620422` — the **Vapi AI line**.
Twilio will not send from a number it does not own, hence
`twilio_from_not_owned`. Once a real Twilio number is bought, this variable
must point at that number. That single change is what restores SMS.

---

## 2. Division of labour

| Who | What |
|---|---|
| **Mimatt** | Upgrade the Twilio account (paid), buy a number, set the two webhook URLs in the Twilio console. These need account access and money. |
| **The agent** | Run the activation script, update the Vercel env vars, redeploy, verify end to end. |

---

## 3. Step 1 — Upgrade the account (Mimatt)

Twilio Console → **Billing** → **Upgrade your account**. The console shows
the exact price at checkout; a US local number is a few dollars per month on
top of whatever the upgrade charges.

The account is `type: Trial`. It has to become a paying account before
anything below will work.

---

## 4. Step 2 — Buy a number (Mimatt)

Twilio Console → **Phone Numbers** → **Buy a number**.

Recommended configuration:

| Setting | Value | Why |
|---|---|---|
| Country | United States | The merchant is in Bellaire, TX |
| Area code | **713** | Houston — where the merchant and most customers are |
| Type | **Local** | Not toll-free; a local number reads as more trustworthy to a customer who is choosing a handyman |
| Capabilities | **Voice + SMS** | Voice for the human line, SMS for job notifications |
| Regex | anything | — |

Pick a number without a memorable bad digit sequence — customers will read it out loud to their family.

---

## 5. Step 3 — Set the two webhook URLs (Mimatt)

In the Twilio console, open the new number → **A CALL COMES IN**:

```
https://demo-navy-chi-47.vercel.app/api/human-line/voice
```

And under the same number → **RECORDING STATUS**:

```
https://demo-navy-chi-47.vercel.app/api/human-line/recording
```

Both routes verify the Twilio signature and reject unsigned calls. The
activation script prints these two URLs too.

---

## 6. Step 4 — Wire it up (agent)

Run the activation script with the new number:

```bash
cd "/Users/yimozhang/Business/Handy Bookloh/handyline-ai-receptionist"
node scripts/activate-human-line.js +1XXXXXXXXXX
```

It writes `human_line_number`, `twilio_phone_number` and `human_line_enabled`
to the `bosses` row for Handy Works, and sets `TWILIO_PHONE_NUMBER` and
`HUMAN_LINE_NUMBER` in `.env.local`.

**Then the Vercel env vars must be updated** — `src/lib/notify.ts` and
`src/lib/emergency-call.ts` read `TWILIO_PHONE_NUMBER` from the *deployment*,
not from `.env.local`:

```
TWILIO_PHONE_NUMBER  = <the new number>     (Production)
HUMAN_LINE_NUMBER    = <the new number>     (Production, new)
```

`HUMAN_LINE_NUMBER` is what lets the code tell the human line apart from the
Vapi AI line — both are Twilio numbers, and pointing the human line at the AI
line would loop the customer back to the AI.

Env vars are baked into each deployment, so a **redeploy is required** after
changing them.

---

## 7. Step 5 — Verify (agent)

```bash
node scripts/check-human-line.js     # readiness chain, prints what is missing
node scripts/test-human-line.js      # 25 assertions against the live site
curl -sS https://demo-navy-chi-47.vercel.app/api/human-line/status
```

Then the two checks that only a human can do:

1. **Call the new number** from a real phone. The call should ring the
   merchant's phone (currently `+1 (713) 742-2387`).
2. **After the call ends**, open `/human-calls` — the recording should be
   there, with the transcript and the AI minutes.

---

## 8. Open decisions (not needed to unblock)

- **Who does the human line ring?** Only the merchant's number is on file
  (`+1 (713) 742-2387`). Abel's number is not in the `bosses` table.
- **What if nobody answers?** Currently `voicemail`. The alternative is
  falling back to the AI assistant so the customer is never dropped.
  Configure with `node scripts/activate-human-line.js +1XXXXXXXXXX --fallback ai`.

---

## 9. Rollback

```bash
node scripts/activate-human-line.js --disable
```

This clears `human_line_enabled` but keeps the number in the database, so it
can be switched back on without buying another one. The AI line is never
affected by any of this.
