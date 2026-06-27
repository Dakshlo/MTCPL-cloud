-- 164: DPR "Block Cutted" perf (Daksh, June 2026).
--
-- /reports/dpr → Block Cutted keyset-paginates every post-cut slab:
--   .in("status", POST_CUT_STATUSES).order("id").gt("id", lastId).limit(1000)
-- A composite (status, id) index lets Postgres serve that filter+order from
-- the index instead of sequentially scanning slab_requirements (the largest,
-- fastest-growing table). Harmless if it already exists.

create index if not exists idx_slab_requirements_status_id
  on public.slab_requirements (status, id);
