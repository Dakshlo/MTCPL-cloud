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
import { RoyaltyNetPeek } from "./royalty-net-peek";
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

// Daksh June 2026 — Paid column for the bill-history table. Shows the total
// paid (green) plus, for part-paid bills, one small green chip per payment
// (amount · paid date), mirroring the Due Bills page. Display-only.
function PaidCell({
  paid,
  parts,
}: {
  paid: number;
  parts: Array<{ amount: number; paidAt: string | null; method: string | null }>;
}) {
  if (paid <= 0 && parts.length === 0) {
    return <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>;
  }
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <Money value={paid} tone="success" />
      {parts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          {parts.map((p, i) => {
            const datePart = p.paidAt
              ? new Date(p.paidAt).toLocaleDateString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  day: "numeric",
                  month: "short",
                })
              : null;
            return (
              <span
                key={i}
                title={[
                  `Part #${i + 1}`,
                  datePart ? `Paid on ${datePart}` : null,
                  p.method ? `via ${p.method}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#15803d",
                  background: "rgba(34,197,94,0.10)",
                  border: "1px solid rgba(34,197,94,0.25)",
                  borderRadius: 4,
                  padding: "1px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                ₹{p.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                {datePart ? <span style={{ opacity: 0.7, fontWeight: 500 }}> · {datePart}</span> : null}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Hold column — the owner-withheld amount (mig 072) as an amber chip,
// reason on hover. Display-only.
function HoldCell({ amount, reason }: { amount: number; reason: string | null }) {
  if (!(amount > 0)) {
    return <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>;
  }
  return (
    <span
      title={reason ? `On hold — ${reason}` : "Owner-withheld amount"}
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "#b45309",
        background: "rgba(217,119,6,0.12)",
        border: "1px solid rgba(217,119,6,0.35)",
        borderRadius: 6,
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      ₹{Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
    </span>
  );
}

type Params = Promise<{ id: string }>;
// Mig 082 follow-on (Daksh) — `?from=...` query param tells the
// page where the user came from. Used to render a context-aware
// back button at the top, e.g. "← Back to Final Audit" when the
// auditor pivoted in from /accounts/final-audit. Recognised
// values: "final-audit" (more can be added later).
type SearchParams = Promise<{ from?: string }>;

export default async function BillVendorDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (!canViewBillVendors(profile)) {
    redirect("/accounts");
  }
  const canEdit = canManageBillVendors(profile);
  const { id } = await params;
  const fromContext = (await searchParams)?.from ?? null;
  const supabase = createAdminSupabaseClient();

  const { data: vendor } = await supabase
    .from("bill_vendors")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!vendor) notFound();

  // Mig 082 — load user-created categories so the inline edit form
  // surfaces them in the picker alongside the canonical list.
  const { data: customCategoriesRaw } = await supabase
    .from("bill_vendor_custom_categories")
    .select("value, label, pill_fg, pill_bg")
    .eq("is_active", true)
    .order("label");
  const customCategories = (customCategoriesRaw ?? []) as Array<{
    value: string;
    label: string;
    pill_fg: string;
    pill_bg: string;
  }>;

  const { data: billsRaw } = await supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, amount_total, amount_paid, amount_outstanding, amount_tds, amount_tcs, amount_payable_to_vendor, status, held_amount, held_reason",
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
    profile.role === "accountant_star" ||
    // Mig 061 follow-on (Daksh): crosscheck also gets the royalty
    // net + private-notes modal — they need to add/cancel royalty
    // entries while reviewing bills.
    profile.role === "crosscheck";
  let royaltyNet: number | null = null;
  if (canSeeRoyaltyNet) {
    // Mig 064 — only `approved` entries count toward the displayed
    // net. Pending entries (added by accountant/accountant_star/
    // crosscheck waiting for owner sign-off) and rejected entries
    // both stay out. Keeps the page net in sync with the modal
    // total: both show only what the owner has signed off on.
    const { data: royaltyRows, error: royaltyErr } = await supabase
      .from("vendor_royalty_entries")
      .select("amount, entry_type, cancelled_at, status")
      .eq("bill_vendor_id", id)
      .eq("status", "approved")
      .is("cancelled_at", null);
    if (!royaltyErr && royaltyRows) {
      let received = 0;
      let paid = 0;
      for (const r of royaltyRows as Array<{
        amount: number;
        entry_type: string;
      }>) {
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
    held_amount: number;
    held_reason: string | null;
  }>;

  // Daksh June 2026 — per-bill PAID part-payments for the new Paid column's
  // chips. READ-ONLY: only the confirmed-paid bill_payments rows, oldest
  // first. Touches no totals and no payment logic.
  const partsByBill = new Map<
    string,
    Array<{ amount: number; paidAt: string | null; method: string | null }>
  >();
  const billIds = bills.map((b) => b.id);
  if (billIds.length > 0) {
    const { data: payRows } = await supabase
      .from("bill_payments")
      .select("bill_id, paid_amount, paid_at, payment_method")
      .in("bill_id", billIds)
      .eq("status", "paid")
      .order("paid_at", { ascending: true });
    for (const p of (payRows ?? []) as Array<{
      bill_id: string;
      paid_amount: number | null;
      paid_at: string | null;
      payment_method: string | null;
    }>) {
      const list = partsByBill.get(p.bill_id) ?? [];
      list.push({
        amount: Number(p.paid_amount) || 0,
        paidAt: p.paid_at ?? null,
        method: p.payment_method ?? null,
      });
      partsByBill.set(p.bill_id, list);
    }
  }

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

  // Mig 073 — advance credit balance (per-vendor view) + the
  // vendor's advance history. Used by the new KPI tile + the
  // Advances section below the bill history.
  const [{ data: balanceRow }, { data: advanceRows }] = await Promise.all([
    supabase
      .from("vendor_advance_balance")
      .select("available_balance, total_paid, total_applied, open_advance_count")
      .eq("vendor_id", vendor.id)
      .maybeSingle(),
    supabase
      .from("vendor_advances")
      .select("id, token, amount, status, proposed_at, paid_at, cancelled_at, payment_reference")
      .eq("vendor_id", vendor.id)
      .order("proposed_at", { ascending: false })
      .limit(20),
  ]);
  type AdvBal = {
    available_balance: number;
    total_paid: number;
    total_applied: number;
    open_advance_count: number;
  };
  const advanceBalance = (balanceRow as AdvBal | null) ?? {
    available_balance: 0,
    total_paid: 0,
    total_applied: 0,
    open_advance_count: 0,
  };
  type AdvanceLite = {
    id: string;
    token: string;
    amount: number | string;
    status: string;
    proposed_at: string;
    paid_at: string | null;
    cancelled_at: string | null;
    payment_reference: string | null;
  };
  const advances = (advanceRows ?? []) as AdvanceLite[];

  return (
    <section className="page-card">
      <div style={{ marginBottom: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
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
        {/* Mig 082 follow-on (Daksh) — context-aware back link.
            When the auditor pivots in from Final Audit
            (`?from=final-audit`), we surface a prominent button
            that takes them back to the same audit page. The
            browser preserves scroll on history.back-style
            navigation; we use a plain Link to /accounts/final-
            audit so the page reloads with the latest queue. */}
        {fromContext === "final-audit" && (
          <Link
            href="/accounts/final-audit"
            style={{
              padding: "5px 12px",
              background: "rgba(180, 83, 9, 0.10)",
              border: "1px solid rgba(180, 83, 9, 0.35)",
              borderRadius: 999,
              color: "#b45309",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.02em",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ← Back to Final Audit
          </Link>
        )}
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
          {/* Mig 073 — Advance balance KPI. Always renders for visibility
              (₹0 is informative when zero open). */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              📥 Advance credit
            </div>
            {Number(advanceBalance.available_balance) > 0 ? (
              <Money value={Number(advanceBalance.available_balance)} size="large" tone="warning" />
            ) : (
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--muted)",
                  letterSpacing: "-0.02em",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                ₹0
              </span>
            )}
            {Number(advanceBalance.open_advance_count) > 0 && (
              <div style={{ fontSize: 10, color: "var(--muted)" }}>
                across {advanceBalance.open_advance_count} open advance
                {advanceBalance.open_advance_count === 1 ? "" : "s"}
              </div>
            )}
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

      {/* Mig 061 follow-on (Daksh): both private-data dots live in
          one row directly above the Edit vendor details panel so
          they sit on the same vertical baseline. Left = net peek
          (collapsed dot, click reveals "Net: +/-X (10s)" inline).
          Right = Private Notes / Royalty modal trigger (collapsed
          dot, click opens the passphrase-gated modal). Net dot
          collapses to empty placeholder when balance is 0 so the
          modal dot stays right-aligned regardless. */}
      {canSeeRoyaltyNet && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            minHeight: 14,
          }}
        >
          <div>
            {royaltyNet !== null && royaltyNet !== 0 && (
              <RoyaltyNetPeek netValue={royaltyNet} />
            )}
          </div>
          <PrivateNotesModal
            vendorId={id}
            canShow={canSeeRoyaltyNet}
            canCancelRoyalty={
              profile.role === "developer" || profile.role === "owner"
            }
          />
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
        </summary>
        <div style={{ marginTop: 14 }}>
          <VendorForm
            action={upsertBillVendorAction}
            mode="edit"
            vendorId={id}
            nameLocked={!canRenameBillVendor(profile)}
            customCategories={customCategories}
            initialValues={{
              name: vendor.name,
              nickname: vendor.nickname,
              category: vendor.category,
              gstin: vendor.gstin,
              pan: vendor.pan,
              address: vendor.address,
              phone: vendor.phone,
              email: vendor.email,
              bank_name: vendor.bank_name,
              bank_account: vendor.bank_account,
              ifsc: vendor.ifsc,
              // Bug fix (Daksh, May 2026): hdfc_bene_name was missing
              // from initialValues, so the form re-loaded with a blank
              // input even when the DB had a saved value. Every save
              // then re-submitted "" → server wrote NULL → user thought
              // their edit didn't persist. Pass the stored value in
              // so the input round-trips correctly.
              hdfc_bene_name: vendor.hdfc_bene_name,
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
                      <th style={TABLE_STYLES.thRight}>Paid</th>
                      <th style={TABLE_STYLES.thRight}>Hold</th>
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
                          <PaidCell paid={Number(b.amount_paid ?? 0)} parts={partsByBill.get(b.id) ?? []} />
                        </td>
                        <td style={TABLE_STYLES.tdRight}>
                          <HoldCell amount={Number(b.held_amount ?? 0)} reason={b.held_reason} />
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

        {/* Mig 073 — Advances section. Lists every advance for this
            vendor (paid, in-flight, cancelled). Click-through to the
            advance detail page. */}
        {advances.length > 0 && (
          <div
            style={{
              padding: "18px 20px",
              background: "var(--surface)",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 12,
              marginTop: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                📥 Advances · {advances.length}
              </h3>
              <Link
                href={`/accounts/advances?vendor=${vendor.id}`}
                style={{ fontSize: 12, color: ACCOUNTS_TOKENS.accent, textDecoration: "underline" }}
              >
                See all →
              </Link>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={TABLE_STYLES.th}>Token</th>
                    <th style={TABLE_STYLES.thRight}>Amount</th>
                    <th style={TABLE_STYLES.th}>Status</th>
                    <th style={TABLE_STYLES.th}>Paid at</th>
                    <th style={TABLE_STYLES.th}>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map((a) => (
                    <tr key={a.id}>
                      <td style={TABLE_STYLES.td}>
                        <Link
                          href={`/accounts/advances/${a.id}`}
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 700,
                            color: ACCOUNTS_TOKENS.warning,
                            textDecoration: "none",
                          }}
                        >
                          {a.token}
                        </Link>
                      </td>
                      <td style={TABLE_STYLES.tdRight}>
                        <Money value={Number(a.amount)} />
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background:
                              a.status === "paid"
                                ? ACCOUNTS_TOKENS.successLight
                                : a.status === "cancelled"
                                  ? ACCOUNTS_TOKENS.surfaceMuted
                                  : ACCOUNTS_TOKENS.warningLight,
                            color:
                              a.status === "paid"
                                ? ACCOUNTS_TOKENS.success
                                : a.status === "cancelled"
                                  ? "var(--muted)"
                                  : ACCOUNTS_TOKENS.warning,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 11, color: "var(--muted)" }}>
                        {a.paid_at
                          ? new Date(a.paid_at).toLocaleDateString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                        {a.payment_reference ?? "—"}
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
