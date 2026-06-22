// Mig 155 — Import externally-cut slabs from Excel (replaces the old
// "Add external cut slab" form). Same template → fill → upload → review →
// approve flow as Required Sizes; the batch is tagged external_slab and
// approved from Slab Import Approvals as "External slab add".

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canAddExternalCutSlab } from "@/lib/cutting-permissions";
import { ExternalSlabImportClient, type TempleOpt } from "./external-slab-import-client";

export const dynamic = "force-dynamic";

export default async function ExternalSlabImportPage() {
  const { profile } = await requireAuth();
  if (!canAddExternalCutSlab(profile)) redirect("/carving");
  const admin = createAdminSupabaseClient();

  const [{ data: temples }, { data: stones }] = await Promise.all([
    admin.from("temples").select("id, name, code_prefix, default_stone").eq("is_active", true).order("name"),
    admin.from("stone_types").select("id, name").order("name"),
  ]);

  const templeOpts: TempleOpt[] = ((temples ?? []) as Array<{ name: string; default_stone: string | null }>).map((t) => ({
    name: t.name,
    default_stone: t.default_stone ?? null,
  }));
  const stoneOpts = ((stones ?? []) as Array<{ name: string }>).map((s) => s.name);
  const stoneList = stoneOpts.length > 0 ? stoneOpts : ["PinkStone", "WhiteStone"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40, maxWidth: 1100 }}>
      <div>
        <Link href="/carving" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Carving</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>📥 Import external cut slabs from Excel</h1>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Slabs cut <strong>outside</strong> our pipeline. Pick a temple + stone, download the template, fill in label / description / stock location / size / quantity, upload it back, review, then send for approval. After approval they land in <strong>Unassigned</strong> — or straight on Dispatch if you tick that option.
        </p>
      </div>
      <ExternalSlabImportClient temples={templeOpts} stones={stoneList} />
    </div>
  );
}
