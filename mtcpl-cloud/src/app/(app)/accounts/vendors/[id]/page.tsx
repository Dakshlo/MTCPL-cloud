// Bill-vendor detail — bank details, bill history, total outstanding.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageBillVendors } from "@/lib/accounts-permissions";
import { upsertBillVendorAction } from "../../actions";
import { VendorForm } from "../vendor-form";

type Params = Promise<{ id: string }>;

export default async function BillVendorDetailPage({
  params,
}: {
  params: Params;
}) {
  const { profile } = await requireAuth();
  if (!canManageBillVendors(profile)) {
    redirect("/accounts");
  }
  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: vendor } = await supabase
    .from("bill_vendors")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!vendor) notFound();

  const { data: billsRaw } = await supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, amount_total, amount_paid, amount_outstanding, status",
    )
    .eq("bill_vendor_id", id)
    .order("bill_date", { ascending: false })
    .limit(200);
  const bills = (billsRaw ?? []) as Array<{
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    amount_total: number;
    amount_paid: number;
    amount_outstanding: number;
    status: string;
  }>;

  const totalOutstanding = bills
    .filter((b) => b.status === "approved")
    .reduce((s, b) => s + Number(b.amount_outstanding), 0);
  const totalPaid = bills.reduce((s, b) => s + Number(b.amount_paid), 0);

  return (
    <section className="page-card">
      <div style={{ marginBottom: 18 }}>
        <Link
          href="/accounts/vendors"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ← All bill vendors
        </Link>
      </div>
      <div className="record-head" style={{ marginBottom: 16 }}>
        <div>
          <h1>{vendor.name}</h1>
          <p className="muted">
            {vendor.category ?? "—"}
            {vendor.gstin ? ` · GSTIN ${vendor.gstin}` : ""}
            {vendor.phone ? ` · ${vendor.phone}` : ""}
          </p>
        </div>
        <div
          style={{
            fontFamily: "ui-monospace, monospace",
            textAlign: "right",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>
            Outstanding
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: totalOutstanding > 0 ? "#b45309" : "var(--muted)",
            }}
          >
            ₹{totalOutstanding.toLocaleString("en-IN")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Lifetime paid ₹{totalPaid.toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <VendorForm
          action={upsertBillVendorAction}
          mode="edit"
          vendorId={id}
          initialValues={{
            name: vendor.name,
            category: vendor.category,
            gstin: vendor.gstin,
            pan: vendor.pan,
            address: vendor.address,
            phone: vendor.phone,
            email: vendor.email,
            bank_name: vendor.bank_name,
            bank_account: vendor.bank_account,
            ifsc: vendor.ifsc,
            upi_id: vendor.upi_id,
            notes: vendor.notes,
          }}
        />
      </div>

      <h2 style={{ fontSize: 14, marginTop: 26, marginBottom: 10, color: "var(--muted)" }}>
        Bill history ({bills.length})
      </h2>
      {bills.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>
          No bills yet for this vendor.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={thStyle}>Token</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Bill no</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Paid</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Outstanding</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={tdStyle}>
                    <Link
                      href={`/accounts/bills/${b.id}`}
                      style={{
                        textDecoration: "none",
                        fontFamily: "ui-monospace, monospace",
                        fontWeight: 700,
                        color: "var(--text)",
                      }}
                    >
                      {b.token}
                    </Link>
                  </td>
                  <td style={tdStyle}>
                    {new Date(b.bill_date).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 12 }}>{b.vendor_bill_no}</code>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 260 }}>
                    <span style={{ fontSize: 12 }}>
                      {b.description.length > 60 ? `${b.description.slice(0, 60)}…` : b.description}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    ₹{Number(b.amount_total).toLocaleString("en-IN")}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {Number(b.amount_paid) > 0
                      ? `₹${Number(b.amount_paid).toLocaleString("en-IN")}`
                      : "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {Number(b.amount_outstanding) > 0 ? (
                      <strong style={{ color: "#b45309" }}>
                        ₹{Number(b.amount_outstanding).toLocaleString("en-IN")}
                      </strong>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {b.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
