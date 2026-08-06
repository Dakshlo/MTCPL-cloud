-- 216 — stop the public anon key from executing production cutting functions
--
-- Aug 2026 audit, finding #1 (the only Critical that can WRITE data).
--
-- finish_block_cut, precut_release_slabs and handle_new_user are all
-- SECURITY DEFINER, and PostgreSQL grants EXECUTE on a new function to PUBLIC
-- by default — which includes `anon`, the role a browser holds before anyone
-- signs in. Verified in pg_proc: anon_can_execute = true on all three.
--
-- The anon key is public by design; it ships inside the client bundle. So
-- anyone who opened the site could POST to
--   /rest/v1/rpc/finish_block_cut
-- and complete a block cut — create slabs, consume a block, write remainders,
-- restock — with no login at all. SECURITY DEFINER means it runs with the
-- owner's rights, so row-level security does not stop it.
--
-- Safe to run. Verified before writing this:
--   * The app calls finish_block_cut and precut_release_slabs only from
--     src/app/(app)/cutting/actions.ts, through createAdminSupabaseClient() —
--     the SERVICE ROLE key, which bypasses grants entirely and is unaffected.
--   * handle_new_user is not called by anyone: it is the function behind the
--     trigger on_auth_user_created on auth.users. Triggers execute as the
--     table owner, not as the calling role, so revoking EXECUTE cannot affect
--     signup.
--   * No browser-side code calls any of the three (only comments reference
--     them).
--
-- Changes permissions only. No rows are read, written or deleted.
--
-- Rollback (only if something unexpected breaks):
--   GRANT EXECUTE ON FUNCTION public.finish_block_cut(...) TO anon, authenticated;
--   ...and the same for the other two.

do $$
declare
  fn record;
  n int := 0;
begin
  -- Match by name across every overload. finish_block_cut in particular has
  -- had more than one signature over its life (mig 020's 13-arg body and
  -- mig 131's 12-arg one), and leaving either one executable would defeat
  -- the point.
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('finish_block_cut', 'precut_release_slabs', 'handle_new_user')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    n := n + 1;
    raise notice 'revoked EXECUTE on %', fn.sig;
  end loop;
  raise notice '216: revoked EXECUTE on % function(s)', n;
end $$;

-- Leave a record of the intended end state so a future reader can re-check it:
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_execute,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_execute
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('finish_block_cut','precut_release_slabs','handle_new_user');
-- Both columns must read false for every row.
