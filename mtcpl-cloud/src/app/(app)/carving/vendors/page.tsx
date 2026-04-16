import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { VendorForm } from "./vendor-form";

export default async function VendorDirectoryPage() {
  await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();

  const [
    { data: vendors },
    { data: machines },
    { data: activeJobs },
  ] = await Promise.all([
    admin.from("vendors").select("id, name, vendor_type, is_active, created_at").order("name"),
    admin.from("cnc_machines").select("id, vendor_id, machine_code, operator_name, is_active"),
    admin.from("carving_items").select("vendor_id, status").in("status", ["carving_assigned", "carving_in_progress"]),
  ]);

  const machineCountByVendor = new Map<string, number>();
  for (const m of machines ?? []) {
    if (m.is_active) machineCountByVendor.set(m.vendor_id, (machineCountByVendor.get(m.vendor_id) ?? 0) + 1);
  }
  const activeJobsByVendor = new Map<string, number>();
  for (const j of activeJobs ?? []) {
    activeJobsByVendor.set(j.vendor_id, (activeJobsByVendor.get(j.vendor_id) ?? 0) + 1);
  }

  const vendorList = vendors ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Carving Vendors</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Manage in-house and CNC carving vendors · Phase 2 dev-only
          </p>
        </div>
        <Link href="/carving" style={{ fontSize: 12, color: "var(--gold-dark)", fontWeight: 600, textDecoration: "none" }}>
          ← Back to Carving Dashboard
        </Link>
      </div>

      {/* New vendor form */}
      <section className="page-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>Add a new vendor</h2>
        <VendorForm />
      </section>

      {/* Vendor list */}
      <section className="page-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>
          {vendorList.length} vendors
        </h2>
        {vendorList.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, padding: 16 }}>
            No vendors yet. Use the form above to add your first one.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {vendorList.map((v) => {
              const mCount = machineCountByVendor.get(v.id) ?? 0;
              const activeCount = activeJobsByVendor.get(v.id) ?? 0;
              return (
                <div
                  key={v.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "14px 16px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    opacity: v.is_active ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{v.name}</span>
                    <span
                      className="role-pill"
                      style={{
                        background: v.vendor_type === "CNC" ? "rgba(37,99,235,0.1)" : "rgba(217,119,6,0.1)",
                        color: v.vendor_type === "CNC" ? "#2563EB" : "#D97706",
                        fontSize: 10,
                      }}
                    >
                      {v.vendor_type}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {v.vendor_type === "CNC" && `${mCount} machine${mCount === 1 ? "" : "s"} · `}
                    {activeCount} active job{activeCount === 1 ? "" : "s"}
                  </div>
                  {!v.is_active && (
                    <span style={{ fontSize: 10, color: "#DC2626", fontWeight: 600 }}>INACTIVE</span>
                  )}
                  <Link
                    href={`/carving/vendors/${v.id}`}
                    style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "var(--gold-dark)", textDecoration: "none" }}
                  >
                    Edit vendor →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
