// Mig 155 — Import externally-cut slabs from Excel (replaces the old
// "Add external cut slab" form). Same full template → fill → upload →
// review → approve flow as Required Sizes (Category 1/2 · Label ·
// Description · Additional · Stock Location · L/W/H · Qty · Quality); the
// batch is tagged external_slab and approved from Slab Import Approvals as
// "External slab add".

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canAddExternalCutSlab } from "@/lib/cutting-permissions";
import { ExternalSlabImportClient, type TempleOpt, type ExistingCats } from "./external-slab-import-client";

export const dynamic = "force-dynamic";

export default async function ExternalSlabImportPage() {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) redirect("/carving");
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
  const stoneList = stoneOpts.length > 0 ? stoneOpts : ["PinkStone", "WhiteStone"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40, maxWidth: 1200 }}>
      <div>
        <Link href="/carving" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Carving</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>📥 Import external cut slabs from Excel</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Slabs cut <strong>outside</strong> our pipeline. Pick a temple + stone, download the template, fill in Category 1/2 · label · description · stock location · size · quantity, upload it back, review, then send for approval. After approval they land in <strong>Unassigned</strong> — or straight on Dispatch if you tick that option.
        </p>
      </div>
      <ExternalSlabImportClient temples={templeOpts} stones={stoneList} existingCats={existingCats} />
    </div>
  );
}

// Per-temple Category 1 / Category 2 / Label values already used — powers
// the review-step suggestion datalists. Same logic as the Required Sizes
// import page (fetchExistingCats there); duplicated here because that one is
// module-private. Paginated + deduped so a big table doesn't hit the
// PostgREST 1000-row cap.
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
