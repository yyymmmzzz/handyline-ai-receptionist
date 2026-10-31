-- 019: make the notification delivery log actually able to record a success.
--
-- WHY: `logNotification()` in src/lib/notify.ts writes an `external_id` column
-- (the Twilio Message SID) when a message is sent successfully. That column
-- was never created in the notifications table, so EVERY successful delivery
-- failed at the insert — and the error was swallowed, because the Supabase
-- client returns { error } instead of throwing and the return value was never
-- checked. The net effect:
--
--   - 80 rows in `notifications`, all 'failed'
--   - zero rows ever recorded as 'sent'
--
-- So the delivery log could only ever prove failure. It could never prove
-- success — which meant the dashboard could not tell "delivered" from
-- "never tried", and a working notification channel looked identical to a
-- broken one.
--
-- This migration gives the table the column it has been writing to, plus the
-- indexes the delivery-log queries need:
--   - the order detail page reads notifications by work_order_id
--   - the dashboard reads the most recent failures
--
-- external_id holds the provider's own id (Twilio Message SID for SMS, Call
-- SID for a voice attempt). It is what makes a delivery traceable back to
-- the provider, and it is how a replayed notification can be recognised as
-- a duplicate.

alter table notifications
  add column if not exists external_id text;

comment on column notifications.external_id is
  'Provider-side id of the delivery attempt (Twilio Message SID for SMS, Call SID for voice). NULL = not recorded.';

create index if not exists notifications_work_order_id_idx
  on notifications (work_order_id);

create index if not exists notifications_created_at_idx
  on notifications (created_at desc);

-- Partial index for the dashboard banner: it only ever asks for failures.
create index if not exists notifications_failed_created_at_idx
  on notifications (created_at desc)
  where status = 'failed';
