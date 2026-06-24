/**
 * Dispatch → Invoicing bridge (Mig 154, reworked in Mig 158).
 *
 * When a dispatch is verified it is mirrored into an invoicing challan so the
 * accountant can price it. Mig 158: the client is the TEMPLE itself, so this no
 * longer needs a temple→party mapping — every verified dispatch produces a
 * challan, tagged with its temple. Idempotent via challans.source_dispatch_id.
 *
 * Also used by the invoicing "Sync from dispatch" action to backfill any
 * approved dispatch that predates this flow (e.g. a truck already on the road).
 */

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { groupDispatchSlabs, type DispatchSlabInput } from "@/lib/dispatch-grouping";

export async function createInvoicingChallanFromDispatch(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  dispatchId: string,
  temple: string,
  challanNumber: number | null,
  actorId: string,
): Promise<"created" | "exists" | "empty"> {
  const { data: existing } = await admin
    .from("challans")
    .select("id")
    .eq("source_dispatch_id", dispatchId)
    .maybeSingle();
  if (existing) return "exists";

  // Per-slab logs carry the billing unit (cft/sft, chosen at Check) + weight.
  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, weight_tonnes, measure_unit, desc_override, additional_override")
    .eq("dispatch_id", dispatchId);
  const logRows = (logs ?? []) as Array<{
    slab_requirement_id: string | null;
    weight_tonnes: number | null;
    measure_unit: string | null;
    desc_override: string | null;
    additional_override: string | null;
  }>;
  const slabIds = [...new Set(logRows.map((l) => l.slab_requirement_id).filter(Boolean) as string[])];
  if (slabIds.length === 0) return "empty";

  const { data: slabs } = await admin
    .from("slab_requirements")
    .select(
      "id, label, description, additional_description, component_section, component_element, length_ft, width_ft, thickness_ft",
    )
    .in("id", slabIds);

  const unitBy = new Map<string, "cft" | "sft">();
  const weightBy = new Map<string, number>();
  // Per-slab challan/invoice description overrides (Mig 162); null = use slab's own.
  const descOv = new Map<string, string | null>();
  const addlOv = new Map<string, string | null>();
  for (const l of logRows) {
    if (!l.slab_requirement_id) continue;
    unitBy.set(l.slab_requirement_id, l.measure_unit === "sft" ? "sft" : "cft");
    weightBy.set(l.slab_requirement_id, Number(l.weight_tonnes) || 0);
    descOv.set(l.slab_requirement_id, l.desc_override);
    addlOv.set(l.slab_requirement_id, l.additional_override);
  }

  const inputs: DispatchSlabInput[] = ((slabs ?? []) as Array<Record<string, unknown>>).map((s) => ({
    id: s.id as string,
    label: (s.label as string | null) ?? null,
    description: descOv.get(s.id as string) ?? ((s.description as string | null) ?? null),
    additional_description: addlOv.get(s.id as string) ?? ((s.additional_description as string | null) ?? null),
    component_section: (s.component_section as string | null) ?? null,
    component_element: (s.component_element as string | null) ?? null,
    length_ft: Number(s.length_ft) || 0,
    width_ft: Number(s.width_ft) || 0,
    thickness_ft: Number(s.thickness_ft) || 0,
    weight_tonnes: weightBy.get(s.id as string) ?? null,
    measure_unit: unitBy.get(s.id as string) ?? "cft",
  }));
  const groups = groupDispatchSlabs(inputs);
  if (groups.length === 0) return "empty";

  const chalanLabel =
    challanNumber != null ? `CHLN-${String(challanNumber).padStart(4, "0")}` : dispatchId.slice(0, 8);
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  // Client = the temple (Mig 158). No invoice party.
  const { data: header, error } = await admin
    .from("challans")
    .insert({
      challan_date: today,
      temple,
      invoice_party_id: null,
      notes: `Auto from dispatch ${chalanLabel} · ${temple}`,
      source_dispatch_id: dispatchId,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error || !header) return "empty";

  const items = groups.map((g, i) => {
    const dims = `${g.length_ft}×${g.width_ft}×${g.thickness_ft} in`;
    // Standalone description (override-aware) — Label is its own column, so no
    // "label · …" prefix; the team's edited text shows cleanly. Dims if blank.
    const desc = ((g.description ?? "").trim() || dims).slice(0, 500);
    return {
      challan_id: (header as { id: string }).id,
      description: desc || dims,
      quantity: g.qty,
      unit: g.measure_unit,
      position: i,
      codes: g.codes.join(", "),
      label: g.label,
      additional_description: g.additional_description,
      component_section: g.component_section,
      component_element: g.component_element,
      length_ft: g.length_ft,
      width_ft: g.width_ft,
      thickness_ft: g.thickness_ft,
      weight_tonnes: g.weightTonnes,
      measure_unit: g.measure_unit,
      measure_qty: g.measureQty,
    };
  });
  await admin.from("challan_items").insert(items);
  return "created";
}
