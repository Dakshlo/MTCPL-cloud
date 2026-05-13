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
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  EmptyState,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../_ui/components";

export default async function PayTodayPage() {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile) && !canConfirmPayments(profile)) {
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

  // IST today window
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
  const proposedTotal = proposedRows.reduce((s, r) => s + r.proposedAmount, 0);
  const confirmedTotal = confirmedRows.reduce((s, r) => s + r.proposedAmount, 0);

  return (
    <section className="page-card">
      <AccountsHero
        title="Pay Today"
        description="Proposed payments → owner confirmation → accountant marks paid. Partial payments are supported — adjust the actual amount per row."
        actions={
          <Link href="/accounts" style={BUTTON_STYLES.secondary}>
            ← Due Bills
          </Link>
        }
      />

      {/* Flow summary strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <FlowStat
          label="Proposed by accountant"
          count={proposedRows.length}
          value={proposedTotal}
          tone={ACCOUNTS_TOKENS.accent}
          icon="📥"
        />
        <FlowArrow />
        <FlowStat
          label="Confirmed by owner"
          count={confirmedRows.length}
          value={confirmedTotal}
          tone={ACCOUNTS_TOKENS.warning}
          icon="✅"
        />
        <FlowArrow />
        <FlowStat
          label="Paid today"
          count={paidToday.length}
          value={paidTodayTotal}
          tone={ACCOUNTS_TOKENS.success}
          icon="💸"
        />
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

      {/* Paid today section */}
      <div style={{ marginTop: 26 }}>
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
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>
            💰 Paid today
          </h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{paidToday.length}</strong> payment{paidToday.length === 1 ? "" : "s"} ·{" "}
            <Money value={paidTodayTotal} size="small" tone="success" />
          </span>
        </div>
        {paidToday.length === 0 ? (
          <EmptyState
            icon="💸"
            title="No payments recorded today yet"
            description="Mark payments paid from the Confirmed section once you've actually moved the money. They show here for the rest of the day."
          />
        ) : (
          <div style={TABLE_STYLES.tableWrap}>
            <div style={{ overflowX: "auto" }}>
              <table style={TABLE_STYLES.table}>
                <thead style={TABLE_STYLES.thead}>
                  <tr>
                    <th style={TABLE_STYLES.th}>Vendor / token</th>
                    <th style={TABLE_STYLES.thRight}>Paid</th>
                    <th style={TABLE_STYLES.th}>Method · Ref</th>
                    <th style={TABLE_STYLES.th}>Note</th>
                    <th style={TABLE_STYLES.th}>By</th>
                    <th style={TABLE_STYLES.th}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {paidToday.map((p, idx) => (
                    <tr
                      key={p.id}
                      style={{ background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted }}
                    >
                      <td style={TABLE_STYLES.td}>
                        <Link
                          href={`/accounts/bills/${p.billId}`}
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <VendorIdentity name={p.vendorName} subLabel={p.billToken} />
                        </Link>
                      </td>
                      <td style={TABLE_STYLES.tdRight}>
                        <Money value={p.paidAmount} tone="success" />
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 12 }}>
                        {p.paymentMethod ? (
                          <>
                            <strong style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              {p.paymentMethod}
                            </strong>
                            {p.paymentReference && <span style={{ color: "var(--muted)" }}> · {p.paymentReference}</span>}
                          </>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, maxWidth: 240, fontSize: 12, color: "var(--muted)" }}>
                        {p.paymentNote ?? "—"}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                        {p.paidByName ?? "—"}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                        {p.paidAt
                          ? new Date(p.paidAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
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

function FlowStat({
  label,
  count,
  value,
  tone,
  icon,
}: {
  label: string;
  count: number;
  value: number;
  tone: string;
  icon: string;
}) {
  const isEmpty = count === 0;
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--surface, #fff)",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${tone}`,
        borderRadius: 12,
        boxShadow: ACCOUNTS_TOKENS.shadow,
        opacity: isEmpty ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em", fontFamily: "ui-monospace, monospace" }}>
          {count}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          payment{count === 1 ? "" : "s"}
        </span>
      </div>
      <Money value={value} size="small" tone={isEmpty ? "muted" : "muted"} />
    </div>
  );
}

function FlowArrow() {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        color: ACCOUNTS_TOKENS.borderStrong,
      }}
    >
      →
    </div>
  );
}
