-- 220: Round off the invoice VALUE to whole rupees (Daksh, Aug 2026).
--
-- Every tax invoice must end on a whole-rupee figure — no paise on the amount
-- payable. Rounding is HALF-DOWN, exactly as Daksh specified:
--
--     200.43 → 200      200.50 → 200      200.51 → 201
--
-- Only the FINAL amount rounds. Taxable value and the CGST/SGST/IGST amounts
-- stay exact to the paisa — they are filed in GSTR-1 and must still equal
-- rate × taxable. The ± difference prints as a "Round Off" line, so the
-- document's arithmetic reconciles the way an Indian tax invoice should.
--
-- WHY A COLUMN AND NOT A GLOBAL RULE: invoices already issued have been
-- printed, sent and filed at their paise figure. Re-rounding them in the app
-- would make the software disagree with the paper. So:
--
--   • existing rows  → round_total = false  → they compute EXACTLY as today
--   • every new row  → column DEFAULT true  → rounded, even from a code path
--                                             that never mentions the column
--
-- Fixing the already-issued invoices is a separate, deliberate step.
--
-- Rollback: alter table ... drop column round_total;

-- Step 1 — add it false, so nothing already in the table changes.
alter table public.challans       add column if not exists round_total boolean not null default false;
alter table public.bulk_invoices  add column if not exists round_total boolean not null default false;
alter table public.other_challans add column if not exists round_total boolean not null default false;

-- Step 2 — flip the DEFAULT for rows created from here on. Backstop for any
-- insert path that does not set the column explicitly.
alter table public.challans       alter column round_total set default true;
alter table public.bulk_invoices  alter column round_total set default true;
alter table public.other_challans alter column round_total set default true;

notify pgrst, 'reload schema';
