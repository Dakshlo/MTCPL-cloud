import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageBillVendors } from "@/lib/accounts-permissions";
import { upsertBillVendorAction, archiveBillVendorFormAction } from "../actions";
import { VendorForm } from "./vendor-form";
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  EmptyState,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../_ui/components";

export default async function BillVendorsPage() {
  const { profile } = await requireAuth();
  if (!canManageBillVendors(profile)) {
    redirect("/accounts");
  }
  const supabase = createAdminSupabaseClient();
  const { data: vendorsRaw } = await supabase
    .from("bill_vendors")
    .select("id, name, category, gstin, phone, email, is_active, created_at")
    .order("is_active", { ascending: false })
    .order("name");
  const vendors = (vendorsRaw ?? []) as Array<{
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    is_active: boolean;
    created_at: string;
  }>;

  const { data: outstandingRaw } = await supabase
    .from("bills")
    .select("bill_vendor_id, amount_outstanding")
    .eq("status", "approved")
    .gt("amount_outstanding", 0);
  const outstandingByVendor = new Map<string, number>();
  for (const r of outstandingRaw ?? []) {
    const id = r.bill_vendor_id as string;
    const amt = Number(r.amount_outstanding ?? 0);
    outstandingByVendor.set(id, (outstandingByVendor.get(id) ?? 0) + amt);
  }

  const activeCount = vendors.filter((v) => v.is_active).length;
  const archivedCount = vendors.length - activeCount;
  const totalOutstandingAcrossVendors = [...outstandingByVendor.values()].reduce((s, n) => s + n, 0);

  return (
    <section className="page-card">
      <AccountsHero
        title="Vendors Profile (Bill)"
        description="The beneficiary master. Distinct from carving vendors. Bank details + GST info live here so the entry form stays light."
        badge={
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--muted)",
              padding: "3px 10px",
              background: ACCOUNTS_TOKENS.surfaceMuted,
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 999,
            }}
          >
            {activeCount} active · {archivedCount} archived
          </span>
        }
        actions={<VendorForm action={upsertBillVendorAction} mode="create" />}
      />

      {vendors.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No bill vendors yet"
          description="Add your suppliers (cement / steel / scaffolding / tools / etc) here so they show up in the bill-entry form."
          action={<VendorForm action={upsertBillVendorAction} mode="create" />}
        />
      ) : (
        <div style={TABLE_STYLES.tableWrap}>
          <div style={{ overflowX: "auto" }}>
            <table style={TABLE_STYLES.table}>
              <thead style={TABLE_STYLES.thead}>
                <tr>
                  <th style={TABLE_STYLES.th}>Vendor</th>
                  <th style={TABLE_STYLES.th}>Category</th>
                  <th style={TABLE_STYLES.th}>GSTIN</th>
                  <th style={TABLE_STYLES.th}>Contact</th>
                  <th style={TABLE_STYLES.thRight}>Outstanding</th>
                  <th style={TABLE_STYLES.th}>Status</th>
                  <th style={TABLE_STYLES.th}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v, idx) => {
                  const outstanding = outstandingByVendor.get(v.id) ?? 0;
                  return (
                    <tr
                      key={v.id}
                      style={{
                        background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted,
                        opacity: v.is_active ? 1 : 0.6,
                      }}
                    >
                      <td style={TABLE_STYLES.td}>
                        <VendorIdentity
                          name={v.name}
                          subLabel={v.email ?? undefined}
                          size={36}
                          href={`/accounts/vendors/${v.id}`}
                        />
                      </td>
                      <td style={TABLE_STYLES.td}>
                        {v.category ? (
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
                            {v.category}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={TABLE_STYLES.td}>
                        {v.gstin ? (
                          <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                            {v.gstin}
                          </code>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                        {v.phone ?? "—"}
                      </td>
                      <td style={TABLE_STYLES.tdRight}>
                        {outstanding > 0 ? (
                          <Money value={outstanding} tone="warning" />
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 10px",
                            borderRadius: 999,
                            background: v.is_active ? ACCOUNTS_TOKENS.successLight : ACCOUNTS_TOKENS.surfaceMuted,
                            color: v.is_active ? ACCOUNTS_TOKENS.success : "var(--muted)",
                          }}
                        >
                          {v.is_active ? "● Active" : "○ Archived"}
                        </span>
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Link
                            href={`/accounts/vendors/${v.id}`}
                            style={{ ...BUTTON_STYLES.secondary, padding: "5px 12px", fontSize: 11 }}
                          >
                            View
                          </Link>
                          <form action={archiveBillVendorFormAction}>
                            <input type="hidden" name="id" value={v.id} />
                            <input type="hidden" name="reactivate" value={v.is_active ? "" : "1"} />
                            <button
                              type="submit"
                              style={{ ...BUTTON_STYLES.ghost, padding: "5px 10px" }}
                            >
                              {v.is_active ? "Archive" : "Reactivate"}
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalOutstandingAcrossVendors > 0 && (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 12,
            color: "var(--muted)",
            textAlign: "right",
          }}
        >
          Total outstanding across all vendors:{" "}
          <Money value={totalOutstandingAcrossVendors} size="small" tone="warning" />
        </p>
      )}
    </section>
  );
}
