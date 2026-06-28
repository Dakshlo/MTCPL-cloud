/**
 * Dispatch "Check & verify" — full-page Excel-style review that replaces the
 * inline Approve / Cancel / Edit-slabs buttons on the Waiting-approval tab.
 *
 * Shows every slab grouped (identical label+desc+dims collapse into one row
 * with a quantity + all their codes), each row billed in CFT (default) or SFT
 * in two separate groups. Verifying creates the challan + sends the truck on
 * the road; Cancel returns every slab to Make Dispatch.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { groupDispatchSlabs, dash, type DispatchSlabInput } from "@/lib/dispatch-grouping";
import { resolveDispatchIncharge, fetchInchargeOptions } from "@/lib/dispatch-incharge";
import { challanCode, financialYear } from "@/lib/doc-code";
import { CheckGrid } from "./check-grid";
import { InchargePicker } from "./incharge-picker";
import { LoadNumberEditor } from "./load-number-editor";
import { ChallanNumberEditor } from "./challan-number-editor";

export const dynamic = "force-dynamic";

// Only senior dispatch roles verify (the dispatch incharge is read-only and
// never reaches this page — they wait for a senior).
const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

type Params = Promise<{ id: string }>;
type Search = Promise<{ [k: string]: string | string[] | undefined }>;

export default async function DispatchCheckPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dispatch");
  const { id } = await params;
  const sp = await searchParams;
  const toast = typeof sp.dispatch_toast === "string" ? sp.dispatch_toast : null;
  const admin = createAdminSupabaseClient();

  const { data: dispatch } = await admin
    .from("dispatches")
    .select(
      "id, challan_number, load_number, temple, vehicle_no, driver_name, driver_phone, expected_delivery_date, notes, dispatched_at, approved_at, delivered_at, incharge_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!dispatch) notFound();
  // Already verified / delivered → nothing to check; bounce to the live tab.
  if (dispatch.approved_at) redirect("/dispatch?tab=out_for_delivery");
  if (dispatch.delivered_at) redirect("/dispatch?tab=delivered");

  // Mig 163 — weight mode + saved whole-truck weight. Best-effort (separate
  // select) so a pre-migration schema falls back to per-slab instead of 404-ing
  // the page on an unknown column.
  let initialWeightMode: "slab" | "truck" = "slab";
  let initialLoadTonnes = 0;
  {
    const { data: wm } = await admin
      .from("dispatches")
      .select("weight_mode, load_weight_tonnes")
      .eq("id", id)
      .maybeSingle();
    if (wm) {
      initialWeightMode = (wm as { weight_mode?: string }).weight_mode === "truck" ? "truck" : "slab";
      initialLoadTonnes = Number((wm as { load_weight_tonnes?: number | null }).load_weight_tonnes) || 0;
    }
  }

  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, weight_tonnes, measure_unit, desc_override, additional_override")
    .eq("dispatch_id", id);
  const logRows = (logs ?? []) as Array<{
    slab_requirement_id: string | null;
    weight_tonnes: number | null;
    measure_unit: string | null;
    desc_override: string | null;
    additional_override: string | null;
  }>;
  const slabIds = [...new Set(logRows.map((l) => l.slab_requirement_id).filter(Boolean) as string[])];

  const unitBy = new Map<string, "cft" | "sft">();
  const weightBy = new Map<string, number>();
  // Saved per-slab description overrides (Mig 162); null = use slab's own. Only
  // present if this dispatch was verified then undone back to Check.
  const descOv = new Map<string, string | null>();
  const addlOv = new Map<string, string | null>();
  for (const l of logRows) {
    if (!l.slab_requirement_id) continue;
    unitBy.set(l.slab_requirement_id, l.measure_unit === "sft" ? "sft" : "cft");
    weightBy.set(l.slab_requirement_id, Number(l.weight_tonnes) || 0);
    descOv.set(l.slab_requirement_id, l.desc_override);
    addlOv.set(l.slab_requirement_id, l.additional_override);
  }

  let inputs: DispatchSlabInput[] = [];
  if (slabIds.length > 0) {
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select(
        "id, label, description, additional_description, component_section, component_element, length_ft, width_ft, thickness_ft",
      )
      .in("id", slabIds);
    const order = new Map(slabIds.map((sid, i) => [sid, i]));
    inputs = ((slabRows ?? []) as Array<Record<string, unknown>>)
      .map((s) => ({
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
      }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  const groups = groupDispatchSlabs(inputs);

  // Available slabs for this temple that could still be added — completed
  // (carving-approved, ready), NOT parked (storage is pulled in via the picker's
  // toggles), and not yet on any dispatch.
  const { data: availRows } = await admin
    .from("slab_requirements")
    .select("id, label, length_ft, width_ft, thickness_ft")
    .eq("status", "completed")
    .eq("is_parked", false)
    .eq("temple", dispatch.temple)
    .order("created_at", { ascending: true })
    .limit(500);
  const availIds = ((availRows ?? []) as Array<{ id: string }>).map((s) => s.id);

  // Mig 160 — each ready slab's dispatch station (Main vs a vendor shed), from
  // its carving_items.dispatch_station_id, so the picker can filter by station.
  const availStationBy = new Map<string, string>();
  if (availIds.length > 0) {
    const { data: ciRows } = await admin
      .from("carving_items")
      .select("slab_requirement_id, dispatch_station_id, ready_to_dispatch_at")
      .in("slab_requirement_id", availIds);
    for (const r of (ciRows ?? []) as Array<{ slab_requirement_id: string; dispatch_station_id: string | null; ready_to_dispatch_at: string | null }>) {
      const prev = availStationBy.get(r.slab_requirement_id);
      if (!prev || r.ready_to_dispatch_at) availStationBy.set(r.slab_requirement_id, r.dispatch_station_id ?? "");
    }
  }
  const { data: stationRows } = await admin
    .from("dispatch_stations")
    .select("id, name, is_default, vendor_id")
    .eq("is_active", true)
    .order("name");
  const stations = (stationRows ?? []) as Array<{ id: string; name: string; is_default: boolean; vendor_id: string | null }>;
  const mainStationId = stations.find((s) => s.is_default)?.id ?? null;
  const shedIds = new Set(stations.filter((s) => s.vendor_id).map((s) => s.id));
  const vendorSheds = stations.filter((s) => s.vendor_id).map((s) => ({ id: s.id, name: s.name }));
  const stationOf = (slabId: string): string => {
    const sid = availStationBy.get(slabId) || null;
    return sid && shedIds.has(sid) && sid !== mainStationId ? sid : "main";
  };

  const available = ((availRows ?? []) as Array<Record<string, unknown>>).map((s) => {
    const l = Number(s.length_ft) || 0, w = Number(s.width_ft) || 0, t = Number(s.thickness_ft) || 0;
    return {
      id: s.id as string,
      label: (s.label as string | null) ?? null,
      dimensions: `${l}×${w}×${t} in`,
      cft: (l * w * t) / 1728,
      station: stationOf(s.id as string),
    };
  });
  // Same roster as canDispatchStorage() in dispatch/actions.ts.
  const canUseStorage = ["owner", "developer", "carving_head", "senior_incharge", "dispatch"].includes(profile.role);

  // Temple site + the resolved dispatch incharge — for the compact header.
  const overrideInchargeId = (dispatch as { incharge_id?: string | null }).incharge_id ?? null;
  const [{ data: templeRow }, handlingMan, inchargeOptions] = await Promise.all([
    admin
      .from("temples")
      .select("site_location, site_incharge_name, site_incharge_phone, installer_name, installer_phone")
      .eq("name", dispatch.temple)
      .maybeSingle(),
    // Mig 159 — dispatch override → temple's linked incharge → legacy global.
    resolveDispatchIncharge(admin, { inchargeId: overrideInchargeId, temple: dispatch.temple }),
    fetchInchargeOptions(admin),
  ]);
  const site = (templeRow ?? {}) as {
    site_location?: string | null;
    site_incharge_name?: string | null;
    site_incharge_phone?: string | null;
    installer_name?: string | null;
    installer_phone?: string | null;
  };

  const challanLabel = dispatch.challan_number != null
    ? `CHLN-${String(dispatch.challan_number).padStart(4, "0")}`
    : `DISP-${id.slice(0, 8).toUpperCase()}`;
  const loadNumber = (dispatch as { load_number?: number | null }).load_number ?? null;

  // Mig 168 — unified per-FY challan number (editable here). Best-effort select
  // so a pre-migration schema (no doc_fy/doc_seq columns) just shows the legacy
  // read-only label instead of the editor.
  let docFy: string | null = null;
  let docSeq: number | null = null;
  let docNumAvailable = false;
  {
    const { data: dn, error: dnErr } = await admin.from("dispatches").select("doc_fy, doc_seq").eq("id", id).maybeSingle();
    if (!dnErr) {
      docNumAvailable = true;
      docFy = (dn as { doc_fy?: string | null } | null)?.doc_fy ?? null;
      docSeq = (dn as { doc_seq?: number | null } | null)?.doc_seq ?? null;
    }
  }
  const editorFy = (docFy ?? "").trim() || financialYear(dispatch.dispatched_at);
  const unifiedLabel = challanCode(docFy, docSeq) ?? challanLabel;

  const meta: Array<[string, string]> = [
    ["Vehicle", dash(dispatch.vehicle_no)],
    ["Driver", dash(dispatch.driver_name)],
    ["Driver phone", dash(dispatch.driver_phone)],
    ["Site", dash(site.site_location)],
    ["Site incharge", site.site_incharge_name ? `${site.site_incharge_name}${site.site_incharge_phone ? ` · ${site.site_incharge_phone}` : ""}` : "-"],
    ["Installation by", site.installer_name ? `${site.installer_name}${site.installer_phone ? ` · ${site.installer_phone}` : ""}` : "-"],
    ["MTCPL incharge", handlingMan?.name ? `${handlingMan.name}${handlingMan.phone ? ` · ${handlingMan.phone}` : ""}` : "-"],
    // Load no. is rendered separately (editable) — see LoadNumberEditor below.
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 40, maxWidth: 1280 }}>
      <div>
        <Link href="/dispatch?tab=provisional" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
          ← Waiting approval
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>🔍 Check &amp; verify</h1>
          {docNumAvailable ? (
            <ChallanNumberEditor dispatchId={id} fy={editorFy} seq={docSeq} />
          ) : (
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#D97706", fontSize: 15 }}>{challanLabel}</span>
          )}
          <span style={{ fontSize: 14, color: "var(--muted)" }}>· 🏛 {dispatch.temple}</span>
        </div>
      </div>

      {toast && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {toast}
        </div>
      )}

      {/* Compact header — all the info that prints on the (landscape) challan,
          shown tightly so the grid gets the room. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: "6px 18px",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
          background: "var(--surface)",
        }}
      >
        {meta.map(([label, val]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={val}>{val}</div>
          </div>
        ))}
        <LoadNumberEditor dispatchId={id} initial={loadNumber} />
      </div>

      {/* Mig 159 — change the dispatch incharge for THIS truck (overrides the
          temple's default); the new name/phone prints on the challan. */}
      <InchargePicker
        dispatchId={id}
        options={inchargeOptions.map((o) => ({ id: o.id ?? "", name: o.name, phone: o.phone }))}
        overrideId={overrideInchargeId}
        resolvedLabel={handlingMan?.name ? `${handlingMan.name}${handlingMan.phone ? ` · ${handlingMan.phone}` : ""}` : "—"}
      />

      <CheckGrid dispatchId={id} groups={groups} challanLabel={unifiedLabel} available={available} temple={dispatch.temple} vendorSheds={vendorSheds} canUseStorage={canUseStorage} initialWeightMode={initialWeightMode} initialLoadTonnes={initialLoadTonnes} />
    </div>
  );
}
