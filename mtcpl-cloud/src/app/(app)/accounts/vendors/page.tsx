// Bill vendor master — accountant CRUD.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageBillVendors } from "@/lib/accounts-permissions";
import { upsertBillVendorAction, archiveBillVendorFormAction } from "../actions";
import { VendorForm } from "./vendor-form";

export default async function BillVendorsPage() {
  const { profile } = await requireAuth();
  if (!canManageBillVendors(profile)) {
    redirect("/accounts");
  }
  const supabase = createAdminSupabaseClient();
  const { data: vendorsRaw } = await supabase
    .from("bill_vendors")
    .select("id, name, category, gstin, phone, email, is_active, created_at")
    .order("is_active", { ascending: false })
    .order("name");
  const vendors = (vendorsRaw ?? []) as Array<{
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    is_active: boolean;
    created_at: string;
  }>;

  // Per-vendor outstanding totals (pulled in one shot)
  const { data: outstandingRaw } = await supabase
    .from("bills")
    .select("bill_vendor_id, amount_outstanding")
    .eq("status", "approved")
    .gt("amount_outstanding", 0);
  const outstandingByVendor = new Map<string, number>();
  for (const r of outstandingRaw ?? []) {
    const id = r.bill_vendor_id as string;
    const amt = Number(r.amount_outstanding ?? 0);
    outstandingByVendor.set(id, (outstandingByVendor.get(id) ?? 0) + amt);
  }

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Bill vendors</h1>
          <p className="muted">
            Beneficiaries that appear in the bill-entry form. Separate from
            the carving vendors (which are CNC / Manual).
          </p>
        </div>
        <VendorForm action={upsertBillVendorAction} mode="create" />
      </div>

      <div style={{ marginTop: 18, overflowX: "auto" }}>
        {vendors.length === 0 ? (
          <div className="banner">No bill vendors yet — add the first one above.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>GSTIN</th>
                <th style={thStyle}>Phone</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Outstanding</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const outstanding = outstandingByVendor.get(v.id) ?? 0;
                return (
                  <tr key={v.id} style={{ borderBottom: "1px solid var(--border)", opacity: v.is_active ? 1 : 0.55 }}>
                    <td style={tdStyle}>
                      <Link
                        href={`/accounts/vendors/${v.id}`}
                        style={{ textDecoration: "none", color: "var(--text)", fontWeight: 600 }}
                      >
                        {v.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      {v.category ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: "rgba(184,115,51,0.10)",
                            color: "#b45309",
                            fontWeight: 600,
                          }}
                        >
                          {v.category}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <code style={{ fontSize: 12 }}>{v.gstin ?? "—"}</code>
                    </td>
                    <td style={tdStyle}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {v.phone ?? "—"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                      {outstanding > 0 ? (
                        <strong style={{ color: "#b45309" }}>
                          ₹{outstanding.toLocaleString("en-IN")}
                        </strong>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: v.is_active ? "rgba(22,101,52,0.12)" : "rgba(0,0,0,0.06)",
                          color: v.is_active ? "#15803d" : "var(--muted)",
                        }}
                      >
                        {v.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link
                          href={`/accounts/vendors/${v.id}`}
                          style={{
                            textDecoration: "none",
                            fontSize: 12,
                            padding: "4px 10px",
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text)",
                            fontWeight: 600,
                          }}
                        >
                          View / edit
                        </Link>
                        <form action={archiveBillVendorFormAction}>
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="reactivate" value={v.is_active ? "" : "1"} />
                          <button
                            type="submit"
                            style={{
                              fontSize: 12,
                              padding: "4px 10px",
                              background: "transparent",
                              border: "1px dashed var(--border)",
                              borderRadius: 6,
                              color: "var(--muted)",
                              cursor: "pointer",
                            }}
                          >
                            {v.is_active ? "Archive" : "Reactivate"}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const tdStyle: React.CSSProperties = {
  padding: "10px 10px",
  verticalAlign: "middle",
};
