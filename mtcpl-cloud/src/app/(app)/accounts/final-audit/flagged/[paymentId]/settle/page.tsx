/**
 * Mig 085 — "Settle with debit" page.
 *
 * The auditor lands here from a flagged OVERPAYMENT on the Flagged
 * Payments list. We show that vendor's OPEN bills; the auditor picks
 * one + types the debit amount. On submit a PENDING debit settlement
 * is created — nothing moves until the owner approves it (in the
 * Approvals panel). No money ever leaves the bank here.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canSettleWithDebit } from "@/lib/accounts-permissions";
import {
  AccountsHero,
  BUTTON_STYLES,
  ACCOUNTS_TOKENS,
  Money,
  VendorAvatar,
} from "../../../../_ui/components";
import { createDebitSettlementFormAction } from "../../../../actions";

export default async function SettleWithDebitPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { profile } = await requireAuth();
  if (!canSettleWithDebit(profile)) redirect("/accounts");

  const { paymentId } = await params;
  const sp = await searchParams;
  const errorMsg = sp.error ?? null;

  const supabase = createAdminSupabaseClient();

  // The flagged payment + its overpaid bill.
  const { data: pay } = await supabase
    .from("bill_payments")
    .select(
      "id, bill_id, status, final_audit_status, paid_amount, final_audit_flag_reason, final_audit_flag_note, debit_settled_at",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (!pay) redirect("/accounts/final-audit/flagged?toast=Flagged+payment+not+found");
  const p = pay as {
    id: string;
    bill_id: string;
    final_audit_status: string;
    paid_amount: number | string;
    final_audit_flag_reason: string | null;
    final_audit_flag_note: string | null;
    debit_settled_at: string | null;
  };
  if (p.final_audit_status !== "flagged") {
    redirect("/accounts/final-audit/flagged?toast=Only+flagged+payments+can+be+settled");
  }
  if (p.debit_settled_at) {
    redirect("/accounts/final-audit/flagged?toast=Already+settled");
  }
  // Mig 085 follow-on (Daksh, June 2026) — block drafting a SECOND
  // debit while one is already awaiting approval. The list hides the
  // Settle button for pending rows, but someone could still reach this
  // page via the back button or a stale link. The DB partial-unique
  // index is the hard stop; this is the friendly one.
  const { data: activeSettle } = await supabase
    .from("bill_debit_settlements")
    .select("id")
    .eq("source_payment_id", paymentId)
    .in("status", ["pending_approval", "approved"])
    .limit(1);
  if (activeSettle && activeSettle.length > 0) {
    redirect(
      "/accounts/final-audit/flagged?toast=A+debit+is+already+in+approval+for+this+bill",
    );
  }

  const { data: srcBill } = await supabase
    .from("bills")
    .select("id, token, vendor_bill_no, bill_vendor_id")
    .eq("id", p.bill_id)
    .maybeSingle();
  if (!srcBill) redirect("/accounts/final-audit/flagged?toast=Bill+not+found");
  const sb = srcBill as {
    id: string;
    token: string;
    vendor_bill_no: string | null;
    bill_vendor_id: string;
  };

  const [{ data: vendorRow }, { data: openBillsRaw }] = await Promise.all([
    supabase
      .from("bill_vendors")
      .select("id, name")
      .eq("id", sb.bill_vendor_id)
      .maybeSingle(),
    // Open bills of the SAME vendor — approved + still owing + not
    // cancelled — minus the overpaid bill itself.
    supabase
      .from("bills")
      .select("id, token, vendor_bill_no, bill_date, amount_outstanding, status, cancelled_at")
      .eq("bill_vendor_id", sb.bill_vendor_id)
      .eq("status", "approved")
      .gt("amount_outstanding", 0)
      .is("cancelled_at", null)
      .neq("id", sb.id)
      .order("bill_date", { ascending: true })
      .limit(200),
  ]);

  const vendorName = (vendorRow as { name: string } | null)?.name ?? "—";
  const openBills = ((openBillsRaw ?? []) as Array<{
    id: string;
    token: string;
    vendor_bill_no: string | null;
    bill_date: string | null;
    amount_outstanding: number | string;
  }>).map((b) => ({
    id: b.id,
    token: b.token,
    vendorBillNo: b.vendor_bill_no,
    billDate: b.bill_date,
    outstanding: Number(b.amount_outstanding ?? 0),
  }));

  const flaggedPaid = Number(p.paid_amount ?? 0);

  return (
    <section className="page-card">
      <AccountsHero
        title="Settle with debit"
        description="Apply the over-paid amount as a debit against another open bill of this vendor. It reduces that bill's outstanding once the owner approves. No money moves — the cash already left the bank."
        actions={
          <Link href="/accounts/final-audit/flagged" style={BUTTON_STYLES.secondary}>
            ← Back to Flagged
          </Link>
        }
      />

      {errorMsg && (
        <div
          style={{
            margin: "0 0 14px",
            padding: "12px 14px",
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 10,
            color: "#b91c1c",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* The flagged overpayment, for context. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderLeft: "4px solid #b91c1c",
          borderRadius: 10,
          marginBottom: 16,
          boxShadow: ACCOUNTS_TOKENS.shadow,
          flexWrap: "wrap",
        }}
      >
        <VendorAvatar name={vendorName} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{vendorName}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Flagged bill{" "}
            <Link
              href={`/accounts/bills/${sb.id}`}
              style={{ color: ACCOUNTS_TOKENS.accent, fontWeight: 700 }}
            >
              {sb.token}
            </Link>
            {p.final_audit_flag_reason ? ` · ${p.final_audit_flag_reason}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Paid amount
          </div>
          <Money value={flaggedPaid} tone="success" precise />
        </div>
      </div>

      {openBills.length === 0 ? (
        <div
          style={{
            padding: "28px 18px",
            background: "#fff",
            border: `1px dashed ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 10,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          This vendor has no other open bills to apply a debit against.
        </div>
      ) : (
        <form action={createDebitSettlementFormAction}>
          <input type="hidden" name="source_payment_id" value={paymentId} />

          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 2px 8px",
            }}
          >
            1 · Pick the bill to debit
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {openBills.map((b, i) => (
              <label
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  background: "#fff",
                  border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="target_bill_id"
                  value={b.id}
                  required
                  defaultChecked={i === 0}
                  style={{ width: 18, height: 18, accentColor: ACCOUNTS_TOKENS.accent }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        color: ACCOUNTS_TOKENS.accent,
                      }}
                    >
                      {b.token}
                    </span>
                    {b.vendorBillNo ? (
                      <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                        {" "}
                        · {b.vendorBillNo}
                      </span>
                    ) : null}
                  </div>
                  {b.billDate && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                      {new Date(b.billDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Outstanding
                  </div>
                  <Money value={b.outstanding} />
                </div>
              </label>
            ))}
          </div>

          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "18px 2px 8px",
            }}
          >
            2 · Debit amount
          </div>
          <input
            type="number"
            name="amount"
            step="0.01"
            min="0.01"
            required
            placeholder="e.g. 20000"
            style={{
              width: "100%",
              maxWidth: 280,
              padding: "10px 12px",
              fontSize: 16,
              fontFamily: "ui-monospace, monospace",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 8,
            }}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Can&apos;t be more than the chosen bill&apos;s outstanding.
          </div>

          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "18px 2px 8px",
            }}
          >
            Note (optional)
          </div>
          <textarea
            name="note"
            rows={2}
            placeholder="Why this debit (e.g. excess on bill YR/21)"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 13,
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 8,
              resize: "vertical",
            }}
          />

          <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
            <button type="submit" style={BUTTON_STYLES.primary}>
              ⇄ Send for owner approval
            </button>
            <Link href="/accounts/final-audit/flagged" style={BUTTON_STYLES.secondary}>
              Cancel
            </Link>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
            Nothing changes until the owner approves. You&apos;ll see it move to
            &quot;Settled&quot; once they do.
          </div>
        </form>
      )}
    </section>
  );
}
