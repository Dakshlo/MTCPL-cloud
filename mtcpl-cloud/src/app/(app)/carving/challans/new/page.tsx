import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { cftFromSlab, sftFromSlab } from "@/lib/dimensions";
import { NewCarvingChallanForm, type BillableSlab } from "./new-challan-form";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

export default async function NewCarvingChallanPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const admin = createAdminSupabaseClient();

  // Approved Outsource carving jobs (review_approved_at set).
  const { data: itemRows } = await admin
    .from("carving_items")
    .select(
      "id, vendor_id, vendor_name, vendor_type, slab_requirement_id, jobwork_rate, jobwork_unit, review_approved_at",
    )
    .eq("vendor_type", "Outsource")
    .not("review_approved_at", "is", null);
  const approved = ((itemRows ?? []) as Array<{
    id: string;
    vendor_id: string;
    vendor_name: string;
    slab_requirement_id: string;
    jobwork_rate: number | string | null;
    jobwork_unit: string | null;
  }>);

  // Exclude slabs already on a non-cancelled challan.
  const { data: billedRows } = await admin
    .from("carving_challan_items")
    .select("carving_item_id, carving_challans!inner(cancelled_at)");
  const billed = new Set(
    ((billedRows ?? []) as unknown as Array<{
      carving_item_id: string | null;
      carving_challans: { cancelled_at: string | null } | null;
    }>)
      .filter((r) => r.carving_item_id && !r.carving_challans?.cancelled_at)
      .map((r) => r.carving_item_id as string),
  );
  const open = approved.filter((i) => !billed.has(i.id));

  // Slab dims for qty + display.
  const slabIds = [...new Set(open.map((i) => i.slab_requirement_id))];
  const slabById = new Map<
    string,
    { label: string | null; temple: string; length: number; width: number; thickness: number }
  >();
  if (slabIds.length > 0) {
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, label, temple, length_ft, width_ft, thickness_ft")
      .in("id", slabIds);
    for (const s of (slabRows ?? []) as Array<{
      id: string;
      label: string | null;
      temple: string;
      length_ft: number | string;
      width_ft: number | string;
      thickness_ft: number | string;
    }>) {
      slabById.set(s.id, {
        label: s.label,
        temple: s.temple,
        length: Number(s.length_ft),
        width: Number(s.width_ft),
        thickness: Number(s.thickness_ft),
      });
    }
  }

  const billable: BillableSlab[] = open.map((i) => {
    const s = slabById.get(i.slab_requirement_id);
    return {
      carvingItemId: i.id,
      vendorId: i.vendor_id,
      vendorName: i.vendor_name,
      slabId: i.slab_requirement_id,
      label: s?.label ?? null,
      temple: s?.temple ?? "",
      dims: s ? `${s.length}×${s.width}×${s.thickness}″` : "",
      cft: s ? Math.round(cftFromSlab(s.length, s.width, s.thickness) * 1000) / 1000 : 0,
      sft: s ? Math.round(sftFromSlab(s.length, s.width) * 1000) / 1000 : 0,
      snapRate: i.jobwork_rate != null ? Number(i.jobwork_rate) : null,
      // Mig 100 — carry the slab's own unit (job = flat per slab). Default cft.
      snapUnit: i.jobwork_unit === "sft" ? "sft" : i.jobwork_unit === "job" ? "job" : "cft",
    };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 880 }}>
      <div>
        <Link href="/carving/challans" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
          ← Jobwork challans
        </Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>New jobwork challan</h1>
      </div>
      <NewCarvingChallanForm billable={billable} />
    </div>
  );
}
