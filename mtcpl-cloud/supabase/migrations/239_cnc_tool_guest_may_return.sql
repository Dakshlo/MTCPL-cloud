-- ──────────────────────────────────────────────────────────────────
-- Migration 239 — the cupboard QR may hand a tool back, not only take
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh, Nov 2026, with the screenshot: "there is one more error when
-- we try to give back item to store."
--
--   new row for relation "cnc_tool_movements" violates check
--   constraint "cnc_tool_movements_guest_issue_only"
--
-- Mig 229 wrote that constraint, and its comment said exactly what it
-- meant: "The QR can ONLY take. Anything else through a link is
-- rejected by the database, whatever the application layer believes."
--
-- That was right when it was written. A take was the end of the story,
-- so the only honest thing a sticker on a door could record was a man
-- walking off with something. Mig 238 changed the story: a take now
-- puts the tool in his hands, and he comes back to the same sticker to
-- say what happened to it. One of the two answers is "nothing — here
-- it is". That return is not a loophole in the QR's job; it IS the QR's
-- job now, and it is signed by the same OTP as the take it reverses.
--
-- ── What stays shut ────────────────────────────────────────────────
--
-- Everything else. A link still cannot record:
--
--   receive   stock arriving from a supplier
--   scrap     writing something off
--   adjust    correcting the shelf against a physical count
--
-- Those are the keeper's acts, and the keeper's own path through the
-- cupboard screen deliberately writes a NULL guest_link_id — which is
-- why add-stock and fix-count have always worked through the QR without
-- ever touching this constraint. Nothing about them changes here.
--
-- ── Why a return cannot be used to invent stock ────────────────────
--
-- The obvious worry about letting a door push stock UP is somebody
-- "returning" ten of something they took one of. They cannot: every
-- return from this screen goes through cnc_tool_settle_held (mig 238),
-- which reads what the man is holding inside a lock on the tool and
-- refuses anything above it. The ceiling is in the database, not in the
-- page, so widening this constraint does not widen what a tampered form
-- can do.
--
-- Safety: one CHECK swapped for a strictly weaker one. Every existing
-- row satisfies the new form — there are no 'return' rows in the table
-- at all yet, so nothing is reinterpreted.
--
-- Rollback:
--   alter table public.cnc_tool_movements
--     drop constraint if exists cnc_tool_movements_guest_issue_only;
--   alter table public.cnc_tool_movements
--     add constraint cnc_tool_movements_guest_issue_only
--     check (guest_link_id is null or kind = 'issue');
--   -- NOTE: this fails once a man has handed anything back at the QR.
-- ──────────────────────────────────────────────────────────────────

begin;

alter table public.cnc_tool_movements
  drop constraint if exists cnc_tool_movements_guest_issue_only;

alter table public.cnc_tool_movements
  add constraint cnc_tool_movements_guest_issue_only
  check (guest_link_id is null or kind in ('issue', 'return'));

comment on constraint cnc_tool_movements_guest_issue_only
  on public.cnc_tool_movements is
  'Mig 229, widened by mig 239 — a cupboard sticker may record a man taking '
  'a tool and a man handing one back, and nothing else. Receive, scrap and '
  'adjust are keeper acts and are written with a NULL guest_link_id. The '
  'return is bounded by cnc_tool_settle_held, which refuses more than the '
  'man is holding.';

notify pgrst, 'reload schema';

commit;

-- ── Verification (paste separately after running) ─────────────────
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'cnc_tool_movements_guest_issue_only';
--
-- -- a return through a link must now pass, and a receive must still fail
