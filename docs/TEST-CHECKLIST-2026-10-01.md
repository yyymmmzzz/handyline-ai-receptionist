# Test Checklist — Alex Questionnaire Change Verification

> Generated: 2026-10-01
> Corresponding change: migration 012 + system prompt v2
> Prerequisite: Vercel deployment is complete (see the "Deployment Preconditions" section)

---

## 1. Deployment Preconditions (confirm these first, otherwise nothing else can be tested)

| # | Action | Expected |
|---|---|---|
| 0.1 | Open `https://demo-navy-chi-47.vercel.app/api/cron/keepalive` in a browser | Returns `{"ok":true,"stage":"keepalive",...}` |
| 0.2 | Vercel console → Project → Cron Jobs | `/api/cron/keepalive` is visible, running once a day |
| 0.3 | Run `npx vercel login` && `./scripts/push-cron-env.sh` | The two environment variables are pushed into Vercel |

**0.1 If it returns 404** → the deployment is not finished yet; wait for the Vercel build first.

---

## 2. Must Test (if these are wrong, the customer hears the wrong thing)

Call **+1 724-362-0422** and read each line below exactly as written.

### 2.1 Opening Line — Highest Priority

| Read this | Expected answer |
|---|---|
| *(the first line when they pick up)* | **"Handy Works service desk. What's the issue."** |
| | ❌ Must not contain "this is Alex" |

### 2.2 Trip Fee — It Was Erroring on Every Previous Call

| Read this | Expected answer |
|---|---|
| "I need a faucet replaced, I'm in 77401" | **Must not contain $89**. Should say "no trip fee" or give the labor cost range directly |
| "I'm in 77583, can you come?" | Still no trip fee (within 25 miles) |
| "I'm in 77301, that's like 40 miles out" | **Should mention a small trip fee**, and clarify that it is not credited back against the job |

**Fail condition**: any call that says "eighty-nine dollars" means the change did not take effect.

### 2.3 Business Hours

| Read this | Expected answer |
|---|---|
| "Are you open Sunday?" | **"closed Sunday"** |
| "What time do you close on weekdays?" | **"six"** (not five) |
| "Are you open Saturday?" | "nine to three" |

### 2.4 Payment Methods

| Read this | Expected answer |
|---|---|
| "What payment do you take?" | cash / check / **Zelle** / card |
| | ❌ **Must not mention Venmo** |
| "Is there a fee for card?" | **"three percent"** |

### 2.5 Licensing

| Read this | Expected answer |
|---|---|
| "Are you licensed?" | "insured Texas LLC, Texas doesn't require a trade license" |
| | ❌ **Must not quote any license number** (in particular, must not say 32094253104) |

### 2.6 Year Established

| Read this | Expected answer |
|---|---|
| "How long have you been in business?" | **"since twenty twenty four"** |
| | ❌ Must not say 2021 |

---

## 3. Scope Boundaries (test whether it should take the job)

| Read this | Expected behavior |
|---|---|
| "Can you install a smart lock?" | ✅ Accept, **from $80** |
| "I need my water heater replaced" | ⚠️ Should **refer out** to a plumber (outside minor plumbing) |
| "My AC isn't cooling, it's blowing warm air" | ✅ Accept, AC repair $150–600 |
| "I want a whole new central AC unit installed" | ⚠️ Should **refer out** to an HVAC specialist |
| "My roof needs new shingles" | ✅ Accept, $400–$2,500 |
| "I need a whole new roof" | ⚠️ Should **refer out** |
| "Can you fix my washing machine?" | ❌ Explicit refusal + suggest finding an appliance tech |
| "I run a restaurant, need someone for my kitchen" | ✅ Acknowledge accepting commercial work, **but do not quote a price**; say Alex will call back |
| "Can you gut and redo my kitchen?" | ⚠️ Currently **declines** (waiting for Alex to clarify, see B3) |
| "Do you do termites?" | ❌ Refuse + suggest finding pest control |
| "I smell gas" | ⚠️ See the next section, **highest danger** |

---

## 4. Emergency Scenarios (must be tested separately)

| Read this | Expected behavior |
|---|---|
| **"I smell gas in my kitchen"** | 1) Tell them to open the windows 2) Tell them to leave 3) Tell them to call **911** 4) Say Alex will be called immediately |
| | ❌ **Must never say "I'll find you a plumber"** |
| "There's water spraying everywhere, my ceiling is soaking" | flag_urgent + contact Alex immediately |
| "The power just went out in the whole house" | flag_urgent |
| "My shop AC died and I have inventory" | flag_urgent |
| "I have no hot water but I have small kids" | flag_urgent |

**After testing, check**: after every flag_urgent, Alex's phone (713-742-2387) should receive a call; a work order with `status=urgent` should be pinned to the top of the dashboard.

---

## 5. Price Quoting Format (TTS Number Reading)

| Read this | Expected |
|---|---|
| "How much for furniture assembly, I'm in 77401" | "furniture assembly starts at **seventy-five**" |
| "How much to mount a TV?" | "starts at **ninety**" |
| "How much for blinds?" | "starts at **seventy-five**" |
| (after any quote) | Must include "**final price confirmed once we see the job**" |
| | ❌ Must not read out the numeric characters "$" "89" "–" |

---

## 6. Closing Script (Regression Test)

| Scenario | Expected |
|---|---|
| Normal ending | Must ask "**Anything else** I can help with?" |
| Customer says "no that's all" | "Have a good day." |
| | ❌ Must not say "Bye" / "See ya" |
| Customer asks to be transferred to a human | "I will certainly call you back shortly" |
| | ❌ Must not say "Alex will call" |

---

## 7. Backend Data Verification

After each tested call, run this once:

```bash
node scripts/import-vapi-calls.js --write
node scripts/analyze-calls.js
```

Checklist:
- [ ] `trip_fee` field = **0** (not 89)
- [ ] `price_list` matched values: furniture=75 / tv=90 / smart_home=80 / window_covering=75
- [ ] Emergency call has `ai_decision=urgent` and `status=urgent`
- [ ] Alex's own number (+17137422387) **must not** appear in work orders (the whitelist is working)

---

## 8. Known Out of Scope for This Round

- **5→10 minute progressive call-back + SMS after three missed calls**: the database fields have been added, but the code does not consume them yet. The voice prompt "please leave a voicemail" is already in effect; the SMS fallback is not implemented yet
- **Abel whitelist**: not added for now, per your instruction
- **The answers in sections 5/6/7/10 are shifted**: Alex needs to re-confirm them; this does not affect the current prompt (a safe default value has already been taken)

---

## 9. Test Log Table

| # | Scenario | Date | Result | Notes |
|---|---|---|---|---|
| 1 | Opening line | | | |
| 2 | Trip fee (within zone) | | | |
| 3 | Trip fee (outside zone) | | | |
| 4 | Sunday | | | |
| 5 | Payment methods | | | |
| 6 | Licensing | | | |
| 7 | Gas smell | | | |
| 8 | Urgent leak | | | |
| 9 | Smart lock quote | | | |
| 10 | Water heater (should refer out) | | | |
| 11 | Commercial kitchen | | | |
| 12 | Washing machine (should refuse) | | | |
