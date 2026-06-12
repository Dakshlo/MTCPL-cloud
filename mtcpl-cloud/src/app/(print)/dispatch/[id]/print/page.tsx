/**
 * Dispatch challan print page.
 *
 * A4 layout for the driver to carry — shows MTCPL header, destination
 * temple, vehicle + driver info, itemised slab list, and signature
 * blocks. Renders at /dispatch/<id>/print; opens in a new tab from
 * the dispatch row's "Print challan" button.
 */

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { PrintBtn } from "./print-btn";

type Params = Promise<{ id: string }>;

function cft(l: number, w: number, t: number): number {
  return (l * w * t) / 1728;
}

export default async function DispatchChallanPrintPage({ params }: { params: Params }) {
  // Anyone with owner / team_head / developer / cutting_operator role can
  // print the challan — they're the people who hand it to the driver.
  // Previously this was developer-only which silently bounced Naresh
  // (owner) back to /dashboard whenever he clicked "Print challan".
  await requireAuth(["developer", "owner", "team_head", "senior_incharge", "cutting_operator"]);
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: dispatch, error } = await admin
    .from("dispatches")
    .select(
      "id, challan_number, load_number, temple, vehicle_no, driver_name, driver_phone, expected_delivery_date, notes, dispatched_at, dispatched_by, delivered_at, delivered_by, receiver_name, delivery_note",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !dispatch) notFound();

  // Pull the logs for this dispatch (itemised slab list + mig 130
  // per-slab weights).
  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, weight_tonnes")
    .eq("dispatch_id", id);
  const slabIds = (logs ?? []).map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  const weightBySlab = new Map<string, number>();
  for (const l of (logs ?? []) as Array<{ slab_requirement_id: string | null; weight_tonnes: number | null }>) {
    if (l.slab_requirement_id && l.weight_tonnes != null && Number(l.weight_tonnes) > 0) {
      weightBySlab.set(l.slab_requirement_id, Number(l.weight_tonnes));
    }
  }
  const totalTonnes = [...weightBySlab.values()].reduce((a, b) => a + b, 0);
  const hasWeights = totalTonnes > 0;

  // Mig 130 — temple site info + the fixed MTCPL site handling man.
  const [{ data: templeRow }, { data: handlingManRow }] = await Promise.all([
    admin
      .from("temples")
      .select("site_location, site_incharge_name, site_incharge_phone, installer_name, installer_phone")
      .eq("name", dispatch.temple)
      .maybeSingle(),
    admin.from("app_settings").select("value").eq("key", "dispatch_handling_man").maybeSingle(),
  ]);
  const site = (templeRow ?? {}) as {
    site_location?: string | null;
    site_incharge_name?: string | null;
    site_incharge_phone?: string | null;
    installer_name?: string | null;
    installer_phone?: string | null;
  };
  const handlingMan =
    ((handlingManRow as { value?: { name?: string; phone?: string } } | null)?.value) ?? null;
  const loadNumber = (dispatch as { load_number?: number | null }).load_number ?? null;

  let slabs: Array<{
    id: string;
    label: string | null;
    stone: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
  }> = [];
  if (slabIds.length > 0) {
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, label, stone, length_ft, width_ft, thickness_ft")
      .in("id", slabIds);
    slabs = (slabRows ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      stone: s.stone,
      length_ft: Number(s.length_ft),
      width_ft: Number(s.width_ft),
      thickness_ft: Number(s.thickness_ft),
    }));
    // Preserve dispatch_logs order (by slab id)
    const order = new Map(slabIds.map((id, idx) => [id, idx]));
    slabs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  const totalCft = slabs.reduce(
    (sum, s) => sum + cft(s.length_ft, s.width_ft, s.thickness_ft),
    0,
  );

  const profilesMap = await getProfilesMap();
  const dispatcherName = dispatch.dispatched_by ? profilesMap[dispatch.dispatched_by] ?? "—" : "—";
  const deliveredByName = dispatch.delivered_by ? profilesMap[dispatch.delivered_by] ?? "—" : null;

  // Challan reference — prefer the sequential challan_number column
  // (added in migration 011, format CHLN-0042). Falls back to the UUID
  // prefix (DISP-XXXXXXXX) for any pre-migration row that somehow still
  // has NULL challan_number — shouldn't happen since the migration
  // backfills everyone, but defensive.
  const challanNum = (dispatch as { challan_number?: number }).challan_number ?? null;
  const shortId = challanNum != null
    ? `CHLN-${String(challanNum).padStart(4, "0")}`
    : `DISP-${String(dispatch.id).slice(0, 8).toUpperCase()}`;
  const dispatchedDate = new Date(dispatch.dispatched_at);
  const expectedDelivery = dispatch.expected_delivery_date
    ? new Date(dispatch.expected_delivery_date)
    : null;

  const printDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          font-size: 13px;
          color: #1a1a1a;
          background: #f0f0f0;
        }
        .print-wrap {
          max-width: 900px;
          margin: 0 auto;
          background: #fff;
          padding: 28px 32px 36px;
        }
        .screen-bar {
          background: #1a1a1a;
          color: #fff;
          padding: 10px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          max-width: 900px;
          margin: 0 auto;
        }
        .screen-bar-title { font-size: 13px; color: rgba(255,255,255,0.65); }
        .print-action-btn {
          background: #b87333;
          color: #fff;
          border: none;
          padding: 8px 22px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.02em;
        }
        .print-action-btn:hover { background: #a06428; }

        /* ── MTCPL letterhead (matches the payment-voucher letterhead) ── */
        .letterhead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          border-bottom: 3px double #7c4a1e;
          padding-bottom: 12px;
        }
        .brand-logo {
          height: 52px;
          width: auto;
          display: block;
        }
        .company-block { text-align: right; }
        .company-name {
          font-size: 15px;
          font-weight: 800;
          color: #5b2e0a;
          letter-spacing: 0.03em;
        }
        .company-line {
          font-size: 10px;
          color: #666;
          margin-top: 2px;
          line-height: 1.5;
        }
        .title-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          margin: 16px 0 18px;
        }
        .doc-title-pill {
          display: inline-block;
          font-size: 16px;
          font-weight: 800;
          color: #5b2e0a;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          border: 2px solid #7c4a1e;
          border-radius: 8px;
          padding: 7px 22px;
          background: #faf4ea;
        }
        .doc-sub { font-size: 12px; color: #666; margin-top: 6px; }
        .doc-ref { text-align: right; }
        .doc-ref-num {
          font-size: 22px; font-weight: 800; color: #1a1a1a;
          font-family: ui-monospace, monospace; letter-spacing: 0.02em;
        }
        .doc-ref-date { font-size: 11px; color: #888; margin-top: 4px; line-height: 1.5; }

        .section-title {
          font-size: 11px; font-weight: 700; color: #666;
          text-transform: uppercase; letter-spacing: 0.1em;
          margin: 18px 0 8px; padding-bottom: 5px;
          border-bottom: 1px solid #ddd;
        }

        .meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 12px 24px;
        }
        .meta-label {
          font-size: 9px; font-weight: 700; color: #999;
          text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px;
        }
        .meta-val { font-size: 14px; font-weight: 600; color: #1a1a1a; }
        .meta-val.mono { font-family: ui-monospace, monospace; }

        table.slab-table {
          width: 100%; border-collapse: collapse; font-size: 12px;
          margin-top: 4px;
        }
        table.slab-table th {
          background: #f5f5f5; padding: 6px 10px; text-align: left;
          font-size: 10px; font-weight: 700; color: #555;
          text-transform: uppercase; letter-spacing: 0.05em;
          border-bottom: 2px solid #ccc;
        }
        table.slab-table td {
          padding: 6px 10px; border-bottom: 1px solid #eee;
          vertical-align: middle;
        }
        table.slab-table tr:last-child td { border-bottom: 2px solid #ccc; }
        table.slab-table tfoot td {
          padding: 8px 10px; font-weight: 700; font-size: 12px;
          background: #f8f8f3; border-top: 2px solid #ccc;
        }
        .slab-code { font-family: ui-monospace, monospace; font-weight: 700; }

        .delivered-banner {
          background: rgba(22,101,52,0.08);
          border: 1px solid rgba(22,101,52,0.3);
          color: #15803d;
          padding: 10px 14px;
          border-radius: 6px;
          margin-top: 14px;
          font-size: 12px;
          font-weight: 600;
        }

        .signoff-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
          margin-top: 40px;
        }
        .signoff-field {
          display: flex; flex-direction: column; gap: 40px;
          padding-top: 10px;
          border-top: 1.5px solid #888;
        }
        .signoff-label { font-size: 10px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .signoff-sub { font-size: 11px; color: #666; margin-top: 3px; }

        .doc-footer {
          margin-top: 28px; padding-top: 10px;
          border-top: 1px solid #e0e0e0;
          display: flex; justify-content: space-between;
          font-size: 9px; color: #aaa;
        }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 10mm 12mm; margin: 0; }
          table.slab-table, .signoff-row, .delivered-banner {
            page-break-inside: avoid;
          }
          @page { margin: 10mm; }
        }
        @media screen { body { padding: 0; } }
      `}</style>

      {/* Screen-only top bar */}
      <div className="screen-bar">
        <span className="screen-bar-title">
          Dispatch Challan — {shortId} · {dispatch.temple}
        </span>
        <PrintBtn />
      </div>

      <div className="print-wrap">
        {/* MTCPL letterhead — same company block as the payment voucher */}
        <div className="letterhead">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dark.png" alt="MTCPL" className="brand-logo" />
          </div>
          <div className="company-block">
            <div className="company-name">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
            <div className="company-line">
              NH-27, Opposite Ajari Gate, Pindwara, Dist. Sirohi, Rajasthan
            </div>
            <div className="company-line">
              ☎ +91 94141 52740 / +91 94143 74979 · 🌐 mtcpl.org · mateshwaritemples.com
            </div>
          </div>
        </div>

        {/* Title + reference */}
        <div className="title-row">
          <div>
            <span className="doc-title-pill">Delivery Challan</span>
            <div className="doc-sub">Outgoing shipment to {dispatch.temple}</div>
          </div>
          <div className="doc-ref">
            <div className="doc-ref-num">{shortId}</div>
            <div className="doc-ref-date">
              <div>
                Dispatched:{" "}
                {dispatchedDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
              </div>
              <div>
                {dispatchedDate.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} · by{" "}
                {dispatcherName}
              </div>
              <div>Printed: {printDate}</div>
            </div>
          </div>
        </div>

        {/* Bill To Party — the temple + its site location (mig 130,
            mirrors the office's Excel challan format). */}
        <div className="section-title">Bill To Party</div>
        <div
          style={{
            border: "1.5px solid #7c4a1e", borderRadius: 8, padding: "10px 14px",
            display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
            background: "#fdfaf4", marginBottom: 4,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#1a1a1a" }}>🏛 {dispatch.temple}</div>
            {site.site_location && (
              <div style={{ fontSize: 12.5, color: "#444", marginTop: 3, fontWeight: 600 }}>
                📍 {site.site_location}
              </div>
            )}
            <div style={{ fontSize: 10.5, color: "#888", marginTop: 4 }}>
              Site engineer / receiver to sign below upon receipt.
            </div>
          </div>
          {loadNumber != null && (
            <div
              style={{
                alignSelf: "center", textAlign: "center", border: "2px solid #1a1a1a", borderRadius: 8,
                padding: "8px 18px", minWidth: 120,
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 800, color: "#666", letterSpacing: "0.1em" }}>LOAD NO.</div>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "ui-monospace, monospace", lineHeight: 1.1 }}>
                {loadNumber}
              </div>
              <div style={{ fontSize: 8.5, color: "#999", marginTop: 1 }}>temple-wise</div>
            </div>
          )}
        </div>

        {/* Site contacts (mig 130) — client incharge, our installation
            contractor, and the fixed MTCPL handling man. */}
        {(site.site_incharge_name || site.installer_name || handlingMan?.name) && (
          <>
            <div className="section-title">Site Contacts</div>
            <div className="meta-grid">
              {site.site_incharge_name && (
                <div>
                  <div className="meta-label">Site Incharge (Client)</div>
                  <div className="meta-val">{site.site_incharge_name}</div>
                  {site.site_incharge_phone && (
                    <div style={{ fontSize: 11.5, color: "#555", fontFamily: "ui-monospace, monospace" }}>{site.site_incharge_phone}</div>
                  )}
                </div>
              )}
              {site.installer_name && (
                <div>
                  <div className="meta-label">Installation By</div>
                  <div className="meta-val">{site.installer_name}</div>
                  {site.installer_phone && (
                    <div style={{ fontSize: 11.5, color: "#555", fontFamily: "ui-monospace, monospace" }}>{site.installer_phone}</div>
                  )}
                </div>
              )}
              {handlingMan?.name && (
                <div>
                  <div className="meta-label">MTCPL Site Handling</div>
                  <div className="meta-val">{handlingMan.name}</div>
                  {handlingMan.phone && (
                    <div style={{ fontSize: 11.5, color: "#555", fontFamily: "ui-monospace, monospace" }}>{handlingMan.phone}</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Vehicle + driver */}
        <div className="section-title">Transport</div>
        <div className="meta-grid">
          <div>
            <div className="meta-label">Vehicle No.</div>
            <div className="meta-val mono">{dispatch.vehicle_no ?? "—"}</div>
          </div>
          <div>
            <div className="meta-label">Driver</div>
            <div className="meta-val">{dispatch.driver_name ?? "—"}</div>
          </div>
          <div>
            <div className="meta-label">Driver Phone</div>
            <div className="meta-val">{dispatch.driver_phone ?? "—"}</div>
          </div>
          {hasWeights && (
            <div>
              <div className="meta-label">Net Weight</div>
              <div className="meta-val mono">{totalTonnes.toFixed(3)} T</div>
            </div>
          )}
          {expectedDelivery && (
            <div>
              <div className="meta-label">Expected Delivery</div>
              <div className="meta-val">
                {expectedDelivery.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </div>
            </div>
          )}
        </div>

        {/* Slab list */}
        <div className="section-title">
          Slabs in this dispatch ({slabs.length})
        </div>
        {slabs.length === 0 ? (
          <p style={{ color: "#888", fontSize: 12 }}>No slabs linked to this dispatch.</p>
        ) : (
          <table className="slab-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Slab ID</th>
                <th>Label</th>
                <th>Stone</th>
                <th>Dimensions (in)</th>
                <th style={{ textAlign: "right" }}>CFT</th>
                {hasWeights && <th style={{ textAlign: "right" }}>Weight (T)</th>}
              </tr>
            </thead>
            <tbody>
              {slabs.map((s, idx) => {
                const c = cft(s.length_ft, s.width_ft, s.thickness_ft);
                const w = weightBySlab.get(s.id);
                return (
                  <tr key={s.id}>
                    <td style={{ color: "#999" }}>{idx + 1}</td>
                    <td>
                      <span className="slab-code">{s.id}</span>
                    </td>
                    <td>{s.label ?? "—"}</td>
                    <td>{s.stone ?? "—"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>
                      {s.length_ft} × {s.width_ft} × {s.thickness_ft}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{c.toFixed(2)}</td>
                    {hasWeights && (
                      <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                        {w != null ? w.toFixed(3) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ textAlign: "right" }}>Total</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{totalCft.toFixed(2)}</td>
                {hasWeights && (
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {totalTonnes.toFixed(3)} T
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        )}

        {/* Notes */}
        {dispatch.notes && (
          <>
            <div className="section-title">Notes</div>
            <p style={{ fontSize: 12, color: "#333", lineHeight: 1.5 }}>{dispatch.notes}</p>
          </>
        )}

        {/* Delivery status banner (only if already delivered) */}
        {dispatch.delivered_at && (
          <div className="delivered-banner">
            ✓ Delivered on{" "}
            {new Date(dispatch.delivered_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {dispatch.receiver_name ? ` · Received by ${dispatch.receiver_name}` : ""}
            {deliveredByName ? ` · Confirmed in system by ${deliveredByName}` : ""}
            {dispatch.delivery_note ? ` · "${dispatch.delivery_note}"` : ""}
          </div>
        )}

        {/* Sign-off row */}
        <div className="signoff-row">
          <div className="signoff-field">
            <div>
              <div className="signoff-label">Driver Signature</div>
              <div className="signoff-sub">{dispatch.driver_name ?? "Driver name"}</div>
            </div>
          </div>
          <div className="signoff-field">
            <div>
              <div className="signoff-label">Receiver Signature (Site Engineer)</div>
              <div className="signoff-sub">
                {dispatch.receiver_name || "Name & date of receipt"}
              </div>
            </div>
          </div>
        </div>

        {/* Letterhead footer */}
        <div className="doc-footer" style={{ flexDirection: "column", gap: 2, textAlign: "center", alignItems: "center" }}>
          <span style={{ fontWeight: 700, color: "#7c4a1e" }}>
            Mateshwari Temple Construction Pvt Ltd · NH-27, Opposite Ajari Gate, Pindwara, Dist. Sirohi, Rajasthan
          </span>
          <span>☎ +91 94141 52740 / +91 94143 74979 · 🌐 mtcpl.org · mateshwaritemples.com</span>
          <span>
            Delivery Challan {shortId} · {slabs.length} slab{slabs.length !== 1 ? "s" : ""} · {totalCft.toFixed(2)} CFT · Computer-generated document
          </span>
        </div>
      </div>
    </>
  );
}
