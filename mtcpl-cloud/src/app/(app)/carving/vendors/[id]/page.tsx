import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { VendorForm } from "../vendor-form";
import { ConfirmButton } from "@/components/confirm-button";
import { deactivateVendorAction } from "../../actions";
import { updateMachineAssetFormAction } from "../../expenses/actions";

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{vendor.name}</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {vendor.vendor_type} vendor · {machineList.length} machines
          </p>
        </div>
        <Link href="/carving/vendors" style={{ fontSize: 12, color: "var(--gold-dark)", fontWeight: 600, textDecoration: "none" }}>
          ← Back to Vendors
        </Link>
      </div>

      <section className="page-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Edit vendor</h2>
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

      <section className="page-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>
          Recent jobs ({(jobs ?? []).length})
        </h2>
        {(jobs ?? []).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No jobs assigned to this vendor yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(jobs ?? []).map((j) => {
              const due = j.due_at ? new Date(j.due_at) : null;
              const overdue = due && due.getTime() < Date.now() && !["completed", "dispatched"].includes(j.status);
              return (
                <Link
                  key={j.id}
                  href={`/carving/${j.id}`}
                  style={{
                    textDecoration: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "var(--surface-alt)",
                    borderRadius: 6,
                  }}
                >
                  <div>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--text)" }}>
                      {j.slab_requirement_id}
                    </span>
                    <span className="muted" style={{ marginLeft: 10, fontSize: 11 }}>
                      assigned {new Date(j.assigned_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="role-pill" style={{ fontSize: 10 }}>{j.status}</span>
                    {due && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: overdue ? "#DC2626" : "var(--muted)" }}>
                        due {due.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {vendor.vendor_type === "CNC" && (machines ?? []).length > 0 && (
        <section className="page-card">
          {/* Mig 054 — Machine asset values & depreciation editor.
              One row per machine. Two entry paths supported:
                1. Purchase price + date — for new purchases the system
                   has full history of.
                2. Current book value + as-of date — for legacy
                   machines whose original purchase isn't recorded.
              The report builder prefers (1) when both are present.
              Depreciation rate defaults to 15% WDV (Income Tax Act
              §32 for general plant + machinery). Salvage = floor
              below which the book value never depreciates. */}
          <h2 style={{ margin: "0 0 6px", fontSize: 15 }}>Machine asset values & depreciation</h2>
          <p className="muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
            Used to compute per-machine depreciation cost in the carving monthly report.
            Either fill <strong>purchase price + date</strong> (for new machines), OR
            <strong> current book value + as-of date</strong> (for legacy machines).
            Default rate is 15% per year (WDV, Income Tax Act §32 plant & machinery).
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(machines ?? []).map((m) => {
              const machineRow = m as {
                id: string;
                machine_code: string;
                machine_type: string | null;
                purchase_price: number | string | null;
                purchase_date: string | null;
                current_book_value: number | string | null;
                book_value_as_of: string | null;
                depreciation_rate_pct: number | string | null;
                salvage_value: number | string | null;
              };
              const typeLabel =
                machineRow.machine_type === "lathe"
                  ? "LATHE"
                  : machineRow.machine_type === "multi_head_2"
                    ? "2× HEAD"
                    : "SINGLE HEAD";
              return (
                <form
                  key={machineRow.id}
                  action={updateMachineAssetFormAction}
                  style={{
                    padding: 14,
                    background: "var(--surface-alt)",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    display: "grid",
                    gridTemplateColumns: "120px repeat(2, minmax(160px, 1fr)) repeat(2, minmax(100px, 120px)) auto",
                    gap: 10,
                    alignItems: "end",
                  }}
                >
                  <input type="hidden" name="machine_id" value={machineRow.id} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Machine
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                      {machineRow.machine_code}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>
                      {typeLabel}
                    </div>
                  </div>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Purchase price (₹)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      name="purchase_price"
                      defaultValue={machineRow.purchase_price != null ? String(machineRow.purchase_price) : ""}
                      placeholder="e.g. 1200000"
                      style={{ padding: "7px 10px", fontSize: 13, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
                    />
                    <input
                      type="date"
                      name="purchase_date"
                      defaultValue={machineRow.purchase_date ?? ""}
                      style={{ padding: "6px 10px", fontSize: 12, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      OR · Current book value (₹)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      name="current_book_value"
                      defaultValue={machineRow.current_book_value != null ? String(machineRow.current_book_value) : ""}
                      placeholder="e.g. 850000"
                      style={{ padding: "7px 10px", fontSize: 13, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
                    />
                    <input
                      type="date"
                      name="book_value_as_of"
                      defaultValue={machineRow.book_value_as_of ?? ""}
                      style={{ padding: "6px 10px", fontSize: 12, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Rate (%/yr)
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      name="depreciation_rate_pct"
                      defaultValue={machineRow.depreciation_rate_pct != null ? String(machineRow.depreciation_rate_pct) : "15"}
                      style={{ padding: "7px 10px", fontSize: 13, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Salvage (₹)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      name="salvage_value"
                      defaultValue={machineRow.salvage_value != null ? String(machineRow.salvage_value) : "0"}
                      style={{ padding: "7px 10px", fontSize: 13, fontFamily: "ui-monospace, monospace", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
                    />
                  </label>

                  <button
                    type="submit"
                    style={{
                      padding: "8px 16px",
                      fontSize: 12,
                      fontWeight: 700,
                      background: "var(--gold)",
                      color: "#fff",
                      border: "1px solid var(--gold-dark)",
                      borderRadius: 7,
                      cursor: "pointer",
                      height: "fit-content",
                    }}
                  >
                    Save
                  </button>
                </form>
              );
            })}
          </div>
        </section>
      )}

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
