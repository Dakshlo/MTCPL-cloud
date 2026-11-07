-- 237: the shelf fills itself from the bill (Daksh, Nov 2026).
--
-- "One person will maintain stock, mainly intake. When the tools arrive
--  they come with a bill. We scan the bill and AI will read it and from
--  product name it will restock automatically. If item don't exist it
--  will create new and prompt us 'should I create new item'. And make
--  the AI smart — if there is a small typo the AI can fix it and put
--  stock to the relevant item. In background we will keep the bill and
--  all info about tool."
--
-- The cupboard QR already handles OUTFLOW: every take is signed by the
-- man who took it. This is the other half — INFLOW — and with both ends
-- captured nobody has to count a shelf ever again.
--
-- Deliberately NOT wired to Finance. Daksh, same day: "no, don't link
-- this to finance at all, it's completely separate." The accountant's
-- bill is about money owed; this one is about what landed on the shelf.
-- Same paper, two different jobs, and tying them together would mean
-- neither side could change without breaking the other.
--
-- ── Three tables, and the third is the one that matters ────────────
--
--   cnc_tool_bills        the scanned bill: supplier, number, date,
--                         totals, the file itself, and the AI's whole
--                         reply kept verbatim.
--   cnc_tool_bill_lines   one row per line AS PRINTED, next to what we
--                         decided it was. The printed text is kept
--                         forever even after it is matched, because it
--                         is the evidence for the match.
--   cnc_tool_supplier_codes
--                         the LEARNING table. "On a SHARDA bill, the
--                         text 'DSZ.10.4/40 160' means this tool."
--
-- Without that third table the AI guesses at 85% and stays at 85%
-- forever. With it, every correction a human makes is remembered: the
-- second bill from that supplier needs no AI judgement at all, just a
-- lookup. The AI is only ever asked about text nobody has seen before,
-- and each answer permanently removes one question.
--
-- ── Why the lines carry a rate ────────────────────────────────────
--
-- Nothing in the tool store has ever held money. The rate is on the
-- line anyway, so capturing it costs nothing now and is the only way
-- to answer "we paid ₹1,240 last time, this bill says ₹1,480" later.
-- It is recorded, not reported on — the price screens come when there
-- is a year of lines to put in them.
--
-- RLS on, no policies: service_role only, exactly like the rest of the
-- module. These tables carry supplier rates, so unlike tool photos the
-- bucket is PRIVATE and the file is served through a signed URL.

begin;

-- ── The bill ──────────────────────────────────────────────────────

create table if not exists public.cnc_tool_bills (
  id               uuid primary key default gen_random_uuid(),

  -- Header, as read off the paper. All nullable: a partial read that
  -- got the line items right is still worth posting, and a hand-written
  -- challan with no GSTIN is a normal Tuesday.
  supplier_name    text,
  supplier_gstin   text,
  bill_no          text,
  bill_date        date,
  amount_subtotal  numeric(14,2),
  amount_gst       numeric(14,2),
  amount_total     numeric(14,2),

  -- The paper itself, in the private cnc_tool_bills bucket.
  document_path    text,
  document_mime    text,
  document_bytes   integer,

  -- How the read was done, so a bad batch can be found later by model
  -- rather than by memory.
  scan_model       text,
  scan_confidence  text,          -- high | medium | low
  scan_raw         jsonb,         -- the AI's entire reply, verbatim
  scan_input_tokens  integer,
  scan_output_tokens integer,

  status           text not null default 'draft',  -- draft | posted | discarded
  note             text,

  posted_at        timestamptz,
  posted_by        uuid references public.profiles(id),
  discarded_at     timestamptz,
  discarded_by     uuid references public.profiles(id),

  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),

  constraint cnc_tool_bills_status_ck
    check (status in ('draft', 'posted', 'discarded')),
  constraint cnc_tool_bills_confidence_ck
    check (scan_confidence is null or scan_confidence in ('high', 'medium', 'low'))
);

comment on table public.cnc_tool_bills is
  'A scanned supplier bill for CNC tooling (mig 237). Read by Claude '
  'vision, reviewed by a human, then posted as receive movements. '
  'Nothing to do with public.bills — that is money owed, this is stock '
  'arriving.';

comment on column public.cnc_tool_bills.scan_raw is
  'The model reply exactly as returned. Kept so a line the reviewer '
  'overrode can still be traced back to what the AI actually said.';

create index if not exists cnc_tool_bills_recent_idx
  on public.cnc_tool_bills (created_at desc);
create index if not exists cnc_tool_bills_draft_idx
  on public.cnc_tool_bills (status) where status = 'draft';

-- One bill number per supplier, so the same paper cannot be posted
-- twice in a busy week. Normalised and only for posted bills: drafts
-- and discards must never block a re-scan.
create unique index if not exists cnc_tool_bills_one_per_supplier_idx
  on public.cnc_tool_bills (
    upper(regexp_replace(coalesce(supplier_name, ''), '[^A-Za-z0-9]', '', 'g')),
    upper(regexp_replace(coalesce(bill_no, ''), '[^A-Za-z0-9]', '', 'g'))
  )
  where status = 'posted' and bill_no is not null and supplier_name is not null;

-- ── The lines ─────────────────────────────────────────────────────

create table if not exists public.cnc_tool_bill_lines (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.cnc_tool_bills(id) on delete cascade,
  line_no         integer not null,

  -- AS PRINTED. Never cleaned up, never overwritten by the match: this
  -- is the evidence, and it is what the learning table keys on.
  raw_text        text not null,
  raw_qty         numeric(14,3),
  raw_unit        text,
  rate            numeric(14,2),
  amount          numeric(14,2),
  hsn             text,

  -- What we decided it was. NULL tool_id with outcome 'skipped' is a
  -- freight / packing / round-off line, which must never become stock.
  tool_id         uuid references public.cnc_tools(id) on delete set null,
  qty             numeric(14,3),        -- the quantity actually posted

  -- How we got there, which is the whole audit story of the match:
  --   alias   the supplier's own code, learned from a previous bill
  --   exact   normalised name match against the catalogue
  --   fuzzy   close enough on our own scoring (the typo case)
  --   ai      the model proposed it and our score agreed
  --   new     a tool was created for this line
  --   manual  the reviewer picked it by hand
  --   skipped not stock
  outcome         text,
  match_score     numeric(5,4),
  ai_tool_id      uuid references public.cnc_tools(id) on delete set null,
  ai_suggested_name text,
  ai_note         text,

  created_tool    boolean not null default false,
  movement_id     uuid references public.cnc_tool_movements(id) on delete set null,

  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),

  constraint cnc_tool_bill_lines_outcome_ck
    check (outcome is null or outcome in
      ('alias', 'exact', 'fuzzy', 'ai', 'new', 'manual', 'skipped')),
  constraint cnc_tool_bill_lines_one_per_line
    unique (bill_id, line_no)
);

comment on column public.cnc_tool_bill_lines.raw_text is
  'The line exactly as printed on the bill. Kept forever — it is the '
  'evidence for the match and the key the supplier-code table learns on.';

create index if not exists cnc_tool_bill_lines_bill_idx
  on public.cnc_tool_bill_lines (bill_id, line_no);
create index if not exists cnc_tool_bill_lines_tool_idx
  on public.cnc_tool_bill_lines (tool_id) where tool_id is not null;
-- movement → bill, for "where did this stock come from?"
create index if not exists cnc_tool_bill_lines_movement_idx
  on public.cnc_tool_bill_lines (movement_id) where movement_id is not null;

-- ── The learning table ────────────────────────────────────────────

create table if not exists public.cnc_tool_supplier_codes (
  id            uuid primary key default gen_random_uuid(),

  -- Both normalised to letters and digits only, upper case: the same
  -- tool is printed 'DSZ.10.4/40 160', 'DSZ 10.4-40(160)' and
  -- 'dsz10.4/40-160' on three bills from the same shop.
  supplier_key  text not null,
  code_key      text not null,

  tool_id       uuid not null references public.cnc_tools(id) on delete cascade,

  -- A readable example, for the screen that explains why a line matched.
  raw_sample    text,
  times_seen    integer not null default 1,
  last_seen_at  timestamptz not null default now(),

  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),

  constraint cnc_tool_supplier_codes_keys_ck
    check (length(supplier_key) > 0 and length(code_key) > 0)
);

comment on table public.cnc_tool_supplier_codes is
  'What a supplier calls one of our tools (mig 237). Every human '
  'confirmation is remembered here, so the next bill from that supplier '
  'needs a lookup instead of a guess. This is what stops the matcher '
  'being stuck at 85% forever.';

create unique index if not exists cnc_tool_supplier_codes_one_idx
  on public.cnc_tool_supplier_codes (supplier_key, code_key);
create index if not exists cnc_tool_supplier_codes_tool_idx
  on public.cnc_tool_supplier_codes (tool_id);

-- ── Doors ─────────────────────────────────────────────────────────
--
-- Same as the rest of the module: RLS on with no policies at all, so
-- `anon` and `authenticated` cannot read a row. Every read and write
-- goes through the server with the service key behind a role gate.
-- These lines carry supplier rates, which is a sharper reason than
-- usual to keep the table shut.

alter table public.cnc_tool_bills            enable row level security;
alter table public.cnc_tool_bill_lines       enable row level security;
alter table public.cnc_tool_supplier_codes   enable row level security;

revoke all on public.cnc_tool_bills          from anon, authenticated;
revoke all on public.cnc_tool_bill_lines     from anon, authenticated;
revoke all on public.cnc_tool_supplier_codes from anon, authenticated;

-- ── The paper ─────────────────────────────────────────────────────
--
-- PRIVATE, unlike cnc_tool_images. A tool photo is a picture of a drill
-- bit; a bill is what we pay for it and who we pay. Served through a
-- short-lived signed URL from a gated route.

insert into storage.buckets (id, name, public)
values ('cnc_tool_bills', 'cnc_tool_bills', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

commit;

-- ROLLBACK
-- begin;
-- drop table if exists public.cnc_tool_supplier_codes;
-- drop table if exists public.cnc_tool_bill_lines;
-- drop table if exists public.cnc_tool_bills;
-- delete from storage.buckets where id = 'cnc_tool_bills';
-- notify pgrst, 'reload schema';
-- commit;
