# Alex / Handy Works AI Receptionist — User Test Case

**Phone to call:** `+1 (724) 362-0422`
**AI persona:** "Handy Works, this is Alex"
**Last updated:** 2026-08-29 (after TTS fixes + "I will certainly" + "Have a good day" updates)
**Total cases:** 36 (10 regular + 26 other across 9 categories)

---

## How to use

For each case:
1. **Dial** `+1 (724) 362-0422` (or use Vapi dashboard test call)
2. **Read** the "You say" line(s) — speak naturally like a customer
3. **Listen** for the expected AI response (in italics)
4. **Check** all "Pass criteria" boxes
5. **Score** 1-5 on each dimension (response length, decision, tone, TTS quality)

If a case fails, note:
- Which pass criterion failed
- What the AI actually said
- Any TTS mispronunciations

---

## Group A — Regular Cases (in-service, normal flow, likely to close)

**10 cases.** These are the bread-and-butter calls the AI should handle smoothly in < 30 seconds.

---

### TC-001 — Kitchen sink leak, 77005

| Field | Value |
|---|---|
| **Trade** | plumbing |
| **Zip** | 77005 (in service) |
| **Expected decision** | accepted |

**You say:**
> "Hi, my kitchen sink has been leaking for a couple of days. I'm in 77005."

**Expected AI flow:**
- *Got it, in service. Trip fee eighty-nine dollars. Plumbing work runs one-twenty to five hundred. Total estimate around two-nine to five-eighty-nine. When works — morning or afternoon? Name and callback number?*
- (you answer: "Tomorrow morning, Mike, 713-555-0100")
- *Got it, Mike. I will certainly call to follow up. Anything else I can help with?*
- (you: "No, that's it.")
- *Take care, Mike. Have a good day.* [end_call]

**Pass criteria:**
- [ ] Trade "plumbing" recognized
- [ ] Zip 77005 accepted (in 25mi radius)
- [ ] Trip $89 mentioned
- [ ] Plumbing range $120-$500 (no "thousand" glitch)
- [ ] Total range $209-$589
- [ ] Ask for time + name + number in ONE turn
- [ ] Says "I will certainly call to follow up" (NOT "Alex will call")
- [ ] Asks "Anything else?" before end
- [ ] Says "Have a good day" (NOT "Bye")
- [ ] All numbers spoken as words (no "120" digit)

---

### TC-002 — Ceiling fan install, 77030

| Field | Value |
|---|---|
| **Trade** | electrical |
| **Zip** | 77030 (in service) |
| **Expected decision** | accepted |

**You say:**
> "Need a ceiling fan installed in my bedroom. I'm in 77030."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine dollars. Electrical work runs one-twenty to five hundred. Total around two-nine to five-eighty-nine. When works? Name and number?*
- (you: "Friday afternoon, Sarah, 832-555-0142")
- *Got it, Sarah. I will certainly call to follow up. Anything else?*
- (you: "No thanks.")
- *Take care, Sarah. Have a good day.* [end_call]

**Pass criteria:**
- [ ] "electrical" mapped correctly (ceiling fan = electrical)
- [ ] All TTS-friendly numbers
- [ ] 1 end_call call only (not multiple)

---

### TC-003 — TV mount 65", Katy 77450

| Field | Value |
|---|---|
| **Trade** | tv_mounting |
| **Zip** | 77450 (Katy, in service) |
| **Expected decision** | accepted |

**You say:**
> "I just bought a 65-inch TV, need it mounted on the wall. I'm in 77450, Katy."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. TV mounting runs eighty-nine to two hundred. Total around one-eighty to two-eighty-nine. When works?*
- (you: "This Saturday morning, John, 281-555-0123")
- *Got it, John. I will certainly call to follow up. Anything else?*
- (you: "No that's all.")
- *Take care, John. Have a good day.* [end_call]

**Pass criteria:**
- [ ] AI recognizes "65-inch TV" as tv_mounting
- [ ] Katy zip accepted
- [ ] Range $89-$200 quoted

---

### TC-004 — Interior paint one room, Pearland 77584

| Field | Value |
|---|---|
| **Trade** | painting |
| **Zip** | 77584 (Pearland, in service) |
| **Expected decision** | accepted |

**You say:**
> "Need one bedroom painted, about 12 by 12. I'm in 77584, Pearland."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. Painting runs two hundred to fifteen hundred. Total around two-eighty-nine to sixteen-eighty-nine. When works?*
- (you: "Next Tuesday, Lisa, 832-555-0987")
- *Got it, Lisa. I will certainly call to follow up. Anything else?*
- (you: "Nope, thanks.")
- *Take care, Lisa. Have a good day.* [end_call]

**Pass criteria:**
- [ ] "painting" correctly identified from "bedroom painted"
- [ ] $200-$1500 range

---

### TC-005 — Smart lock install, Houston 77006

| Field | Value |
|---|---|
| **Trade** | smart_home |
| **Zip** | 77006 (Montrose, in service) |
| **Expected decision** | accepted |

**You say:**
> "I want to install a smart lock on my front door. I live in 77006."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. Smart home runs one-fifty to six hundred. Total around two-forty to six-eighty-nine. When works?*
- (you: "Tomorrow evening, David, 713-555-0166")
- *Got it, David. I will certainly call to follow up. Anything else?*
- (you: "No thanks.")
- *Take care, David. Have a good day.* [end_call]

---

### TC-006 — Toilet running continuously, 77401 (Bellaire = base)

| Field | Value |
|---|---|
| **Trade** | plumbing |
| **Zip** | 77401 (Bellaire, base) |
| **Expected decision** | accepted |

**You say:**
> "My toilet keeps running. I'm at 77401."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. Plumbing one-twenty to five hundred. Total around two-nine to five-eighty-nine. When works?*
- (you: "Today if possible, Karen, 832-555-0177")
- *Got it, Karen. I will certainly call to follow up. Anything else?*
- (you: "No.")
- *Take care, Karen. Have a good day.* [end_call]

---

### TC-007 — IKEA bookshelf assembly, 77002 (downtown)

| Field | Value |
|---|---|
| **Trade** | furniture_assembly |
| **Zip** | 77002 (in service, downtown) |
| **Expected decision** | accepted |

**You say:**
> "Got an IKEA bookshelf, need it assembled. 77002."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. Furniture assembly runs eighty-nine to two-fifty. Total around one-eighty to three-forty. When works?*
- (you: "Tomorrow, Chris, 713-555-0188")
- *Got it, Chris. I will certainly call to follow up. Anything else?*
- (you: "All good, thanks.")
- *Take care, Chris. Have a good day.* [end_call]

---

### TC-008 — Drywall hole patch, Missouri City 77489

| Field | Value |
|---|---|
| **Trade** | drywall |
| **Zip** | 77489 (Missouri City, in service) |
| **Expected decision** | accepted |

**You say:**
> "Need a drywall patch, like a fist-sized hole. 77489."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. Drywall one-fifty to eight hundred. Total around two-forty to eight-eighty-nine. When works?*
- (you: "Next week, Maria, 832-555-0199")
- *Got it, Maria. I will certainly call to follow up. Anything else?*
- (you: "Nothing else.")
- *Take care, Maria. Have a good day.* [end_call]

---

### TC-009 — One fence panel replacement, Sugar Land 77479

| Field | Value |
|---|---|
| **Trade** | fence_deck |
| **Zip** | 77479 (Sugar Land, in service) |
| **Expected decision** | accepted |

**You say:**
> "Storm knocked down one fence panel. Need it replaced. Sugar Land, 77479."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. Fence work runs two hundred to two thousand. Total around two-eighty-nine to twenty-oh-nine. When works?*
- (you: "This weekend, Tom, 281-555-0210")
- *Got it, Tom. I will certainly call to follow up. Anything else?*
- (you: "No.")
- *Take care, Tom. Have a good day.* [end_call]

---

### TC-010 — GFCI outlet tripping, Houston 77019 (River Oaks / inside loop)

| Field | Value |
|---|---|
| **Trade** | electrical |
| **Zip** | 77019 (in service) |
| **Expected decision** | accepted |

**You say:**
> "GFCI outlet in my bathroom keeps tripping. 77019."

**Expected AI flow:**
- *Got it, in service. Trip eighty-nine. Electrical one-twenty to five hundred. Total around two-nine to five-eighty-nine. When works?*
- (you: "Tomorrow morning, Jennifer, 713-555-0221")
- *Got it, Jennifer. I will certainly call to follow up. Anything else?*
- (you: "No thanks.")
- *Take care, Jennifer. Have a good day.* [end_call]

---

## Group B — Urgent Cases (3)

**3 cases.** Safety + immediate callback. No "Anything else?" check.

---

### TC-U01 — Burst pipe, water everywhere

| Field | Value |
|---|---|
| **Trade** | plumbing |
| **Urgency** | CRITICAL (water damage risk) |
| **Expected decision** | urgent |

**You say:**
> "My pipe just burst! Water is everywhere in my kitchen!"

**Expected AI flow:**
- *Hold on a sec.* [calls flag_urgent]
- *Stay safe. I will certainly call back within fifteen minutes. Have a good day.* [end_call]

**Pass criteria:**
- [ ] Recognized as urgent (no zip question, no price)
- [ ] flag_urgent tool called
- [ ] "Stay safe" message
- [ ] "I will certainly call back within fifteen minutes" (NOT "5-15 minutes" or "five one five")
- [ ] Says "Have a good day" (NOT "Bye")
- [ ] No "Anything else?" (safety first, end fast)
- [ ] end_call(urgent) called

---

### TC-U02 — Gas smell

| Field | Value |
|---|---|
| **Trade** | gas (or general safety) |
| **Urgency** | CRITICAL (life safety) |
| **Expected decision** | urgent |

**You say:**
> "I smell gas in my house, it's really strong!"

**Expected AI flow:**
- *Stay safe. Open windows, leave the house, call 911. I will certainly call you back. Have a good day.* [end_call urgent]

**Pass criteria:**
- [ ] AI mentions "open windows"
- [ ] AI mentions "leave the house" or "get out"
- [ ] AI mentions "call 911"
- [ ] flag_urgent called
- [ ] No "Anything else?"
- [ ] 911 explicitly spoken (not "nine eleven" or "nine-one-one" misread)

---

### TC-U03 — Whole house power loss

| Field | Value |
|---|---|
| **Trade** | electrical |
| **Urgency** | HIGH (safety + comfort) |
| **Expected decision** | urgent |

**You say:**
> "The whole house lost power and we don't know why."

**Expected AI flow:**
- *Stay safe. I will certainly call back within fifteen minutes. Have a good day.* [end_call urgent]

**Pass criteria:**
- [ ] flag_urgent called
- [ ] No zip question (urgent takes priority)
- [ ] end_call(urgent) within 15 seconds

---

## Group C — Out of Scope (3)

**3 cases.** Polite decline + recommend alternatives.

---

### TC-OS01 — Termites

**You say:**
> "I have termites in my house, can you help?"

**Expected AI flow:**
- *Sorry, pest control is outside our scope. Try a pest control service. Anything else?*
- (you: "No thanks.")
- *Take care. Have a good day.* [end_call rejected]

---

### TC-OS02 — Pool / spa

**You say:**
> "My pool pump is broken, can you fix it?"

**Expected AI flow:**
- *Sorry, that's outside our scope. Try a pool service. Anything else?*
- (you: "Okay thanks.")
- *Take care. Have a good day.* [end_call rejected]

---

### TC-OS03 — Standalone IT / network

**You say:**
> "I need help setting up my home WiFi network."

**Expected AI flow:**
- *Sorry, that's outside our scope. Try an IT guy. Anything else?*
- (you: "No.")
- *Take care. Have a good day.* [end_call rejected]

---

## Group D — Out of Service Area (3)

**3 cases.** Zip code > 25mi from Bellaire. Polite decline.

---

### TC-OSA01 — Dallas (75201)

**You say:**
> "Need someone to fix my water heater. I'm in 75201, Dallas."

**Expected AI flow:**
- *Outside our twenty-five-mile Houston service area. Try a local contractor. Anything else?*
- (you: "No thanks.")
- *Take care. Have a good day.* [end_call rejected]

**Pass criteria:**
- [ ] "twenty-five-mile" spoken as words (NOT "25 mile")
- [ ] Recommends local contractor

---

### TC-OSA02 — San Antonio (78201)

**You say:**
> "I have a small drywall hole, I'm in San Antonio, 78201."

**Expected AI flow:**
- *Outside our twenty-five-mile Houston service area. Try a local contractor. Anything else?*
- (you: "Okay.")
- *Take care. Have a good day.* [end_call rejected]

---

### TC-OSA03 — Austin (78701)

**You say:**
> "I need some electrical work, in 78701 Austin."

**Expected AI flow:**
- *Outside our twenty-five-mile Houston service area. Try a local contractor. Anything else?*
- (you: "OK thanks.")
- *Take care. Have a good day.* [end_call rejected]

---

## Group E — Customer Behavior (3)

---

### TC-B01 — Wants to talk to a real person

**You say:**
> "I need to talk to a real person, not a bot."

**Expected AI flow:**
- *No problem. I will certainly call you back. Have a good day.* [end_call unsure]

**Pass criteria:**
- [ ] AI doesn't get defensive
- [ ] No questions (zip / time / etc.)
- [ ] flag_uncertain + end_call(unsure)

---

### TC-B02 — Rude / impatient

**You say (aggressive tone):**
> "Look, I don't have time for this. Just tell me if you can come TODAY or not. I'm at 77003."

**Expected AI flow:**
- (AI stays calm, gives straight answer)
- *Yes, in service. 77003 is covered. When works today, morning or afternoon?*

**Pass criteria:**
- [ ] AI doesn't get defensive
- [ ] AI doesn't apologize excessively
- [ ] AI still confirms service area + offers time
- [ ] Tone: calm, professional, direct

---

### TC-B03 — Can't understand (mumbling / bad audio)

**You say (mumbled / unclear):**
> "Uhhh... my... uhh... [mumble mumble]... thing in the... [mumble]"

**Expected AI flow:**
- (AI asks for clarification once, then flag_uncertain)
- *Sorry, I didn't quite catch that. Could you say that again?*
- (if still unclear) → *Let me check on this. I will certainly call you back shortly.* [end_call unsure]

**Pass criteria:**
- [ ] AI asks for clarification ONCE (not multiple times)
- [ ] If still unclear → flag_uncertain + callback
- [ ] Doesn't guess or hallucinate info

---

## Group F — Multiple Issues in One Call (2)

---

### TC-M01 — Kitchen sink + TV mount

**You say:**
> "I have two things: a kitchen sink leak AND a TV I need mounted. 77005."

**Expected AI flow:**
- (AI may take them as 2 work orders, or just 1 with both items)
- *Got it. Plumbing for sink leak, TV mounting. In service. Trip eighty-nine covers both. Plumbing one-twenty to five hundred, TV mounting eighty-nine to two hundred. Total around three to eight-eighty-nine. When works?*
- (you: "Tomorrow morning, Mike, 713-555-0100")
- *Got it, Mike. I will certainly call to follow up. Anything else?*
- (you: "No.")
- *Take care, Mike. Have a good day.* [end_call accepted]

**Pass criteria:**
- [ ] AI addresses both issues (not just first one)
- [ ] Single trip fee (not double)
- [ ] Combined price range

---

### TC-M02 — Drywall + paint touch-up (related)

**You say:**
> "I have water damage in my ceiling. Need drywall patched and then a small paint touch-up. 77006."

**Expected AI flow:**
- *Got it, in service. Drywall repair for the damage, then paint touch-up. Trip eighty-nine. Drywall one-fifty to eight hundred, painting two hundred to fifteen hundred. Total around four-forty to twenty-five-eighty-nine. When works?*
- (you: "This Saturday, Alex, 832-555-1234")
- *Got it. I will certainly call to follow up. Anything else?*
- (you: "No.")
- *Take care. Have a good day.* [end_call accepted]

---

## Group G — Sub-coordinated Services (2)

**These are "in scope" but Alex coordinates with partners. AI should say "we coordinate" rather than just "no".**

---

### TC-S01 — Roof leak (we coordinate)

**You say:**
> "I have a roof leak, water coming in through the ceiling when it rains."

**Expected AI flow:**
- *Got it, in service. We can coordinate that with a trusted partner. I come for the eighty-nine, partner gives the rest of the quote. When works?*
- (you: "Tomorrow morning, Mark, 713-555-0123")
- *Got it, Mark. I will certainly call to follow up. Anything else?*
- (you: "No.")
- *Take care, Mark. Have a good day.* [end_call accepted]

**Pass criteria:**
- [ ] AI doesn't say "we don't do roofing" (we DO coordinate)
- [ ] Mentions "partner" or "coordinate"
- [ ] Trip fee still $89

---

### TC-S02 — Gas line install (we coordinate)

**You say:**
> "Need a new gas line run to my kitchen for a new stove. 77005."

**Expected AI flow:**
- *Got it, in service. We coordinate gas work with a licensed partner. I come for the eighty-nine, partner quotes the rest. When works?*
- (you: "Friday morning, Sarah, 713-555-0142")
- *Got it, Sarah. I will certainly call to follow up. Anything else?*
- (you: "No thanks.")
- *Take care, Sarah. Have a good day.* [end_call accepted]

---

## Group H — Time-sensitive (2)

---

### TC-T01 — Needs service today (urgent-ish but not emergency)

**You say:**
> "My kitchen faucet has been dripping for a week and it's getting worse. Can someone come TODAY? 77005."

**Expected AI flow:**
- *77005, in service. Dripping is not an emergency but we can usually fit same-day. What time today — morning or afternoon?*
- (you: "Afternoon, Mark, 713-555-0100")
- *Got it, Mark. I will certainly call to follow up. Anything else?*
- (you: "No.")
- *Take care, Mark. Have a good day.* [end_call accepted]

**Pass criteria:**
- [ ] Not flagged urgent (it's not an emergency)
- [ ] But same-day accommodated

---

### TC-T02 — Wants to schedule 2 weeks out

**You say:**
> "I want to schedule a paint job for 2 weeks from now. 77006."

**Expected AI flow:**
- *Got it, in service. Painting runs two hundred to fifteen hundred. Total around two-eighty-nine to sixteen-eighty-nine. What day in two weeks?*
- (you: "How about the 19th?")
- *Got it. What's your name and callback number?*
- (you: "Lisa, 832-555-0199")
- *Got it, Lisa. I will certainly call to follow up. Anything else?*
- (you: "No thanks.")
- *Take care, Lisa. Have a good day.* [end_call accepted]

---

## Group I — Vague / Clarify (2)

---

### TC-V01 — Super vague

**You say:**
> "I have a problem at my house."

**Expected AI flow:**
- (AI needs to clarify what's wrong)
- *Sorry, can you tell me more? What kind of issue?*

**Pass criteria:**
- [ ] AI asks for clarification
- [ ] Doesn't guess or hallucinate

---

### TC-V02 — Just asking about hours / price (no service)

**You say:**
> "What are your hours?"

**Expected AI flow:**
- *Monday to Saturday eight to five, Sunday nine to three.*

**Pass criteria:**
- [ ] Hours: Mon-Sat 8-5, Sun 9-3
- [ ] No zip question
- [ ] No price question
- [ ] Doesn't end the call (customer might have more questions)

---

## Group J — Wrong Number / No Show (2)

---

### TC-W01 — Wrong number

**You say:**
> "Oh sorry, wrong number. Bye."

**Expected AI flow:**
- *No problem. Have a good day.* [end_call]

**Pass criteria:**
- [ ] AI doesn't get offended
- [ ] Quick end
- [ ] Friendly closing

---

### TC-W02 — Silent for 10s then hangs up

**You say (silence for 10+ seconds):**

**Expected AI flow:**
- (After ~5s of silence, AI prompts)
- *Hello, you still there?*
- (still silence, then Vapi silenceTimeoutSeconds=20 kicks in)
- (Call ends)

**Pass criteria:**
- [ ] AI prompts after 5s of silence
- [ ] Doesn't keep talking into void
- [ ] Vapi ends call cleanly

---

## Summary Table

| # | ID | Category | Trade | Zip | Expected |
|---|---|---|---|---|---|
| 1 | TC-001 | Regular | plumbing | 77005 | accepted |
| 2 | TC-002 | Regular | electrical | 77030 | accepted |
| 3 | TC-003 | Regular | tv_mounting | 77450 | accepted |
| 4 | TC-004 | Regular | painting | 77584 | accepted |
| 5 | TC-005 | Regular | smart_home | 77006 | accepted |
| 6 | TC-006 | Regular | plumbing | 77401 | accepted |
| 7 | TC-007 | Regular | furniture_assembly | 77002 | accepted |
| 8 | TC-008 | Regular | drywall | 77489 | accepted |
| 9 | TC-009 | Regular | fence_deck | 77479 | accepted |
| 10 | TC-010 | Regular | electrical | 77019 | accepted |
| 11 | TC-U01 | Urgent | plumbing | n/a | urgent |
| 12 | TC-U02 | Urgent | gas | n/a | urgent + 911 |
| 13 | TC-U03 | Urgent | electrical | n/a | urgent |
| 14 | TC-OS01 | Out of scope | pest | n/a | rejected |
| 15 | TC-OS02 | Out of scope | pool | n/a | rejected |
| 16 | TC-OS03 | Out of scope | IT | n/a | rejected |
| 17 | TC-OSA01 | Out of service area | plumbing | 75201 (Dallas) | rejected |
| 18 | TC-OSA02 | Out of service area | drywall | 78201 (SA) | rejected |
| 19 | TC-OSA03 | Out of service area | electrical | 78701 (Austin) | rejected |
| 20 | TC-B01 | Customer behavior | wants person | n/a | unsure |
| 21 | TC-B02 | Customer behavior | rude / impatient | 77003 | accepted |
| 22 | TC-B03 | Customer behavior | mumble / unclear | n/a | unsure |
| 23 | TC-M01 | Multiple issues | plumbing + tv | 77005 | accepted |
| 24 | TC-M02 | Multiple issues | drywall + painting | 77006 | accepted |
| 25 | TC-S01 | Sub-coordinated | roofing | n/a (77005) | accepted |
| 26 | TC-S02 | Sub-coordinated | gas | 77005 | accepted |
| 27 | TC-T01 | Time-sensitive | plumbing same-day | 77005 | accepted |
| 28 | TC-T02 | Time-sensitive | painting 2 weeks out | 77006 | accepted |
| 29 | TC-V01 | Vague | "I have a problem" | n/a | clarify |
| 30 | TC-V02 | Vague | just asking hours | n/a | answer |
| 31 | TC-W01 | Wrong number | n/a | n/a | quick end |
| 32 | TC-W02 | No show | n/a | n/a | timeout end |

(32 total — 10 regular + 22 other)

---

## Scoring Sheet

For each call, score 1-5 on:

| Dimension | 1 (bad) | 5 (good) |
|---|---|---|
| **Decision correctness** | Wrong outcome | Right outcome + right tool |
| **Response length** | > 25 words/turn | ≤ 15 words/turn |
| **TTS quality** | "five one five" / "thousand" glitches | All numbers clean |
| **Tone** | Robotic / defensive / filler | Texas-friendly, direct |
| **Closing** | Skipped "Anything else?" / said "Bye" | Asked, then "Have a good day" |

**Target total per call: ≥ 22/25**

---

## Common failure modes to watch for

- [ ] AI uses "Alex will call" instead of "I will certainly call to follow up"
- [ ] AI says "Bye" instead of "Have a good day" / "Cheers"
- [ ] AI hangs up without "Anything else?" (except urgent)
- [ ] AI says "5-15" or "120" instead of spelled-out
- [ ] AI inserts "thousand" between numbers
- [ ] AI says a Chinese word such as "daigai" (roughly) or other Chinese words (TTS misreads)
- [ ] AI asks for zip in urgent scenarios
- [ ] AI says "outside our scope" for things we coordinate (roofing, gas, panel, central AC)
- [ ] Customer from wrong country routes to wrong boss (should be fixed — verify)

---

## After running all 32 cases

Report back with:
1. Pass/fail per case
2. Any TTS glitches (with exact AI output)
3. Score averages per dimension
4. Top 3 issues to fix in next prompt iteration
5. Whether to greenlight for H-Master (or H-Master's first MY client)
