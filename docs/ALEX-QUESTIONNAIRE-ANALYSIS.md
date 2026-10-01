# Alex / Handy Works — Questionnaire Answer Analysis

> Source: `ai answers.pdf` (Alex Vega, Handy Works Home Services, returned 2026-09-30)
> Compared against: `vapi/system-prompt.md`, `supabase/migrations/`, current boss config
> Status: **ANALYSIS ONLY — no system changes made yet**

---

## TL;DR

- **Good news**: 11 of 13 price ranges are **exactly correct** in our system. The core pricing table is validated.
- **Bad news**: 7 hard conflicts where Alex's real answer contradicts what the AI currently says. Two of them will make the AI **quote a fee that doesn't exist** and **promise a callback cadence we don't implement**.
- **Blocking**: Section 5 (Emergencies) and Section 10 (Compliance) answers are **misaligned in the PDF** — they cannot be reliably mapped to their questions. Emergencies are the highest-stakes flow; we need to re-ask.

---

## Part 1 — What Alex confirmed (✅ matches current system)

### Business identity

| Field | Alex's answer | Verdict |
|---|---|---|
| Company | Handy Works Home Services | ✅ |
| Address | 6575 W Loop S Ste 500, Bellaire TX 77401 | ✅ |
| Phone | 713-742-2387 | ✅ |
| Owner | **Alex Vega** (+ co-owner **Abel**, in the field) | ✅ |
| Team | 3 people, occasional subcontractors | ✅ |
| Service area | 25 mi radius from 77401 | ✅ |
| Operational since | **2024** (prior handyman experience before) | ⚠️ prompt says "Started 2021" |
| AI personality | **friendly and warm** | ✅ |
| AI gives price ranges | **Yes** | ✅ |
| Give price ranges caveat | "prices can change when we put eyes on the work" | ➕ new, add to prompt |

### Price ranges — validated (11/13 correct)

| Trade | System | Alex | Verdict |
|---|---|---|---|
| plumbing | 120–500 | 120–500 | ✅ |
| electrical | 120–500 | 120–500 | ✅ |
| hvac | 150–600 | 150–600 | ✅ |
| painting | 200–1500 | 200–1500 | ✅ |
| tv_mounting | 89–200 | 89–200 | ✅ |
| furniture_assembly | 89–250 | 89–250 | ✅ |
| smart_home | 150–600 | 150–600 | ✅ |
| drywall | 150–800 | 150–800 | ✅ |
| pressure_washing | 150–600 | 150–600 | ✅ |
| fence_deck | 200–2000 | 200–2000 | ✅ |
| window_covering | 100–400 | 100–400 | ✅ |
| handyman | 89–400 | **$75 min** (furniture) | ⚠️ see below |
| general | 89–500 | not mentioned | ⚠️ |

### Out-of-scope list — validated (all 8 confirmed)

| Declined | Alex confirmed | Verdict |
|---|---|---|
| Pest control | "not in list, not mentioned" | ✅ |
| Foundation / structural / slab leak | refer | ✅ |
| Standalone IT / networking | not in list | ✅ |
| Large tree removal | "We can refer a landscaping pro" | ✅ |
| Pool service | not in list | ✅ |
| Appliance repair | **"We do not work on appliances" ×3** | ✅ strong signal |
| Gas line work | "Call a plumber" | ✅ refer |
| Central AC full install | "refer to a certified specialist" | ✅ refer |
| Electrical panel upgrade | "refer to an electrician" | ✅ refer |

---

## Part 2 — 🔴 HARD CONFLICTS (must fix before going live)

### C1. Trip fee — AI will quote a fee that DOESN'T EXIST 🔴🔴🔴

**Alex's actual answer (Q6.1):**
> "We currently don't have a trip fee, unless they are outside the greater Houston area, if so a small fee trip will be added (depends on what the work is)"

**Q6.8:** "Yes, they must pay the $45 trip fee"
**Q3.7:** answer column shows `45`

**Current system says:** `$89 trip fee (15 mi included; $2/mile beyond)` — stated in the First Message example, the pricing section, the FAQ, AND 3 quote examples.

**Impact:** Every single AI call currently opens by saying "Trip fee eighty-nine dollars." Alex has no $89 trip fee. This is the first thing the AI says on every qualified call.

**Correct model:**
- Inside 25 mi (Greater Houston): **$0 trip fee**
- Outside Greater Houston: **$45 trip fee**, not credited, customer pays it
- Mileage surcharge: **$2/mile** (Q3.6 pre-fill said $2/mile — Alex did NOT contradict, but also did not confirm; treat as needs-confirm)

**Needs one clarification:** Does the $45 apply to the *total* trip or is it in addition to labor? And is the $2/mile still active on top?

---

### C2. First message says "Alex" — Alex wants "Handy Works Service desk" 🔴

**Q8.4 answer:** "Handy Works Service desk" (explicitly **NOT** "Alex from Handy Works")

**Current first message:** `"Handy Works, this is Alex. What's the issue."`

Also Q8.1: Alex does **not** want to record his own voice → keep ElevenLabs default (no action needed, but confirms no voice cloning).

---

### C3. Emergency callback cadence — we don't implement what he asked 🔴

**Alex's requested cadence (verbatim):**
> - 1st call → you answer, you handle customer
> - No answer → wait 5 min → 2nd call
> - No answer → wait 10 min → 3rd call
> - 3 no-answer → **SMS you** + **tell customer to leave voicemail**

**Current system:** 3 attempts at 5-min interval, **no SMS fallback, no voicemail message**.

**Gaps:**
1. Retry interval is 5/5/5 — should be **5/10/5-ish** (or 5/10/then stop)
2. **SMS to Alex** after 3 misses — we have no SMS channel (Twilio can do it, but not wired)
3. **Tell the customer to leave a voicemail** — prompt has no such line

---

### C4. Sunday hours — AI currently says OPEN 🔴

| | System | Alex |
|---|---|---|
| Weekday | Mon–Sat 8–5 | **Mon–Fri 8:00–18:00** |
| Saturday | Sat 9–3 | **Sat 9:00–15:00** ✅ |
| **Sunday** | **9–3 (OPEN)** | **CLOSED** |

**Current FAQ line:** `"Weekend hours?" — "Mon-Sat 8-5, Sun 9-3."`

This is a direct "we're open when we're closed" failure. Note weekday hours also extend to **6 PM**, not 5 PM — the AI currently under-promises availability by an hour every weekday.

**Holidays:** Q2.4 = "Definitely closed" (Christmas / Thanksgiving). Q2.5 = "Definitely closed". Not currently in the system.

---

### C5. "Full home renovation" — Alex contradicts himself 🔴

- **Section 4.10 (What we DON'T do) lists:** "Full home renovation (kitchen/bath gut)"
- **His answer in that same row:** **"We do offer home renovation and remodeling services"**

This is a direct self-contradiction. The AI either declines renovation (current behavior) or accepts it — we need Alex to pick one. If renovation IS in scope, it's a major trade addition with its own pricing (currently absent).

---

### C6. License / insured — Alex says "No license" 🔴

| Source | Says |
|---|---|
| Pre-filled Section 0 (we wrote it) | "Texas LLC #32094253104" |
| Alex's answer to Section 0 | **"No license"** |
| Alex's answer to 10.x | **"Texas doesn't require us to be licensed. We are insured"** |
| Pre-filled FAQ 9.10 (we wrote it) | "Yes, Texas LLC + insured" |

**Current system FAQ:** `"Licensed?" — "Yes, Texas LLC, fully insured."`

**This is legally sensitive.** We asserted a license number on Alex's behalf that he says doesn't exist. Options:
- (a) Change to: "We're an insured Texas LLC — Texas doesn't require a trade license for our work."
- (b) Ask Alex to confirm whether the LLC registration number is real (LLC registration ≠ trade license; he may be confusing the two)

**Do not state a license number until Alex confirms in writing.**

---

### C7. Commercial jobs — currently absent from scope 🟠→🔴

**Q3.8:** "We are capable of some commercial jobs"
**Q9.9:** "Discuss per job"

The AI has no commercial handling at all. Currently a commercial caller gets treated as residential (or declined if outside residential service logic). Needs either a dedicated path or an explicit "we do take commercial, let me have Alex call you" path.

---

## Part 3 — 🟠 MEDIUM fixes

### M1. Venmo removed, CC surcharge added

| | System FAQ | Alex |
|---|---|---|
| Payment | "Cash, all major cards, Zelle, **Venmo**" | "**No venmo**" |
| CC fee | not mentioned | **3% fee added to total** |
| Preference | — | "We prefer Zelle" |
| Check | not mentioned | ✅ accepted |
| Hourly | not mentioned | "Most of our services are flat fees; moving services may have an hourly fee" |

The AI must stop saying Venmo and must disclose the 3% card fee.

### M2. Email corrected

`handyworks281@gmail.com` → **`handy@handyworks.info`** (and the original had a typo: "handyworks281" vs "handyworks")

### M3. "Started 2021" → "Operational since 2024"

Current prompt: "Started 2021 — founded from a furniture assembly business"
Alex: "Handy Works has been operational since 2024, but we have been doing handyman work for a long time"
FAQ 9.11: "(2 years official, more experience)"

Stating "since 2021" is a factual claim Alex didn't make. Change to "operating since 2024, team has long prior handyman experience."

### M4. Scope narrowed for Electrical + Plumbing (referral-heavy)

| Trade | System prompt implies | Alex actually says |
|---|---|---|
| **Electrical** | ceiling fan, light fixture, outlet, switch, GFCI, doorbell, ceiling fan replace | **"minor electric only"** — install ceiling fans, light fixtures. "For certified electrical work we can refer you to an electrician that we use" |
| **Plumbing** | faucet, toilet, sink, pipe insulation, visible leak repair, electric water heater | **"minor plumbing"** — replace toilets, install faucets and sinks. "We can refer you to a certified plumber if necessary" |

**Implication:** Water heater, visible leak repair, pipe insulation, GFCI/outlet replacement are NOT confirmed in scope. Leak repair is currently an `flag_urgent` trigger — we need to know whether Alex wants to take those or refer them out. This is urgent-flow-critical.

### M5. Roofing — hedged, not a hard refer

- System: "Roofing (any) — refer out, we coordinate"
- FAQ 9.7: "(No, but I can refer you)"
- **Alex's answer:** "We can offer shingle replacement services depending on size of work, a referral may be given as an option"

So: **shingle replacement = YES (size-dependent)**; full roofing = refer. Needs a pricing range (currently missing).

### M6. Emergency table 5.3 answer appears WRONG

The answer column in the PDF is misaligned. Under **5.3 Gas smell**, the visible answer reads **"Call a plumber"** — a gas smell must route to the gas utility / 911, never a plumber. This is almost certainly a column-shift artifact, not Alex's real instruction, but it **must be re-confirmed** before it goes anywhere near the prompt.

### M7. Art Work is in our prompt but not in Alex's questionnaire

Current prompt lists: "Art Work (hanging, spacing, leveling — hooks/anchors/nails/screws included)"

The questionnaire has **no art-hanging section**. Either it was dropped from this version of the form, or Alex no longer offers it. Needs confirmation — currently the AI will happily quote it.

### M8. Price floor mismatches (Alex gave lower floors than our table)

| Trade | Our table low | Alex's stated floor |
|---|---|---|
| furniture_assembly | 89 | **"minimum fee of $75"** |
| tv_mounting | 89 | **"start at $90"**, + fee if TV > 65" |
| smart_home | 150 | **"start at $80"** |
| window_covering | 100 | **"start at $75"** |

Also new qualifiers we don't have:
- Furniture: multiple items = flat fee
- TV: >65" screen adds a fee
- Window coverings: price varies by height + quantity
- Painting: ~$200/room labor, varies with ceilings/baseboards/doors + paint brand
- Fence: $200–2000, varies by size + material
- Siding/door/window install: varies by size + material
- Junk removal: varies by volume + material type

---

## Part 4 — 🟡 Unanswered / need re-ask

| # | Question | Why it matters |
|---|---|---|
| Q1.3 | WhatsApp number → "none" | How do we notify last-minute closures? (Q2.6 left blank) |
| Q2.6 | Closure notification channel | No WhatsApp → need Slack/email/SMS path |
| Q3.3 | Katy / Sugar Land / Pearland / Woodlands / Cypress → answer reads **"15"** | Is that 15 of 5 cities? "some"? Needs clarification — these are core Houston suburbs |
| Q3.4 | Galveston / College Station → "no" | ✅ clear, but should be encoded as explicit exclusions |
| Q3.6 | $2/mile surcharge — pre-filled, not confirmed | Tied to C1 |
| Q7.1 | Normal lead time → "We try to accommodate with our schedule as much as possible" | Too vague for AI to quote a time |
| Q7.2 | Urgent lead time → answer column is **off by one** | Needs clean answer |
| Q7.4 | AM/PM preference → answer column **off by one** | Needs clean answer |
| Q7.5 | Time slot format → answer column **off by one** | Needs clean answer |
| Q8.6 | Whitelist numbers → **blank** | Should at minimum whitelist Alex + Abel so they bypass the AI |
| Q8.7 | Blacklist numbers → **blank** | OK to leave empty |
| Q9.5 | Warranty "30-day workmanship" | **Pre-filled by us, never confirmed by Alex** |
| Q9.10 | "Yes, Texas LLC + insured" | Pre-filled by us, contradicted by Alex (see C6) |
| Q9.12 | "Basic Spanish" | Pre-filled by us, never confirmed |
| Q10.2 | Recording retention period → **blank** | We have no deletion policy. Texas one-party consent confirmed ✅, but retention needs a decision |
| Q10.3 | Where stored → answer is "Yes" (doesn't answer) | We know: Supabase Storage |
| Q10.4 | "Customer says delete my recording" → "No" (doesn't answer) | **Compliance question — must have a real answer** |
| Q10.5 | Opening line wording → off-topic answer | Decide: do we play a recording notice? |

---

## Part 5 — Recommended sequencing

### Do NOT go live until these are answered

1. **C1 trip fee** — the AI's first sentence on every call. Cannot be wrong.
2. **C4 Sunday hours** — "we're open when we're closed" is a trust-killer.
3. **C6 license** — legal exposure. We asserted a number Alex denies.
4. **C5 renovation** — pick one.
5. **M6 emergency routing** — gas smell → plumber is unacceptable if real.
6. **Q10.4 recording deletion** — compliance requirement.

### Can ship with AI disclaimer

7. **C2 first message** → "Handy Works Service desk"
8. **C3 callback cadence** → implement 5/10 + add SMS fallback (Twilio) + voicemail line
9. **M1 payment** → drop Venmo, add 3% card fee
10. **M3** → "operating since 2024"
11. **C7 commercial** → add a commercial path
12. **M4 scope narrowing** → move water heater / leak repair / GFCI to refer-until-confirmed
13. **M5 roofing** → shingle replacement yes, full roofing refer, add price range
14. **M8 price floors** → update 4 trade minimums
15. **M2 email** → handy@handyworks.info
16. **M7 art work** → confirm or remove
17. **Q8.6 whitelist** → add Alex + Abel

### Longer tail

18. Q3.3 city coverage clarification
19. Q7.1–7.5 scheduling preferences
20. Q10.2 retention policy
21. Closure notification channel (no WhatsApp)

---

## Appendix — Data quality notes on the source PDF

The answer column in the returned PDF is **visually offset** in several sections:

- **Section 5 (Emergencies)**: answers for 5.1–5.6 cannot be reliably mapped. Visible sequence suggests 5.1="Call a plumber", 5.2="Call an electrician", 5.3="Call a plumber" (implausible), 5.4/5.5 shifted further.
- **Section 6.2–7.5**: the answer stream appears **off by one to two rows** from 6.4 onward.
- **Section 8.3–8.5**: appears aligned (friendly and warm / Handy Works Service desk / price-range caveat) — these three are trustworthy.
- **Section 10**: answers are off-topic relative to questions.

**Recommendation:** ask Alex for a **15-minute voice call** covering Sections 5, 6, 7, 10 only. Sections 0–4 and 8 are reliable enough to act on.
