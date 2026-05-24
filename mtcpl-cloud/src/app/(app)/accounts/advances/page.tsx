/**
 * /accounts/advances — list of every vendor advance, filterable by
 * vendor + status.
 *
 * Powers the answer to "what advances are sitting open right now"
 * and "show me everything we've paid Daksh Enterprise in advance".
 *
 * Visible to anyone who can manage accounts (read access), plus
 * owner/dev. Recording new advances is gated to owner/dev via
 * canRecordAdvance on the action.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canManageAccounts,
  canRecordAdvance,
} from "@/lib/accounts-permissions";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  BUTTON_STYLES,
  EmptyState,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../_ui/components";

type Search = Promise<{
  status?: string;
  vendor?: string;
  toast?: string;
}>;

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  paid: "Paid",
  bank_rejected: "Bank rejected",
  cancelled: "Cancelled",
};
const ALL_STATUSES = [
  "proposed",
  "confirmed",
  "paid",
  "bank_rejected",
  "cancelled",
];

export default async function AdvancesListPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile)) redirect("/accounts");

  const sp = await searchParams;
  const statusFilter = sp.status ?? "";
  const vendorFilter = sp.vendor ?? "";

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // Vendors for the filter dropdown.
  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select("id, name")
    .order("name");
  const vendors = ((vendorRows ?? []) as Array<{ id: string; name: string }>);

  // Build the query.
  let q = supabase
    .from("vendor_advances")
    .select(
      "id, token, vendor_id, amount, description, note, status, proposed_at, paid_at, payment_method, payment_reference, cancelled_at, bill_vendors(id, name)",
    )
    .order("proposed_at", { ascending: false })
    .limit(500);
  if (statusFilter && ALL_STATUSES.includes(statusFilter)) {
    q = q.eq("status", statusFilter);
  }
  if (vendorFilter) q = q.eq("vendor_id", vendorFilter);

  const { data: rawRows, error } = await q;
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    token: string;
    vendor_id: string;
    amount: number | string;
    description: string;
    note: string | null;
    status: string;
    proposed_at: string;
    paid_at: string | null;
    payment_method: string | null;
    payment_reference: string | null;
    cancelled_at: string | null;
    bill_vendors: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const rows = (rawRows ?? []) as Row[];

  // Pull applied totals for paid advances so we can show
  // "₹X applied of ₹Y" on each row.
  const paidIds = rows.filter((r) => r.status === "paid").map((r) => r.id);
  const appliedByAdvance = new Map<string, number>();
  if (paidIds.length > 0) {
    const { data: appliedRows } = await supabase
      .from("vendor_advance_applications")
      .select("vendor_advance_id, amount_applied")
      .in("vendor_advance_id", paidIds)
      .is("unapplied_at", null);
    for (const a of (appliedRows ?? []) as Array<{
      vendor_advance_id: string;
      amount_applied: number;
    }>) {
      appliedByAdvance.set(
        a.vendor_advance_id,
        (appliedByAdvance.get(a.vendor_advance_id) ?? 0) + Number(a.amount_applied ?? 0),
      );
    }
  }

  // Quick totals for the strip.
  const totalPaid = rows
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + Number(r.amount), 0);
  const totalOpenBalance = rows
    .filter((r) => r.status === "paid")
    .reduce(
      (s, r) =>
        s + Math.max(0, Number(r.amount) - (appliedByAdvance.get(r.id) ?? 0)),
      0,
    );

  return (
    <section className="page-card">
      <AccountsHero
        title="📥 Vendor Advances"
        description="Money paid to vendors before the bill arrives. Open advances sit as vendor credit until applied to a real bill."
        actions={
          canRecordAdvance(profile) ? (
            <Link href="/accounts/advances/new" style={BUTTON_STYLES.primary}>
              + Record advance
            </Link>
          ) : null
        }
      />

      {sp.toast && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: ACCOUNTS_TOKENS.successLight,
            color: ACCOUNTS_TOKENS.success,
            border: `1px solid ${ACCOUNTS_TOKENS.success}`,
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          ✓ {sp.toast}
        </div>
      )}

      {/* Filter strip */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          padding: "12px 14px",
          marginBottom: 16,
          background: "var(--surface)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusChip current={statusFilter} value="" vendorFilter={vendorFilter} label={`All (${rows.length})`} />
          {ALL_STATUSES.map((s) => (
            <StatusChip
              key={s}
              current={statusFilter}
              value={s}
              vendorFilter={vendorFilter}
              label={`${STATUS_LABELS[s]} · ${rows.filter((r) => r.status === s).length}`}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <form method="GET" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Vendor
            </span>
            <select
              name="vendor"
              defaultValue={vendorFilter}
              style={{
                padding: "6px 10px",
                fontSize: 13,
                background: "#fff",
                border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
                borderRadius: 8,
                color: "var(--text)",
              }}
            >
              <option value="">All</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button type="submit" style={BUTTON_STYLES.secondary}>Apply</button>
            {(statusFilter || vendorFilter) && (
              <Link href="/accounts/advances" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}>
                Clear
              </Link>
            )}
          </form>
        </div>
      </div>

      {/* Totals strip */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Stat label="Total paid out (filter)" value={totalPaid} accent={ACCOUNTS_TOKENS.success} />
        <Stat label="Open credit balance (filter)" value={totalOpenBalance} accent={ACCOUNTS_TOKENS.warning} />
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <EmptyState
          icon="📥"
          title="No advances match the current filters"
          description="Record one when a vendor demands money before the bill arrives."
          action={
            canRecordAdvance(profile) ? (
              <Link href="/accounts/advances/new" style={BUTTON_STYLES.primary}>
                + Record advance
              </Link>
            ) : null
          }
        />
      ) : (
        <div
          style={{
            background: "var(--surface)",
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={TABLE_STYLES.th}>Token</th>
                <th style={TABLE_STYLES.th}>Vendor / reason</th>
                <th style={TABLE_STYLES.thRight}>Amount</th>
                <th style={TABLE_STYLES.thRight}>Applied</th>
                <th style={TABLE_STYLES.thRight}>Open</th>
                <th style={TABLE_STYLES.th}>Status</th>
                <th style={TABLE_STYLES.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = Array.isArray(r.bill_vendors) ? r.bill_vendors[0] ?? null : r.bill_vendors;
                const amount = Number(r.amount);
                const applied = appliedByAdvance.get(r.id) ?? 0;
                const open = Math.max(0, amount - applied);
                return (
                  <tr key={r.id}>
                    <td style={TABLE_STYLES.td}>
                      <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: ACCOUNTS_TOKENS.warning }}>
                        {r.token}
                      </code>
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <VendorIdentity name={v?.name ?? "—"} subLabel={r.description.slice(0, 80)} size={28} />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <Money value={amount} />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      {r.status === "paid" && applied > 0 ? (
                        <Money value={applied} tone="muted" />
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      {r.status === "paid" ? (
                        open > 0 ? (
                          <Money value={open} tone="warning" />
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: ACCOUNTS_TOKENS.success,
                            }}
                          >
                            ✓ fully used
                          </span>
                        )
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <AdvanceStatusPill status={r.status} />
                      {r.status === "paid" && r.paid_at && (
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                          {new Date(r.paid_at).toLocaleDateString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                          {r.payment_reference && (
                            <span title={`Method: ${r.payment_method ?? "—"}`}>
                              {" · "}
                              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                                {r.payment_reference}
                              </code>
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <Link
                        href={`/accounts/advances/${r.id}`}
                        style={{ ...BUTTON_STYLES.secondary, padding: "5px 12px", fontSize: 11 }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 14, fontSize: 10, color: "var(--muted)" }}>
        Owner records advances and confirms on Pay Today; accountant marks them
        paid after the bank transfer; then applies the credit to bills.
        {profilesMap ? "" : ""}
      </p>
    </section>
  );
}

function StatusChip({
  current,
  value,
  vendorFilter,
  label,
}: {
  current: string;
  value: string;
  vendorFilter: string;
  label: string;
}) {
  const isActive = current === value;
  const params = new URLSearchParams();
  if (value) params.set("status", value);
  if (vendorFilter) params.set("vendor", vendorFilter);
  const href = `/accounts/advances${params.toString() ? `?${params.toString()}` : ""}`;
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 700,
        padding: "5px 12px",
        borderRadius: 999,
        background: isActive ? ACCOUNTS_TOKENS.accent : "#fff",
        color: isActive ? "#fff" : "var(--muted)",
        border: `1px solid ${isActive ? ACCOUNTS_TOKENS.accent : ACCOUNTS_TOKENS.borderStrong}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div
      style={{
        flex: "1 1 200px",
        padding: "12px 14px",
        background: "var(--surface)",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </div>
      <div style={{ marginTop: 4 }}>
        <Money value={value} size="large" />
      </div>
    </div>
  );
}

export function AdvanceStatusPill({ status }: { status: string }) {
  const tone =
    status === "paid"
      ? { fg: ACCOUNTS_TOKENS.success, bg: ACCOUNTS_TOKENS.successLight }
      : status === "confirmed"
        ? { fg: ACCOUNTS_TOKENS.accent, bg: ACCOUNTS_TOKENS.accentLight }
        : status === "proposed"
          ? { fg: ACCOUNTS_TOKENS.warning, bg: ACCOUNTS_TOKENS.warningLight }
          : status === "bank_rejected"
            ? { fg: ACCOUNTS_TOKENS.danger, bg: ACCOUNTS_TOKENS.dangerLight }
            : { fg: ACCOUNTS_TOKENS.neutral, bg: ACCOUNTS_TOKENS.surfaceMuted };
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 800,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {(STATUS_LABELS[status] ?? status).toUpperCase()}
    </span>
  );
}
