-- 016: allow "human_handled" as a work order decision.
--
-- WHY: the human-answering line (Twilio) writes ai_decision = 'human_handled'
-- for calls a person answered, so the dashboard does not pretend an AI
-- triaged it. The column's CHECK constraint only allowed the four AI
-- outcomes, so every human call 500'd on insert:
--
--   new row for relation "work_orders" violates check constraint
--   "work_orders_ai_decision_check"
--
-- The path had never run because the Twilio account has no number yet.
-- Found by scripts/test-human-line.js.
--
-- 'human_handled' is only ever written for call_type = 'human'.

alter table work_orders
  drop constraint if exists work_orders_ai_decision_check;

alter table work_orders
  add constraint work_orders_ai_decision_check
  check (ai_decision is null or ai_decision in ('accepted', 'urgent', 'unsure', 'rejected', 'human_handled'));
