-- 015_summary_source.sql
--
-- Records WHICH path produced the LLM-derived summary fields on a work order.
--
-- WHY
-- ---
-- The summariser falls back to a regex implementation when OpenAI is
-- unreachable. That fallback output was written to the work order and then
-- served as a cache hit on every later run, because the cache is the
-- work_orders row itself (matched by summary_hash). A transient OpenAI
-- outage therefore degraded a call permanently — the customer name and the
-- intent summary stayed empty and the LLM never got another chance at it.
--
-- With summary_source recorded, only rows produced by a successful LLM run
-- are eligible to be reused, and a fallback row is retried next time.
--
-- Existing rows are backfilled as 'llm' where they look like a real LLM
-- result (an intent summary is present) and left NULL otherwise, so those
-- are simply re-derived on the next processing pass.

alter table work_orders
  add column if not exists summary_source text;

comment on column work_orders.summary_source is
  'Which path produced the LLM summary fields: llm | regex | regex-fallback';

create index if not exists idx_work_orders_summary_hash
  on work_orders (summary_hash);

update work_orders
set summary_source = 'llm'
where summary_source is null
  and summary_hash is not null
  and intent_summary is not null
  and customer_name_extracted is not null;
