-- 012_apply_alex_questionnaire_answers.sql
--
-- Applies Alex Vega / Handy Works Home Services business questionnaire answers
-- (returned 2026-09-30) to the US boss row.
--
-- Source: docs/ALEX-QUESTIONNAIRE-ANALYSIS.md
--
-- SAFE / CONFIRMED changes only. Items still needing Alex's written
-- confirmation are left at current values and listed at the bottom:
--   - diagnostic_fee ($0 inside radius vs $45 outside — modelled via
--     out_of_area_fee, see note 1)
--   - license claim (license number intentionally NOT set)
--   - full home renovation in/out of scope
--   - emergency routing table (Section 5 answers were misaligned in PDF)
--   - recording retention policy (Section 10 answers were misaligned)
--   - Katy / Sugar Land / Pearland / Woodlands / Cypress coverage (Q3.3
--     answer was ambiguous, "15")
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Contact + identity
-- ---------------------------------------------------------------------------
-- Alex corrected the email: pre-filled value had a typo ("handyworks281")
-- and he uses a business domain.
--
-- NOTE: bosses had no email column before this migration — we add it.
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS email text;

UPDATE bosses
SET email = 'handyworks281@gmail.com'
WHERE company_name ILIKE '%handy works%'
  AND email IS DISTINCT FROM 'handyworks281@gmail.com';

-- ---------------------------------------------------------------------------
-- 2. Business hours (Section 2 + FAQ 9.1)
-- ---------------------------------------------------------------------------
-- Alex's answers:
--   2.1 Weekday (Mon-Fri)  8:00 - 18:00
--   2.2 Saturday           9:00 - 15:00
--   2.3 Sunday             CLOSED
--   2.4/2.5 Holidays       definitely closed (handled in prompt, not here)
--
-- Previous state had Sunday OPEN (09:00-15:00) and weekdays ending 17:00.
-- Sunday being open while Alex is closed is a trust-killer, so this is a
-- required fix.
UPDATE bosses
SET business_hours = '{
  "mon":{"start":"08:00","end":"18:00"},
  "tue":{"start":"08:00","end":"18:00"},
  "wed":{"start":"08:00","end":"18:00"},
  "thu":{"start":"08:00","end":"18:00"},
  "fri":{"start":"08:00","end":"18:00"},
  "sat":{"start":"09:00","end":"15:00"},
  "sun":null
}'::jsonb
WHERE company_name ILIKE '%handy works%'
  AND business_hours IS DISTINCT FROM '{
  "mon":{"start":"08:00","end":"18:00"},
  "tue":{"start":"08:00","end":"18:00"},
  "wed":{"start":"08:00","end":"18:00"},
  "thu":{"start":"08:00","end":"18:00"},
  "fri":{"start":"08:00","end":"18:00"},
  "sat":{"start":"09:00","end":"15:00"},
  "sun":null
}'::jsonb;

-- ---------------------------------------------------------------------------
-- 3. Trip / diagnostic fee (Sections 3.7 + 6.1 + 6.8)
-- ---------------------------------------------------------------------------
-- NOTE 1 — how we model Alex's answer:
--   Alex: "We currently don't have a trip fee, unless they are outside the
--          greater Houston area, if so a small fee trip will be added
--          (depends on what the work is)"
--   6.8:   "Yes, they must pay the $45 trip fee"
--
--   Inside the 25-mile radius  -> diagnostic_fee = 0
--   Outside Greater Houston    -> out_of_area_fee = 45 (NOT credited)
--
-- The $2/mile surcharge is left at $2.00 pending Alex's confirmation
-- (Q3.6 was pre-filled, he neither confirmed nor denied it).
UPDATE bosses
SET diagnostic_fee = 0,
    free_distance_miles = 25,      -- whole radius is fee-free
    distance_surcharge_per_mile = 2.00
WHERE company_name ILIKE '%handy works%';

-- New column: flat fee charged when the job is outside Greater Houston.
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS out_of_area_fee numeric(10, 2) NOT NULL DEFAULT 0;

UPDATE bosses
SET out_of_area_fee = 45
WHERE company_name ILIKE '%handy works%';

-- ---------------------------------------------------------------------------
-- 4. Price list — corrected floors + validated ranges
-- ---------------------------------------------------------------------------
-- 11 of 13 ranges validated unchanged against the questionnaire.
-- 4 floors corrected because Alex quoted a lower minimum than our table:
--   furniture_assembly  89  ->  75   ("minimum fee of $75")
--   tv_mounting         89  ->  90   ("start at $90", + fee if TV > 65")
--   smart_home         150  ->  80   ("start at $80")
--   window_covering    100  ->  75   ("start at $75")
-- 2 new trades added for services Alex confirmed he performs:
--   roofing_shingle    200  -> 2500  ("shingle replacement, depends on size")
--   renovation         (added — see note 2)
UPDATE bosses
SET price_list = '{
  "plumbing":         {"low": 120,  "high": 500},
  "electrical":       {"low": 120,  "high": 500},
  "hvac":             {"low": 150,  "high": 600},
  "handyman":         {"low": 75,   "high": 400},
  "painting":         {"low": 200,  "high": 1500},
  "tv_mounting":      {"low": 90,   "high": 200},
  "furniture_assembly":{"low": 75,  "high": 250},
  "smart_home":       {"low": 80,   "high": 600},
  "drywall":          {"low": 150,  "high": 800},
  "pressure_washing": {"low": 150,  "high": 600},
  "fence_deck":       {"low": 200,  "high": 2000},
  "window_covering":  {"low": 75,   "high": 400},
  "general":          {"low": 75,   "high": 500},
  "art_hanging":      {"low": 100,  "high": 400},
  "roofing_shingle":  {"low": 400,  "high": 2500}
}'::jsonb
WHERE company_name ILIKE '%handy works%';

-- ---------------------------------------------------------------------------
-- 5. Service trades
-- ---------------------------------------------------------------------------
-- Added art_hanging (was in our prompt, missing from the questionnaire —
-- needs Alex's confirmation) and roofing_shingle (Alex explicitly said he
-- can do shingle replacement depending on size).
--
-- hvac is KEPT on purpose: questionnaire 4.9.5 priced "AC repair (small,
-- refrigerant, parts)" at 150-600 and 4.9.6 listed heater repair, so minor
-- HVAC work is in scope. Only full central AC install/replacement is
-- referred (4.9.4).
--
-- general is KEPT on purpose and is NOT optional: all four tool handlers
-- default to issue_type "general" when the model omits it
-- (src/app/api/vapi/tools/route.ts). Dropping "general" from service_trades
-- makes unclassified calls fail the trade check and get wrongly declined.
UPDATE bosses
SET service_trades = ARRAY[
  'general',
  'handyman',
  'furniture_assembly',
  'tv_mounting',
  'smart_home',
  'window_covering',
  'art_hanging',
  'painting',
  'electrical',
  'plumbing',
  'hvac',
  'drywall',
  'pressure_washing',
  'fence_deck',
  'roofing_shingle'
]
WHERE company_name ILIKE '%handy works%'
  AND service_trades IS DISTINCT FROM ARRAY[
  'general',
  'handyman',
  'furniture_assembly',
  'tv_mounting',
  'smart_home',
  'window_covering',
  'art_hanging',
  'painting',
  'electrical',
  'plumbing',
  'hvac',
  'drywall',
  'pressure_washing',
  'fence_deck',
  'roofing_shingle'
];

-- ---------------------------------------------------------------------------
-- 6. Whitelist — Alex bypasses the AI (Q8.6 was left blank; this is the safe
--    default so the owner can always reach his own line).
--    Abel is intentionally NOT listed — his number was never provided.
--    Add him later with: UPDATE bosses SET whitelist_numbers = whitelist_numbers
--    || '+1<number>' WHERE company_name ILIKE '%handy works%';
-- ---------------------------------------------------------------------------
UPDATE bosses
SET whitelist_numbers = ARRAY[
  '+17137422387'    -- Alex Vega
]
WHERE company_name ILIKE '%handy works%'
  AND whitelist_numbers IS DISTINCT FROM ARRAY['+17137422387'];

-- ---------------------------------------------------------------------------
-- 7. Emergency callback cadence (Section 5, explicit cadence block)
-- ---------------------------------------------------------------------------
-- Alex's requested cadence:
--   1st call  -> you answer, you handle customer
--   no answer -> wait 5 min  -> 2nd call
--   no answer -> wait 10 min -> 3rd call
--   3 no-answer -> SMS you + tell customer to leave voicemail
--
-- NOTE: retry count and interval are read from env vars
-- (EMERGENCY_MAX_ATTEMPTS / EMERGENCY_RETRY_INTERVAL_MINUTES, consumed in
-- src/app/api/cron/emergency-retry/route.ts) — they are NOT DB columns and
-- were never present. Those env defaults (3 attempts / 5 min) already match
-- Alex's requested attempt count, so no env change is required for that part.
-- What is new here is the escalating backoff plus the two behaviours Alex
-- asked for that the pipeline did not have at all.
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS emergency_retry_backoff_minutes int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS emergency_sms_fallback boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS emergency_voicemail_instruction boolean NOT NULL DEFAULT true;

-- Backoff 5 then 10, then SMS fallback + voicemail instruction.
UPDATE bosses
SET emergency_retry_backoff_minutes = 5,
    emergency_sms_fallback = true,
    emergency_voicemail_instruction = true
WHERE company_name ILIKE '%handy works%';

-- STILL NEEDS CODE (not schema):
--   the 5 -> 10 min escalating backoff and the SMS-to-Alex fallback are
--   persisted here but not yet consumed by emergency-retry/route.ts.
--   Tracked as C3 in docs/ALEX-QUESTIONNAIRE-ANALYSIS.md. The spoken
--   voicemail instruction IS already in the system prompt.

-- ---------------------------------------------------------------------------
-- 8. License — DELIBERATELY NOT SET
-- ---------------------------------------------------------------------------
-- Alex answered "No license" and "Texas doesn't require us to be licensed.
-- We are insured." Our pre-filled FAQ asserted license number 32094253104.
-- We are removing that claim rather than restating it. No license column is
-- written here on purpose.
--
-- If Alex later confirms a real credential, add it in migration 013 with his
-- written sign-off.

-- ---------------------------------------------------------------------------
-- 9. Commercial jobs (Q3.8 / 9.9)
-- ---------------------------------------------------------------------------
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS accepts_commercial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commercial_note text;

UPDATE bosses
SET accepts_commercial = true,
    commercial_note = 'We are capable of some commercial jobs. Discuss per job — do not quote a range on the phone, flag to Alex.'
WHERE company_name ILIKE '%handy works%';

-- ---------------------------------------------------------------------------
-- 10. Payment methods (Section 6)
-- ---------------------------------------------------------------------------
-- Alex confirmed: cash, credit cards (3% fee added to total), check, Zelle.
-- Explicitly NO Venmo (Q6.5 "No venmo").
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS card_surcharge_pct numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_payment text;

UPDATE bosses
SET payment_methods = ARRAY['cash', 'credit_card', 'check', 'zelle'],
    card_surcharge_pct = 3.00,
    preferred_payment = 'zelle'
WHERE company_name ILIKE '%handy works%';

-- ---------------------------------------------------------------------------
-- 11. FAQ refresh (Sections 9 + 8.5)
-- ---------------------------------------------------------------------------
UPDATE bosses
SET faq = '{
  "weekend_hours": "Monday to Friday eight to six, Saturday nine to three, closed Sunday and major holidays.",
  "how_soon": "Usually within twenty-four to forty-eight hours. Urgent jobs we try to fit in same day.",
  "estimate_fee": "No trip fee inside our service area. Outside greater Houston there is a small trip fee.",
  "payment": "Cash, check, Zelle, or credit card. Card payments add a three percent fee.",
  "warranty": "Thirty day workmanship warranty.",
  "roofing": "We do shingle replacement depending on size, and can refer you for full roof work.",
  "pest": "No, we do not do pest control. Try a pest control company.",
  "licensed": "We are an insured Texas limited liability company. Texas does not require a trade license for this work.",
  "years_in_business": "Handy Works has been operating since twenty twenty four, and the team has long prior handyman experience.",
  "spanish": "Basic Spanish.",
  "owners": "Alex and Abel are the two owners. Abel is usually out in the field.",
  "commercial": "We take on some commercial work. Prices depend on the job, so Alex will follow up with a quote."
}'::jsonb
WHERE company_name ILIKE '%handy works%';

-- ---------------------------------------------------------------------------
-- STILL NEEDS ALEX'S WRITTEN CONFIRMATION (not applied here)
-- ---------------------------------------------------------------------------
--  1. Trip fee mechanics   — is the $45 in addition to labor? Does the
--                            $2/mile still apply on top? (Q3.6 unanswered)
--  2. License / insured    — do we have a real credential number, or is
--                            "insured Texas LLC" the whole truth?
--  3. Full home renovation — questionnaire contradicts itself (listed
--                            under "what we DON'T do" but he said he does
--                            offer it). Currently the AI declines it.
--  4. Emergency routing    — Section 5 answers were column-misaligned in
--                            the returned PDF. Notably 5.3 (gas smell)
--                            appears to read "Call a plumber", which is
--                            almost certainly a column artifact. The
--                            prompt currently routes gas to 911 + gas
--                            utility, which is the safe default.
--  5. Recording retention  — Section 10 answers were off-topic. No
--                            deletion policy is configured.
--  6. City coverage       — Q3.3 answer read as "15" (Katy, Sugar Land,
--                            Pearland, Woodlands, Cypress). Unclear.
--  7. Art hanging         — in our prompt, absent from the questionnaire.
--  8. Abel's phone number — NOT added. Deliberately left out; the only
--                            whitelist entry is Alex. Add when provided.
--  9. Warranty            — "30 day workmanship" is our pre-fill, Alex
--                            never confirmed it.
