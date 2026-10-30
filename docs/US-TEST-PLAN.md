# US Demo (Alex) — End-to-End Test Plan

**Goal:** Verify how the new, "more direct" AI receptionist performs on real calls
**Test environment:** Vapi assistant `42523b3e-...` + Vercel deployment `https://demo-navy-chi-47.vercel.app/`
**Test phone:** US +1 724 362 0422 (Alex's Vapi number)

---

## Prerequisite steps

### 0.1 Redeploy on Vercel (important)

The previous Vercel project may be in a paused state (a leftover from when the private repo was changed to public).

**Steps:**
1. Open https://vercel.com/dashboard
2. Find the `demo` project
3. If it shows "Paused": click the **Resume** button
4. Wait 1-2 minutes for the URL to come back

**Verify:**
```bash
curl -sI https://demo-navy-chi-47.vercel.app/ | head -2
# you should see HTTP/2 200
```

### 0.2 Prepare the test equipment

- 1 phone (to call the Vapi number)
- 1 computer (to watch the live stats at /api/admin/llm-stats)
- 1 stopwatch (to measure call duration manually)

### 0.3 Tools

- **AI receptionist:** +1 (724) 362-0422
- **Watch the live dashboard:** https://demo-navy-chi-47.vercel.app/?country=us
- **Watch the LLM stats:** https://demo-navy-chi-47.vercel.app/api/admin/llm-stats (header: `x-admin-token: dev-secret`)

---

## Test goals

Score each call immediately after it ends (5-point scale):

| Dimension | 1 point | 5 points |
|---|---|---|
| Call duration | > 60 seconds | < 30 seconds |
| AI response sentences | > 4 sentences | ≤ 2 sentences |
| Words per sentence | > 25 words | ≤ 15 words |
| Polite filler | "Sure thing" etc. | 0 |
| Info collection | misses zip / time / name | everything captured |
| Price given | only at the end of the call | given as soon as the ZIP is verified |
| Correct decision | wrong | correct |

**Target total score ≥ 30/35 (pass on every call)**

---

## 5 test scripts

### Script 1: Normal accepted (leaking water pipe)

**Call script:**
```
You: Hi, I have a kitchen sink that's leaking
AI:[should say within 5 seconds "What's your zip."]
You: 77005
AI:[should immediately say "77005, in service. Trip $89, plumbing $150-400, total approximately $240-490. When works — morning or afternoon? Name + number?"]
You: Tomorrow morning. Mike, 713-555-0100
AI:[should immediately say "Got it, Mike. Alex calls to confirm. Bye." then end_call]
```

**Expected results:**
- Call duration: < 30 seconds
- AI sentence count: 3 sentences (sentence 1 asks for the zip, sentence 2 gives the price + asks for the time + name, sentence 3 ends the call)
- Decision: accepted
- Dashboard: 1 new work order, customer_name=Mike, issue_type=plumbing

**Score:**
- Call duration ____ seconds
- AI sentence count ____
- Score ____/35

---

### Script 2: Emergency urgent (main pipe burst)

**Call script:**
```
You: My pipe just burst! Water everywhere in my kitchen!
AI:[should immediately say "Stay safe. Alex calls back in 5-15 minutes. Bye." then flag_urgent + end_call]
```

**Expected results:**
- Call duration: < 15 seconds
- AI sentence count: 1-2 sentences
- Decision: urgent
- Your phone will receive the AI's emergency outbound call within 30 seconds (+1 512 712 6713)
- Dashboard: 1 work order with ai_decision=urgent

**Score:**
- Call duration ____ seconds
- Emergency outbound call received? ____
- Score ____/35

---

### Script 3: Gas smell (highest-level emergency)

**Call script:**
```
You: I smell gas in my house! It's strong!
AI:[should immediately say "Open windows, leave the house, call 911. Alex calls back. Bye." then flag_urgent + end_call]
```

**Expected results:**
- The AI must give the "open windows + 911" safety instruction
- Call duration: < 15 seconds
- Decision: urgent
- Emergency outbound call + SMS to you

**Score:**
- AI mentioned 911? ____
- AI mentioned opening the windows? ____
- Score ____/35

---

### Script 4: Outside the service area (Dallas)

**Call script:**
```
You: Hey, I need someone to fix my water heater. I'm in 75201 (Dallas).
AI:[should immediately say "Outside our 25 mile Houston radius. Try a local contractor. Anything else?" then end_call]
```

**Expected results:**
- Call duration: < 20 seconds
- AI sentence count: 1-2 sentences
- Decision: rejected
- Reason: the zip is outside the service area

**Score:**
- AI explicitly said "outside our service area"? ____
- AI recommended someone else? ____
- Score ____/35

---

### Script 5: out-of-scope (pest control)

**Call script:**
```
You: I have termites in my house. Can you help?
AI:[should say "Sorry, pest control is outside our scope. Try a pest control service. Have a good day." then end_call]
```

**Expected results:**
- Call duration: < 20 seconds
- AI sentence count: 1-2 sentences
- Decision: rejected
- Reason: the trade is not on the list

**Score:**
- AI declined politely? ____
- Recommended another service? ____
- Score ____/35

---

### Script 6 (bonus): wants a real person

**Call script:**
```
You: I need to talk to a real person, not a bot.
AI:[should say "No problem, Alex will call you back. Thanks for your patience." then flag_uncertain + end_call]
```

**Expected results:**
- Call duration: < 15 seconds
- Decision: unsure
- Alex receives the callback notice

---

## Score summary table

| Script | Target duration | Actual duration | AI sentence count | Decision | Total score |
|---|---|---|---|---|---|
| 1. Leak | < 30s | | | accepted | /35 |
| 2. Burst | < 15s | | | urgent | /35 |
| 3. Gas | < 15s | | | urgent | /35 |
| 4. Dallas | < 20s | | | rejected | /35 |
| 5. Pest | < 20s | | | rejected | /35 |
| 6. Real person | < 15s | | | unsure | /35 |

---

## 4 things to do after scoring

1. **Screenshot the dashboard row of each call** (confirm that the data was written)
2. **Note where the AI got it right/wrong**
3. **Check the LLM cost at /api/admin/llm-stats** (it should be lower than before, because gpt-4o-mini is used)
4. **Listen to the emergency outbound call recording** (if you received one)

---

## Troubleshooting

### Is the AI response too long?

→ Check whether `maxTokens` in Vapi is 80. `scripts/update-vapi-assistant.js` will PATCH this value.

### Did the AI end_call without giving a price?

→ Check whether end_call happened before the ZIP. Restart the conversation and start over from the ZIP.

### Did the emergency outbound call not arrive?

→ 1) Check whether the Vapi assistant `serverUrl` is `https://demo-navy-chi-47.vercel.app/api/vapi/tools`  2) Check whether the Vercel project is running  3) Check whether your emergency phone number +1 512 712 6713 can be reached during working hours

### Is the Dashboard not showing the new calls?

→ 1) Check /api/admin/llm-stats for LLM call records  2) Check the Supabase work_orders table  3) Check whether the webhook arrived (look at the Vercel logs)

---

## Recording playback

The recording of every call is automatically saved to Supabase Storage. How to view it:

1. Dashboard → click the work order row → open the detail page
2. Query it directly: https://demo-navy-chi-47.vercel.app/orders/[id]

---

## Tell me when the full test run is done

- The total score of the 6 calls
- Which scripts the AI did well on
- Which ones need the prompt tuned
- Whether the emergency outbound call really came through
- Average call duration (vs the old 60-90 seconds)

I'll tune the prompt for version 2 based on the results (if needed), and then H-Master can do a real test.
