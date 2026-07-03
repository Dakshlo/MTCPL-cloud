-- 178: Freed invoice numbers (Daksh, Jul 2026).
--
-- Invoice numbers are now LOCKED (auto-assigned from the shared INV:<fy>
-- counter — no manual editing anywhere). Cancelling an invoice frees its
-- number and sends the challan back to its source page:
--   • if the cancelled number was the HEAD of the series, the counter is
--     decremented so the NEXT invoice reuses it (cancel 90 when head=90 →
--     next invoice is 90 again). The decrement keeps collapsing through any
--     previously-freed tail numbers.
--   • otherwise (91+ already issued) the number is recorded here as FREE and
--     shown as an indication on Review & price — the series continues at
--     head+1 (94), it does NOT jump back.
-- Additive + idempotent.

create table if not exists public.freed_invoice_numbers (
  fy        text not null,               -- e.g. '26/27'
  seq       int  not null,
  freed_at  timestamptz not null default now(),
  freed_by  uuid references public.profiles(id),
  primary key (fy, seq)
);

notify pgrst, 'reload schema';
