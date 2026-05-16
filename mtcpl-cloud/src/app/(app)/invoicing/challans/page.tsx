/**
 * Mig 058 — Challans list.
 *
 * Filter row (party / status / from-date / to-date) + table.
 * Filter params come from the URL so links can pre-filter.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  BUTTON_STYLES,
  EmptyState,
  INPUT_STYLE,
  SectionHeader,
  TABLE_STYLES,
  VendorIdentity,
} from "../../accounts/_ui/components";
import { ChallanStatusPill } from "../_ui/challan-status-pill";

type SearchParams = Promise<{
  party?: string;
  status?: "open" | "converted" | "cancelled" | "all";
  from?: string;
  to?: string;
}>;

export default async function ChallansListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();

  // Build the query progressively from the filters.
  let q = supabase
    .from("challans")
    .select(
      "id, challan_number, challan_date, invoice_party_id, notes, cancelled_at, converted_invoice_id, invoice_parties(name)",
    )
    .order("challan_date", { ascending: false })
    .limit(500);

  if (sp.party) q = q.eq("invoice_party_id", sp.party);
  if (sp.from) q = q.gte("challan_date", sp.from);
  if (sp.to) q = q.lte("challan_date", sp.to);

  const status = sp.status ?? "all";
  if (status === "open") {
    q = q.is("cancelled_at", null).is("converted_invoice_id", null);
  } else if (status === "converted") {
    q = q.is("cancelled_at", null).not("converted_invoice_id", "is", null);
  } else if (status === "cancelled") {
    q = q.not("cancelled_at", "is", null);
  }

  const { data: challansRaw, error } = await q;
  if (error) throw new Error(error.message);

  const challans = (challansRaw ?? []) as Array<{
    id: string;
    challan_number: string;
    challan_date: string;
    invoice_party_id: string;
    notes: string | null;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    invoice_parties: { name: string } | { name: string }[] | null;
  }>;

  // Also fetch party list for the filter dropdown.
  const { data: partiesRaw } = await supabase
    .from("invoice_parties")
    .select("id, name")
    .order("name");
  const parties = (partiesRaw ?? []) as Array<{ id: string; name: string }>;

  return (
    <section className="page-card">
      <AccountsHero
        title="Challans"
        description="Delivery notes — items + qty, no money. Convert to invoice when ready."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/invoicing/challans/new" style={BUTTON_STYLES.primary}>
              📋 + New challan
            </Link>
            <Link href="/invoicing" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", alignSelf: "center" }}>
              ← Dashboard
            </Link>
          </div>
        }
      />

      {/* Filter form — GET-based, same pattern as accounts/page.tsx */}
      <form
        method="get"
        action="/invoicing/challans"
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) auto auto",
          alignItems: "end",
          columnGap: 10,
          marginBottom: 14,
        }}
      >
        <FilterField label="Party">
          <select name="party" defaultValue={sp.party ?? ""} style={INPUT_STYLE}>
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select name="status" defaultValue={status} style={INPUT_STYLE}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="converted">Converted</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </FilterField>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={sp.from ?? ""} style={INPUT_STYLE} />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={sp.to ?? ""} style={INPUT_STYLE} />
        </FilterField>
        <button type="submit" style={BUTTON_STYLES.secondary}>
          Apply filters
        </button>
        <Link href="/invoicing/challans" style={{ ...BUTTON_STYLES.ghost, alignSelf: "center" }}>
          Reset
        </Link>
      </form>

      <SectionHeader title="Challans" count={challans.length} />

      {challans.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No challans match"
          description="Try clearing the filters, or create a new challan."
          action={
            <Link href="/invoicing/challans/new" style={BUTTON_STYLES.primary}>
              + New challan
            </Link>
          }
        />
      ) : (
        <div style={{ ...TABLE_STYLES.tableWrap }}>
          <table style={TABLE_STYLES.table}>
            <thead style={TABLE_STYLES.thead}>
              <tr>
                <th style={TABLE_STYLES.th}>Challan #</th>
                <th style={TABLE_STYLES.th}>Date</th>
                <th style={TABLE_STYLES.th}>Party</th>
                <th style={TABLE_STYLES.th}>Status</th>
                <th style={TABLE_STYLES.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {challans.map((c, idx) => {
                const partyName = c.invoice_parties
                  ? Array.isArray(c.invoice_parties)
                    ? c.invoice_parties[0]?.name ?? "—"
                    : c.invoice_parties.name
                  : "—";
                const s: "open" | "converted" | "cancelled" = c.cancelled_at
                  ? "cancelled"
                  : c.converted_invoice_id
                  ? "converted"
                  : "open";
                return (
                  <tr key={c.id} style={{ background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted }}>
                    <td style={{ ...TABLE_STYLES.td, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                      <Link href={`/invoicing/challans/${c.id}`} style={{ color: ACCOUNTS_TOKENS.accent, textDecoration: "none" }}>
                        {c.challan_number}
                      </Link>
                    </td>
                    <td style={TABLE_STYLES.td}>{c.challan_date}</td>
                    <td style={TABLE_STYLES.td}>
                      <VendorIdentity name={partyName} size={28} href={`/invoicing/parties/${c.invoice_party_id}`} />
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <ChallanStatusPill status={s} />
                    </td>
                    <td style={{ ...TABLE_STYLES.td, color: "var(--muted)", fontSize: 12 }}>
                      {c.notes ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
