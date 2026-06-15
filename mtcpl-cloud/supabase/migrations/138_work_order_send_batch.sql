-- 138 — Track send batches on work-order lines so each assignment batch gets
-- its OWN gate pass. Every "send" action stamps one timestamp across the lines
-- it sends; existing sent lines are backfilled from the carving job's loaded
-- time (grouped to the minute, a good-enough batch key for past sends).

begin;

alter table public.carving_work_order_items
  add column if not exists sent_batch_at timestamptz;

update public.carving_work_order_items i
set sent_batch_at = date_trunc('minute', ci.loaded_at)
from public.carving_items ci
where ci.id = i.carving_item_id
  and i.line_status = 'sent'
  and i.sent_batch_at is null
  and ci.loaded_at is not null;

commit;

notify pgrst, 'reload schema';
