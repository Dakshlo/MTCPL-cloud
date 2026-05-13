// Pay Today screen (migration 028).
//
// Three sections:
//   1. Proposed — accountant has staged the payment. Owner sees
//      checkboxes + Confirm button at the bottom (per batch).
//      Accountant sees rows read-only with a "withdraw" link.
//   2. Confirmed — owner has ticked. Accountant marks each paid
//      (amount + method + reference + note). Owner sees read-only.
//   3. Paid today — today's `paid` rows. Running total at the bottom.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canConfirmPayments,
  canManageAccounts,
  canMarkPaid,
} from "@/lib/accounts-permissions";
import {
  cancelPaymentAction,
  confirmPaymentsAction,
  markPaymentPaidAction,
} from "../actions";
import { PayTodayClient, type PayTodayRow } from "./pay-today-client";

export default async function PayTodayPage() {
  const { profile } = await requireAuth();
  if (
    !canManageAccounts(profile) &&
    !canConfirmPayments(profile)
  ) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { data: openRowsRaw } = await supabase
    .from("bill_payments")
    .select(
      "id, bill_id, status, proposed_amount, proposed_by, proposed_at, confirmed_by, confirmed_at, proposal_batch_id, bills(id, token, vendor_bill_no, bill_date, amount_outstanding, amount_total, bill_vendor_id, bill_vendors(id, name))",
    )
    .in("status", ["proposed", "confirmed"])
    .order("proposed_at", { ascending: false });

  // Today's IST window for the "Paid today" section.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 86_400_000;
  const nowMs = Date.now();
  const todayIstMidnightMs = Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  const todayStartIso = new Date(todayIstMidnightMs).toISOString();
  const tomorrowStartIso = new Date(todayIstMidnightMs + DAY_MS).toISOString();

  const { data: paidRowsRaw } = await supabase
    .from("bill_payments")
    .select(
      "id, bill_id, status, proposed_amount, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, confirmed_by, confirmed_at, bills(id, token, bill_vendor_id, bill_vendors(id, name))",
    )
    .eq("status", "paid")
    .gte("paid_at", todayStartIso)
    .lt("paid_at", tomorrowStartIso)
    .order("paid_at", { ascending: false });

  type OpenRow = {
    id: string;
    bill_id: string;
    status: string;
    proposed_amount: number;
    proposed_by: string | null;
    proposed_at: string | null;
    confirmed_by: string | null;
    confirmed_at: string | null;
    proposal_batch_id: string | null;
    bills:
      | {
          id: string;
          token: string;
          vendor_bill_no: string;
          bill_date: string;
          amount_outstanding: number;
          amount_total: number;
          bill_vendor_id: string;
          bill_vendors:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }
      | null;
  };
  const open = ((openRowsRaw ?? []) as unknown) as OpenRow[];

  function rowFromOpen(r: OpenRow): PayTodayRow {
    const b = r.bills;
    const v = b ? (Array.isArray(b.bill_vendors) ? b.bill_vendors[0] ?? null : b.bill_vendors) : null;
    return {
      id: r.id,
      billId: r.bill_id,
      status: r.status as "proposed" | "confirmed",
      proposedAmount: Number(r.proposed_amount ?? 0),
      proposedByName: r.proposed_by ? profilesMap[r.proposed_by] ?? "Unknown" : null,
      proposedAt: r.proposed_at,
      confirmedByName: r.confirmed_by ? profilesMap[r.confirmed_by] ?? "Unknown" : null,
      confirmedAt: r.confirmed_at,
      batchId: r.proposal_batch_id,
      vendorName: v?.name ?? "—",
      billToken: b?.token ?? "—",
      vendorBillNo: b?.vendor_bill_no ?? "—",
      billDate: b?.bill_date ?? null,
      billOutstanding: b ? Number(b.amount_outstanding ?? 0) : 0,
      billTotal: b ? Number(b.amount_total ?? 0) : 0,
    };
  }

  const proposedRows = open.filter((r) => r.status === "proposed").map(rowFromOpen);
  const confirmedRows = open.filter((r) => r.status === "confirmed").map(rowFromOpen);

  type PaidRow = {
    id: string;
    bill_id: string;
    status: string;
    proposed_amount: number;
    paid_amount: number | null;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_by: string | null;
    paid_at: string | null;
    bills:
      | {
          id: string;
          token: string;
          bill_vendor_id: string;
          bill_vendors:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }
      | null;
  };
  const paidRaw = ((paidRowsRaw ?? []) as unknown) as PaidRow[];
  const paidToday = paidRaw.map((r) => {
    const b = r.bills;
    const v = b ? (Array.isArray(b.bill_vendors) ? b.bill_vendors[0] ?? null : b.bill_vendors) : null;
    return {
      id: r.id,
      billId: r.bill_id,
      billToken: b?.token ?? "—",
      vendorName: v?.name ?? "—",
      paidAmount: Number(r.paid_amount ?? 0),
      paymentMethod: r.payment_method,
      paymentReference: r.payment_reference,
      paymentNote: r.payment_note,
      paidByName: r.paid_by ? profilesMap[r.paid_by] ?? "Unknown" : null,
      paidAt: r.paid_at,
    };
  });

  const paidTodayTotal = paidToday.reduce((s, p) => s + p.paidAmount, 0);

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Pay Today</h1>
          <p className="muted">
            Proposed payments go through owner confirmation before the
            accountant marks them paid. Partial payments are supported —
            adjust the actual amount paid per row.
          </p>
        </div>
        <Link
          href="/accounts"
          style={{
            textDecoration: "none",
            fontSize: 13,
            padding: "6px 14px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            fontWeight: 500,
            whiteSpace: "nowrap",
            alignSelf: "flex-start",
          }}
        >
          ← Due Bills
        </Link>
      </div>

      <PayTodayClient
        proposedRows={proposedRows}
        confirmedRows={confirmedRows}
        canConfirm={canConfirmPayments(profile)}
        canMarkPaid={canMarkPaid(profile)}
        canCancel={canManageAccounts(profile) || canConfirmPayments(profile)}
        confirmAction={confirmPaymentsAction}
        markPaidAction={markPaymentPaidAction}
        cancelAction={cancelPaymentAction}
      />

      {/* Paid today */}
      <div style={{ marginTop: 26 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 10,
            paddingBottom: 6,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            💰 Paid today
          </h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {paidToday.length} payment{paidToday.length === 1 ? "" : "s"} ·{" "}
            <strong style={{ color: "#15803d", fontFamily: "ui-monospace, monospace" }}>
              ₹{paidTodayTotal.toLocaleString("en-IN")}
            </strong>
          </span>
        </div>
        {paidToday.length === 0 ? (
          <div
            className="muted"
            style={{
              fontSize: 12,
              padding: "10px 14px",
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: 6,
            }}
          >
            No payments marked paid today yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={thStyle}>Token</th>
                  <th style={thStyle}>Vendor</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Paid ₹</th>
                  <th style={thStyle}>Method · Ref</th>
                  <th style={thStyle}>Note</th>
                  <th style={thStyle}>By</th>
                  <th style={thStyle}>Time</th>
                </tr>
              </thead>
              <tbody>
                {paidToday.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={tdStyle}>
                      <Link
                        href={`/accounts/bills/${p.billId}`}
                        style={{
                          textDecoration: "none",
                          fontWeight: 700,
                          fontFamily: "ui-monospace, monospace",
                          color: "var(--text)",
                        }}
                      >
                        {p.billToken}
                      </Link>
                    </td>
                    <td style={tdStyle}>{p.vendorName}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                      <strong style={{ color: "#15803d" }}>
                        ₹{p.paidAmount.toLocaleString("en-IN")}
                      </strong>
                    </td>
                    <td style={tdStyle}>
                      {p.paymentMethod ? (
                        <>
                          <strong>{p.paymentMethod.toUpperCase()}</strong>
                          {p.paymentReference ? ` · ${p.paymentReference}` : ""}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 220 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        {p.paymentNote ?? "—"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {p.paidByName ?? "—"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {p.paidAt
                          ? new Date(p.paidAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
