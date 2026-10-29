-- 017: flag calls where the AI visibly misbehaved.
--
-- WHY: on 2026-10-14 the AI answered a customer question with "What's the
-- issue?" three times. Nothing on the work order said so — the summary just
-- read "Customer inquired about TV mounting". The only way to catch it was to
-- read every transcript by hand.
--
-- ai_quality_flag stores the symptom(s) detected mechanically:
--   repeated_turn   — the AI said the same thing twice in a row
--   opener_echo     — the AI repeated its opening question after the customer
--                     had already spoken
--   no_customer_turn— the AI talked 3+ times and the customer never replied
--
-- NULL means the call looked normal.

alter table work_orders
  add column if not exists ai_quality_flag text;

comment on column work_orders.ai_quality_flag is
  'Comma-separated AI misbehaviour flags: repeated_turn, opener_echo, no_customer_turn';
