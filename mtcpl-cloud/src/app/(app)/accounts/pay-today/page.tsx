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
  SECTION_COLORS,
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
      "id, bill_id, status, proposed_amount, proposed_by, proposed_at, confirmed_by, confirmed_at, proposal_batch_id, bills(id, token, vendor_bill_no, bill_date, amount_outstanding, amount_total, bill_vendor_id, bill_vendors(id, name, payment_terms_days))",
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
            | { id: string; name: string; payment_terms_days: number | null }
            | { id: string; name: string; payment_terms_days: number | null }[]
            | null;
        }
      | null;
  };
  const open = ((openRowsRaw ?? []) as unknown) as OpenRow[];

  // Mig 040 — per-vendor payment terms. Fallback to legacy 45.
  const DEFAULT_PAYMENT_TERMS_DAYS = 45;
  function daysSince(dateStr: string | null): number | null {
    if (!dateStr) return null;
    return Math.floor((nowMs - new Date(dateStr).getTime()) / DAY_MS);
  }

  function rowFromOpen(r: OpenRow): PayTodayRow {
    const b = r.bills;
    const v = b ? (Array.isArray(b.bill_vendors) ? b.bill_vendors[0] ?? null : b.bill_vendors) : null;
    const d = daysSince(b?.bill_date ?? null);
    const terms =
      v?.payment_terms_days != null
        ? Number(v.payment_terms_days)
        : DEFAULT_PAYMENT_TERMS_DAYS;
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
      daysSinceBill: d,
      paymentTermsDays: terms,
      prematureForPayment: terms > 0 && d !== null && d < terms,
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

      {/* Mig 042 follow-on (Daksh): "that pay today section cards
          taking too much space, make them small." Replaced the 3-card
          grid + arrows with a single compact pill strip. Each pill
          is also a clickable anchor that jumps to its section so a
          long page doesn't require manual scrolling. Colour-coded
          dots match the section banners further down. */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          flexWrap: "wrap",
          background: "#fff",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 10,
          padding: 6,
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <FlowPill
          href="#section-proposed"
          label="Proposed"
          count={proposedRows.length}
          value={proposedTotal}
          dotColor={SECTION_COLORS.proposed}
        />
        <FlowPill
          href="#section-confirmed"
          label="Confirmed by owner"
          count={confirmedRows.length}
          value={confirmedTotal}
          dotColor={SECTION_COLORS.confirmed}
        />
        <FlowPill
          href="#section-paid-today"
          label="Paid today"
          count={paidToday.length}
          value={paidTodayTotal}
          dotColor={SECTION_COLORS.paidToday}
        />
      </div>

      <PayTodayClient
        proposedRows={proposedRows}
        confirmedRows={confirmedRows}
        canConfirm={canConfirmPayments(profile)}
        canMarkPaid={canMarkPaid(profile)}
        // Mig 042 follow-on (Daksh): "once due are proposed for today
        // no edit only one thing can happen — owner can send back to
        // due which is already there." Accountant no longer has
        // cancel/abort on a proposed or confirmed payment; only owner
        // (and developer) can send it back to the due-bills list.
        canCancel={canConfirmPayments(profile)}
        confirmAction={confirmPaymentsAction}
        markPaidAction={markPaymentPaidAction}
        cancelAction={cancelPaymentAction}
      />

      {/* Paid today section — Mig 042 follow-on: sticky color-banded
          banner so a fast scroll never leaves you guessing which
          section you're in. */}
      <div id="section-paid-today" style={{ marginTop: 26 }}>
        <SectionBanner
          label="Paid today"
          emoji="💰"
          count={paidToday.length}
          countSuffix="payment"
          subline={paidToday.length > 0 ? `Total ₹${paidTodayTotal.toLocaleString("en-IN")}` : "Nothing recorded yet"}
          tint={SECTION_COLORS.paidToday}
        />
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

/** Mig 042 follow-on — compact pill in the top KPI strip. Click
 *  scrolls to that section. */
function FlowPill({
  href,
  label,
  count,
  value,
  dotColor,
}: {
  href: string;
  label: string;
  count: number;
  value: number;
  dotColor: string;
}) {
  const isEmpty = count === 0;
  return (
    <Link
      href={href}
      style={{
        flex: "1 1 200px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: isEmpty ? "transparent" : `${dotColor}11`,
        border: `1px solid ${isEmpty ? ACCOUNTS_TOKENS.border : `${dotColor}55`}`,
        borderRadius: 8,
        textDecoration: "none",
        color: "var(--text)",
        opacity: isEmpty ? 0.7 : 1,
        transition: "transform 0.1s ease, box-shadow 0.1s ease",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
          boxShadow: isEmpty ? "none" : `0 0 0 3px ${dotColor}22`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
            letterSpacing: "-0.01em",
          }}
        >
          {count}
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--muted)",
              marginLeft: 4,
              letterSpacing: "0.04em",
            }}
          >
            · ₹{value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </span>
        </span>
      </div>
    </Link>
  );
}

/** Mig 042 follow-on — section banner that sticks to the top as
 *  the user scrolls through that section. Strong colour-coding so
 *  even a fast scroll telegraphs which section is active. */
function SectionBanner({
  label,
  emoji,
  count,
  countSuffix,
  subline,
  tint,
}: {
  label: string;
  emoji: string;
  count: number;
  countSuffix: string;
  subline: string;
  tint: string;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        marginBottom: 12,
        background: `linear-gradient(135deg, ${tint}EE 0%, ${tint}DD 100%)`,
        color: "#fff",
        borderRadius: 10,
        boxShadow: `0 2px 8px ${tint}44`,
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
        {emoji}
      </span>
      <h2
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </h2>
      <span
        style={{
          padding: "2px 10px",
          fontSize: 11,
          fontWeight: 800,
          fontFamily: "ui-monospace, monospace",
          background: "rgba(255,255,255,0.22)",
          borderRadius: 999,
        }}
      >
        {count} {countSuffix}
        {count === 1 ? "" : "s"}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: 11,
          fontWeight: 700,
          opacity: 0.92,
          fontFamily: "ui-monospace, monospace",
          letterSpacing: "0.02em",
        }}
      >
        {subline}
      </span>
    </div>
  );
}

