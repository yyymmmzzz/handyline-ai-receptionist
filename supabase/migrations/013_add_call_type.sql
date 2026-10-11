-- 013_add_call_type.sql
--
-- Splits work orders into "who actually answered the phone".
--
-- WHY
-- ---
-- We are adding a second inbound line that a human answers directly. The
-- recording → transcript → summary pipeline is identical for both lines, so
-- both keep writing to work_orders. What differs is who picked up, and the
-- dashboard needs to be able to show "AI calls" and "human calls" separately.
--
-- The alternative — a separate human_calls table — was rejected: it would
-- duplicate the customer, transcript, recording, follow-up and status columns
-- that work_orders already carries correctly, and force two code paths for
-- everything downstream.
--
-- call_type values:
--   'ai'     — the AI receptionist answered (default; covers every row that
--              existed before this migration)
--   'human'  — a person answered the call directly
--   'hybrid' — the AI answered, then handed off / the human took over mid-call
--
-- Idempotent: safe to re-run.

-- 1. The column
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS call_type text NOT NULL DEFAULT 'ai';

-- 2. Constrain it so a typo cannot create a fourth bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_call_type_check'
  ) THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_call_type_check
      CHECK (call_type IN ('ai', 'human', 'hybrid'));
  END IF;
END $$;

-- 3. Index for the dashboard filter (".eq('call_type', filter)")
CREATE INDEX IF NOT EXISTS work_orders_call_type_idx
  ON work_orders (call_type);

-- 4. Boss-level switch: which call type a given inbound line produces.
--    Kept on the boss so the two-line setup can be switched per customer and
--    so the dashboard can label each line.
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS ai_line_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS human_line_enabled boolean NOT NULL DEFAULT false;

-- 5. The human line's own settings. Defaults are conservative: disabled until
--    a real number is provisioned, and a short ring window before falling back.
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS human_line_number text,
  ADD COLUMN IF NOT EXISTS human_line_ring_seconds int NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS human_line_fallback text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS human_line_priority_in_hours boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bosses_human_line_fallback_check'
  ) THEN
    ALTER TABLE bosses
      ADD CONSTRAINT bosses_human_line_fallback_check
      CHECK (human_line_fallback IN ('ai', 'voicemail', 'hangup'));
  END IF;
END $$;

-- 6. Per-call human-line metadata: did Alex actually pick up, how long did the
--    phone ring, did we fall back. Null on AI-line calls.
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS human_answered boolean,
  ADD COLUMN IF NOT EXISTS human_ring_seconds int,
  ADD COLUMN IF NOT EXISTS line_label text;

COMMENT ON COLUMN work_orders.call_type IS
  'Who answered: ai | human | hybrid. Defaults to ai for all pre-existing rows.';
COMMENT ON COLUMN bosses.human_line_number IS
  'E.164 number of the dedicated human-answering line. NULL until provisioned.';
COMMENT ON COLUMN bosses.human_line_fallback IS
  'What happens when the human does not pick up: ai | voicemail | hangup.';
COMMENT ON COLUMN bosses.human_line_priority_in_hours IS
  'true  = during business hours the human answers first, AI is the fallback.'
  'false = the AI always answers this line and only escalates emergencies.';
