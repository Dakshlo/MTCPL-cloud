import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canApproveBills,
  canManageAccounts,
  canSubmitBills,
} from "@/lib/accounts-permissions";
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  BillStatusPill,
  BUTTON_STYLES,
  EmptyState,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../_ui/components";

type SearchParams = Promise<{ status?: string; vendor?: string; q?: string }>;

const ALL_STATUSES = ["pending_approval", "approved", "rejected", "fully_paid", "cancelled"];
const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending audit",
  approved: "Approved",
  rejected: "Rejected",
  fully_paid: "Paid in full",
  cancelled: "Cancelled",
};

type BillRow = {
  id: string;
  token: string;
  vendor_bill_no: string;
  bill_date: string;
  description: string;
  cost_head: string | null;
  amount_total: number;
  amount_paid: number;
  amount_outstanding: number;
  status: string;
  submitted_by: string | null;
  submitted_at: string | null;
  bill_vendor_id: string;
  bill_vendors: { id: string; name: string } | null;
};

export default async function BillsListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (
    !canSubmitBills(profile) &&
    !canManageAccounts(profile) &&
    !canApproveBills(profile)
  ) {
    return null;
  }

  const sp = await searchParams;
  const statusFilter = sp.status ?? "";
  const vendorFilter = sp.vendor ?? "";
  const searchQuery = (sp.q ?? "").trim();

  const restrictToOwn =
    profile.role === "biller" &&
    !canManageAccounts(profile) &&
    !canApproveBills(profile);

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select("id, name")
    .order("name");
  const vendors = (vendorRows ?? []) as Array<{ id: string; name: string }>;

  let query = supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_total, amount_paid, amount_outstanding, status, submitted_by, submitted_at, bill_vendor_id, bill_vendors(id, name)",
    )
    .order("submitted_at", { ascending: false })
    .limit(500);
  if (restrictToOwn) query = query.eq("submitted_by", profile.id);
  if (statusFilter && ALL_STATUSES.includes(statusFilter)) query = query.eq("status", statusFilter);
  if (vendorFilter) query = query.eq("bill_vendor_id", vendorFilter);
  // Token + vendor's-bill-no search. PostgREST `or` filter does an
  // OR across both columns with case-insensitive prefix match.
  if (searchQuery) {
    const safe = searchQuery.replace(/[%,]/g, " ");
    query = query.or(`token.ilike.%${safe}%,vendor_bill_no.ilike.%${safe}%`);
  }

  const { data: billsRaw, error } = await query;
  if (error) throw new Error(error.message);
  const bills = ((billsRaw ?? []) as unknown) as BillRow[];

  let countQuery = supabase.from("bills").select("status", { count: "exact", head: false });
  if (restrictToOwn) countQuery = countQuery.eq("submitted_by", profile.id);
  const { data: statusBuckets } = await countQuery;
  const counts: Record<string, number> = {};
  for (const r of statusBuckets ?? []) {
    const s = r.status as string;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <section className="page-card">
      <AccountsHero
        title="All bills"
        description={
          restrictToOwn
            ? "Your bill submissions. Click any row to see status + edit options."
            : "Every bill in the system, ordered by most-recent submission."
        }
        actions={
          canSubmitBills(profile) ? (
            <Link href="/accounts/bills/new" style={BUTTON_STYLES.primary}>
              + New bill
            </Link>
          ) : null
        }
      />

      {/* Filter strip */}
      <div
        style={{
          background: "var(--surface, #fff)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 16,
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          alignItems: "center",
          boxShadow: ACCOUNTS_TOKENS.shadow,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <StatusChip current={statusFilter} value="" vendorFilter={vendorFilter} searchQuery={searchQuery} label={`All (${allCount})`} />
          {ALL_STATUSES.map((s) => (
            <StatusChip
              key={s}
              current={statusFilter}
              value={s}
              vendorFilter={vendorFilter}
              searchQuery={searchQuery}
              label={`${STATUS_LABELS[s]} · ${counts[s] ?? 0}`}
            />
          ))}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <form method="GET" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              🔍 Search
            </span>
            <input
              type="search"
              name="q"
              defaultValue={searchQuery}
              placeholder="Token (T-2026-1) or bill no…"
              style={{
                padding: "6px 12px",
                fontSize: 13,
                background: "#fff",
                border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
                borderRadius: 8,
                color: "var(--text)",
                width: 220,
                fontFamily: "ui-monospace, monospace",
              }}
            />
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
            <button type="submit" style={BUTTON_STYLES.secondary}>
              Apply
            </button>
            {(statusFilter || vendorFilter || searchQuery) && (
              <Link href="/accounts/bills" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}>
                Clear all
              </Link>
            )}
          </form>
        </div>
      </div>

      {/* Bills table */}
      {bills.length === 0 ? (
        <EmptyState
          icon="📑"
          title="No bills match the current filters"
          description={canSubmitBills(profile) ? "Start by adding a bill, or adjust the status / vendor filters above." : "Try clearing the filters or check back later."}
          action={
            canSubmitBills(profile) ? (
              <Link href="/accounts/bills/new" style={BUTTON_STYLES.primary}>
                + New bill
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div style={TABLE_STYLES.tableWrap}>
          <div style={{ overflowX: "auto" }}>
            <table style={TABLE_STYLES.table}>
              <thead style={TABLE_STYLES.thead}>
                <tr>
                  <th style={TABLE_STYLES.th}>Vendor / token</th>
                  <th style={TABLE_STYLES.th}>Bill no</th>
                  <th style={TABLE_STYLES.th}>Date</th>
                  <th style={TABLE_STYLES.th}>Cost head</th>
                  <th style={TABLE_STYLES.thRight}>Total</th>
                  <th style={TABLE_STYLES.thRight}>Outstanding</th>
                  <th style={TABLE_STYLES.th}>Status</th>
                  <th style={TABLE_STYLES.th}>Submitted by</th>
                  <th style={TABLE_STYLES.th}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b, idx) => (
                  <tr
                    key={b.id}
                    style={{
                      background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted,
                      transition: "background 0.1s",
                    }}
                  >
                    <td style={TABLE_STYLES.td}>
                      <Link href={`/accounts/bills/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        <VendorIdentity
                          name={b.bill_vendors?.name ?? "—"}
                          subLabel={b.token}
                        />
                      </Link>
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {b.vendor_bill_no}
                      </code>
                    </td>
                    <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                      {new Date(b.bill_date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      {b.cost_head ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 10px",
                            borderRadius: 999,
                            background: ACCOUNTS_TOKENS.surfaceMuted,
                            color: ACCOUNTS_TOKENS.neutral,
                            fontWeight: 600,
                            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                          }}
                        >
                          {b.cost_head}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <Money value={Number(b.amount_total)} />
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
                    <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                      {b.submitted_by ? profilesMap[b.submitted_by] ?? "—" : "—"}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <Link
                        href={`/accounts/bills/${b.id}`}
                        style={{ ...BUTTON_STYLES.secondary, padding: "5px 12px", fontSize: 11 }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusChip({
  current,
  value,
  vendorFilter,
  searchQuery,
  label,
}: {
  current: string;
  value: string;
  vendorFilter: string;
  searchQuery: string;
  label: string;
}) {
  const isActive = current === value;
  const params = new URLSearchParams();
  if (value) params.set("status", value);
  if (vendorFilter) params.set("vendor", vendorFilter);
  if (searchQuery) params.set("q", searchQuery);
  const href = `/accounts/bills${params.toString() ? `?${params.toString()}` : ""}`;
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
        transition: "all 0.12s",
      }}
    >
      {label}
    </Link>
  );
}
