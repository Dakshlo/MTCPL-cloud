import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Fetch EVERY block id, paginated.
 *
 * Supabase/PostgREST caps a single .select() response at its db-max-rows (1000)
 * — and `.limit(100000)` does NOT raise that cap. So once the `blocks` table
 * passes 1000 rows the id pool silently truncates, and `generateNextCode()`
 * picks an already-TAKEN code (max of a partial set), which then fails to insert
 * → "Unable to generate a unique block ID". Ranging in 1000-row pages (ordered
 * by id for stable paging) returns the complete pool. Same fix pattern as the
 * invoices register (see [[reference-mtcpl-postgrest-row-cap]]).
 */
export async function fetchAllBlockIds(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 1_000_000; from += PAGE) {
    const { data, error } = await supabase
      .from("blocks")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Array<{ id: string }>;
    for (const r of rows) out.push(r.id);
    if (rows.length < PAGE) break;
  }
  return out;
}
