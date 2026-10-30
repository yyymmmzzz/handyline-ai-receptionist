# US Demo (Alex / Handy Works Home Services) — "More Direct" Overhaul Plan

**Author:** Mavis · **Date:** 2026-08-29 · **Status:** Plan
**Target customer:** Alex's Handy Works Home Services (Bellaire TX, handyman + light home services)
**Goal:** AI receptionist that captures issue + price in **< 30 seconds**, every response **≤ 15 words**

---

## Current Issues (based on existing system-prompt.md)

After reading `vapi/system-prompt.md`, 5 inefficiencies:

| Issue | Current | Impact |
|---|---|---|
| **Responses too long** | 1-2 sentences (25-40 words) per turn | Higher hang-up rate |
| **Too much filler** | "Sure! I'd be happy to help" / "I can definitely assist with that" | Wastes 3-5 sec/turn |
| **Questions in series** | 1 per turn: issue → zip → details → time → name | 5 turns × 6 sec = 30 sec |
| **Price comes too late** | Usually 3-4 turns in | Customer already impatient |
| **Scope vague** | "We do plumbing" (doesn't define what's IN plumbing) | AI gives wrong answer when out of scope |

---

## Part 1 — Voice "More Direct" 5 Changes

### 1.1 Rewrite prompts: each sentence ≤ 15 words

**Before:**
> "Sure, I can definitely help you with that. What kind of issue are you having with the plumbing today?"

**After:**
> "Plumbing issue? What's the problem."

**Rules:**
- 1 sentence per turn (max 2 in special cases)
- Each sentence ≤ 15 English words
- Strip all "Sure", "Of course", "I can", "Definitely", "I'd be happy to"
- Don't repeat what the customer just said
- No "thank you for calling" openings

### 1.2 First sentence gives info directly

**Before:**
> "Hey, this is Alex over at Handy Works Home Services. This call may be recorded for quality. How can I help you today?"

**After:**
> "Handy Works, Alex speaking. What's the issue."

**Why:** Customer decides in 1 second whether to keep listening or hang up.

### 1.3 Parallel question collection

**Before (4 serial turns):**
```
AI: What's the issue?
User: Pipe leak
AI: Where are you? (zip)
User: 77005
AI: What time works?
User: Tomorrow morning
AI: Got it, name and callback?
```

**After (1-2 turns):**
```
AI: What's the issue + zip code?
User: Kitchen pipe leak in 77005
AI: [extract both] 77005, in service. Trip $89 + pipe work $150-400.
    Time tomorrow morning OK? Name + number?
User: Yes, Mike, 713-555-0100
AI: [end_call immediately]
```

**Rules:**
- Turn 1: ask "issue + zip" together (the 2 most important)
- Turn 2: give price + ask "time + name + number" together
- Turn 3: end_call

### 1.4 Give price early + with range

**Before:** AI gives price only after collecting all info
**After:** Once ZIP is verified, immediately: "Trip $89 + [trade] $XXX-XXX. Total roughly $YYY-ZZZ."

**Why:** Customers' top 3 questions are "Can you come / how much / how fast". If they don't hear a price in first 30 seconds, anxiety sets in.

### 1.5 Urgent / accepted → end_call immediately

**Before:**
> AI: OK got it, anything else I can help?
> User: No thanks
> AI: [end_call]

**After:**
> AI: [end_call immediately after customer confirms, no chit-chat]

**Why:** Saves 5-10 sec/call, ~10% Vapi cost reduction.

---

## Part 2 — Business flow compression

### 2.1 4 steps → 3 steps

| Old | New |
|---|---|
| 1. Identify issue | 1. Identify issue + zip (merged) |
| 2. Validate service area | 2. Validate + give price (merged) |
| 3. Ask time / name | 3. Ask all + end_call |
| 4. Confirm + end_call | |

**Target call duration:** from 60-90 sec → **< 30 sec**.

### 2.2 Vapi tool calls more aggressive

**Current 6 tools:**
- `check_trade` — immediate
- `validate_service` — after issue
- `get_price_quote` — after validate
- `flag_urgent` — emergency
- `flag_uncertain` — not sure
- `end_call` — end

**Issue:** Tools called serially = multiple LLM round-trips.

**Optimization:**
1. **Merge `check_trade` into `validate_service`**: 1 call checks trade + zip
2. **`get_price_quote` auto-follows**: when validate returns in_service, backend attaches price automatically — AI doesn't need to call

**New tool design:**
```
check_and_quote(issue_type, zip) → { in_trade, in_service, trip_fee, range_low, range_high, total_low, total_high }
```
1 call = check_trade + validate_service + get_price_quote combined.

### 2.3 Response delay to 0

Vapi settings:
- `responseDelaySeconds`: 0.5 → **0.3** (faster response)
- `llmRequestDelaySeconds`: 0.5 → **0.3**
- `silenceTimeoutSeconds`: 30 → **20** (ask after 20s silence)

### 2.4 Upgrade to gpt-4o-mini

`gpt-4o` is overkill for receptionist — **slow + expensive**.
- Switch to `gpt-4o-mini` (3-5× faster, 10× cheaper)
- `max_tokens`: 250 → **80** (enforce short replies)
- `temperature`: 0.3 → **0.2** (more stable)

---

## Part 3 — Alex business scope refinement

### 3.1 Already known (in system)

| Item | Value |
|---|---|
| Company | Handy Works Home Services |
| Owner | Alex |
| Address | 77401 Bellaire TX (just updated from website) |
| Service radius | 25 mile |
| Hours | Mon-Fri 8-6, Sat 9-3, Sun closed |
| Trip fee | $89 |
| Free distance | 15 mile |
| Surcharge | $2/mile |
| Trades | plumbing, electrical, hvac, handyman, painting, tv_mounting, furniture_assembly, smart_home, drywall, pressure_washing, fence_deck, window_covering, general |

### 3.2 MUST clarify "CAN DO" list (each goes into prompt)

#### Furniture Assembly ✅
- IKEA / flat-pack (beds, dressers, desks, bookshelves)
- Office furniture (cubicles, desks, conference tables)
- Patio / outdoor
- Exercise equipment (treadmills, ellipticals, weight benches)
- Disassembly / reassembly for moves

#### TV Mounting ✅
- TV mount + cable routing (clean look)
- Recommend or supply the right mount
- Soundbar mount, shelf for components

#### Smart Home ✅
- Smart locks (front, back, garage, pantry doors)
- Smart thermostats
- Doorbell cameras
- Security cameras (indoor/outdoor)
- Smart light fixtures
- Other smart home (basic)

#### Window Coverings ✅
- Drapes, roller shades, blinds, curtains
- Curtain rods / tracks
- Valance / cornice

#### Artwork ✅
- Spacing, leveling, alignment
- Home decor, family portraits, canvases
- We come with hooks, anchors, nails, screws

#### Painting (Indoor) ✅
- Touch-up → whole house
- Single room → accent walls
- Minimal disruption to daily routine
- Exterior (house, trim, fence) - per project

#### Electrical ✅
- Ceiling fan install / replace
- Light fixture install / replace
- Outlet / switch replacement
- GFCI outlets
- Doorbell / chime
- Small electrical projects

#### Plumbing ✅
- Faucet repair / replacement
- Toilet repair / replacement
- Sink install / replacement
- Pipe insulation
- Visible leak repair
- Water heater (electric tank only)
- Hose bib

#### Drywall ✅
- Water damage repair (ceiling, wall)
- Hole patching
- Crack repair
- Texture matching
- Demo + replacement

#### Outdoor ✅
- Pressure washing (house, driveway, deck, fence, rust)
- Fence & deck repair (partial + full build)
- Siding repair
- Door / window install (exterior)
- Weatherproofing
- Deck sealing / staining
- Heavy trash / junk removal

#### General ✅
- Honey-do lists
- TV mount
- Furniture moving (within home)
- Childproofing
- Misc handyman tasks

### 3.3 MUST clarify "CAN'T DO" list

#### ❌ Roofing
- Any shingle, flat roof, gutter
- → Refer to roofing partner

#### ❌ Gas
- Gas line, gas appliance
- → Refer to licensed gas tech (coordinate via us)

#### ❌ Pest control
- Termites, roaches, snakes, mice
- → Refer to pest control service

#### ❌ Foundation / structural
- Slab leaks, foundation, structural
- → Refer to structural engineer

#### ❌ Full renovation
- Kitchen / bath gut, room additions
- → Refer to general contractor

#### ❌ Standalone IT / networking
- WiFi setup, NAS, computer repair
- → Refer to IT guy

#### ❌ Pool / spa
- Maintenance, repair, install
- → Refer to pool service

#### ❌ Appliance repair
- Washer, dryer, fridge, dishwasher
- → Refer to appliance tech

### 3.4 Price range (generic — Alex to provide real)

| Trade | Low ($) | High ($) | Notes |
|---|---|---|---|
| plumbing | 120 | 500 | Faucet to full replacement |
| electrical | 120 | 500 | Switch to ceiling fan install |
| hvac | 150 | 600 | Repair to small install |
| handyman | 89 | 400 | Minimum job to full day |
| painting | 200 | 1500 | Touch-up to whole house |
| tv_mounting | 89 | 200 | Single TV to full setup |
| furniture_assembly | 89 | 250 | Single piece to multiple |
| smart_home | 150 | 600 | Single device to multi-room |
| drywall | 150 | 800 | Patch to full wall |
| pressure_washing | 150 | 600 | Driveway to whole house |
| fence_deck | 200 | 2000 | Repair to full build |
| window_covering | 100 | 400 | Single window to whole house |
| general | 89 | 500 | Minimum to half-day |

**Trip fee:** $89 (15 mile included; $2/mile beyond)

### 3.5 Urgent signal criteria (MUST clarify)

| Scenario | Urgent? | Action |
|---|---|---|
| Burst pipe, water everywhere | 🔴 URGENT | Customer shuts main valve |
| Whole house power loss (no reason) | 🔴 URGENT | Safety risk |
| Gas smell | 🔴 URGENT | **Open windows + 911** |
| Shop AC dead + inventory at risk | 🔴 URGENT | |
| Smoke, sparks | 🔴 URGENT | 911 first |
| Elderly / kids no hot water | 🟡 PRIORITY | Same-day if possible |
| Leak under control | 🟢 ROUTINE | Normal scheduling |
| Bulb out | 🟢 ROUTINE | Batch next visit |

### 3.6 FAQ (10-20 high-frequency, Alex provides)

See `ALEX-BUSINESS-QUESTIONNAIRE.md` section 9.

---

## Part 4 — Information needed from Alex

To fill Part 3 completely, we need (see `ALEX-BUSINESS-QUESTIONNAIRE.md` for full):

### 4.1 Required (without these, AI will make mistakes)

| # | Info | Who asks | Format |
|---|---|---|---|
| 1 | Real price list (per trade × complexity) | I help draft | Online form |
| 2 | Service radius in/out pricing | You send to Alex | Email |
| 3 | Owner mobile (urgent callback) | You | WhatsApp |
| 4 | Owner WhatsApp (work order summary) | You | |
| 5 | Urgent threshold confirmation (what counts as urgent) | Me | One call |
| 6 | Hours details (holidays / closures) | You | Email |

### 4.2 Recommended (make AI more accurate)

| # | Info |
|---|---|
| 7 | Common 10 questions + answers (FAQ) |
| 8 | Whitelist (old customers / VIP — skip AI) |
| 9 | Blacklist (debt / dispute) |
| 10 | Recording consent wording (PDPA / TX one-party) |

### 4.3 Optional (v2)

| # | Info |
|---|---|
| 11 | Owner real-voice recording (1-2 min mp3) |
| 12 | Holiday special hours |
| 13 | Seasonal peaks (hurricane season, winter freeze) |

---

## Part 5 — Implementation order (5 steps, 2-3 days)

### Step 1: Rewrite US system prompt (half day)

Stuff all of Part 1 + Part 3 into `vapi/system-prompt.md`:
- Each sentence ≤ 15 words
- 5 in-scope trade with sub-items
- 8 out-of-scope polite declines
- Price ranges given directly
- Urgent judgment table

**Deliverable:** New system-prompt.md
**Validation:** Read 3 scripts aloud to Vapi, listen to response length

### Step 2: Merge tools (half day)

Merge `check_trade` + `validate_service` + `get_price_quote` into `check_and_quote`:
- Modify `src/lib/validation.ts`
- Modify `vapi/assistant.json` tools
- Modify `src/app/api/vapi/tools/route.ts` `dispatchToolCall`
- Test

**Deliverable:** 6 tools → 4 tools

### Step 3: Vapi config optimization (30 min)

- Model: gpt-4o → **gpt-4o-mini**
- max_tokens: 250 → **80**
- temperature: 0.3 → **0.2**
- responseDelaySeconds: 0.5 → **0.3**
- llmRequestDelaySeconds: 0.5 → **0.3**
- silenceTimeoutSeconds: 30 → **20**

**Deliverable:** New assistant config

### Step 4: Run `update-vapi-assistant.js` (5 min)

PATCH new prompt + tools + config to Vapi.

### Step 5: Live test 3 rounds (half day)

3 test scripts:
1. **Normal accepted**: "Water heater not heating, 77005, morning"
2. **Urgent**: "Pipe burst, water everywhere!"
3. **Out-of-scope**: "I need my roof fixed"

Each round record:
- AI response length (word count)
- Total call duration (seconds)
- Decision correctness

**Target: < 30 sec call, < 15 words/sentence**

---

## Part 6 — Impact estimate

| Metric | Old | New (estimated) |
|---|---|---|
| Average call duration | 60-90s | 25-40s |
| Hang-up rate (within 30s) | ~15% | ~5% |
| AI response word count | 20-30/turn | 8-15/turn |
| Decision error rate | ~8% | ~3% |
| Vapi per-call cost | $0.10 | $0.06 |

---

## 3 things to confirm with you

1. **Part 3 scope accuracy** — e.g. really NOT do roofing? Or coordinate?
2. **Part 4 info** — can you get from Alex, or do I draft the questionnaire?
3. **Part 5 all 5 steps** — or just 1-3 first (the ones not depending on Alex data)?

Confirm and I start rewriting `vapi/system-prompt.md`.
