import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { SlabImportClient, type TempleOpt } from "./slab-import-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "team_head", "senior_incharge", "slab_entry", "developer"];

export default async function SlabImportPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/slabs");
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
      <SlabImportClient temples={templeOpts} stones={stoneList} />
    </div>
  );
}
