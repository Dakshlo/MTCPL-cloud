import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  canApproveBills,
  canManageAccounts,
  canSubmitBills,
} from "@/lib/accounts-permissions";

type SearchParams = Promise<{ status?: string; vendor?: string }>;

const STATUS_TINT: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  pending_approval: { label: "Pending approval", bg: "rgba(232,197,114,0.18)", color: "var(--gold-dark)" },
  approved: { label: "Approved", bg: "rgba(22,101,52,0.12)", color: "#15803d" },
  rejected: { label: "Rejected", bg: "rgba(220,38,38,0.10)", color: "#b91c1c" },
  fully_paid: { label: "Fully paid", bg: "rgba(15,118,110,0.12)", color: "#0f766e" },
  cancelled: { label: "Cancelled", bg: "rgba(0,0,0,0.06)", color: "var(--muted)" },
};

const ALL_STATUSES = ["pending_approval", "approved", "rejected", "fully_paid", "cancelled"];

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
  // Hidden away from anyone not in the accounts world
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

  // Visibility: biller sees only their own; everyone else sees all.
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

  const { data: billsRaw, error } = await query;
  if (error) throw new Error(error.message);
  const bills = ((billsRaw ?? []) as unknown) as BillRow[];

  // Quick counts per status (always over the visible scope)
  let countQuery = supabase.from("bills").select("status", { count: "exact", head: false });
  if (restrictToOwn) countQuery = countQuery.eq("submitted_by", profile.id);
  const { data: statusBuckets } = await countQuery;
  const counts: Record<string, number> = {};
  for (const r of statusBuckets ?? []) {
    const s = r.status as string;
    counts[s] = (counts[s] ?? 0) + 1;
  }

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>All bills</h1>
          <p className="muted">
            {restrictToOwn
              ? "Your bill submissions. Click into any row for status + edit options."
              : "Every bill in the system. Filter by status or vendor."}
          </p>
        </div>
        {canSubmitBills(profile) && (
          <Link
            href="/accounts/bills/new"
            className="primary-button"
            style={{ textDecoration: "none", padding: "8px 18px", fontSize: 13, fontWeight: 700 }}
          >
            + New bill
          </Link>
        )}
      </div>

      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 16,
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
            Status
          </span>
          <StatusChip current={statusFilter} value="" vendorFilter={vendorFilter} label={`All (${bills.length})`} />
          {ALL_STATUSES.map((s) => (
            <StatusChip
              key={s}
              current={statusFilter}
              value={s}
              vendorFilter={vendorFilter}
              label={`${STATUS_TINT[s].label} (${counts[s] ?? 0})`}
              tint={STATUS_TINT[s]}
            />
          ))}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
            Vendor
          </span>
          <form method="GET" style={{ display: "inline" }}>
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            <select
              name="vendor"
              defaultValue={vendorFilter}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
              }}
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                marginLeft: 4,
                padding: "5px 10px",
                fontSize: 12,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                color: "var(--text)",
              }}
            >
              Filter
            </button>
          </form>
        </div>
      </div>

      {/* Bills table */}
      <div style={{ marginTop: 18, overflowX: "auto" }}>
        {bills.length === 0 ? (
          <div className="banner">No bills match the current filters.</div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <Th>Token</Th>
                <Th>Vendor</Th>
                <Th>Bill date</Th>
                <Th>Vendor bill no</Th>
                <Th>Cost head</Th>
                <Th align="right">Total</Th>
                <Th align="right">Outstanding</Th>
                <Th>Status</Th>
                <Th>Submitted by</Th>
                <Th>&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const tint = STATUS_TINT[b.status] ?? STATUS_TINT.cancelled;
                return (
                  <tr key={b.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <Td>
                      <code style={{ fontWeight: 700 }}>{b.token}</code>
                    </Td>
                    <Td>{b.bill_vendors?.name ?? "—"}</Td>
                    <Td>
                      {new Date(b.bill_date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Td>
                    <Td>
                      <code style={{ fontSize: 12 }}>{b.vendor_bill_no}</code>
                    </Td>
                    <Td>
                      {b.cost_head ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: "rgba(184,115,51,0.10)",
                            color: "#b45309",
                            fontWeight: 600,
                          }}
                        >
                          {b.cost_head}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>—</span>
                      )}
                    </Td>
                    <Td align="right">
                      <strong style={{ fontFamily: "ui-monospace, monospace" }}>
                        ₹{Number(b.amount_total).toLocaleString("en-IN")}
                      </strong>
                    </Td>
                    <Td align="right">
                      <span
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          color: Number(b.amount_outstanding) > 0 ? "#b45309" : "var(--muted)",
                          fontWeight: 600,
                        }}
                      >
                        ₹{Number(b.amount_outstanding).toLocaleString("en-IN")}
                      </span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: 4,
                          background: tint.bg,
                          color: tint.color,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {tint.label}
                      </span>
                    </Td>
                    <Td>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {b.submitted_by ? profilesMap[b.submitted_by] ?? "—" : "—"}
                      </span>
                    </Td>
                    <Td>
                      <Link
                        href={`/accounts/bills/${b.id}`}
                        style={{
                          textDecoration: "none",
                          fontSize: 12,
                          padding: "4px 10px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--text)",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        View →
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "8px 10px",
        fontSize: 10,
        fontWeight: 700,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td style={{ padding: "10px 10px", textAlign: align ?? "left", verticalAlign: "middle" }}>{children}</td>
  );
}

function StatusChip({
  current,
  value,
  vendorFilter,
  label,
  tint,
}: {
  current: string;
  value: string;
  vendorFilter: string;
  label: string;
  tint?: { bg: string; color: string };
}) {
  const isActive = current === value;
  const params = new URLSearchParams();
  if (value) params.set("status", value);
  if (vendorFilter) params.set("vendor", vendorFilter);
  const href = `/accounts/bills${params.toString() ? `?${params.toString()}` : ""}`;
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        fontSize: 11,
        fontWeight: 700,
        padding: "4px 10px",
        borderRadius: 14,
        background: isActive ? tint?.bg ?? "var(--gold)" : "var(--bg)",
        color: isActive ? tint?.color ?? "#fff" : "var(--muted)",
        border: `1px solid ${isActive ? "currentColor" : "var(--border)"}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );
}

