import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canFinalAudit } from "@/lib/accounts-permissions";
import {
  flagFinalAuditAction,
  verifyFinalAuditAction,
} from "../actions";
import {
  FinalAuditClient,
  type FinalAuditRow,
} from "./final-audit-client";
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  EmptyState,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../_ui/components";

/**
 * Migration 053 — Final Audit page.
 *
 * Workflow:
 *   1. Every paid payment lands in this page's "Pending" queue with
 *      final_audit_status = 'pending'.
 *   2. The final auditor opens the bank statement, finds the UTR
 *      shown on the card, and confirms:
 *        - same vendor account?
 *        - same amount?
 *        - actually credited?
 *   3. Tap ✓ Verified → row moves out of the queue (terminal).
 *      Tap 🚩 Flag a problem → capture reason; row stays in the
 *      "Recently audited" tab as a flagged entry. Owner sees it.
 *
 * This is NOT an approval. Money has already moved when a payment
 * lands here. Flag = "I noticed something" — no reversal happens.
 */
export default async function FinalAuditPage() {
  const { profile } = await requireAuth();
  if (!canFinalAudit(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // ── Pending queue ────────────────────────────────────────────────
  // Paid payments awaiting verification. Index-backed.
  const { data: pendingRaw } = await supabase
    .from("bill_payments")
    .select(
      "id, bill_id, status, final_audit_status, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, confirmed_by, confirmed_at, bills(id, token, vendor_bill_no, bill_date, bill_vendor_id, bill_vendors(id, name, bank_name, bank_account, ifsc, hdfc_bene_name))",
    )
    .eq("status", "paid")
    .eq("final_audit_status", "pending")
    // Mig 073 — synthetic advance-application rows are NOT real bank
    // payments (the cash moved when the original advance was paid),
    // so they shouldn't appear in Final Audit's queue.
    .eq("is_advance_application", false)
    .order("paid_at", { ascending: false })
    .limit(200);

  // ── Recently audited (last 14 days) ──────────────────────────────
  // Mix of verified + flagged for context. Owner uses the flagged
  // entries; auditor uses both to refer back to "did I already do
  // this one?". 14d window keeps the page snappy.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 86_400_000;
  const nowMs = Date.now();
  const cutoffIso = new Date(nowMs - 14 * DAY_MS).toISOString();
  void IST_OFFSET_MS;

  const { data: auditedRaw } = await supabase
    .from("bill_payments")
    .select(
      "id, bill_id, status, final_audit_status, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, final_audit_at, final_audit_by, final_audit_flag_reason, final_audit_flag_note, bills(id, token, vendor_bill_no, bill_vendor_id, bill_vendors(id, name))",
    )
    .eq("status", "paid")
    .eq("is_advance_application", false)
    .in("final_audit_status", ["verified", "flagged"])
    .not("final_audit_at", "is", null)
    .gte("final_audit_at", cutoffIso)
    .order("final_audit_at", { ascending: false })
    .limit(200);

  type RawPending = {
    id: string;
    bill_id: string;
    status: string;
    final_audit_status: string;
    paid_amount: number | null;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_by: string | null;
    paid_at: string | null;
    confirmed_by: string | null;
    confirmed_at: string | null;
    bills:
      | {
          id: string;
          token: string;
          vendor_bill_no: string;
          bill_date: string;
          bill_vendor_id: string;
          bill_vendors:
            | {
                id: string;
                name: string;
                bank_name: string | null;
                bank_account: string | null;
                ifsc: string | null;
                hdfc_bene_name: string | null;
              }
            | {
                id: string;
                name: string;
                bank_name: string | null;
                bank_account: string | null;
                ifsc: string | null;
                hdfc_bene_name: string | null;
              }[]
            | null;
        }
      | null;
  };

  type RawAudited = {
    id: string;
    bill_id: string;
    status: string;
    final_audit_status: string;
    paid_amount: number | null;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_by: string | null;
    paid_at: string | null;
    final_audit_at: string | null;
    final_audit_by: string | null;
    final_audit_flag_reason: string | null;
    final_audit_flag_note: string | null;
    bills:
      | {
          id: string;
          token: string;
          vendor_bill_no: string;
          bill_vendor_id: string;
          bill_vendors:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }
      | null;
  };

  const pendingRows: FinalAuditRow[] = ((pendingRaw ?? []) as unknown as RawPending[]).map((r) => {
    const b = r.bills;
    const v = b
      ? Array.isArray(b.bill_vendors)
        ? b.bill_vendors[0] ?? null
        : b.bill_vendors
      : null;
    return {
      id: r.id,
      billId: r.bill_id,
      billToken: b?.token ?? "—",
      vendorBillNo: b?.vendor_bill_no ?? "—",
      vendorName: v?.name ?? "—",
      vendorBankName: v?.bank_name ?? null,
      vendorBankAccount: v?.bank_account ?? null,
      vendorIfsc: v?.ifsc ?? null,
      vendorHdfcBeneName: v?.hdfc_bene_name ?? null,
      paidAmount: Number(r.paid_amount ?? 0),
      paymentMethod: r.payment_method,
      paymentReference: r.payment_reference,
      paymentNote: r.payment_note,
      paidByName: r.paid_by ? profilesMap[r.paid_by] ?? "Unknown" : null,
      paidAt: r.paid_at,
      auditStatus: "pending",
      auditedAt: null,
      auditedByName: null,
      flagReason: null,
      flagNote: null,
    };
  });

  const auditedRows: FinalAuditRow[] = ((auditedRaw ?? []) as unknown as RawAudited[]).map((r) => {
    const b = r.bills;
    const v = b
      ? Array.isArray(b.bill_vendors)
        ? b.bill_vendors[0] ?? null
        : b.bill_vendors
      : null;
    return {
      id: r.id,
      billId: r.bill_id,
      billToken: b?.token ?? "—",
      vendorBillNo: b?.vendor_bill_no ?? "—",
      vendorName: v?.name ?? "—",
      vendorBankName: null,
      vendorBankAccount: null,
      vendorIfsc: null,
      vendorHdfcBeneName: null,
      paidAmount: Number(r.paid_amount ?? 0),
      paymentMethod: r.payment_method,
      paymentReference: r.payment_reference,
      paymentNote: r.payment_note,
      paidByName: r.paid_by ? profilesMap[r.paid_by] ?? "Unknown" : null,
      paidAt: r.paid_at,
      auditStatus: r.final_audit_status as "verified" | "flagged",
      auditedAt: r.final_audit_at,
      auditedByName: r.final_audit_by ? profilesMap[r.final_audit_by] ?? "Unknown" : null,
      flagReason: r.final_audit_flag_reason,
      flagNote: r.final_audit_flag_note,
    };
  });

  const flaggedCount = auditedRows.filter((r) => r.auditStatus === "flagged").length;
  const verifiedTodayCount = auditedRows.filter((r) => {
    if (r.auditStatus !== "verified" || !r.auditedAt) return false;
    return new Date(r.auditedAt).getTime() > nowMs - DAY_MS;
  }).length;
  const pendingTotal = pendingRows.reduce((s, r) => s + r.paidAmount, 0);

  return (
    <section className="page-card">
      <AccountsHero
        title="Final Audit"
        description="Cross-check each paid payment's UTR / reference against the bank statement. Verify when it matches; flag for the owner's attention when it doesn't. This is a recheck — money has already moved."
        actions={
          <Link href="/accounts/pay-today" style={BUTTON_STYLES.secondary}>
            ← Pay Today
          </Link>
        }
      />

      {/* Quick stats */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <StatChip
          label="Awaiting verification"
          value={`${pendingRows.length}`}
          subline={
            pendingRows.length > 0
              ? `₹${pendingTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
              : "All clear"
          }
          tint="#b45309"
        />
        <StatChip
          label="Verified (24h)"
          value={`${verifiedTodayCount}`}
          subline="last day"
          tint="#15803d"
        />
        <StatChip
          label="Flagged (14d)"
          value={`${flaggedCount}`}
          subline={flaggedCount > 0 ? "owner attention" : "none open"}
          tint={flaggedCount > 0 ? "#b91c1c" : "var(--muted)"}
        />
      </div>

      <FinalAuditClient
        pendingRows={pendingRows}
        auditedRows={auditedRows}
        verifyAction={verifyFinalAuditAction}
        flagAction={flagFinalAuditAction}
      />

      {pendingRows.length === 0 && auditedRows.length === 0 && (
        <EmptyState
          icon="🧾"
          title="No payments to audit"
          description="The Final Audit queue is empty. Paid payments land here as they're recorded; come back when the accountant has marked some paid."
        />
      )}
    </section>
  );
}

function StatChip({
  label,
  value,
  subline,
  tint,
}: {
  label: string;
  value: string;
  subline: string;
  tint: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 180px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 14px",
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${tint}`,
        borderRadius: 8,
        boxShadow: ACCOUNTS_TOKENS.shadow,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 800, color: tint, fontFamily: "ui-monospace, monospace" }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{subline}</span>
    </div>
  );
}

// Silence eslint-no-unused for components imported but used in client subtree.
void TABLE_STYLES;
void Money;
void VendorIdentity;
