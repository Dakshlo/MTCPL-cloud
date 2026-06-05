/**
 * Slab Transfer dispatch list — the runner's home page.
 *
 * Renders every carving_assigned slab that hasn't been delivered to
 * the vendor yet, with three buckets:
 *
 *   1. Claimed by ME  — slabs this runner has locked. Big yellow
 *      "Mark delivered →" button each. Optional dropoff_note when
 *      they leave it somewhere different from the standard vendor
 *      dropoff location.
 *
 *   2. Available      — unclaimed slabs. Each has a "📦 Claim"
 *      button.
 *
 *   3. Claimed by others — read-only visibility into what other
 *      runners are working. carving_head + owner + developer can
 *      release someone else's claim (Unclaim button).
 *
 * Page is server-rendered to keep the list fresh; mutations route
 * through actions.ts which refreshAll() and redirect back here.
 *
 * Access: slab_transfer role lands here on login. carving_head +
 * owner + developer also see it (oversight).
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { TransferDispatchList } from "./transfer-list";

export default async function SlabTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string }>;
}) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
    "slab_transfer",
    // Mig 083 — storekeeper merged with slab_transfer.
    "storekeeper",
  ]);
  const admin = createAdminSupabaseClient();
  const params = await searchParams;

  // Pending + recently-delivered-by-me + vendors + stones.
  //   - Pending: carving_assigned, not yet received → the actionable
  //     list (Claimed/Available/Others buckets).
  //   - Delivered by me: last 48h of slabs THIS user marked
  //     received. Powers the success-confirmation "Delivered" section.
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const [
    { data: jobs },
    { data: deliveredByMe },
    { data: vendors },
    { data: stoneTypes },
  ] = await Promise.all([
    admin
      .from("carving_items")
      .select(
        "id, slab_requirement_id, vendor_id, vendor_name, vendor_type, urgency, status, assigned_at, claimed_by, claimed_at, claim_batch_id, requires_machine_type, batch_id",
      )
      .eq("status", "carving_assigned")
      .is("received_at_vendor_at", null)
      .order("urgency", { ascending: true })
      .order("assigned_at", { ascending: true }),
    admin
      .from("carving_items")
      .select(
        "id, slab_requirement_id, vendor_id, vendor_name, vendor_type, received_at_vendor_at, dropoff_note, urgency, requires_machine_type",
      )
      .eq("received_at_vendor_by", profile.id)
      .gte("received_at_vendor_at", since48h)
      .order("received_at_vendor_at", { ascending: false })
      .limit(30),
    admin
      .from("vendors")
      .select("id, name, vendor_type, dropoff_location")
      .in("vendor_type", ["CNC", "Outsource"]),
    admin
      .from("stone_types")
      .select("id, name, color_top, color_front, color_side, sort_order, is_active")
      .order("sort_order")
      .order("name"),
  ]);

  // Hydrate slab dims + stock_location. carving_items doesn't carry
  // dims directly — they're on slab_requirements. Pull both pending
  // and delivered slab ids in the same query.
  const slabIds = [
    ...(jobs ?? []).map((j) => j.slab_requirement_id),
    ...(deliveredByMe ?? []).map((j) => j.slab_requirement_id),
  ];
  const slabInfo = new Map<
    string,
    {
      temple: string;
      label: string | null;
      stone: string | null;
      length_ft: number;
      width_ft: number;
      thickness_ft: number;
      stock_location: string | null;
    }
  >();
  if (slabIds.length > 0) {
    const { data: slabs } = await admin
      .from("slab_requirements")
      .select(
        "id, temple, label, stone, length_ft, width_ft, thickness_ft, stock_location",
      )
      .in("id", slabIds);
    for (const s of slabs ?? []) {
      slabInfo.set(s.id, {
        temple: s.temple ?? "—",
        label: (s as { label?: string | null }).label ?? null,
        stone: (s as { stone?: string | null }).stone ?? null,
        length_ft: Number(s.length_ft) || 0,
        width_ft: Number(s.width_ft) || 0,
        thickness_ft: Number(s.thickness_ft) || 0,
        stock_location: (s as { stock_location?: string | null }).stock_location ?? null,
      });
    }
  }

  // Hydrate claimer names so we can show "claimed by X" on the rows.
  const claimerIds = [...new Set((jobs ?? []).map((j) => j.claimed_by).filter(Boolean) as string[])];
  const claimerNames = new Map<string, string>();
  if (claimerIds.length > 0) {
    const { data: claimers } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", claimerIds);
    for (const c of claimers ?? []) claimerNames.set(c.id, c.full_name ?? "—");
  }

  const vendorById = new Map(
    (vendors ?? []).map((v) => [
      v.id,
      {
        id: v.id,
        name: v.name,
        vendor_type: v.vendor_type as "CNC" | "Outsource",
        dropoff_location: (v as { dropoff_location?: string | null }).dropoff_location ?? null,
      },
    ]),
  );

  const rows = (jobs ?? []).map((j) => {
    const info = slabInfo.get(j.slab_requirement_id);
    const vendor = vendorById.get(j.vendor_id) ?? null;
    return {
      id: j.id,
      slab_id: j.slab_requirement_id,
      temple: info?.temple ?? "—",
      slab_label: info?.label ?? null,
      stone: info?.stone ?? null,
      length_ft: info?.length_ft ?? 0,
      width_ft: info?.width_ft ?? 0,
      thickness_ft: info?.thickness_ft ?? 0,
      stock_location: info?.stock_location ?? null,
      vendor_id: j.vendor_id,
      vendor_name: vendor?.name ?? j.vendor_name,
      vendor_type: vendor?.vendor_type ?? (j.vendor_type as "CNC" | "Outsource"),
      vendor_dropoff: vendor?.dropoff_location ?? null,
      urgency: (j.urgency === "urgent" ? "urgent" : "normal") as "urgent" | "normal",
      assigned_at: j.assigned_at,
      claimed_by: j.claimed_by ?? null,
      claimed_by_name: j.claimed_by ? claimerNames.get(j.claimed_by) ?? null : null,
      claimed_at: (j as { claimed_at?: string | null }).claimed_at ?? null,
      claim_batch_id: (j as { claim_batch_id?: string | null }).claim_batch_id ?? null,
      is_lathe: (j as { requires_machine_type?: string | null }).requires_machine_type === "lathe",
      batch_id: (j as { batch_id?: string | null }).batch_id ?? null,
    };
  });

  // Reshape "delivered by me" for the success-confirmation section.
  const deliveredRows = (deliveredByMe ?? []).map((j) => {
    const info = slabInfo.get(j.slab_requirement_id);
    const vendor = vendorById.get(j.vendor_id) ?? null;
    return {
      id: j.id,
      slab_id: j.slab_requirement_id,
      temple: info?.temple ?? "—",
      slab_label: info?.label ?? null,
      stone: info?.stone ?? null,
      length_ft: info?.length_ft ?? 0,
      width_ft: info?.width_ft ?? 0,
      thickness_ft: info?.thickness_ft ?? 0,
      vendor_name: vendor?.name ?? j.vendor_name,
      vendor_dropoff: vendor?.dropoff_location ?? null,
      delivered_at: (j as { received_at_vendor_at: string }).received_at_vendor_at,
      dropoff_note: (j as { dropoff_note?: string | null }).dropoff_note ?? null,
      urgency: ((j as { urgency?: string }).urgency === "urgent" ? "urgent" : "normal") as "urgent" | "normal",
      is_lathe: (j as { requires_machine_type?: string | null }).requires_machine_type === "lathe",
    };
  });

  return (
    <TransferDispatchList
      rows={rows}
      delivered={deliveredRows}
      currentUserId={profile.id}
      canUnclaimOthers={["developer", "owner", "carving_head"].includes(profile.role)}
      stoneTypes={stoneTypes ?? []}
      toast={params.toast ?? null}
    />
  );
}
