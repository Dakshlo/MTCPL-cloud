import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// Admin cleanup (Daksh, June 2026) — "uncategorized open slabs": slabs that
// are still at status 'open' (Pending in Temple View) AND have NEITHER a
// Category 1 (component_section) NOR a Category 2 (component_element). These
// are the bare rows sitting in the "Unassigned" group with nothing filled
// in. The cleanup tool soft-archives them (status -> 'rejected', which the
// Temple View excludes entirely — unlike 'cancelled') after exporting an
// Excel record. See /temples/cleanup + /api/slabs/uncategorized-export +
// archiveUncategorizedOpenSlabsAction.

export type UncatSlab = {
  id: string;
  temple: string;
  label: string | null;
  description: string | null;
  additional_description: string | null;
  component_section: string | null;
  component_element: string | null;
  stone: string | null;
  quality: string | null;
  length_ft: number | null;
  width_ft: number | null;
  thickness_ft: number | null;
  priority: boolean | null;
  status: string;
  created_at: string | null;
  batch_id: string | null;
};

/** A slab counts as uncategorized when BOTH Category 1 (component_section)
 *  AND Category 2 (component_element) are blank (null or whitespace). */
export function isUncategorized(s: { component_section: string | null; component_element: string | null }): boolean {
  const c1 = (s.component_section ?? "").trim();
  const c2 = (s.component_element ?? "").trim();
  return !c1 && !c2;
}

/** All OPEN + fully-uncategorized slabs for one temple. Paginated + filtered
 *  in JS (PostgREST OR-on-empty-string is fragile, so we scan the temple's
 *  open slabs and filter precisely here). Stable id ordering for paging. */
export async function fetchUncategorizedOpenSlabs(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  temple: string,
): Promise<UncatSlab[]> {
  const PAGE = 1000;
  const MAX = 300000;
  const out: UncatSlab[] = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("id, temple, label, description, additional_description, component_section, component_element, stone, quality, length_ft, width_ft, thickness_ft, priority, status, created_at, batch_id")
      .eq("temple", temple)
      .eq("status", "open")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as UncatSlab[];
    if (rows.length === 0) break;
    for (const r of rows) if (isUncategorized(r)) out.push(r);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Per-temple counts of open + fully-uncategorized slabs (for the cleanup
 *  dashboard). One paginated scan over all open slabs. */
export async function countUncategorizedOpenByTemple(
  admin: ReturnType<typeof createAdminSupabaseClient>,
): Promise<Record<string, number>> {
  const PAGE = 1000;
  const MAX = 1000000;
  const acc: Record<string, number> = {};
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("id, temple, component_section, component_element")
      .eq("status", "open")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Array<{ id: string; temple: string | null; component_section: string | null; component_element: string | null }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!r.temple) continue;
      if (isUncategorized(r)) acc[r.temple] = (acc[r.temple] ?? 0) + 1;
    }
    if (rows.length < PAGE) break;
  }
  return acc;
}
