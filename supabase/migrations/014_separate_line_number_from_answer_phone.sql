-- 014_separate_line_number_from_answer_phone.sql
--
-- Fixes a column-naming collision introduced in migration 013.
--
-- THE BUG
-- -------
-- 013 added `human_line_number` and then used it for two different things:
--
--   1. identifying which inbound line a call arrived on, and
--   2. the phone that actually rings when someone calls that line.
--
-- Those are not the same number. The line is the number the customer dials
-- (a Twilio number we own); the answer phone is Alex's handset. Routing
-- a TwiML <Number> to the line's own number rings the line again instead of
-- ringing Alex — caught by actually rendering the TwiML and reading it.
--
-- THE FIX
-- -------
--   human_line_number  — the inbound line (customer dials this). Unchanged.
--   human_answer_phone — Alex's handset that rings. New, nullable.
--
-- RING TARGETING
-- -------------
-- If human_answer_phone is NULL we ring the boss's own `phone` field, which is
-- the mobile Alex gave us in the questionnaire. That is a safe default: every
-- boss has one, and it means a provisioned line works before anyone fills in
-- the extra column.
--
-- Idempotent: safe to re-run.

ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS human_answer_phone text;

COMMENT ON COLUMN bosses.human_line_number IS
  'The inbound line customers dial (Twilio). Identifies which line a call arrived on.';
COMMENT ON COLUMN bosses.human_answer_phone IS
  'The handset that rings when human_line_number is called. NULL = fall back to bosses.phone.';

-- Backfill the US boss from the number Alex gave in the questionnaire (1.2).
-- Only applies where the line is already provisioned, so it cannot touch an
-- unconfigured boss.
UPDATE bosses
SET human_answer_phone = phone
WHERE human_line_enabled = true
  AND human_line_number IS NOT NULL
  AND (human_answer_phone IS NULL OR human_answer_phone = '');
