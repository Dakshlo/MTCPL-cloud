/**
 * /accounts/advances/[id] — single-advance detail.
 *
 * Sections (top-down):
 *   • Vendor + ₹ + status pill (hero)
 *   • Pipeline timeline (proposed → confirmed → paid)
 *   • Applications panel: which bills consumed how much; remaining
 *     credit; Unapply button per row (owner only).
 *   • Action footer: Cancel (owner, pre-paid only).
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canManageAccounts,
  canRecordAdvance,
  canUnapplyAdvance,
} from "@/lib/accounts-permissions";
import {
  canConfirmPayments,
  canMarkPaid,
} from "@/lib/accounts-permissions";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  BUTTON_STYLES,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../../_ui/components";
import { AdvanceStatusPill } from "../page";
import {
  CancelAdvanceButton,
  ConfirmAdvanceButton,
  MarkAdvancePaidButton,
  UnapplyButton,
} from "./action-buttons";

type Params = Promise<{ id: string }>;
type Search = Promise<{ toast?: string; error?: string }>;

export default async function AdvanceDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile)) redirect("/accounts");
  const { id } = await params;
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { data: row } = await supabase
    .from("vendor_advances")
    .select(
      "id, token, vendor_id, amount, description, note, status, proposed_by, proposed_at, confirmed_by, confirmed_at, paid_by, paid_at, payment_method, payment_reference, hdfc_csv_downloaded_at, bank_rejected_by, bank_rejected_at, bank_rejection_reason, cancelled_by, cancelled_at, cancel_reason, bill_vendors(id, name, gstin, phone)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) notFound();
  type Adv = {
    id: string;
    token: string;
    vendor_id: string;
    amount: number | string;
    description: string;
    note: string | null;
    status: string;
    proposed_by: string;
    proposed_at: string;
    confirmed_by: string | null;
    confirmed_at: string | null;
    paid_by: string | null;
    paid_at: string | null;
    payment_method: string | null;
    payment_reference: string | null;
    hdfc_csv_downloaded_at: string | null;
    bank_rejected_by: string | null;
    bank_rejected_at: string | null;
    bank_rejection_reason: string | null;
    cancelled_by: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    bill_vendors:
      | { id: string; name: string; gstin: string | null; phone: string | null }
      | { id: string; name: string; gstin: string | null; phone: string | null }[]
      | null;
  };
  const adv = row as Adv;
  const v = Array.isArray(adv.bill_vendors) ? adv.bill_vendors[0] ?? null : adv.bill_vendors;

  // Applications — which bills have consumed this advance.
  const { data: appRows } = await supabase
    .from("vendor_advance_applications")
    .select(
      "id, bill_id, amount_applied, applied_at, applied_by, note, unapplied_at, unapplied_by, unapply_reason, bills(id, token, vendor_bill_no, amount_total, amount_outstanding)",
    )
    .eq("vendor_advance_id", id)
    .order("applied_at", { ascending: false });
  type App = {
    id: string;
    bill_id: string;
    amount_applied: number | string;
    applied_at: string;
    applied_by: string;
    note: string | null;
    unapplied_at: string | null;
    unapplied_by: string | null;
    unapply_reason: string | null;
    bills:
      | { id: string; token: string; vendor_bill_no: string; amount_total: number; amount_outstanding: number }
      | { id: string; token: string; vendor_bill_no: string; amount_total: number; amount_outstanding: number }[]
      | null;
  };
  const applications = (appRows ?? []) as App[];
  const activeApplications = applications.filter((a) => !a.unapplied_at);
  const totalApplied = activeApplications.reduce(
    (s, a) => s + Number(a.amount_applied),
    0,
  );
  const remaining = Math.max(0, Number(adv.amount) - totalApplied);
  const isPaid = adv.status === "paid" && !adv.cancelled_at;
  const isCancelled = !!adv.cancelled_at || adv.status === "cancelled";

  const canCancel =
    canRecordAdvance(profile) && !isPaid && !isCancelled;
  const canUnapply = canUnapplyAdvance(profile);

  return (
    <section className="page-card" style={{ maxWidth: 980 }}>
      <AccountsHero
        title={`📥 ${adv.token}`}
        description={adv.description}
        actions={
          <Link href="/accounts/advances" style={BUTTON_STYLES.secondary}>
            ← All advances
          </Link>
        }
      />

      {sp.toast && (
        <Alert tone="success">✓ {sp.toast}</Alert>
      )}
      {sp.error && (
        <Alert tone="danger">{sp.error}</Alert>
      )}

      {/* Hero card */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <HeroTile label="Vendor">
          <VendorIdentity name={v?.name ?? "—"} subLabel={v?.gstin ?? ""} size={32} />
          {v && (
            <Link
              href={`/accounts/vendors/${v.id}`}
              style={{ fontSize: 11, color: ACCOUNTS_TOKENS.accent, textDecoration: "underline" }}
            >
              Open vendor profile →
            </Link>
          )}
        </HeroTile>
        <HeroTile label="Amount">
          <Money value={Number(adv.amount)} size="large" />
        </HeroTile>
        <HeroTile label="Status">
          <AdvanceStatusPill status={adv.status} />
          {adv.payment_reference && (
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
              {adv.payment_method ?? "—"} · {" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>{adv.payment_reference}</code>
            </div>
          )}
        </HeroTile>
        {isPaid && (
          <HeroTile label="Open credit balance">
            <Money
              value={remaining}
              tone={remaining > 0 ? "warning" : "success"}
              size="large"
            />
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
              of ₹{Number(adv.amount).toLocaleString("en-IN")} paid · ₹
              {totalApplied.toLocaleString("en-IN")} applied
            </div>
          </HeroTile>
        )}
      </div>

      {/* Pipeline timeline */}
      <Section title="Pipeline">
        <TimelineRow
          label="Recorded"
          ts={adv.proposed_at}
          who={profilesMap[adv.proposed_by] ?? "—"}
          status="done"
        />
        <TimelineRow
          label="Confirmed by owner"
          ts={adv.confirmed_at}
          who={adv.confirmed_by ? profilesMap[adv.confirmed_by] ?? "—" : null}
          status={adv.confirmed_at ? "done" : isCancelled ? "skipped" : "pending"}
        />
        <TimelineRow
          label="Paid"
          ts={adv.paid_at}
          who={adv.paid_by ? profilesMap[adv.paid_by] ?? "—" : null}
          status={adv.paid_at ? "done" : isCancelled ? "skipped" : "pending"}
          extra={
            adv.payment_method
              ? `${adv.payment_method} · ${adv.payment_reference ?? "—"}`
              : null
          }
        />
        {adv.bank_rejected_at && (
          <TimelineRow
            label="Bank rejected"
            ts={adv.bank_rejected_at}
            who={adv.bank_rejected_by ? profilesMap[adv.bank_rejected_by] ?? "—" : null}
            status="error"
            extra={adv.bank_rejection_reason ?? null}
          />
        )}
        {adv.cancelled_at && (
          <TimelineRow
            label="Cancelled"
            ts={adv.cancelled_at}
            who={adv.cancelled_by ? profilesMap[adv.cancelled_by] ?? "—" : null}
            status="error"
            extra={adv.cancel_reason ?? null}
          />
        )}
      </Section>

      {/* Applications */}
      <Section title={`Applied to bills · ${activeApplications.length}`}>
        {activeApplications.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {isPaid
              ? "Not yet applied to any bill. The ₹" +
                remaining.toLocaleString("en-IN") +
                " sits as vendor credit until you apply it from the bill entry form or bill detail page."
              : "Application happens after the advance is paid."}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={TABLE_STYLES.th}>Bill</th>
                <th style={TABLE_STYLES.thRight}>Bill total</th>
                <th style={TABLE_STYLES.thRight}>Applied</th>
                <th style={TABLE_STYLES.thRight}>Bill outstanding</th>
                <th style={TABLE_STYLES.th}>Applied at / by</th>
                {canUnapply && <th style={TABLE_STYLES.th}></th>}
              </tr>
            </thead>
            <tbody>
              {activeApplications.map((a) => {
                const b = Array.isArray(a.bills) ? a.bills[0] ?? null : a.bills;
                return (
                  <tr key={a.id}>
                    <td style={TABLE_STYLES.td}>
                      {b ? (
                        <Link
                          href={`/accounts/bills/${a.bill_id}`}
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: ACCOUNTS_TOKENS.accent }}>
                            {b.token}
                          </code>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            {b.vendor_bill_no}
                          </div>
                        </Link>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      {b && <Money value={Number(b.amount_total)} tone="muted" />}
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <Money value={Number(a.amount_applied)} />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      {b && (
                        <Money
                          value={Number(b.amount_outstanding)}
                          tone={Number(b.amount_outstanding) > 0 ? "warning" : "success"}
                        />
                      )}
                    </td>
                    <td style={{ ...TABLE_STYLES.td, fontSize: 11, color: "var(--muted)" }}>
                      {new Date(a.applied_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <br />
                      by {profilesMap[a.applied_by] ?? "—"}
                    </td>
                    {canUnapply && (
                      <td style={TABLE_STYLES.td}>
                        <UnapplyButton
                          applicationId={a.id}
                          billId={a.bill_id}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {applications.length > activeApplications.length && (
                <tr>
                  <td colSpan={canUnapply ? 6 : 5} style={{ ...TABLE_STYLES.td, fontSize: 11, color: "var(--muted)" }}>
                    + {applications.length - activeApplications.length} previously-unapplied
                    application{applications.length - activeApplications.length !== 1 ? "s" : ""} (history kept for audit)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Section>

      {/* Action footer — Confirm / Mark Paid / Cancel based on
          pipeline stage. Owner confirms (proposed → confirmed),
          accountant marks paid (confirmed → paid). Cancel only
          while pre-paid. */}
      <div
        style={{
          marginTop: 18,
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {adv.status === "proposed" && canConfirmPayments(profile) && (
          <ConfirmAdvanceButton advanceId={adv.id} token={adv.token} />
        )}
        {(adv.status === "confirmed" || adv.status === "bank_rejected") &&
          canMarkPaid(profile) && (
            <MarkAdvancePaidButton advanceId={adv.id} token={adv.token} />
          )}
        {canCancel && <CancelAdvanceButton advanceId={adv.id} token={adv.token} />}
      </div>

      {/* Notes / metadata */}
      {adv.note && (
        <Section title="Note">
          <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{adv.note}</p>
        </Section>
      )}
    </section>
  );
}

function HeroTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--surface)",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginBottom: 18,
        padding: 14,
        background: "var(--surface)",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 12,
      }}
    >
      <h2
        style={{
          margin: "0 0 10px",
          fontSize: 12,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function TimelineRow({
  label,
  ts,
  who,
  status,
  extra,
}: {
  label: string;
  ts: string | null;
  who: string | null;
  status: "done" | "pending" | "skipped" | "error";
  extra?: string | null;
}) {
  const colour =
    status === "done"
      ? ACCOUNTS_TOKENS.success
      : status === "error"
        ? ACCOUNTS_TOKENS.danger
        : status === "skipped"
          ? ACCOUNTS_TOKENS.neutral
          : ACCOUNTS_TOKENS.warning;
  const icon = status === "done" ? "✓" : status === "error" ? "⚠" : status === "skipped" ? "—" : "○";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "6px 0",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 22,
          height: 22,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          background: colour + "22",
          color: colour,
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
          {ts
            ? new Date(ts).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}
          {who && ` · by ${who}`}
        </div>
        {extra && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>
            {extra}
          </div>
        )}
      </div>
    </div>
  );
}

function Alert({ tone, children }: { tone: "success" | "danger"; children: React.ReactNode }) {
  const palette =
    tone === "success"
      ? { bg: ACCOUNTS_TOKENS.successLight, fg: ACCOUNTS_TOKENS.success, border: ACCOUNTS_TOKENS.success }
      : { bg: ACCOUNTS_TOKENS.dangerLight, fg: ACCOUNTS_TOKENS.danger, border: ACCOUNTS_TOKENS.danger };
  return (
    <div
      role="alert"
      style={{
        marginBottom: 12,
        padding: "10px 14px",
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
