-- ══════════════════════════════════════════════════════════════════
-- 241 — heartbeat_log: a diary instead of a phone book, and a bin
-- ══════════════════════════════════════════════════════════════════
--
-- Found while Daksh was looking at Supabase's compute page and asked
-- whether a bigger instance would make the app faster. It would not —
-- the cache hit rate is 100.000%, the whole 134 MB database fits in
-- shared buffers, two connections of sixty were active and nothing was
-- waiting on a lock. But the question sent me to pg_stat_statements,
-- and this table was sitting at the top of it:
--
--   heartbeat_log reads: 11,217 calls, 3,628 SECONDS of database time
--
-- the single largest consumer on the instance.
--
-- ── Why it was slow ───────────────────────────────────────────────
--
-- Every browser posts a row every couple of minutes so the app knows
-- who is online and how long they have been looking at it. Since April
-- that is 176,090 rows.
--
-- Three things read it — the dashboard, Settings and the AI tool — and
-- ALL THREE ask the same question: who was active TODAY. About fifty
-- rows.
--
-- The only usable index was (user_id, created_at DESC). Leading column
-- user_id, so a query filtered on created_at alone cannot seek: Postgres
-- walks the whole index checking dates, person by person. Measured on
-- the live table: 1,554 buffers read to return 64 rows.
--
-- A phone book, asked for everything that happened on Tuesday.
--
-- The (user_id, created_at) index STAYS. "How much screen time did this
-- person have" is a real question and that index is the right shape for
-- it. This adds the other one rather than replacing it.
--
-- ── And why it will stay fast ─────────────────────────────────────
--
-- 169,964 of those 176,090 rows — 96.5% — were older than thirty days,
-- and nothing has ever read them. They were pure weight on every scan.
--
-- Sixty days is deliberately generous: nothing today looks past
-- midnight, so this keeps two months of room for a "last month" view
-- that does not exist yet. The ongoing trim lives in the heartbeat
-- route itself (src/app/api/heartbeat/route.ts) rather than in pg_cron,
-- which is not installed on this project — one fewer moving part, and
-- it cannot drift out of sync with the code that does the inserting.
-- ══════════════════════════════════════════════════════════════════

begin;

-- ── 1. Take the bin out first ─────────────────────────────────────
--
-- Before the index, not after: building an index over 176k rows locks
-- writes for as long as it takes, and heartbeats are arriving while it
-- runs. Deleting first means the index is built over ~6k rows instead,
-- and the pause nobody notices.
delete from public.heartbeat_log
 where created_at < now() - interval '60 days';

-- ── 2. The diary ──────────────────────────────────────────────────
create index if not exists idx_heartbeat_log_created_at
  on public.heartbeat_log (created_at desc);

comment on index public.idx_heartbeat_log_created_at is
  'Mig 241 — "who was active today". The (user_id, created_at) index '
  'cannot serve a created_at-only filter because user_id leads it, so '
  'that query walked the whole index: 1,554 buffers for 64 rows. Keep '
  'both — this one answers by DATE, the other by PERSON.';

-- The planner has just lost 96% of the rows it had statistics for.
analyze public.heartbeat_log;

commit;

-- ── Verification (paste separately after running) ─────────────────
--
-- explain (analyze, buffers)
-- select user_id, created_at from heartbeat_log
--  where created_at >= (now() at time zone 'Asia/Kolkata')::date::timestamptz
--    and created_at <= now();
--
-- -- expect: Index Only Scan using idx_heartbeat_log_created_at,
-- -- buffers in single digits rather than 1,554.
