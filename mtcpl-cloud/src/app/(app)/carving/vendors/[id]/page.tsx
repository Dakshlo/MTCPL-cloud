import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { VendorForm } from "../vendor-form";
import { ConfirmButton } from "@/components/confirm-button";
import { deactivateVendorAction } from "../../actions";
import { updateMachineAssetFormAction } from "../../expenses/actions";
import { currentBookValueFor } from "@/lib/cnc-monthly-report";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Mig 081 follow-on (Daksh) — opens to carving_head + senior_incharge
  // so the "⚙ Machines" link on the Manage Vendors peek works for
  // them (was redirecting because the role guard rejected). Mohit
  // (role='vendor') stays out — the Manage Vendors button itself is
  // also gated on the parent carving page.
  await requireAuth(["developer", "owner", "carving_head", "senior_incharge"]);
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const [{ data: vendor }, { data: machines }, { data: jobs }] = await Promise.all([
    admin.from("vendors").select("id, name, vendor_type, is_active, dropoff_location").eq("id", id).single(),
    admin.from("cnc_machines").select("id, machine_code, operator_name, is_active, machine_type, cnc_axes, max_length_in, max_width_in, max_thickness_in, purchase_price, purchase_date, current_book_value, book_value_as_of, depreciation_rate_pct, salvage_value").eq("vendor_id", id).order("machine_code"),
    admin.from("carving_items").select("id, status, assigned_at, due_at, slab_requirement_id").eq("vendor_id", id).order("assigned_at", { ascending: false }).limit(50),
  ]);

  if (!vendor) notFound();

  const machineList = (machines ?? []).map((m) => {
    // Daksh June 2026 — pass cnc_axes through to the form. The query
    // above already selects it, but the form's initial.machines was
    // dropping the field, so the axis dropdown re-rendered at "3"
    // after every save — even though the DB was correctly storing
    // 4 / 5. Looked like a save bug ("vendor updated but axis didn't
    // change"); was actually a display bug. Same coercion as the
    // form's select (NULL on lathes, 3/4/5 on CNCs).
    const rawAxes = (m as { cnc_axes?: number | null }).cnc_axes;
    const cncAxes: 3 | 4 | 5 | null =
      rawAxes === 3 || rawAxes === 4 || rawAxes === 5 ? rawAxes : null;
    return {
      id: m.id,
      machine_code: m.machine_code,
      operator_name: m.operator_name ?? "",
      is_active: m.is_active,
      machine_type: ((m as { machine_type?: string }).machine_type ?? "multi_head_2") as
        | "single_head"
        | "multi_head_2"
        | "lathe",
      cnc_axes: cncAxes,
      max_length_in: (m as { max_length_in?: number | string | null }).max_length_in ?? null,
      max_width_in: (m as { max_width_in?: number | string | null }).max_width_in ?? null,
      max_thickness_in: (m as { max_thickness_in?: number | string | null }).max_thickness_in ?? null,
    };
  });

  const jobList = jobs ?? [];
  const machineRows = (machines ?? []) as Array<{
    id: string; machine_code: string; machine_type: string | null;
    purchase_price: number | string | null; purchase_date: string | null;
    current_book_value: number | string | null; book_value_as_of: string | null;
    depreciation_rate_pct: number | string | null; salvage_value: number | string | null;
  }>;
  const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
  const pill = (color: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 800, color, background: `${color}1a`, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" });
  const sectionH: React.CSSProperties = { margin: "0 0 12px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 };
  const fieldLbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" };
  const fieldInp: React.CSSProperties = { padding: "8px 10px", fontSize: 13, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 32, maxWidth: 1080 }}>
      <style>{`
        .rj-summary { list-style: none; cursor: pointer; }
        .rj-summary::-webkit-details-marker { display: none; }
        details[open] .rj-chevron { transform: rotate(90deg); }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(201,161,74,0.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>🧑‍🏭</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>{vendor.name}</h1>
            <div style={{ display: "flex", gap: 7, marginTop: 6, flexWrap: "wrap" }}>
              <span style={pill(vendor.vendor_type === "CNC" ? "#1d4ed8" : "#92400e")}>{vendor.vendor_type} vendor</span>
              {vendor.vendor_type === "CNC" && <span style={pill("#0891b2")}>{machineList.length} machine{machineList.length === 1 ? "" : "s"}</span>}
              <span style={pill(vendor.is_active ? "#15803d" : "#991b1b")}>{vendor.is_active ? "Active" : "Inactive"}</span>
            </div>
          </div>
        </div>
        <Link href="/carving/vendors" style={{ fontSize: 12.5, color: "var(--gold-dark)", fontWeight: 700, textDecoration: "none" }}>← Back to Vendors</Link>
      </div>

      {/* ── Edit vendor ── */}
      <section className="page-card">
        <h2 style={sectionH}>✏️ Edit vendor</h2>
        <VendorForm
          initial={{
            id: vendor.id,
            name: vendor.name,
            vendor_type: vendor.vendor_type,
            is_active: vendor.is_active,
            dropoff_location: (vendor as { dropoff_location?: string | null }).dropoff_location ?? null,
            machines: machineList,
          }}
        />
      </section>

      {/* ── Machine asset values & depreciation ── */}
      {vendor.vendor_type === "CNC" && machineRows.length > 0 && (
        <section className="page-card">
          <h2 style={sectionH}>🏭 Machine asset values &amp; depreciation</h2>
          <p className="muted" style={{ margin: "0 0 14px", fontSize: 12, lineHeight: 1.55 }}>
            Set each machine&apos;s <strong>purchase price + date</strong> and rate. <strong>Closing value</strong> is the machine&apos;s
            depreciated worth today (WDV, floored at salvage) — for an older machine, just back-date the purchase and it
            depreciates accordingly. Edit and save <strong>one machine at a time</strong>.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {machineRows.map((m) => {
              const typeLabel = m.machine_type === "lathe" ? "LATHE" : m.machine_type === "multi_head_2" ? "2× HEAD" : "SINGLE HEAD";
              const closing = currentBookValueFor(m);
              return (
                <form key={m.id} action={updateMachineAssetFormAction} style={{ padding: "12px 14px", background: "var(--surface-alt)", borderRadius: 10, border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
                  <input type="hidden" name="machine_id" value={m.id} />
                  {/* Header: code + type + computed closing value */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{m.machine_code}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>{typeLabel}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={fieldLbl}>Closing value today</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: closing != null ? "#15803d" : "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>
                        {closing != null ? inr(closing) : "—"}
                      </div>
                    </div>
                  </div>
                  {/* Inputs */}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
                      <span style={fieldLbl}>Purchase price (₹)</span>
                      <input type="number" step="1" min="0" name="purchase_price" defaultValue={m.purchase_price != null ? String(m.purchase_price) : ""} placeholder="e.g. 1200000" style={fieldInp} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
                      <span style={fieldLbl}>Purchase date</span>
                      <input type="date" name="purchase_date" defaultValue={m.purchase_date ?? ""} style={fieldInp} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 100px" }}>
                      <span style={fieldLbl}>Rate (%/yr)</span>
                      <input type="number" step="0.5" min="0" max="100" name="depreciation_rate_pct" defaultValue={m.depreciation_rate_pct != null ? String(m.depreciation_rate_pct) : "15"} style={fieldInp} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 120px" }}>
                      <span style={fieldLbl}>Salvage (₹)</span>
                      <input type="number" step="1" min="0" name="salvage_value" defaultValue={m.salvage_value != null ? String(m.salvage_value) : "0"} style={fieldInp} />
                    </label>
                    <button type="submit" style={{ padding: "9px 18px", fontSize: 12.5, fontWeight: 800, background: "var(--gold-dark)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", height: "fit-content" }}>
                      Save
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recent jobs — at the bottom, collapsed by default ── */}
      <section className="page-card" style={{ padding: 0 }}>
        <details>
          <summary className="rj-summary" style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", fontSize: 15, fontWeight: 800 }}>
            <span className="rj-chevron" style={{ display: "inline-block", fontSize: 12, color: "var(--muted)", transition: "transform .15s ease" }}>▶</span>
            📋 Recent jobs <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>({jobList.length})</span>
          </summary>
          <div style={{ padding: "0 18px 16px" }}>
            {jobList.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No jobs assigned to this vendor yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {jobList.map((j) => {
                  const due = j.due_at ? new Date(j.due_at) : null;
                  const overdue = due && due.getTime() < Date.now() && !["completed", "dispatched"].includes(j.status);
                  return (
                    <Link key={j.id} href={`/carving/${j.id}`} style={{ textDecoration: "none", display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface-alt)", borderRadius: 8 }}>
                      <div>
                        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--text)" }}>{j.slab_requirement_id}</span>
                        <span className="muted" style={{ marginLeft: 10, fontSize: 11 }}>assigned {new Date(j.assigned_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className="role-pill" style={{ fontSize: 10 }}>{j.status}</span>
                        {due && <span style={{ fontSize: 10, fontWeight: 700, color: overdue ? "#DC2626" : "var(--muted)" }}>due {due.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      </section>

      {/* ── Danger zone ── */}
      <section className="page-card">
        <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "#991b1b" }}>Danger zone</h3>
        <form action={deactivateVendorAction}>
          <input type="hidden" name="vendor_id" value={vendor.id} />
          <ConfirmButton
            message={`Deactivate ${vendor.name}? Existing jobs stay intact.`}
            className="ghost-button danger-ghost"
          >
            Deactivate vendor
          </ConfirmButton>
        </form>
      </section>
    </div>
  );
}
