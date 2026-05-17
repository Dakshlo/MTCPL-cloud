import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canApproveBills,
  canConfirmPayments,
  canManageAccounts,
  canMarkPaid,
  canSubmitBills,
} from "@/lib/accounts-permissions";
import {
  approveBillFormAction,
  cancelBillAction,
  clearPartialRejectionFormAction,
} from "../../actions";
import { RejectBillForm } from "./reject-bill-form";
import { ApproveBillButton } from "./approve-bill-button";
import { BillBackLink } from "./bill-back-link";
import { PartialRejectionForm } from "./partial-rejection-form";
import { CancelBillButton } from "./cancel-bill-button";
import {
  ACCOUNTS_TOKENS,
  BillStatusPill,
  BUTTON_STYLES,
  Money,
  PaymentStatusPill,
  TABLE_STYLES,
  VendorAvatar,
  VendorIdentity,
} from "../../_ui/components";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; saved?: string; just_submitted?: string }>;

export default async function BillDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();
  const { data: bill } = await supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_subtotal, gst_percent, cgst_percent, sgst_percent, igst_percent, tds_percent, tcs_percent, amount_gst, amount_cgst, amount_sgst, amount_igst, amount_tds, amount_tcs, amount_total, amount_payable_to_vendor, amount_paid, amount_outstanding, block_cft, status, rejection_note, partial_rejection_amount, partial_rejection_note, partial_rejection_at, partial_rejection_by, submitted_by, submitted_at, approved_by, approved_at, rejected_by, rejected_at, cancelled_by, cancelled_at, bill_vendor_id, bill_vendors(id, name, category, gstin, phone, email, address, bank_name, bank_account, ifsc, upi_id, tds_applicable, tcs_applicable)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!bill) notFound();

  type VendorInfo = {
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    bank_name: string | null;
    bank_account: string | null;
    ifsc: string | null;
    upi_id: string | null;
  };
  const vendor: VendorInfo | null = Array.isArray(bill.bill_vendors)
    ? (bill.bill_vendors[0] as VendorInfo) ?? null
    : ((bill.bill_vendors as VendorInfo) ?? null);

  const profilesMap = await getProfilesMap();

  const { data: paymentsRaw } = await supabase
    .from("bill_payments")
    .select(
      // Mig 052 follow-on: pull bank-rejection metadata so the
      // timeline below can render the 🏦 entry. previous_payment_id
      // lets us hint "retry of <earlier id>" on the retry row.
      // Mig 053 follow-on: pull final-audit metadata so the bill
      // header can show the PAID + VERIFIED tag once all paid
      // payments are verified.
      "id, status, proposed_amount, proposed_by, proposed_at, confirmed_by, confirmed_at, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, cancelled_by, cancelled_at, cancel_reason, bank_rejected_at, bank_rejected_by, bank_rejection_reason, previous_payment_id, final_audit_status, final_audit_at, final_audit_by, final_audit_flag_reason, final_audit_flag_note",
    )
    .eq("bill_id", id)
    .order("proposed_at", { ascending: false });
  const payments = (paymentsRaw ?? []) as Array<{
    id: string;
    status: string;
    proposed_amount: number;
    proposed_by: string | null;
    proposed_at: string | null;
    confirmed_by: string | null;
    confirmed_at: string | null;
    paid_amount: number | null;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_by: string | null;
    paid_at: string | null;
    cancelled_by: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    bank_rejected_at: string | null;
    bank_rejected_by: string | null;
    bank_rejection_reason: string | null;
    previous_payment_id: string | null;
    final_audit_status: string | null;
    final_audit_at: string | null;
    final_audit_by: string | null;
    final_audit_flag_reason: string | null;
    final_audit_flag_note: string | null;
  }>;

  // Mig 053 — bill-level "PAID + VERIFIED" derivation.
  // Compute audit-rollup over all paid payments on this bill:
  //   • If at least one paid payment is flagged → 'flagged'
  //   • Else if all paid payments are verified → 'verified'
  //   • Else if any paid payment is pending     → 'pending'
  //   • No paid payments yet                     → null (no tag)
  const paidPayments = payments.filter((p) => p.status === "paid");
  const billAuditRollup: "verified" | "flagged" | "pending" | null =
    paidPayments.length === 0
      ? null
      : paidPayments.some((p) => p.final_audit_status === "flagged")
        ? "flagged"
        : paidPayments.every((p) => p.final_audit_status === "verified")
          ? "verified"
          : "pending";

  // Mig 052 — bank_rejected counts as an "open / in-flight" state
  // for the purposes of preventing the bill from being edited from
  // under it. Treat it like proposed/confirmed for locking, AND for
  // hasOpenPayment so the due-bills view still recognises the
  // payment is mid-cycle (rather than re-offering it as fully open).
  const hasOpenPayment = payments.some(
    (p) =>
      p.status === "proposed" ||
      p.status === "confirmed" ||
      p.status === "bank_rejected",
  );
  const isLocked = payments.some((p) => p.status !== "cancelled");
  const isOwnBill = bill.submitted_by === profile.id;
  const canEdit =
    !isLocked &&
    ((bill.status === "rejected" &&
      (canApproveBills(profile) || isOwnBill || canSubmitBills(profile))) ||
      // Mig 058 follow-on (Daksh): pending bills are also editable
      // by the submitter / accountant / biller — they can fix typos
      // before the owner sees it. The form locks bill_date +
      // vendor_bill_no in this mode (those feed the token); other
      // fields stay editable. Server-side gate in editBillAction
      // matches this widening.
      (bill.status === "pending_approval" &&
        (canApproveBills(profile) || isOwnBill || canSubmitBills(profile))) ||
      // Mig 042 follow-on (Daksh): once a bill is in the due-bills
      // list, only the owner can edit. Accountant cannot — they must
      // ask the owner. The button stays hidden for them.
      (bill.status === "approved" && canConfirmPayments(profile)));

  // Timeline events for the right rail
  const timeline: Array<{ at: string; label: string; by: string | null; tone: string }> = [];
  if (bill.submitted_at) {
    timeline.push({
      at: bill.submitted_at,
      label: "Submitted",
      by: bill.submitted_by ? profilesMap[bill.submitted_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.neutral,
    });
  }
  if (bill.approved_at) {
    timeline.push({
      at: bill.approved_at,
      label: "Approved",
      by: bill.approved_by ? profilesMap[bill.approved_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.success,
    });
  }
  if (bill.rejected_at) {
    timeline.push({
      at: bill.rejected_at,
      label: "Rejected",
      by: bill.rejected_by ? profilesMap[bill.rejected_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.danger,
    });
  }
  if (bill.cancelled_at) {
    timeline.push({
      at: bill.cancelled_at,
      label: "Cancelled",
      by: bill.cancelled_by ? profilesMap[bill.cancelled_by] ?? null : null,
      tone: ACCOUNTS_TOKENS.neutral,
    });
  }
  if (bill.partial_rejection_at && Number(bill.partial_rejection_amount ?? 0) > 0) {
    timeline.push({
      at: bill.partial_rejection_at,
      label: `Partial rejection · ₹${Number(bill.partial_rejection_amount).toLocaleString("en-IN")}`,
      by: bill.partial_rejection_by
        ? profilesMap[bill.partial_rejection_by] ?? null
        : null,
      tone: ACCOUNTS_TOKENS.warning,
    });
  }
  for (const p of payments) {
    if (p.paid_at) {
      timeline.push({
        at: p.paid_at,
        label: `Paid ₹${Number(p.paid_amount ?? 0).toLocaleString("en-IN")} · ${p.payment_method?.toUpperCase() ?? "—"}`,
        by: p.paid_by ? profilesMap[p.paid_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.success,
      });
    } else if (p.confirmed_at) {
      timeline.push({
        at: p.confirmed_at,
        label: `Payment confirmed · ₹${Number(p.proposed_amount).toLocaleString("en-IN")}`,
        by: p.confirmed_by ? profilesMap[p.confirmed_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.warning,
      });
    } else if (p.proposed_at) {
      timeline.push({
        at: p.proposed_at,
        label: `Payment proposed · ₹${Number(p.proposed_amount).toLocaleString("en-IN")}`,
        by: p.proposed_by ? profilesMap[p.proposed_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.accent,
      });
    }
    if (p.cancelled_at) {
      timeline.push({
        at: p.cancelled_at,
        label: `Payment cancelled${p.cancel_reason ? ` · ${p.cancel_reason}` : ""}`,
        by: p.cancelled_by ? profilesMap[p.cancelled_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.neutral,
      });
    }
    // Mig 052 — bank-rejection event in the timeline. Surfaces the
    // reason inline so the auditor doesn't have to drill anywhere.
    if (p.bank_rejected_at) {
      timeline.push({
        at: p.bank_rejected_at,
        label: `🏦 Bank rejected${p.bank_rejection_reason ? ` · ${p.bank_rejection_reason}` : ""}`,
        by: p.bank_rejected_by ? profilesMap[p.bank_rejected_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.danger,
      });
    }
    // Mig 053 — final-audit event (verified or flagged). Verified
    // shows quiet green; flagged shows prominent red with reason
    // inline. Skipped for legacy backfill rows (at IS NULL).
    if (p.final_audit_at && p.final_audit_status === "verified") {
      timeline.push({
        at: p.final_audit_at,
        label: "✓ Final audit verified",
        by: p.final_audit_by ? profilesMap[p.final_audit_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.success,
      });
    }
    if (p.final_audit_at && p.final_audit_status === "flagged") {
      timeline.push({
        at: p.final_audit_at,
        label: `🚩 Final audit flagged${p.final_audit_flag_reason ? ` · ${p.final_audit_flag_reason}` : ""}${p.final_audit_flag_note ? ` (${p.final_audit_flag_note})` : ""}`,
        by: p.final_audit_by ? profilesMap[p.final_audit_by] ?? null : null,
        tone: ACCOUNTS_TOKENS.danger,
      });
    }
  }
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <section className="page-card">
      <div style={{ marginBottom: 14 }}>
        {/* Mig 053 follow-on — back link reads document.referrer
            client-side and re-labels based on where the user came
            from (Due Bills, Pay Today, Crosscheck Queue, Final
            Audit, Vendor profile, etc.). Preserves query string so
            filters stay intact on return. Falls back to "All bills"
            on direct visits or external referrers. */}
        <BillBackLink />
      </div>

      {sp.saved && (
        <FlashBanner tone="success">✓ Saved successfully.</FlashBanner>
      )}
      {sp.error && (
        <FlashBanner tone="danger"><strong>Action failed:</strong> {sp.error}</FlashBanner>
      )}

      {/* Mig 042 — fresh-submit banner. Renders only when the
          page is reached via the new-bill redirect with
          `?just_submitted=1`. The token blinks (CSS animation) and
          sits big at the top of the page so the biller is reminded
          to write it on the physical bill. Once they leave/refresh
          without the flag, it goes away. */}
      {sp.just_submitted && (
        <>
          {/* Style block for the blink animation. Scoped to this page
              via a unique class name so it can't leak. */}
          <style>{`
            @keyframes mtcpl-token-blink {
              0%,   60%  { opacity: 1; transform: scale(1); }
              80%        { opacity: 0.35; transform: scale(0.985); }
              100%       { opacity: 1; transform: scale(1); }
            }
            .mtcpl-token-blink {
              animation: mtcpl-token-blink 1.4s ease-in-out infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .mtcpl-token-blink { animation: none; }
            }
          `}</style>
          <div
            style={{
              marginBottom: 18,
              padding: "16px 22px",
              background: "linear-gradient(135deg, #fff7ed 0%, #fffaf3 100%)",
              border: `2px solid ${ACCOUNTS_TOKENS.warning}`,
              borderRadius: 14,
              display: "flex",
              gap: 18,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              boxShadow: "0 4px 12px rgba(217, 119, 6, 0.18)",
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 34, lineHeight: 1 }} aria-hidden>✍️</span>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: ACCOUNTS_TOKENS.warning,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Write this on the physical bill before filing
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 13,
                    color: "var(--text)",
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  Bill submitted and queued for crosscheck audit. Pen the
                  token below on the paper bill so we can match it back to
                  this entry later.
                </div>
              </div>
            </div>
            <code
              className="mtcpl-token-blink"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 32,
                fontWeight: 800,
                padding: "10px 22px",
                background: "#fff",
                color: ACCOUNTS_TOKENS.warning,
                border: `3px dashed ${ACCOUNTS_TOKENS.warning}`,
                borderRadius: 10,
                letterSpacing: "0.04em",
              }}
            >
              {bill.token}
            </code>
          </div>
        </>
      )}

      {/* Hero block — token, vendor, total, status */}
      <div
        style={{
          background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 14,
          padding: "20px 22px",
          marginBottom: 18,
          boxShadow: ACCOUNTS_TOKENS.shadow,
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <VendorAvatar name={vendor?.name ?? "?"} size={56} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <code
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 14,
                  fontWeight: 700,
                  padding: "3px 10px",
                  background: ACCOUNTS_TOKENS.accentLight,
                  color: ACCOUNTS_TOKENS.accent,
                  borderRadius: 6,
                  letterSpacing: "0.02em",
                }}
              >
                {bill.token}
              </code>
              <BillStatusPill status={bill.status} />
              {/* Mig 053 — final-audit rollup tag.
                  - verified: every paid payment is verified → green
                  - flagged: at least one paid payment flagged → red
                  - pending: paid but awaiting final audit  → amber */}
              {billAuditRollup === "verified" && (
                <span
                  title="Every payment on this bill has been verified against the bank statement by the final auditor."
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "rgba(21, 128, 61, 0.12)",
                    color: "#15803d",
                    border: "1px solid rgba(21, 128, 61, 0.3)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  ✓ Verified
                </span>
              )}
              {billAuditRollup === "flagged" && (
                <span
                  title="One or more payments on this bill have been flagged by the final auditor. See the timeline below."
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "rgba(185, 28, 28, 0.12)",
                    color: "#b91c1c",
                    border: "1px solid rgba(185, 28, 28, 0.3)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  🚩 Flagged
                </span>
              )}
              {billAuditRollup === "pending" && (
                <span
                  title="Paid but awaiting final audit (UTR cross-check against bank statement)."
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "rgba(180, 83, 9, 0.12)",
                    color: "#b45309",
                    border: "1px solid rgba(180, 83, 9, 0.3)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  ⏳ Pending final audit
                </span>
              )}
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {vendor?.name ?? "Unknown vendor"}
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Vendor bill <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{bill.vendor_bill_no}</code>
              {" · "}
              {new Date(bill.bill_date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {bill.cost_head ? <> · <span style={{ color: ACCOUNTS_TOKENS.warning, fontWeight: 600 }}>{bill.cost_head}</span></> : null}
              {/* Mig 062 — block-purchase bills carry a CFT volume.
                  Render as an inline chip in the meta row so it's
                  visible at a glance + show ₹/CFT calc on hover. */}
              {bill.block_cft != null && Number(bill.block_cft) > 0 && (
                <>
                  {" · "}
                  <span
                    title={`Stone volume on this bill. Effective ₹${(Number(bill.amount_subtotal) / Number(bill.block_cft)).toLocaleString("en-IN", { maximumFractionDigits: 2 })} per CFT (subtotal basis)`}
                    style={{
                      display: "inline-block",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      background: "#fce7f3",
                      color: "#9d174d",
                      borderRadius: 999,
                      letterSpacing: "0.02em",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {Number(bill.block_cft).toLocaleString("en-IN", { maximumFractionDigits: 3 })} CFT
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 220 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Bill total
          </div>
          <Money value={Number(bill.amount_total)} size="hero" tone="accent" />
          {/* Full tax breakdown — CGST + SGST OR IGST, plus TDS / TCS
              when the bill carried them. Existing bills (entered
              before mig 042) have all the new percents at 0 and just
              fall back to showing the legacy GST line. */}
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              color: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
              alignItems: "flex-end",
            }}
          >
            <BreakdownRow label="Net" value={Number(bill.amount_subtotal)} />
            {Number(bill.cgst_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`CGST ${Number(bill.cgst_percent)}%`}
                value={Number(bill.amount_cgst ?? 0)}
              />
            )}
            {Number(bill.sgst_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`SGST ${Number(bill.sgst_percent)}%`}
                value={Number(bill.amount_sgst ?? 0)}
              />
            )}
            {Number(bill.igst_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`IGST ${Number(bill.igst_percent)}%`}
                value={Number(bill.amount_igst ?? 0)}
              />
            )}
            {/* Legacy bills (mig 028) that only have gst_percent and
                no breakdown — show the single GST line. */}
            {Number(bill.cgst_percent ?? 0) === 0 &&
              Number(bill.sgst_percent ?? 0) === 0 &&
              Number(bill.igst_percent ?? 0) === 0 &&
              Number(bill.gst_percent) > 0 && (
                <BreakdownRow
                  label={`GST ${Number(bill.gst_percent)}%`}
                  value={Number(bill.amount_gst)}
                />
              )}
            {/* Mig 045 — partial rejection (debit-note math). When set,
                the surviving subtotal drives TDS/TCS, so render the
                rejection line BEFORE the tax rows so the breakdown
                reads top-to-bottom in calc order. */}
            {Number(bill.partial_rejection_amount ?? 0) > 0 && (
              <BreakdownRow
                label="− Rejected"
                value={Number(bill.partial_rejection_amount ?? 0)}
                tone="warning"
              />
            )}
            {Number(bill.tds_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`− TDS ${Number(bill.tds_percent)}%`}
                value={Number(bill.amount_tds ?? 0)}
                tone="danger"
              />
            )}
            {Number(bill.tcs_percent ?? 0) > 0 && (
              <BreakdownRow
                label={`+ TCS ${Number(bill.tcs_percent)}%`}
                value={Number(bill.amount_tcs ?? 0)}
              />
            )}
            {(Number(bill.tds_percent ?? 0) > 0 ||
              Number(bill.tcs_percent ?? 0) > 0 ||
              Number(bill.partial_rejection_amount ?? 0) > 0) && (
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 4,
                  borderTop: `1px dashed ${ACCOUNTS_TOKENS.border}`,
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: 700,
                  color: ACCOUNTS_TOKENS.success,
                }}
              >
                <span>Pay vendor</span>
                <span>
                  ₹{Number(
                    bill.amount_payable_to_vendor ?? bill.amount_total,
                  ).toLocaleString("en-IN")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column body: details + side rail */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 340px)",
          gap: 18,
        }}
      >
        {/* LEFT column — payment summary + description + payment history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Payment summary cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            <SummaryCard
              label={
                Number(bill.partial_rejection_amount ?? 0) > 0
                  ? "Pay vendor"
                  : "Total"
              }
              value={
                Number(bill.partial_rejection_amount ?? 0) > 0 ? (
                  // Surviving payable: shows the cashflow-truth number
                  // after rejection, with the original bill total as a
                  // muted strike-through label so the auditor can see
                  // both at a glance.
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Money
                      value={Number(
                        bill.amount_payable_to_vendor ?? bill.amount_total,
                      )}
                      size="large"
                      tone="warning"
                    />
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        textDecoration: "line-through",
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      was ₹{Number(bill.amount_total).toLocaleString("en-IN")}
                    </span>
                  </div>
                ) : (
                  <Money value={Number(bill.amount_total)} size="large" />
                )
              }
              tone={
                Number(bill.partial_rejection_amount ?? 0) > 0
                  ? ACCOUNTS_TOKENS.warning
                  : ACCOUNTS_TOKENS.neutral
              }
            />
            <SummaryCard
              label="Paid"
              value={
                Number(bill.amount_paid) > 0 ? (
                  <Money value={Number(bill.amount_paid)} size="large" tone="success" />
                ) : (
                  <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 600 }}>—</span>
                )
              }
              tone={ACCOUNTS_TOKENS.success}
            />
            <SummaryCard
              label="Outstanding"
              value={
                Number(bill.amount_outstanding) > 0 ? (
                  <Money value={Number(bill.amount_outstanding)} size="large" tone="warning" />
                ) : (
                  <span style={{ fontSize: 16, color: ACCOUNTS_TOKENS.success, fontWeight: 700 }}>Cleared</span>
                )
              }
              tone={Number(bill.amount_outstanding) > 0 ? ACCOUNTS_TOKENS.warning : ACCOUNTS_TOKENS.success}
            />
          </div>

          {/* Partial rejection (mig 045) — visible when:
                (a) a rejection is already marked (always render the
                    info card so the team can see what / who / why,
                    plus Edit + Clear buttons if still editable), OR
                (b) bill is approved or pending-approval AND no payment
                    has been paid yet AND user can manage accounts —
                    then render the "+ Mark partial rejection" button.
              Locked once any payment hits status='paid'.
          */}
          {(() => {
            const rejectionAmt = Number(bill.partial_rejection_amount ?? 0);
            const isLockedByPaidPayment = payments.some((p) => p.status === "paid");
            const canMarkOrEdit =
              canManageAccounts(profile) &&
              !isLockedByPaidPayment &&
              (bill.status === "approved" || bill.status === "pending_approval");
            const showCard = rejectionAmt > 0 || canMarkOrEdit;
            if (!showCard) return null;
            const rejectedByName = bill.partial_rejection_by
              ? profilesMap[bill.partial_rejection_by] ?? "Unknown"
              : null;
            return (
              <div
                style={{
                  background: rejectionAmt > 0 ? ACCOUNTS_TOKENS.warningLight : "#fff",
                  border: `1px solid ${rejectionAmt > 0 ? ACCOUNTS_TOKENS.warning : ACCOUNTS_TOKENS.border}`,
                  borderLeft: rejectionAmt > 0 ? `4px solid ${ACCOUNTS_TOKENS.warning}` : `1px solid ${ACCOUNTS_TOKENS.border}`,
                  borderRadius: 10,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: rejectionAmt > 0 ? ACCOUNTS_TOKENS.warning : "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Partial rejection
                    {isLockedByPaidPayment && rejectionAmt > 0 && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 9,
                          background: "rgba(15,23,42,0.08)",
                          color: "var(--muted)",
                          letterSpacing: "0.05em",
                        }}
                      >
                        🔒 LOCKED
                      </span>
                    )}
                  </div>
                  {rejectionAmt > 0 && (
                    <div style={{ fontSize: 14, fontWeight: 800, color: ACCOUNTS_TOKENS.warning, fontFamily: "ui-monospace, monospace" }}>
                      −₹{rejectionAmt.toLocaleString("en-IN")}
                    </div>
                  )}
                </div>

                {rejectionAmt > 0 && (
                  <>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: "var(--text)",
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {bill.partial_rejection_note ?? "—"}
                    </p>
                    {(rejectedByName || bill.partial_rejection_at) && (
                      <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
                        {rejectedByName ? `Marked by ${rejectedByName}` : "Marked"}
                        {bill.partial_rejection_at
                          ? ` · ${new Date(bill.partial_rejection_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          : ""}
                      </p>
                    )}
                  </>
                )}

                {canMarkOrEdit && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
                    <PartialRejectionForm
                      billId={bill.id}
                      maxAmount={Number(bill.amount_subtotal)}
                      currentAmount={rejectionAmt}
                      currentNote={bill.partial_rejection_note ?? null}
                    />
                    {rejectionAmt > 0 && (
                      <form action={clearPartialRejectionFormAction}>
                        <input type="hidden" name="bill_id" value={bill.id} />
                        <button
                          type="submit"
                          style={{
                            ...BUTTON_STYLES.ghost,
                            color: ACCOUNTS_TOKENS.danger,
                            borderColor: ACCOUNTS_TOKENS.danger,
                          }}
                          title="Remove this rejection — payable resets to the full bill total"
                        >
                          🗑 Clear rejection
                        </button>
                      </form>
                    )}
                  </div>
                )}
                {rejectionAmt > 0 && isLockedByPaidPayment && (
                  <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
                    A payment has been marked paid — this rejection is now frozen for audit.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Description */}
          <Section title="Description">
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)" }}>
              {bill.description}
            </p>
          </Section>

          {/* Rejection note */}
          {bill.status === "rejected" && bill.rejection_note && (
            <div
              style={{
                padding: "14px 16px",
                background: ACCOUNTS_TOKENS.dangerLight,
                border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
                borderLeft: `4px solid ${ACCOUNTS_TOKENS.danger}`,
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: ACCOUNTS_TOKENS.danger,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 4,
                }}
              >
                Rejected
                {bill.rejected_by && profilesMap[bill.rejected_by]
                  ? ` · by ${profilesMap[bill.rejected_by]}`
                  : ""}
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{bill.rejection_note}</p>
            </div>
          )}

          {/* Owner audit actions */}
          {bill.status === "pending_approval" && canApproveBills(profile) && (
            <div
              style={{
                padding: 16,
                background: ACCOUNTS_TOKENS.accentLight,
                border: `1.5px solid ${ACCOUNTS_TOKENS.accentBorder}`,
                borderRadius: 12,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13, color: ACCOUNTS_TOKENS.accent, fontWeight: 600, flex: 1, minWidth: 200 }}>
                ⏱ This bill is waiting for your audit. Review the entry against the physical bill.
              </span>
              {/* Mig 053 follow-on — branded overlay during approve.
                  Same server action, just a client wrapper that drives
                  the spinning logo via useFormStatus(). */}
              <ApproveBillButton
                billId={bill.id}
                action={approveBillFormAction}
              />
              <RejectBillForm billId={bill.id} />
            </div>
          )}

          {/* Payment history */}
          <Section
            title={`Payment history`}
            subtitle={`${payments.length} record${payments.length === 1 ? "" : "s"}`}
          >
            {payments.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", padding: "10px 4px" }}>
                No payment activity yet.
              </p>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table style={TABLE_STYLES.table}>
                  <thead style={TABLE_STYLES.thead}>
                    <tr>
                      <th style={TABLE_STYLES.th}>Status</th>
                      <th style={TABLE_STYLES.th}>Activity</th>
                      <th style={TABLE_STYLES.thRight}>Proposed</th>
                      <th style={TABLE_STYLES.thRight}>Paid</th>
                      <th style={TABLE_STYLES.th}>Method · Ref</th>
                      <th style={TABLE_STYLES.th}>Who</th>
                      <th style={TABLE_STYLES.th}>Voucher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td style={TABLE_STYLES.td}>
                          <PaymentStatusPill status={p.status} />
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                          {p.paid_at
                            ? new Date(p.paid_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : p.proposed_at
                              ? new Date(p.proposed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                        </td>
                        <td style={TABLE_STYLES.tdRight}>
                          <Money value={Number(p.proposed_amount)} size="small" tone="muted" />
                        </td>
                        <td style={TABLE_STYLES.tdRight}>
                          {p.paid_amount != null ? (
                            <Money value={Number(p.paid_amount)} size="small" tone="success" />
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12 }}>
                          {p.payment_method ? (
                            <>
                              <strong style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {p.payment_method}
                              </strong>
                              {p.payment_reference ? <span style={{ color: "var(--muted)" }}> · {p.payment_reference}</span> : null}
                            </>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                          {p.status === "paid" && p.paid_by
                            ? profilesMap[p.paid_by]
                            : p.status === "cancelled" && p.cancelled_by
                              ? `Cancelled · ${profilesMap[p.cancelled_by] ?? ""}`
                              : p.status === "confirmed" && p.confirmed_by
                                ? `Confirmed · ${profilesMap[p.confirmed_by] ?? ""}`
                                : p.proposed_by
                                  ? profilesMap[p.proposed_by]
                                  : "—"}
                        </td>
                        <td style={{ ...TABLE_STYLES.td, fontSize: 12 }}>
                          {p.status === "paid" ? (
                            <Link
                              href={`/accounts/payments/${p.id}/voucher`}
                              title="Open the printable payment voucher"
                              style={{
                                textDecoration: "none",
                                color: ACCOUNTS_TOKENS.accent,
                                fontWeight: 700,
                                fontSize: 11,
                                padding: "3px 10px",
                                background: ACCOUNTS_TOKENS.accentLight,
                                border: `1px solid ${ACCOUNTS_TOKENS.accentBorder ?? ACCOUNTS_TOKENS.accent}`,
                                borderRadius: 6,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                whiteSpace: "nowrap",
                              }}
                            >
                              🖨 Voucher
                            </Link>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {isLocked && (
            <p style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
              Bill is locked — payment activity exists. Contact a developer for corrections.
            </p>
          )}
        </div>

        {/* RIGHT rail — vendor info + timeline + secondary actions */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Vendor card */}
          {vendor && (
            <div
              style={{
                background: "#fff",
                border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                borderRadius: 12,
                padding: 16,
                boxShadow: ACCOUNTS_TOKENS.shadow,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Vendor
              </div>
              <VendorIdentity
                name={vendor.name}
                subLabel={vendor.category ?? undefined}
                size={36}
                href={`/accounts/vendors/${vendor.id}`}
              />
              <dl style={{ margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                {vendor.gstin && <KV k="GSTIN" v={vendor.gstin} mono />}
                {vendor.phone && <KV k="Phone" v={vendor.phone} />}
                {vendor.email && <KV k="Email" v={vendor.email} />}
                {vendor.upi_id && <KV k="UPI" v={vendor.upi_id} mono />}
                {vendor.bank_name && <KV k="Bank" v={vendor.bank_name} />}
                {vendor.bank_account && <KV k="A/C No." v={vendor.bank_account} mono />}
                {vendor.ifsc && <KV k="IFSC" v={vendor.ifsc} mono />}
              </dl>
            </div>
          )}

          {/* Actions */}
          {canEdit && (
            <div
              style={{
                background: "#fff",
                border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Actions
              </div>
              <Link href={`/accounts/bills/${bill.id}/edit`} style={BUTTON_STYLES.secondary}>
                ✏ Edit bill
              </Link>
              {/* Mig 058 follow-on (Daksh) — accountant + biller
                  can now cancel their own pending/rejected bills
                  (the documented escape hatch for changing date /
                  vendor invoice no). Two-step confirmation is built
                  into CancelBillButton — Daksh accidentally cancelled
                  a real bill with the unconfirmed single-click
                  form-action variant. */}
              {!isLocked &&
                (bill.status === "pending_approval" || bill.status === "rejected") &&
                (profile.role === "developer" ||
                  profile.role === "owner" ||
                  canSubmitBills(profile)) && (
                  <CancelBillButton
                    billId={bill.id}
                    billToken={bill.token}
                    cancelAction={cancelBillAction}
                  />
                )}
            </div>
          )}

          {/* Approved + has outstanding → reminder */}
          {bill.status === "approved" &&
            Number(bill.amount_outstanding) > 0 &&
            !hasOpenPayment &&
            canManageAccounts(profile) && (
              <div
                style={{
                  background: ACCOUNTS_TOKENS.successLight,
                  border: `1px solid ${ACCOUNTS_TOKENS.success}`,
                  borderRadius: 12,
                  padding: 14,
                  fontSize: 13,
                  color: ACCOUNTS_TOKENS.success,
                  fontWeight: 600,
                }}
              >
                Ready for payment proposal —{" "}
                <Link href="/accounts" style={{ color: ACCOUNTS_TOKENS.success, fontWeight: 700, textDecoration: "underline" }}>
                  open Due Bills
                </Link>
              </div>
            )}
          {hasOpenPayment && canManageAccounts(profile) && (
            <div
              style={{
                background: ACCOUNTS_TOKENS.warningLight,
                border: `1px solid ${ACCOUNTS_TOKENS.warning}`,
                borderRadius: 12,
                padding: 14,
                fontSize: 13,
                color: ACCOUNTS_TOKENS.warning,
                fontWeight: 600,
              }}
            >
              Payment in flight —{" "}
              <Link href="/accounts/pay-today" style={{ color: ACCOUNTS_TOKENS.warning, fontWeight: 700, textDecoration: "underline" }}>
                continue on Pay Today
              </Link>
            </div>
          )}

          {/* Audit timeline */}
          <div
            style={{
              background: "#fff",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 12,
              padding: 16,
              boxShadow: ACCOUNTS_TOKENS.shadow,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Audit trail
            </div>
            {timeline.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No events yet.</p>
            ) : (
              <ol style={{ listStyle: "none", padding: 0, margin: 0, position: "relative" }}>
                {/* vertical line */}
                <span
                  style={{
                    position: "absolute",
                    left: 6,
                    top: 6,
                    bottom: 6,
                    width: 1.5,
                    background: ACCOUNTS_TOKENS.border,
                  }}
                />
                {timeline.map((e, i) => (
                  <li key={i} style={{ position: "relative", paddingLeft: 22, paddingBottom: i === timeline.length - 1 ? 0 : 14 }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 3,
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        background: e.tone,
                        border: `2px solid var(--surface, #fff)`,
                      }}
                    />
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                      {e.label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                      {new Date(e.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {e.by ? ` · ${e.by}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function FlashBanner({
  tone,
  children,
}: {
  tone: "success" | "danger";
  children: React.ReactNode;
}) {
  const tones = {
    success: { bg: ACCOUNTS_TOKENS.successLight, border: ACCOUNTS_TOKENS.success, fg: ACCOUNTS_TOKENS.success },
    danger: { bg: ACCOUNTS_TOKENS.dangerLight, border: ACCOUNTS_TOKENS.danger, fg: ACCOUNTS_TOKENS.danger },
  };
  const t = tones[tone];
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 14px",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        color: t.fg,
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>
          {title}
        </h3>
        {subtitle && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Compact "label / value" line for the tax breakdown column.
 *  Mig 042 — shows one row per non-zero tax line so the bill detail
 *  carries the full breakdown the accountant needs. */
function BreakdownRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  /** "warning" added mig 045 for the partial-rejection row — visually
   *  distinct from TDS "danger" while still reading as a deduction. */
  tone?: "muted" | "danger" | "warning";
}) {
  const color =
    tone === "danger"
      ? ACCOUNTS_TOKENS.danger
      : tone === "warning"
        ? ACCOUNTS_TOKENS.warning
        : "var(--muted)";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        gap: 10,
      }}
    >
      <span style={{ color }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600 }}>
        ₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 10,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <dt style={{ color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {k}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          color: "var(--text)",
          fontSize: 12,
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {v}
      </dd>
    </div>
  );
}
