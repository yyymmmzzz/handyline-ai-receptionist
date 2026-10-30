# H-Master Demo Go-Live Checklist (MY / Bintulu)

**To:** H-Master Security Services Team
**From:** HandyLine AI Product Group
**Goal:** Complete the H-Master phase 1 demo go-live by the end of August
**Last updated:** 2026-08-24

> This whole checklist is split into 4 parts: ① Business information ② Real testing ③ Recording & compliance ④ Post-launch follow-up.
> 【Required】 / 【Recommended】 / 【Optional】  (marked by priority)
> Once you provide them we will fill them into the HandyLine AI system, and the AI will "know" your business and answer calls correctly.

---

## I. Business Information (【Required】 Must be fully provided before the AI can answer calls normally)

### 1.1 Company Contacts

| Item | Purpose | Priority |
|---|---|---|
| **Owner / main decision-maker** full name | So the AI knows who to contact when calling back an urgent work order | 【Required】 |
| **Owner's mobile number** (+60 1x-xxxxxxxx) | The AI calls it directly in an emergency | 【Required】 |
| **WhatsApp number** (same as the mobile number or a different one) | Where the owner views summaries / recordings | 【Required】 |
| **Owner's email** | Daily / weekly reports | 【Required】 |
| **Backup technician** name + mobile | A human takes over when the AI cannot answer | 【Recommended】 |
| **Receptionist / customer service** name + mobile (takes orders outside working hours) | Who calls are transferred to during business hours | 【Optional】 |

> Contact details are stored only in our back office; when the AI answers a call it will **not** read out your private mobile number to the customer.

### 1.2 Price List (by trade)

Below are the placeholder values we have set so far — **please verify and amend them**:

| Service | Starting price (RM) | Premium price (RM) | Notes |
|---|---|---|---|
| On-site inspection fee (trip fee) | 89 | 89 | Fixed per visit |
| Alarm service / install | 200 | 1,500 | |
| CCTV service / install | 500 | 3,000 | Depends on the number of cameras? |
| Automated gate service / install | 500 | 2,500 | |
| Access control service / install | 300 | 1,500 | |
| Smart door lock (Samsung etc.) | 300 | 2,000 | |
| PA / public address system | 200 | 2,000 | |
| Comprehensive security package (security audit) | 500 | 5,000 | |

We need you to confirm:
- [ ] Are the 8 price ranges above realistic?
- [ ] Are there any missing services? For example intercom, access control for condo, gate sensor?
- [ ] How much is the surcharge for rush jobs / out-of-hours work? (Currently we have set no surcharge)
- [ ] How is the quote adjusted for travel to 93xxx (Kuching) / 98xxx (Miri)?

### 1.3 Service Coverage

- [ ] Confirm the main service area is **Bintulu + surrounding 50km**?
- [ ] Do you accept jobs in **93xxx (Kuching) / 98xxx (Miri)**? What is the quoting strategy?
- [ ] Do you accept jobs in **West Malaysia (KL / PJ / Penang)**? The system currently rejects them
- [ ] What is the travel fee calculation rule? (Per kilometer? A flat amount?)

### 1.4 Business Hours

Currently set as:
- Monday-Friday 8:00 – 17:30
- Saturday 8:00 – 13:00
- Sunday / public holidays closed

To be confirmed:
- [ ] Do you close on public holidays? Which ones? (Hari Raya, Chinese New Year, Wesak Day, National Day, Sarawak Day, Malaysia Day…)
- [ ] Outside working hours (outside business hours), how do you want the AI to handle the call?
  - Option A: take a message only + call back the next day
  - Option B: for an urgent work order, immediately call the owner's mobile
  - Option C: do both (depending on the situation)

### 1.5 Customer Whitelist / Blacklist

- [ ] **VIP customer** (existing customer, key account) numbers — when these customers call in, the AI will say "welcome back" and pull up the history
- [ ] **Blacklisted numbers** (outstanding payments, disputes, harassment) — these numbers go straight into the "do not answer" flow
- [ ] **Competitor / supplier** (the ones you will call) numbers — these numbers are not counted as customers

> All of the above is **optional**. If they are not provided, every incoming call is treated as a "new customer".

### 1.6 Urgent Work Order Trigger Conditions

The scenarios the AI currently flags as "urgent" (please confirm / modify / add or remove):

- [ ] Alarm triggered + nobody home (the alarm goes off while no one is home)
- [ ] All CCTV at a shop loses power
- [ ] Automated gate is stuck and cannot open / stays open all the time
- [ ] Access control completely fails (on Monday morning staff cannot get through the door)
- [ ] Suspected break-in
- [ ] Bank / jewellery store / key customer with 24/7 alarm monitoring

> After the AI flags an emergency it will **call the owner directly within 10 seconds** (not just send a push notification). So please be careful when defining the "urgent" conditions.

---

## II. Real Testing (【Required】 Must be completed — the last step before the demo go-live)

### 2.1 Provide Test Numbers

- [ ] **5-10 mobile numbers** (your team / friends / family members are all fine) — we will **really call** these numbers to the new +60 number to verify that the AI answers correctly
- [ ] These numbers should **not** be existing H-Master customers (to avoid mistaking them for real customers)
- [ ] We have also prepared some **demo scripts** (see below); each call is assigned one script

### 2.2 Recommended Test Scripts (10 calls)

We suggest the H-Master team **listen to the AI answer first, then score**:

| # | Script | Key point to verify |
|---|---|---|
| 1 | "My home alarm keeps beeping, please come and check it" | Normal accepted work order |
| 2 | "Half of my CCTV cameras show no picture" | Technical diagnostic capability |
| 3 | "My automated gate is stuck half open, there is a blockage at the factory entrance" | Urgent + outbound call to the owner |
| 4 | "Can you install a Samsung smart lock? How much?" | Price enquiry + recommendation |
| 5 | "I am in Kuching, can you come and install it?" | Polite refusal for out-of-area requests |
| 6 | "I want to replace my entire home security system" | Large order / comprehensive package |
| 7 | "Do you use alarms for cars?" | Refusal for out-of-scope requests |
| 8 | "Is the owner there? I am his friend" | Whitelist handling (if a whitelist is provided) |
| 9 | "Manglish-style customer: "Kau ada CCTV tak? " | STT multilingual capability |
| 10 | "I want your H-Master quotation" | FAQ hit rate |

### 2.3 Scoring Dimensions (score 1-5 after each call)

- [ ] Did the AI understand the problem the customer described? (speech recognition accuracy)
- [ ] Are the questions the AI asked reasonable (no key information missed)?
- [ ] Are the prices / decisions given by the AI consistent with the H-Master business?
- [ ] Does the AI's tone / wording sound like a local receptionist?
- [ ] Did emergency situations correctly trigger the outbound call to the owner?

### 2.4 Test Time Window

- [ ] H-Master assigns **1-2 people** to be present at the test site throughout, **uninterrupted for at least 2 hours**
- [ ] The owner's mobile stays switched on (to test urgent outbound calls)
- [ ] After the test we provide: call recordings + AI auto-summary + score summary

---

## III. Recording & Compliance (【Required】 Mandatory / 【Recommended】 Strongly recommended)

### 3.1 Recording Consent (PDPA 2010 - mandatory)

- [ ] **H-Master terms of service** template: telling the customer "calls may be recorded for quality assurance"
- [ ] The AI opening line will say "This call may be recorded for quality, ok." (already written into the system prompt)
- [ ] Are **multilingual versions** needed? (English / Malay / Chinese / Iban)

### 3.2 Recording Storage

- [ ] Recordings are stored in our Supabase for 30 days by default and are deleted automatically after 30 days
- [ ] Does H-Master require a shorter / longer retention period?
- [ ] If a customer calls and says "please delete my recording", the process is:
  - [ ] Option A: the AI answers "OK, noted, will be deleted within 24 hours", then the owner confirms with the customer via WhatsApp
  - [ ] Option B: the AI answers "OK, transferring to the owner immediately"

### 3.3 Customer Data Usage

- [ ] Call content will **not** be used to train the AI of other customers (each boss has an independent prompt)
- [ ] Is H-Master allowed to use recordings internally for staff training?
- [ ] Do the recordings need to be anonymised (customer name / phone number removed)?

---

## IV. Post-Launch Follow-up (【Recommended】 Recommended / 【Optional】 Optional)

### 4.1 First Week

- [ ] We send a **summary of the previous day's calls** every day (calls answered / decision breakdown / urgent work orders)
- [ ] H-Master reviews the **work orders pending the owner's confirmation** once a day (using mobile EMS or web)
- [ ] Any question the AI answered wrong should be **written down** and sent to us; we update the prompt within 3 days

### 4.2 Customer Case Study Material

- [ ] One month after go-live, can you provide 1-2 **real customer success cases** (anonymised)?
- [ ] **Photo + short bio** for the H-Master owner / technicians (for the "Our Team" page)
- [ ] **High-resolution company logo source file** (PNG / SVG, transparent background)
- [ ] 2-3 **on-site work photos** (iconic H-Master work scenes)

### 4.3 Joint Promotion

- [ ] Do you allow us to write "H-Master is our first Malaysian customer" on the HandyLine AI website / in investor materials?
- [ ] Are you willing to make **short videos / customer interviews** together?
- [ ] Is H-Master's existing Facebook page (100063539318730) willing to tag each other (@)?

### 4.4 Long-Term Features (discussed later)

- [ ] Multiple boss accounts (H-Master has 2-3 owners / salespeople, do they need to log in separately?)
- [ ] Multilingual (Chinese / English / Malay / Iban)
- [ ] Automatic outbound follow-up calls to customers (30 days later asking "is the alarm we fixed last time still working?")
- [ ] H-Master WhatsApp Business integration

---

## Timeline Recommendation for H-Master

| Phase | Content | Duration | Owner |
|---|---|---|---|
| Preparation | Provide all the materials in 1.1 - 1.6 | 2-3 days | H-Master |
| Configuration | We write them into the system prompt + tools + boss configuration | 1 day | Us |
| Recording | The owner records a 1-2 minute voice sample → ElevenLabs clone | 1-2 days | H-Master + Us |
| Number | Vapi buys a +60 number + binds the MY assistant | 1 day | Us |
| Internal testing | We self-test with 5 scripts first | 1 day | Us |
| **Live device testing** | **H-Master team tests with 10 scripts** | **1 day** | **H-Master + Us** |
| Tuning | Fix the prompt based on the test results | 1-2 days | Us |
| Official go-live | Switch to the live number, the owner starts answering calls | 1 day | Together |
| First week | Daily review + collecting issues | 7 days | H-Master |
| One-month review | Call data review + adjusting pricing / service coverage | 1 day | Together |

**Total effort: ~3 weeks**

---

## How to Submit the Materials

Please package all the materials (contacts / pricing / FAQ / voice samples) and send them to:

📧 **handyline@bookloh.com** (or the email you provide)

Or fill in this online form (we will send the link once it is built):
- Contact information
- Price list
- Business hours / holidays
- Urgent work order rules
- Whitelist / blacklist
- FAQ list

Voice samples (1-2 minute mp3/wav) can be sent via:
- WhatsApp to our point of contact
- Or upload to Google Drive and share the link

---

**Ask us anything!** We will work with you through every stage.
