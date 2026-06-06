import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
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
  };
  const sRows: SRow[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, label, temple, stone, status, length_ft, width_ft, thickness_ft")
      .in("status", ["open", "planned", "cut_done"])
      .order("created_at", { ascending: false })
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    sRows.push(...(data as SRow[]));
    if (data.length < 1000) break;
  }

  // Exclude slabs already on a live (non-cancelled) work-order line.
  const { data: liveLines } = await admin
    .from("carving_work_order_items")
    .select("slab_requirement_id, line_status")
    .neq("line_status", "cancelled")
    .not("slab_requirement_id", "is", null);
  const taken = new Set(
    ((liveLines ?? []) as Array<{ slab_requirement_id: string | null }>)
      .map((r) => r.slab_requirement_id)
      .filter(Boolean) as string[],
  );

  const slabs: PickableSlab[] = sRows
    .filter((s) => !taken.has(s.id))
    .map((s) => ({
      id: s.id,
      label: s.label,
      temple: s.temple,
      stone: s.stone,
      status: s.status,
      dims: `${Number(s.length_ft)}×${Number(s.width_ft)}×${Number(s.thickness_ft)}″`,
    }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 920 }}>
      <div>
        <Link href="/carving/work-orders" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Work orders</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>New work order</h1>
      </div>
      <NewWorkOrderForm vendors={vendors} slabs={slabs} />
    </div>
  );
}
