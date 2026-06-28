-- 168: Unified per-FY document number (Daksh, June 2026).
--
-- One code shared by a dispatch, its invoicing challan, and its tax invoice:
--   dispatch challan  → CH-26/27-01
--   invoicing challan → CH-26/27-01   (same number)
--   tax invoice       → INV-26/27-01  (same number)
-- The sequence resets to 1 each financial year (Apr–Mar, shown as "26/27").
--
-- doc_seq is assigned ONCE at dispatch (or manual-challan) creation via the
-- atomic next_doc_seq() counter, then copied onto the invoicing challan. Old
-- rows without doc_seq fall back to their legacy CHLN-#### / CH-YYYY-N codes.

create table if not exists public.doc_counters (
  fy        text primary key,
  last_seq  int  not null default 0
);

-- Atomic "give me the next number for this FY" — upsert + return.
create or replace function public.next_doc_seq(p_fy text)
returns int
language sql
volatile
as $$
  insert into public.doc_counters (fy, last_seq)
  values (p_fy, 1)
  on conflict (fy) do update set last_seq = public.doc_counters.last_seq + 1
  returning last_seq;
$$;

alter table public.dispatches
  add column if not exists doc_fy  text,
  add column if not exists doc_seq int;

alter table public.challans
  add column if not exists doc_fy  text,
  add column if not exists doc_seq int;

notify pgrst, 'reload schema';
