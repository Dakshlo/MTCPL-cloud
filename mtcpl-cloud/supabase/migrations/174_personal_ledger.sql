-- Migration 174 — Personal money-record ledger (Daksh, private).
--
-- Two notional accounts: "home" (managed by owner Naresh) and "office" (managed
-- by the crosscheck / "manager" role). This is NOT real cash — just a shared
-- record so there's no misunderstanding about who paid/received what.
--
-- Each row is a single receive (+) or pay (-) on one account. A Home<->Office
-- transfer writes a LINKED PAIR sharing a transfer_group (one entry per account).
-- A manager "receiving from Home" debits Home, so it needs OWNER APPROVAL: those
-- paired entries stay status='pending' and DO NOT affect either balance until the
-- owner approves (then both flip to 'confirmed'). Owner-initiated transfers and
-- the manager paying INTO home are immediate ('confirmed').

create table if not exists personal_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('home', 'office')),
  direction text not null check (direction in ('receive', 'pay')),
  amount numeric(14, 2) not null check (amount >= 0),
  counterparty text not null default '',          -- "to whom" — OFFICE / HOME / free text
  note text,
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'rejected')),
  is_transfer boolean not null default false,
  transfer_group uuid,                            -- links the two halves of a transfer
  requires_approval boolean not null default false,
  entry_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz
);

create index if not exists idx_ledger_account_status on personal_ledger_entries (account, status);
create index if not exists idx_ledger_group on personal_ledger_entries (transfer_group);
create index if not exists idx_ledger_created on personal_ledger_entries (created_at desc);
