import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { SlabImportClient, type TempleOpt, type ExistingCats } from "./slab-import-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "team_head", "senior_incharge", "slab_entry", "developer"];

export default async function SlabImportPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/slabs");
  const admin = createAdminSupabaseClient();

  const [{ data: temples }, { data: stones }, existingCats] = await Promise.all([
    admin.from("temples").select("id, name, code_prefix, default_stone").eq("is_active", true).order("name"),
    admin.from("stone_types").select("id, name").order("name"),
    fetchExistingCats(admin),
  ]);

  const templeOpts: TempleOpt[] = ((temples ?? []) as Array<{ name: string; default_stone: string | null }>).map((t) => ({
    name: t.name,
    default_stone: t.default_stone ?? null,
  }));
  const stoneOpts = ((stones ?? []) as Array<{ name: string }>).map((s) => s.name);
  // Fallback so the picker always works even if stone_types is empty.
  const stoneList = stoneOpts.length > 0 ? stoneOpts : ["PinkStone", "WhiteStone"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40, maxWidth: 1100 }}>
      <div>
        <Link href="/slabs" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Required Sizes</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>📥 Import slabs from Excel</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Pick a temple + stone, download the template, fill in label / description / size / quantity, upload it back, review, then add. Everything lands in <strong>Required Sizes</strong> as a deletable group.
        </p>
      </div>
      <SlabImportClient temples={templeOpts} stones={stoneList} existingCats={existingCats} />
    </div>
  );
}

// Distinct Category 1 / Category 2 / Label values already used per temple —
// powers the review-step suggestion datalists. Paginated + deduped so a big
// slab table doesn't blow the PostgREST 1000-row cap.
async function fetchExistingCats(
  admin: ReturnType<typeof createAdminSupabaseClient>,
): Promise<ExistingCats> {
  const PAGE = 1000;
  const MAX = 60000;
  const acc: Record<string, { cat1: Set<string>; cat2: Set<string>; labels: Set<string> }> = {};
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("temple, component_section, component_element, label")
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Array<{ temple: string | null; component_section: string | null; component_element: string | null; label: string | null }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      const t = (r.temple || "").trim();
      if (!t) continue;
      const b = (acc[t] ??= { cat1: new Set(), cat2: new Set(), labels: new Set() });
      const c1 = (r.component_section || "").trim();
      const c2 = (r.component_element || "").trim();
      const lb = (r.label || "").trim();
      if (c1) b.cat1.add(c1);
      if (c2) b.cat2.add(c2);
      if (lb) b.labels.add(lb);
    }
    if (rows.length < PAGE) break;
  }
  const out: ExistingCats = {};
  for (const [t, b] of Object.entries(acc)) {
    out[t] = {
      cat1: [...b.cat1].sort((a, c) => a.localeCompare(c, undefined, { numeric: true })),
      cat2: [...b.cat2].sort((a, c) => a.localeCompare(c, undefined, { numeric: true })),
      labels: [...b.labels].sort((a, c) => a.localeCompare(c, undefined, { numeric: true })),
    };
  }
  return out;
}
