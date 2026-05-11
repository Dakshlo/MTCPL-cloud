import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { VendorForm } from "../vendor-form";
import { ConfirmButton } from "@/components/confirm-button";
import { deactivateVendorAction } from "../../actions";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth(["developer", "owner"]);
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const [{ data: vendor }, { data: machines }, { data: jobs }] = await Promise.all([
    admin.from("vendors").select("id, name, vendor_type, is_active").eq("id", id).single(),
    admin.from("cnc_machines").select("id, machine_code, operator_name, is_active, machine_type, max_length_in, max_width_in, max_thickness_in").eq("vendor_id", id).order("machine_code"),
    admin.from("carving_items").select("id, status, assigned_at, due_at, slab_requirement_id").eq("vendor_id", id).order("assigned_at", { ascending: false }).limit(50),
  ]);

  if (!vendor) notFound();

  const machineList = (machines ?? []).map((m) => ({
    id: m.id,
    machine_code: m.machine_code,
    operator_name: m.operator_name ?? "",
    is_active: m.is_active,
    machine_type: ((m as { machine_type?: string }).machine_type ?? "multi_head_2") as
      | "single_head"
      | "multi_head_2"
      | "lathe",
    max_length_in: (m as { max_length_in?: number | string | null }).max_length_in ?? null,
    max_width_in: (m as { max_width_in?: number | string | null }).max_width_in ?? null,
    max_thickness_in: (m as { max_thickness_in?: number | string | null }).max_thickness_in ?? null,
  }));

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
                      assigned {new Date(j.assigned_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="role-pill" style={{ fontSize: 10 }}>{j.status}</span>
                    {due && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: overdue ? "#DC2626" : "var(--muted)" }}>
                        due {due.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

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
