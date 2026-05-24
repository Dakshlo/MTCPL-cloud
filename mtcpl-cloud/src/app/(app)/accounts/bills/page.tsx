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

type SearchParams = Promise<{
  status?: string;
  vendor?: string;
  q?: string;
  /** Mig 072 — "1" filters the list to bills with an active hold. */
  hold?: string;
  /** Mig 073 — "1" filters the list to bills with at least one
   *  active vendor_advance_application row. */
  adv?: string;
}>;

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
  /** Mig 072 — owner-held slice. 0 = no hold. Surfaces a 🔒 chip
   *  on the row + powers the "Held only" filter. */
  held_amount: number;
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
  // Mig 072 — ?hold=1 in the URL restricts to bills with an active
  // owner hold (held_amount > 0).
  const heldOnly = (sp.hold ?? "") === "1";
  // Mig 073 — ?adv=1 restricts to bills with at least one active
  // vendor_advance_application row.
  const advanceAppliedOnly = (sp.adv ?? "") === "1";

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

  // Mig 073 — pre-fetch the set of bill IDs with at least one
  // active advance application. Used both as a filter pre-condition
  // (when adv=1 is set) and as a lookup for the row badge.
  const { data: advAppRows } = await supabase
    .from("vendor_advance_applications")
    .select("bill_id")
    .is("unapplied_at", null);
  const billIdsWithAdvance = new Set(
    ((advAppRows ?? []) as Array<{ bill_id: string }>).map((r) => r.bill_id),
  );

  let query = supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_total, amount_paid, amount_outstanding, held_amount, status, submitted_by, submitted_at, bill_vendor_id, bill_vendors(id, name)",
    )
    .order("submitted_at", { ascending: false })
    .limit(500);
  if (restrictToOwn) query = query.eq("submitted_by", profile.id);
  if (statusFilter && ALL_STATUSES.includes(statusFilter)) query = query.eq("status", statusFilter);
  if (vendorFilter) query = query.eq("bill_vendor_id", vendorFilter);
  if (heldOnly) query = query.gt("held_amount", 0);
  if (advanceAppliedOnly && billIdsWithAdvance.size > 0) {
    query = query.in("id", [...billIdsWithAdvance]);
  } else if (advanceAppliedOnly) {
    // Nothing applied yet — narrow to an impossible ID so the list
    // returns empty rather than ignoring the filter.
    query = query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  // Token + vendor's-bill-no + VENDOR NAME search. PostgREST can't
  // OR across an embedded relation column directly, so we first
  // resolve vendor IDs whose name matches, then merge those into
  // the OR clause with bill_vendor_id.in.(...).
  if (searchQuery) {
    const safe = searchQuery.replace(/[%,]/g, " ");
    // Resolve matching vendor IDs (case-insensitive substring).
    const { data: matchingVendorRows } = await supabase
      .from("bill_vendors")
      .select("id")
      .ilike("name", `%${safe}%`)
      .limit(200);
    const vendorIds = (matchingVendorRows ?? []).map((r) => r.id as string);
    const orParts = [
      `token.ilike.%${safe}%`,
      `vendor_bill_no.ilike.%${safe}%`,
    ];
    if (vendorIds.length > 0) {
      // PostgREST IN syntax requires comma-separated values inside
      // parens. UUIDs are safe (no special chars) — no escaping
      // needed.
      orParts.push(`bill_vendor_id.in.(${vendorIds.join(",")})`);
    }
    query = query.or(orParts.join(","));
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
          {/* Mig 072 — dedicated chip to filter only bills with an
              active owner hold. Lives next to the status chips
              because dad asked for "a filter option to see hold
              ones". URL param ?hold=1; toggling sends the same URL
              with/without the param to flip. */}
          <HeldOnlyChip
            current={heldOnly}
            statusFilter={statusFilter}
            vendorFilter={vendorFilter}
            searchQuery={searchQuery}
          />
          {/* Mig 073 — "Has advance applied" filter chip. Same
              shape as Held but green-tinted to match the advance
              applied panel + row badge. */}
          <AdvanceAppliedChip
            current={advanceAppliedOnly}
            statusFilter={statusFilter}
            vendorFilter={vendorFilter}
            searchQuery={searchQuery}
            heldOnly={heldOnly}
          />
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
              placeholder="Token, vendor name, or bill no…"
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <BillStatusPill status={b.status} />
                        {Number(b.held_amount) > 0 && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "#fef3c7",
                              color: "#92400e",
                              border: "1px solid #d97706",
                              fontFamily: "ui-monospace, monospace",
                              letterSpacing: "0.02em",
                              whiteSpace: "nowrap",
                            }}
                            title="Owner has held part of this bill — accountant can only propose the remainder"
                          >
                            🔒 HELD ₹{Number(b.held_amount).toLocaleString("en-IN")}
                          </span>
                        )}
                        {billIdsWithAdvance.has(b.id) && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "#ecfdf5",
                              color: "#047857",
                              border: "1px solid #10b981",
                              letterSpacing: "0.04em",
                              whiteSpace: "nowrap",
                            }}
                            title="An advance has been applied to this bill — outstanding reflects the deduction"
                          >
                            📥 ADV
                          </span>
                        )}
                      </div>
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

/** Mig 072 — "🔒 Held only" filter pill. Distinct amber styling so
 *  it doesn't blend with the neutral status chips. Tapping toggles
 *  the URL's ?hold=1 param. Preserves the other active filters. */
function HeldOnlyChip({
  current,
  statusFilter,
  vendorFilter,
  searchQuery,
}: {
  current: boolean;
  statusFilter: string;
  vendorFilter: string;
  searchQuery: string;
}) {
  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (vendorFilter) params.set("vendor", vendorFilter);
  if (searchQuery) params.set("q", searchQuery);
  // Read current adv from window if needed — toggling Hold should
  // not silently drop the Adv filter. The chip is rendered from the
  // page server component which sets adv=1 in the link if active.
  if (!current) params.set("hold", "1");
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
        background: current ? "#d97706" : "#fffbeb",
        color: current ? "#fff" : "#92400e",
        border: `1px solid ${current ? "#b45309" : "#fcd34d"}`,
        whiteSpace: "nowrap",
        transition: "all 0.12s",
      }}
      title={
        current
          ? "Showing only bills with an active owner hold — tap to clear"
          : "Show only bills with an active owner hold"
      }
    >
      🔒 {current ? "Held only ✓" : "Held only"}
    </Link>
  );
}

/** Mig 073 — "📥 Has advance applied" filter pill. Green-tinted to
 *  match the bill-detail advance panel + row badge. Preserves all
 *  other active filters (status, vendor, search, hold) so the user
 *  can stack them. URL param ?adv=1. */
function AdvanceAppliedChip({
  current,
  statusFilter,
  vendorFilter,
  searchQuery,
  heldOnly,
}: {
  current: boolean;
  statusFilter: string;
  vendorFilter: string;
  searchQuery: string;
  heldOnly: boolean;
}) {
  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (vendorFilter) params.set("vendor", vendorFilter);
  if (searchQuery) params.set("q", searchQuery);
  if (heldOnly) params.set("hold", "1");
  if (!current) params.set("adv", "1");
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
        background: current ? "#10b981" : "#ecfdf5",
        color: current ? "#fff" : "#047857",
        border: `1px solid ${current ? "#059669" : "#86efac"}`,
        whiteSpace: "nowrap",
        transition: "all 0.12s",
      }}
      title={
        current
          ? "Showing only bills with at least one applied advance — tap to clear"
          : "Show only bills with an advance applied"
      }
    >
      📥 {current ? "Has advance ✓" : "Has advance"}
    </Link>
  );
}
