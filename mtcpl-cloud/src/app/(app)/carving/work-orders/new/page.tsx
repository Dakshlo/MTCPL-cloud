import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { NewWorkOrderForm, type PickableSlab, type VendorOpt } from "./new-work-order-form";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

export default async function NewWorkOrderPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const admin = createAdminSupabaseClient();

  const { data: vRows } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("vendor_type", "Outsource")
    .eq("is_active", true)
    .order("name");
  const vendors: VendorOpt[] = ((vRows ?? []) as Array<{ id: string; name: string }>).map((v) => ({
    id: v.id,
    name: v.name,
  }));

  // Slabs that can be put on a work order: still in the pre-carving pool
  // (open / planned / cut_done). Paginated past the PostgREST 1000-row cap
  // so the picker shows EVERY eligible slab, not just the latest few.
  type SRow = {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    status: string;
    length_ft: number | string;
    width_ft: number | string;
    thickness_ft: number | string;
    stock_location: string | null;
    updated_at: string | null;
    description: string | null;
    component_section: string | null;
    component_element: string | null;
    additional_description: string | null;
  };
  const sRows: SRow[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data } = await admin
      .from("slab_requirements")
      .select(
        "id, label, temple, stone, status, length_ft, width_ft, thickness_ft, stock_location, updated_at, description, component_section, component_element, additional_description",
      )
      .in("status", ["open", "planned", "cut_done"])
      // Mig 132 — slabs with a pending cancel request are locked: they
      // can't be put on a new work order until the owner decides.
      .is("cancel_requested_at", null)
      .order("created_at", { ascending: false })
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    sRows.push(...(data as SRow[]));
    if (data.length < 1000) break;
  }

  // Exclude slabs that are CURRENTLY committed to a pending (planned, not yet
  // sent) work-order line — those are spoken for and can't be double-added.
  // We deliberately do NOT exclude "sent" lines: a sent slab is
  // carving_assigned (already filtered out by status above), and once its
  // carving job is cancelled/returned it goes back to cut_done and must
  // reappear here. Keying on a non-cancelled line instead kept such returned
  // slabs hidden from the picker even though they showed in CNC-unassigned.
  const { data: liveLines } = await admin
    .from("carving_work_order_items")
    .select("slab_requirement_id, line_status")
    .eq("line_status", "planned")
    .not("slab_requirement_id", "is", null);
  const taken = new Set(
    ((liveLines ?? []) as Array<{ slab_requirement_id: string | null }>)
      .map((r) => r.slab_requirement_id)
      .filter(Boolean) as string[],
  );

  // Stone palettes for the 3D slab thumbnails on the picker cards.
  const { data: stoneRows } = await admin
    .from("stone_types")
    .select("id, name, color_top, color_front, color_side, sort_order, is_active")
    .order("sort_order")
    .order("name");
  const stoneTypes = (stoneRows ?? []) as StoneTypeDef[];

  const slabs: PickableSlab[] = sRows
    .filter((s) => !taken.has(s.id))
    .map((s) => ({
      id: s.id,
      label: s.label,
      temple: s.temple,
      stone: s.stone,
      status: s.status,
      length_ft: Number(s.length_ft) || 0,
      width_ft: Number(s.width_ft) || 0,
      thickness_ft: Number(s.thickness_ft) || 0,
      stock_location: s.stock_location,
      updated_at: s.updated_at,
      description: s.description,
      component_section: s.component_section,
      component_element: s.component_element,
      additional_description: s.additional_description,
    }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 1180 }}>
      <div>
        <Link href="/carving?mode=outsource&tab=workorders" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Work orders</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>New work order</h1>
      </div>
      <NewWorkOrderForm vendors={vendors} slabs={slabs} stoneTypes={stoneTypes} />
    </div>
  );
}
