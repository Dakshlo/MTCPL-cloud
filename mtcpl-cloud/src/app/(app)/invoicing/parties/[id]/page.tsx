/**
 * Mig 058 — Party detail.
 *
 * Profile card at top (name + GSTIN + address + phone + email) then
 * two SectionHeader-anchored blocks: challans + invoices for this
 * party. From here the user can spin a new challan / new invoice
 * pre-scoped to this party.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  BUTTON_STYLES,
  EmptyState,
  Money,
  SectionHeader,
  TABLE_STYLES,
  VendorAvatar,
} from "../../../accounts/_ui/components";
import { ChallanStatusPill } from "../../_ui/challan-status-pill";

type Params = Promise<{ id: string }>;

export default async function PartyDetailPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const [{ data: party }, { data: challansRaw }, { data: invoicesRaw }] = await Promise.all([
    supabase
      .from("invoice_parties")
      .select("id, name, gstin, pan, address, phone, email, notes, is_active, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("challans")
      .select("id, challan_number, challan_date, notes, cancelled_at, converted_invoice_id, priced_at, owner_approved_at, owner_rejected_at")
      .eq("invoice_party_id", id)
      .order("challan_date", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, total, source_challan_id")
      .eq("invoice_party_id", id)
      .order("invoice_date", { ascending: false }),
  ]);

  if (!party) notFound();
  const p = party as {
    id: string;
    name: string;
    gstin: string | null;
    pan: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    is_active: boolean;
    created_at: string;
  };

  const challans = (challansRaw ?? []) as Array<{
    id: string;
    challan_number: string;
    challan_date: string;
    notes: string | null;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    priced_at: string | null;
    owner_approved_at: string | null;
    owner_rejected_at: string | null;
  }>;
  const invoices = (invoicesRaw ?? []) as Array<{
    id: string;
    invoice_number: string;
    invoice_date: string;
    total: number | string;
    source_challan_id: string | null;
  }>;
  const totalInvoiced = invoices.reduce((s, r) => s + Number(r.total ?? 0), 0);

  return (
    <section className="page-card">
      <AccountsHero
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <VendorAvatar name={p.name} size={36} />
            {p.name}
          </span>
        }
        description={
          <>
            {p.gstin && (
              <>
                GSTIN <strong style={{ fontFamily: "ui-monospace, monospace" }}>{p.gstin}</strong>
                {" · "}
              </>
            )}
            {p.phone && <>{p.phone}{" · "}</>}
            {p.email && <>{p.email}</>}
            {!p.gstin && !p.phone && !p.email && <>No contact details on file.</>}
          </>
        }
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href={`/invoicing/challans/new?party=${p.id}`} style={BUTTON_STYLES.primary}>
              📋 + New challan
            </Link>
            <Link href={`/invoicing/invoices/new?party=${p.id}`} style={BUTTON_STYLES.secondary}>
              🧾 + New invoice
            </Link>
            <Link href="/invoicing/parties" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", alignSelf: "center" }}>
              ← All parties
            </Link>
          </div>
        }
      />

      {/* Address block */}
      {p.address && (
        <div
          style={{
            marginTop: 18,
            padding: "12px 16px",
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 10,
            whiteSpace: "pre-wrap",
            fontSize: 13,
            color: "var(--text)",
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
            Address
          </div>
          {p.address}
        </div>
      )}

      {/* Challans */}
      <div style={{ marginTop: 24 }}>
        <SectionHeader
          title="Challans"
          count={challans.length}
          action={
            <Link href={`/invoicing/challans/new?party=${p.id}`} style={{ ...BUTTON_STYLES.ghost, fontSize: 12 }}>
              + New
            </Link>
          }
        />
        {challans.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No challans for this party yet"
            description="Challans = delivery notes (items + qty, no money). Create one before invoicing if you want to track what was delivered."
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
                </tr>
              </thead>
              <tbody>
                {challans.map((c, idx) => {
                  return (
                    <tr key={c.id} style={{ background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted }}>
                      <td style={{ ...TABLE_STYLES.td, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                        <Link href={`/invoicing/challans/${c.id}`} style={{ color: ACCOUNTS_TOKENS.accent, textDecoration: "none" }}>
                          {c.challan_number}
                        </Link>
                      </td>
                      <td style={TABLE_STYLES.td}>{c.challan_date}</td>
                      <td style={TABLE_STYLES.td}>
                        <ChallanStatusPill challan={c} />
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
      </div>

      {/* Invoices */}
      <div style={{ marginTop: 24 }}>
        <SectionHeader
          title="Invoices"
          count={invoices.length}
          total={<Money value={totalInvoiced} size="normal" tone="success" />}
          action={
            <Link href={`/invoicing/invoices/new?party=${p.id}`} style={{ ...BUTTON_STYLES.ghost, fontSize: 12 }}>
              + New
            </Link>
          }
        />
        {invoices.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No invoices for this party yet"
            description="Convert a challan into an invoice, or create one directly."
          />
        ) : (
          <div style={{ ...TABLE_STYLES.tableWrap }}>
            <table style={TABLE_STYLES.table}>
              <thead style={TABLE_STYLES.thead}>
                <tr>
                  <th style={TABLE_STYLES.th}>Invoice #</th>
                  <th style={TABLE_STYLES.th}>Date</th>
                  <th style={TABLE_STYLES.th}>From challan</th>
                  <th style={TABLE_STYLES.thRight}>Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => (
                  <tr key={inv.id} style={{ background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted }}>
                    <td style={{ ...TABLE_STYLES.td, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                      <Link href={`/invoicing/invoices/${inv.id}`} style={{ color: ACCOUNTS_TOKENS.success, textDecoration: "none" }}>
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td style={TABLE_STYLES.td}>{inv.invoice_date}</td>
                    <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                      {inv.source_challan_id ? "Yes" : "Direct"}
                    </td>
                    <td style={{ ...TABLE_STYLES.tdRight, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                      <Money value={Number(inv.total ?? 0)} size="normal" tone="success" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
