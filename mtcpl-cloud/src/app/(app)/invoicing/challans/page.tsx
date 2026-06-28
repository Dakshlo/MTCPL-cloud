/**
 * Mig 058 — Challans list.
 *
 * Filter row (party / status / from-date / to-date) + table.
 * Filter params come from the URL so links can pre-filter.
 */

import { Fragment } from "react";
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
import { challanStatus } from "@/lib/challan-status";
import { challanCode } from "@/lib/doc-code";
import { ChallanStatusPill } from "../_ui/challan-status-pill";
import { syncDispatchChallansAction, returnDispatchToWaitingAction } from "../actions";
import { ReturnToDispatchButton } from "../_ui/return-to-dispatch-button";

type StatusFilter = "open" | "pending_approval" | "rejected" | "invoiced" | "converted" | "cancelled" | "all";

type SearchParams = Promise<{
  status?: StatusFilter;
  from?: string;
  to?: string;
  toast?: string;
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
      "id, challan_number, doc_fy, doc_seq, challan_date, invoice_party_id, temple, notes, source_dispatch_id, cancelled_at, converted_invoice_id, priced_at, owner_approved_at, owner_rejected_at, owner_reject_reason, invoice_parties(name)",
    )
    .order("challan_date", { ascending: false })
    .limit(500);

  if (sp.from) q = q.gte("challan_date", sp.from);
  if (sp.to) q = q.lte("challan_date", sp.to);

  // Mig 167 — status filter maps to the canonical challanStatus() states.
  // "Open" EXCLUDES priced challans (priced → pending/rejected/invoiced).
  const status: StatusFilter = sp.status ?? "all";
  if (status === "open") {
    q = q.is("cancelled_at", null).is("converted_invoice_id", null).is("priced_at", null);
  } else if (status === "pending_approval") {
    q = q
      .is("cancelled_at", null).is("converted_invoice_id", null)
      .not("priced_at", "is", null).is("owner_approved_at", null).is("owner_rejected_at", null);
  } else if (status === "rejected") {
    q = q
      .is("cancelled_at", null).is("converted_invoice_id", null)
      .not("priced_at", "is", null).not("owner_rejected_at", "is", null);
  } else if (status === "invoiced") {
    q = q
      .is("cancelled_at", null).is("converted_invoice_id", null)
      .not("priced_at", "is", null).not("owner_approved_at", "is", null);
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
    doc_fy: string | null;
    doc_seq: number | null;
    challan_date: string;
    invoice_party_id: string | null;
    temple: string | null;
    notes: string | null;
    source_dispatch_id: string | null;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    priced_at: string | null;
    owner_approved_at: string | null;
    owner_rejected_at: string | null;
    owner_reject_reason: string | null;
    invoice_parties: { name: string } | { name: string }[] | null;
  }>;

  type ChallanRow = (typeof challans)[number];
  const clientNameOf = (c: ChallanRow): string => {
    const legacy = c.invoice_parties
      ? Array.isArray(c.invoice_parties) ? c.invoice_parties[0]?.name ?? null : c.invoice_parties.name
      : null;
    return c.temple ?? legacy ?? "—";
  };
  // Temple-wise grouping (Daksh) — one section per client/temple, alphabetical.
  const grouped = (() => {
    const m = new Map<string, ChallanRow[]>();
    for (const c of challans) { const k = clientNameOf(c); const a = m.get(k) ?? []; a.push(c); m.set(k, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  return (
    <section className="page-card">
      <AccountsHero
        title="Challans"
        description="One per dispatch (client = temple). Review & price each to print a tax invoice."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Mig 158 — pull in any approved/on-road dispatch that doesn't yet
                have a challan (e.g. a truck verified before this flow). */}
            <form action={syncDispatchChallansAction}>
              <button type="submit" style={BUTTON_STYLES.primary}>🔄 Sync from dispatch</button>
            </form>
            {/* Mig 167 — journey reads Challans → Approval → Invoices. */}
            <Link href="/invoicing/approval" style={BUTTON_STYLES.secondary}>
              🟡 Approval
            </Link>
            <Link href="/invoicing/invoices" style={BUTTON_STYLES.secondary}>
              🧾 Invoices
            </Link>
            <Link href="/invoicing" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", alignSelf: "center" }}>
              ← Dashboard
            </Link>
          </div>
        }
      />

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {sp.toast}
        </div>
      )}

      {/* Filter form — GET-based, same pattern as accounts/page.tsx */}
      <form
        method="get"
        action="/invoicing/challans"
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) auto auto",
          alignItems: "end",
          columnGap: 10,
          marginBottom: 14,
        }}
      >
        <FilterField label="Status">
          <select name="status" defaultValue={status} style={INPUT_STYLE}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="pending_approval">Under owner review</option>
            <option value="rejected">Rejected</option>
            <option value="invoiced">Invoiced</option>
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
                <th style={TABLE_STYLES.th}>Status</th>
                <th style={TABLE_STYLES.th}>Notes</th>
                <th style={TABLE_STYLES.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([temple, rows]) => (
                <Fragment key={temple}>
                  <tr>
                    <td colSpan={5} style={{ padding: "8px 12px", background: ACCOUNTS_TOKENS.surfaceMuted, fontWeight: 800, fontSize: 12.5, color: "var(--text)", borderTop: "2px solid var(--border)" }}>
                      🛕 {temple} <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {rows.length}</span>
                    </td>
                  </tr>
                  {rows.map((c, idx) => {
                    const st = challanStatus(c);
                    return (
                    <tr key={c.id} style={{ background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted }}>
                      <td style={{ ...TABLE_STYLES.td, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                        <Link href={`/invoicing/challans/${c.id}`} style={{ color: ACCOUNTS_TOKENS.accent, textDecoration: "none" }}>
                          {challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number}
                        </Link>
                      </td>
                      <td style={TABLE_STYLES.td}>{c.challan_date}</td>
                      <td style={TABLE_STYLES.td}>
                        <ChallanStatusPill challan={c} />
                      </td>
                      <td style={{ ...TABLE_STYLES.td, color: "var(--muted)", fontSize: 12 }}>
                        {st === "rejected" && c.owner_reject_reason
                          ? <span style={{ color: "#991b1b" }}>Rejected: {c.owner_reject_reason}</span>
                          : c.notes && !c.notes.startsWith("Auto from dispatch") ? c.notes : "—"}
                      </td>
                      <td style={TABLE_STYLES.td}>
                        {st === "rejected" ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <Link href={`/invoicing/challans/${c.id}/review`} style={{ ...BUTTON_STYLES.secondary, fontSize: 12 }}>
                              ✏️ Re-price
                            </Link>
                            <ReturnToDispatchButton challanId={c.id} action={returnDispatchToWaitingAction} />
                          </span>
                        ) : st === "pending_approval" ? (
                          <Link href="/invoicing/approval" style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textDecoration: "none" }}>
                            Awaiting approval →
                          </Link>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </Fragment>
              ))}
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
