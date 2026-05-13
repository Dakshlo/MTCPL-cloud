import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canManageBillVendors,
  canRenameBillVendor,
} from "@/lib/accounts-permissions";
import { upsertBillVendorAction } from "../../actions";
import { VendorForm } from "../vendor-form";
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  BillStatusPill,
  BUTTON_STYLES,
  EmptyState,
  Money,
  TABLE_STYLES,
  VendorAvatar,
} from "../../_ui/components";

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
  const billsCount = bills.length;

  return (
    <section className="page-card">
      <div style={{ marginBottom: 14 }}>
        <Link
          href="/accounts/vendors"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ← All vendors profile (bill)
        </Link>
      </div>

      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 14,
          padding: "20px 22px",
          marginBottom: 18,
          boxShadow: ACCOUNTS_TOKENS.shadow,
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <VendorAvatar name={vendor.name} size={56} />
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
                {vendor.name}
              </h1>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: vendor.is_active ? ACCOUNTS_TOKENS.successLight : ACCOUNTS_TOKENS.surfaceMuted,
                  color: vendor.is_active ? ACCOUNTS_TOKENS.success : "var(--muted)",
                }}
              >
                {vendor.is_active ? "● Active" : "○ Archived"}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              {vendor.category ?? "—"}
              {vendor.gstin && <> · GSTIN <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{vendor.gstin}</code></>}
              {vendor.phone && <> · {vendor.phone}</>}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", textAlign: "right" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Outstanding
            </div>
            {totalOutstanding > 0 ? (
              <Money value={totalOutstanding} size="hero" tone="warning" />
            ) : (
              <span style={{ fontSize: 22, color: ACCOUNTS_TOKENS.success, fontWeight: 700 }}>
                Cleared
              </span>
            )}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Lifetime paid
            </div>
            <Money value={totalPaid} size="large" tone="success" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Total bills
            </div>
            <span style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em", fontFamily: "ui-monospace, monospace" }}>
              {billsCount}
            </span>
          </div>
        </div>
      </div>

      {/* Edit + Bill history side by side */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <VendorForm
          action={upsertBillVendorAction}
          mode="edit"
          vendorId={id}
          nameLocked={!canRenameBillVendor(profile)}
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

        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: `1px solid ${ACCOUNTS_TOKENS.border}`,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Bill history</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {billsCount} bill{billsCount === 1 ? "" : "s"}
            </span>
          </div>
          {bills.length === 0 ? (
            <EmptyState
              icon="📑"
              title="No bills yet for this vendor"
              description="When a biller submits a bill against this vendor, it'll show up here."
            />
          ) : (
            <div style={TABLE_STYLES.tableWrap}>
              <div style={{ overflowX: "auto" }}>
                <table style={TABLE_STYLES.table}>
                  <thead style={TABLE_STYLES.thead}>
                    <tr>
                      <th style={TABLE_STYLES.th}>Token</th>
                      <th style={TABLE_STYLES.th}>Date</th>
                      <th style={TABLE_STYLES.th}>Bill no</th>
                      <th style={TABLE_STYLES.thRight}>Total</th>
                      <th style={TABLE_STYLES.thRight}>Outstanding</th>
                      <th style={TABLE_STYLES.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b, idx) => (
                      <tr
                        key={b.id}
                        style={{ background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted }}
                      >
                        <td style={TABLE_STYLES.td}>
                          <Link
                            href={`/accounts/bills/${b.id}`}
                            style={{
                              textDecoration: "none",
                              fontFamily: "ui-monospace, monospace",
                              fontWeight: 700,
                              color: ACCOUNTS_TOKENS.accent,
                            }}
                          >
                            {b.token}
                          </Link>
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                          {new Date(b.bill_date).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td style={TABLE_STYLES.td}>
                          <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                            {b.vendor_bill_no}
                          </code>
                        </td>
                        <td style={TABLE_STYLES.tdRight}>
                          <Money value={Number(b.amount_total)} tone="muted" />
                        </td>
                        <td style={TABLE_STYLES.tdRight}>
                          {Number(b.amount_outstanding) > 0 ? (
                            <Money value={Number(b.amount_outstanding)} tone="warning" />
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td style={TABLE_STYLES.td}>
                          <BillStatusPill status={b.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
