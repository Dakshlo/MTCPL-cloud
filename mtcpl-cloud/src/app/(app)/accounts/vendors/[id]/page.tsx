import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canManageBillVendors,
  canRenameBillVendor,
  canViewBillVendors,
} from "@/lib/accounts-permissions";
import { upsertBillVendorAction } from "../../actions";
import { VendorForm } from "../vendor-form";
import { PrivateNotesModal } from "./private-notes-modal";
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
  if (!canViewBillVendors(profile)) {
    redirect("/accounts");
  }
  const canEdit = canManageBillVendors(profile);
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
      "id, token, vendor_bill_no, bill_date, description, amount_total, amount_paid, amount_outstanding, amount_tds, amount_tcs, amount_payable_to_vendor, status",
    )
    .eq("bill_vendor_id", id)
    .order("bill_date", { ascending: false })
    .limit(200);

  // Mig 053 follow-on (Daksh): tiny "Net: ..." line above Bill
  // history that shows the royalty-points net balance. Visible
  // only to roles that can see the private vendor data modal
  // (dev / owner / accountant). One bounded query — at most a
  // few hundred entries per vendor, summed in-app.
  const canSeeRoyaltyNet =
    profile.role === "developer" ||
    profile.role === "owner" ||
    profile.role === "accountant" ||
    // Mig 053 follow-on — final_auditor sees the royalty net + can
    // open the private-notes modal, matching the canAccessPrivateNotes
    // server gate.
    profile.role === "accountant_star";
  let royaltyNet: number | null = null;
  if (canSeeRoyaltyNet) {
    const { data: royaltyRows, error: royaltyErr } = await supabase
      .from("vendor_royalty_entries")
      .select("amount, entry_type, cancelled_at")
      .eq("bill_vendor_id", id);
    if (!royaltyErr && royaltyRows) {
      let received = 0;
      let paid = 0;
      for (const r of royaltyRows as Array<{
        amount: number;
        entry_type: string;
        cancelled_at: string | null;
      }>) {
        if (r.cancelled_at) continue; // skip cancelled entries
        const v = Number(r.amount ?? 0);
        if (r.entry_type === "received") received += v;
        else if (r.entry_type === "given") paid += v;
      }
      // Same formula as the modal (mig 053 fix): paid − received.
      royaltyNet = paid - received;
    }
  }
  const bills = (billsRaw ?? []) as Array<{
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    amount_total: number;
    amount_paid: number;
    amount_outstanding: number;
    amount_tds: number | null;
    amount_tcs: number | null;
    amount_payable_to_vendor: number | null;
    status: string;
  }>;

  const totalOutstanding = bills
    .filter((b) => b.status === "approved")
    .reduce((s, b) => s + Number(b.amount_outstanding), 0);
  const totalPaid = bills.reduce((s, b) => s + Number(b.amount_paid), 0);
  const billsCount = bills.length;

  // Mig 042 — running totals of TDS deducted + TCS collected on
  // bills that aren't cancelled. Cancelled / rejected bills carry no
  // tax obligation so they're excluded; pending_approval bills are
  // counted because they DO carry a tax intent (we'll surface them
  // separately if Daksh wants).
  const totalTdsDeducted = bills
    .filter((b) => b.status !== "cancelled" && b.status !== "rejected")
    .reduce((s, b) => s + Number(b.amount_tds ?? 0), 0);
  const totalTcsCollected = bills
    .filter((b) => b.status !== "cancelled" && b.status !== "rejected")
    .reduce((s, b) => s + Number(b.amount_tcs ?? 0), 0);

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

      {/* Mig 042 — tax-summary strip (only shown when this vendor
          has at least one bill carrying TDS or TCS). Lifetime
          totals across all non-cancelled bills. */}
      {(vendor.tds_applicable ||
        vendor.tcs_applicable ||
        totalTdsDeducted > 0 ||
        totalTcsCollected > 0) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <TaxSummaryCard
            label="TDS deducted lifetime"
            value={totalTdsDeducted}
            sub={
              vendor.tds_applicable
                ? `Vendor flagged${vendor.default_tds_percent != null ? ` @ default ${vendor.default_tds_percent}%` : ""}`
                : "Not flagged for TDS"
            }
            tone="danger"
          />
          <TaxSummaryCard
            label="TCS collected lifetime"
            value={totalTcsCollected}
            sub={
              vendor.tcs_applicable
                ? `Vendor flagged${vendor.default_tcs_percent != null ? ` @ default ${vendor.default_tcs_percent}%` : ""}`
                : "Not flagged for TCS"
            }
            tone="accent"
          />
        </div>
      )}

      {/* Mig 053 follow-on (Daksh, May 2026): tiny royalty net
          balance line. Sits just above the "Edit vendor details"
          card so it reads as part of the vendor's identity block
          (right under the lifetime totals, above the edit /
          history rows). Mono font, 11px, color-coded green for
          positive, red for negative. Hidden when zero or when
          the role can't see private data. */}
      {canSeeRoyaltyNet && royaltyNet !== null && royaltyNet !== 0 && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 6,
            fontFamily: "ui-monospace, monospace",
            letterSpacing: "0.02em",
          }}
          title="Royalty points net balance · Paid − Received. Positive means you've paid more than you've received."
        >
          Net:{" "}
          <span
            style={{
              color: royaltyNet > 0 ? "#15803d" : "#b91c1c",
              fontWeight: 800,
            }}
          >
            {royaltyNet > 0 ? "+" : "−"}
            {Math.abs(royaltyNet).toLocaleString("en-IN")}
          </span>
        </div>
      )}

      {/* Bill history is now the primary content. Edit-vendor lives
          inside a <details> collapsible above it so the long
          vertical form doesn't dominate the page. Click "Edit
          vendor" to expand; the form is identical to the side-rail
          variant otherwise.
          Crosscheck (read-only) doesn't see this block at all. */}
      {canEdit && (
      <details
        style={{
          marginBottom: 16,
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          padding: "14px 18px",
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 13,
            fontWeight: 700,
            color: ACCOUNTS_TOKENS.accent,
            letterSpacing: "0.01em",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            ✎ Edit vendor details
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>
              (bank info · GSTIN · payment terms · TDS / TCS flags)
            </span>
          </span>
          {/* Mig 050 — tiny low-visibility 🔒 button for vendor
              private notes. The modal client component handles its
              own click event + stops propagation to the parent
              <summary> so clicking the lock doesn't toggle <details>. */}
          <PrivateNotesModal
            vendorId={id}
            canShow={canSeeRoyaltyNet}
          />
        </summary>
        <div style={{ marginTop: 14 }}>
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
              payment_terms_days: vendor.payment_terms_days ?? null,
              tds_applicable: vendor.tds_applicable ?? false,
              default_tds_percent: vendor.default_tds_percent ?? null,
              tcs_applicable: vendor.tcs_applicable ?? false,
              default_tcs_percent: vendor.default_tcs_percent ?? null,
            }}
          />
        </div>
      </details>
      )}

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
                      {(vendor.tds_applicable || totalTdsDeducted > 0) && (
                        <th style={TABLE_STYLES.thRight}>TDS</th>
                      )}
                      {(vendor.tcs_applicable || totalTcsCollected > 0) && (
                        <th style={TABLE_STYLES.thRight}>TCS</th>
                      )}
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
                          {new Date(b.bill_date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
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
                        {(vendor.tds_applicable || totalTdsDeducted > 0) && (
                          <td style={TABLE_STYLES.tdRight}>
                            {Number(b.amount_tds ?? 0) > 0 ? (
                              <Money value={Number(b.amount_tds)} tone="danger" />
                            ) : (
                              <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                            )}
                          </td>
                        )}
                        {(vendor.tcs_applicable || totalTcsCollected > 0) && (
                          <td style={TABLE_STYLES.tdRight}>
                            {Number(b.amount_tcs ?? 0) > 0 ? (
                              <Money value={Number(b.amount_tcs)} tone="muted" />
                            ) : (
                              <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                            )}
                          </td>
                        )}
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
    </section>
  );
}

/** Mig 042 — small KPI card for the TDS / TCS lifetime totals at
 *  the top of the vendor profile. */
function TaxSummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  tone: "danger" | "accent";
}) {
  const accent =
    tone === "danger" ? ACCOUNTS_TOKENS.danger : ACCOUNTS_TOKENS.accent;
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: accent,
          fontFamily: "ui-monospace, monospace",
          marginTop: 4,
        }}
      >
        ₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}
