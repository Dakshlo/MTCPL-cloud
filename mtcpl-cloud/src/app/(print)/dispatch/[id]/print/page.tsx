/**
 * Dispatch challan print page — A4 LANDSCAPE.
 *
 * Wide because the office challan lists every slab attribute (code, label,
 * description, categories, dims, qty, weight, cft/sft). CFT and SFT slabs are
 * shown in separate tables. All the routing/contact info is packed into a tight
 * header strip up top (mirrors the handwritten book they use today). Blank
 * fields print as "-".
 */

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { resolveDispatchIncharge } from "@/lib/dispatch-incharge";
import { groupDispatchSlabs, groupRowsByStone, dash, type DispatchSlabInput, type DispatchGroupRow } from "@/lib/dispatch-grouping";
import { PrintBtn } from "./print-btn";

type Params = Promise<{ id: string }>;
type Search = Promise<{ units?: string; weights?: string; descs?: string; weight_mode?: string; truck_weight?: string }>;

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export default async function DispatchChallanPrintPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  await requireAuth(["developer", "owner", "team_head", "senior_incharge", "carving_head", "cutting_operator", "dispatch"]);
  const { id } = await params;
  // Preview from the Check page passes the current (unsaved) cft/sft toggles +
  // edited weights so the grouped challan matches the screen before verifying.
  const { units: unitsParam, weights: weightsParam, descs: descsParam, weight_mode: weightModeParam, truck_weight: truckWeightParam } = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data: dispatch, error } = await admin
    .from("dispatches")
    .select(
      "id, challan_number, load_number, temple, vehicle_no, driver_name, driver_phone, expected_delivery_date, notes, dispatched_at, dispatched_by, approved_at, delivered_at, delivered_by, receiver_name, delivery_note, incharge_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !dispatch) notFound();

  // Mig 163 — weight mode + whole-truck weight. Best-effort (separate select) so
  // a pre-migration schema just falls back to per-slab. The Check-page preview
  // overrides with the on-screen choice.
  let weightMode: "slab" | "truck" = "slab";
  let loadTonnes = 0;
  {
    const { data: wm } = await admin.from("dispatches").select("weight_mode, load_weight_tonnes").eq("id", id).maybeSingle();
    if (wm) {
      weightMode = (wm as { weight_mode?: string }).weight_mode === "truck" ? "truck" : "slab";
      loadTonnes = Number((wm as { load_weight_tonnes?: number | null }).load_weight_tonnes) || 0;
    }
  }
  if (weightModeParam) {
    weightMode = weightModeParam === "truck" ? "truck" : "slab";
    loadTonnes = Number(truckWeightParam) || 0;
  }

  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, weight_tonnes, measure_unit, desc_override, additional_override")
    .eq("dispatch_id", id);
  const logRows = (logs ?? []) as Array<{ slab_requirement_id: string | null; weight_tonnes: number | null; measure_unit: string | null; desc_override: string | null; additional_override: string | null }>;
  const slabIds = [...new Set(logRows.map((l) => l.slab_requirement_id).filter(Boolean) as string[])];
  const unitBy = new Map<string, "cft" | "sft">();
  const weightBy = new Map<string, number>();
  // Per-slab challan description overrides (Mig 162); null = use slab's own.
  const descOv = new Map<string, string | null>();
  const addlOv = new Map<string, string | null>();
  for (const l of logRows) {
    if (!l.slab_requirement_id) continue;
    unitBy.set(l.slab_requirement_id, l.measure_unit === "sft" ? "sft" : "cft");
    weightBy.set(l.slab_requirement_id, Number(l.weight_tonnes) || 0);
    descOv.set(l.slab_requirement_id, l.desc_override);
    addlOv.set(l.slab_requirement_id, l.additional_override);
  }
  // Check-page preview passes the unsaved description edits (changed rows only).
  if (descsParam) {
    try {
      const o = JSON.parse(descsParam) as Record<string, { d: string | null; a: string | null }>;
      for (const [sid, v] of Object.entries(o)) {
        if (!v) continue;
        if (v.d !== null && v.d !== undefined) descOv.set(sid, v.d);
        if (v.a !== null && v.a !== undefined) addlOv.set(sid, v.a);
      }
    } catch {
      /* ignore malformed preview override */
    }
  }
  if (unitsParam) {
    try {
      const override = JSON.parse(unitsParam) as Record<string, string>;
      for (const [sid, u] of Object.entries(override)) unitBy.set(sid, u === "sft" ? "sft" : "cft");
    } catch {
      /* ignore malformed preview override */
    }
  }
  if (weightsParam) {
    try {
      const wOverride = JSON.parse(weightsParam) as Record<string, number | string>;
      for (const [sid, w] of Object.entries(wOverride)) weightBy.set(sid, Number(w) || 0);
    } catch {
      /* ignore malformed preview override */
    }
  }

  let inputs: DispatchSlabInput[] = [];
  if (slabIds.length > 0) {
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, label, description, additional_description, component_section, component_element, length_ft, width_ft, thickness_ft, stone")
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
        stone: (s.stone as string | null) ?? null,
        weight_tonnes: weightBy.get(s.id as string) ?? null,
        measure_unit: unitBy.get(s.id as string) ?? "cft",
      }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  const groups = groupDispatchSlabs(inputs);
  const cftGroups = groups.filter((g) => g.measure_unit === "cft");
  const sftGroups = groups.filter((g) => g.measure_unit === "sft");
  const cftTotal = cftGroups.reduce((a, g) => a + g.measureQty, 0);
  const sftTotal = sftGroups.reduce((a, g) => a + g.measureQty, 0);
  // Truck mode → the single whole-truck weight; slab mode → sum of per-slab.
  const totalTonnes = weightMode === "truck" ? loadTonnes : groups.reduce((a, g) => a + g.weightTonnes, 0);
  const totalSlabs = groups.reduce((a, g) => a + g.qty, 0);
  const hasWeights = totalTonnes > 0;

  const [{ data: templeRow }, handlingMan] = await Promise.all([
    admin
      .from("temples")
      .select("site_location, site_incharge_name, site_incharge_phone, installer_name, installer_phone")
      .eq("name", dispatch.temple)
      .maybeSingle(),
    // Mig 159 — dispatch override → temple's linked incharge → legacy global.
    resolveDispatchIncharge(admin, { inchargeId: (dispatch as { incharge_id?: string | null }).incharge_id ?? null, temple: dispatch.temple }),
  ]);
  const site = (templeRow ?? {}) as {
    site_location?: string | null;
    site_incharge_name?: string | null;
    site_incharge_phone?: string | null;
    installer_name?: string | null;
    installer_phone?: string | null;
  };
  const loadNumber = (dispatch as { load_number?: number | null }).load_number ?? null;

  const profilesMap = await getProfilesMap();
  const dispatcherName = dispatch.dispatched_by ? profilesMap[dispatch.dispatched_by] ?? "—" : "—";
  const deliveredByName = dispatch.delivered_by ? profilesMap[dispatch.delivered_by] ?? "—" : null;

  const challanNum = (dispatch as { challan_number?: number }).challan_number ?? null;
  const shortId = challanNum != null ? `CHLN-${String(challanNum).padStart(4, "0")}` : `DISP-${String(dispatch.id).slice(0, 8).toUpperCase()}`;
  const dispatchedDate = new Date(dispatch.dispatched_at);
  const printDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  // A not-yet-verified dispatch (the Check-page preview) prints an APPROVAL
  // PENDING banner so a preview is never mistaken for a valid challan.
  const pending = !(dispatch as { approved_at?: string | null }).approved_at;

  const contact = (name?: string | null, phone?: string | null) => (name ? `${name}${phone ? ` · ${phone}` : ""}` : "-");

  const SlabTable = ({ rows, unit }: { rows: DispatchGroupRow[]; unit: "cft" | "sft" }) => {
    if (rows.length === 0) return null;
    const total = rows.reduce((a, g) => a + g.measureQty, 0);
    const wt = rows.reduce((a, g) => a + g.weightTonnes, 0);
    return (
      <>
        <div className="grp-title">{unit === "cft" ? "CFT · volume billed" : "SFT · area billed"}</div>
        <table className="slab-table">
          <thead>
            <tr>
              <th style={{ width: 22 }}>#</th>
              <th>Code(s)</th>
              <th>Label</th>
              <th>Description</th>
              <th>Additional</th>
              <th>Cat 2</th>
              <th>Cat 1</th>
              <th className="r">L</th>
              <th className="r">W</th>
              <th className="r">H</th>
              <th className="r">Qty</th>
              <th className="r">Wt (kg)</th>
              <th className="r">{unit.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g, i) => (
              <tr key={g.key}>
                <td className="muted">{i + 1}</td>
                <td className="mono">{g.codes.join(", ")}</td>
                <td>{dash(g.label)}</td>
                <td>{dash(g.description)}</td>
                <td>{dash(g.additional_description)}</td>
                <td>{dash(g.component_element)}</td>
                <td>{dash(g.component_section)}</td>
                <td className="r mono">{g.length_ft}</td>
                <td className="r mono">{g.width_ft}</td>
                <td className="r mono">{g.thickness_ft}</td>
                <td className="r mono b">{g.qty}</td>
                <td className="r mono">{g.weightTonnes > 0 ? Math.round(g.weightTonnes * 1000).toLocaleString("en-IN") : "-"}</td>
                <td className="r mono b">{fmt(g.measureQty)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={10} className="r">Total {unit.toUpperCase()}</td>
              <td className="r mono b">{rows.reduce((a, g) => a + g.qty, 0)}</td>
              <td className="r mono">{wt > 0 ? Math.round(wt * 1000).toLocaleString("en-IN") : "-"}</td>
              <td className="r mono b">{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </>
    );
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #f0f0f0; }
        .print-wrap { max-width: 1180px; margin: 0 auto; background: #fff; padding: 14px 18px 18px; }
        .screen-bar { background: #1a1a1a; color: #fff; padding: 9px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; }
        .screen-bar-title { font-size: 12px; color: rgba(255,255,255,0.65); }

        .pending-banner { background: #b45309; color: #fff; text-align: center; font-weight: 800; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; padding: 8px 12px; border-radius: 6px; margin-bottom: 10px; }

        .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; border-bottom: 2.5px double #7c4a1e; padding-bottom: 8px; }
        .brand-logo { height: 40px; width: auto; display: block; }
        .company-name { font-size: 13.5px; font-weight: 800; color: #5b2e0a; letter-spacing: 0.02em; }
        .company-line { font-size: 8.5px; color: #666; margin-top: 1px; line-height: 1.45; }
        .doc-pill { font-size: 13px; font-weight: 800; color: #5b2e0a; letter-spacing: 0.1em; text-transform: uppercase; border: 2px solid #7c4a1e; border-radius: 6px; padding: 4px 14px; background: #faf4ea; white-space: nowrap; }
        .doc-num { font-size: 18px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; margin-top: 4px; }
        .doc-dt { font-size: 9px; color: #888; text-align: right; }

        /* Tight info strip — every routing field in a compact grid */
        .info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 16px; margin: 8px 0 4px; border: 1px solid #ccc; border-radius: 6px; padding: 7px 10px; background: #fdfaf4; }
        .info .k { font-size: 7.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #999; }
        .info .v { font-size: 11px; font-weight: 600; color: #1a1a1a; line-height: 1.35; }
        .info .v.big { font-size: 13px; font-weight: 800; }
        .info .mono { font-family: ui-monospace, monospace; }

        .stone-block { margin-top: 4px; }
        .stone-title { font-size: 11.5px; font-weight: 800; color: #5b2e0a; background: #f3efe7; border-left: 3px solid #7c4a1e; padding: 4px 9px; margin: 12px 0 2px; border-radius: 3px; break-after: avoid; }
        .grp-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #5b2e0a; margin: 6px 0 3px; }
        table.slab-table { width: 100%; border-collapse: collapse; font-size: 10px; }
        table.slab-table th { background: #f3efe7; padding: 4px 6px; text-align: left; font-size: 8px; font-weight: 800; color: #555; text-transform: uppercase; letter-spacing: 0.03em; border: 1px solid #d8d2c4; white-space: nowrap; }
        table.slab-table td { padding: 3px 6px; border: 1px solid #e6e1d6; vertical-align: top; }
        table.slab-table tfoot td { font-weight: 800; background: #faf7f0; border: 1px solid #d8d2c4; }
        .slab-table .r { text-align: right; }
        .slab-table .mono { font-family: ui-monospace, monospace; }
        .slab-table .b { font-weight: 800; }
        .slab-table .muted { color: #999; }

        .totals { display: flex; gap: 18px; flex-wrap: wrap; font-size: 11px; font-weight: 800; margin-top: 8px; padding: 6px 10px; border: 1px solid #d8d2c4; border-radius: 6px; background: #faf7f0; }
        .signoff { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 18px; margin-top: 22px; }
        .sign { border-top: 1.5px solid #888; padding-top: 5px; font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .sign .sub { font-size: 10px; color: #444; margin-top: 2px; text-transform: none; letter-spacing: 0; font-weight: 600; }
        .delivered { background: rgba(22,101,52,0.08); border: 1px solid rgba(22,101,52,0.3); color: #15803d; padding: 7px 12px; border-radius: 6px; margin-top: 10px; font-size: 10.5px; font-weight: 700; }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 0; margin: 0; }
          table.slab-table, .signoff, .delivered { page-break-inside: avoid; }
          @page { size: A4 landscape; margin: 9mm; }
        }
        @media screen { body { padding: 0; } }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">Dispatch Challan — {shortId} · {dispatch.temple} · A4 landscape</span>
        <PrintBtn />
      </div>

      <div className="print-wrap">
        {pending && (
          <div className="pending-banner">⚠ Approval pending — preview only · not valid for dispatch until verified</div>
        )}
        <div className="head">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dark.png" alt="MTCPL" className="brand-logo" />
            <div>
              <div className="company-name">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
              <div className="company-line">NH-27, Opposite Ajari Gate, Pindwara, Dist. Sirohi, Rajasthan</div>
              <div className="company-line">☎ +91 94141 52740 / +91 94143 74979 · mtcpl.org · mateshwaritemples.com</div>
            </div>
          </div>
          <div>
            <span className="doc-pill">Delivery Challan</span>
            <div className="doc-num">{shortId}</div>
            <div className="doc-dt">
              Dispatched {dispatchedDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })} · by {dispatcherName}
              <br />Printed {printDate}
            </div>
          </div>
        </div>

        {/* Compact routing strip */}
        <div className="info">
          <div><div className="k">Bill To / Temple</div><div className="v big">🏛 {dash(dispatch.temple)}</div></div>
          <div><div className="k">Site location</div><div className="v">{dash(site.site_location)}</div></div>
          <div><div className="k">Vehicle no.</div><div className="v mono big">{dash(dispatch.vehicle_no)}</div></div>
          <div><div className="k">Load no.</div><div className="v mono big">{loadNumber != null ? loadNumber : "-"}</div></div>

          <div><div className="k">Driver</div><div className="v">{dash(dispatch.driver_name)}</div></div>
          <div><div className="k">Driver phone</div><div className="v mono">{dash(dispatch.driver_phone)}</div></div>
          <div><div className="k">Site incharge (client)</div><div className="v">{contact(site.site_incharge_name, site.site_incharge_phone)}</div></div>
          <div><div className="k">Installation by</div><div className="v">{contact(site.installer_name, site.installer_phone)}</div></div>

          <div><div className="k">MTCPL dispatch incharge</div><div className="v">{contact(handlingMan?.name, handlingMan?.phone)}</div></div>
          <div><div className="k">Total pieces</div><div className="v big">{totalSlabs}</div></div>
          {hasWeights && <div><div className="k">Net weight{weightMode === "truck" ? " (whole truck)" : ""}</div><div className="v mono big">{fmt(totalTonnes, 3)} T</div></div>}
          {dispatch.expected_delivery_date && <div><div className="k">Expected delivery</div><div className="v">{new Date(dispatch.expected_delivery_date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div></div>}
        </div>

        {groups.length === 0 ? (
          <p style={{ color: "#888", fontSize: 11, marginTop: 12 }}>No slabs linked to this dispatch.</p>
        ) : (
          <>
            {/* Stone-wise sections; CFT + SFT sub-tables within each stone. */}
            {groupRowsByStone(groups).map(({ stone, rows }) => (
              <div key={stone} className="stone-block">
                <div className="stone-title">🪨 {stone}</div>
                <SlabTable rows={rows.filter((g) => g.measure_unit === "cft")} unit="cft" />
                <SlabTable rows={rows.filter((g) => g.measure_unit === "sft")} unit="sft" />
              </div>
            ))}
            <div className="totals">
              <span>Σ {totalSlabs} piece{totalSlabs !== 1 ? "s" : ""}</span>
              {cftTotal > 0 && <span>CFT TOTAL: {fmt(cftTotal)}</span>}
              {sftTotal > 0 && <span>SFT TOTAL: {fmt(sftTotal)}</span>}
              {hasWeights && <span>NET WEIGHT{weightMode === "truck" ? " (WHOLE TRUCK)" : ""}: {fmt(totalTonnes, 3)} T</span>}
            </div>
          </>
        )}

        {dispatch.notes && (
          <p style={{ fontSize: 10, color: "#333", marginTop: 8 }}><strong>Notes:</strong> {dispatch.notes}</p>
        )}

        {dispatch.delivered_at && (
          <div className="delivered">
            ✓ Delivered {new Date(dispatch.delivered_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" })}
            {dispatch.receiver_name ? ` · Received by ${dispatch.receiver_name}` : ""}
            {deliveredByName ? ` · Confirmed by ${deliveredByName}` : ""}
            {dispatch.delivery_note ? ` · "${dispatch.delivery_note}"` : ""}
          </div>
        )}

        <div className="signoff">
          <div className="sign">For MTCPL · Representative<div className="sub">{handlingMan?.name ?? "Authorised signatory"}</div></div>
          <div className="sign">Driver Signature<div className="sub">{dash(dispatch.driver_name)}</div></div>
          <div className="sign">Received · Site Engineer<div className="sub">{dispatch.receiver_name || "Name & date of receipt"}</div></div>
          <div className="sign">Remarks<div className="sub">&nbsp;</div></div>
        </div>
      </div>
    </>
  );
}
