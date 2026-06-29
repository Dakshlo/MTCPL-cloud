/**
 * Mig 058 — Invoicing dashboard.
 *
 * Replaces the old "all invoices" list at this URL (that list moved
 * to /invoicing/invoices). Now the landing is a hero + 3 KPI cards
 * (Parties · Open Challans · Invoices ₹total) + a recent-activity
 * strip linking into the sub-sections.
 *
 * Mirrors the Finance dept dashboard pattern from
 * src/app/(app)/accounts/page.tsx (AccountsHero + KPI grid).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { allowedDepartmentsForRole } from "@/lib/departments";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  BUTTON_STYLES,
  EmptyState,
  KpiCard,
  Money,
  SectionHeader,
  VendorIdentity,
} from "../accounts/_ui/components";
import { ChallanStatusPill } from "./_ui/challan-status-pill";
import { challanCode } from "@/lib/doc-code";

export default async function InvoicingDashboardPage() {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    // Plain accountant has Invoicing in their switcher but only for the
    // standalone Work Order Document — they don't get the v2 dashboard
    // (parties / challans / invoices). Bounce them to their one surface
    // instead of kicking them out of the department entirely.
    if (allowedDepartmentsForRole(profile.role).includes("invoicing")) {
      redirect("/invoicing/work-order-doc");
    }
    redirect("/");
  }

  const supabase = createAdminSupabaseClient();

  const [
    { count: partyCount },
    { count: openChallanCount },
    { count: convertedChallanCount },
    { count: pendingApprovalCount },
    invoicesQ,
    recentChallansQ,
    recentInvoicesQ,
  ] = await Promise.all([
    // Mig 158 — "clients" are temples with billing details filled.
    supabase
      .from("temples")
      .select("id", { count: "exact", head: true })
      .or("bill_gstin.not.is.null,bill_pan.not.is.null,bill_phone.not.is.null,bill_address.not.is.null,bill_email.not.is.null"),
    supabase
      .from("challans")
      .select("id", { count: "exact", head: true })
      .is("cancelled_at", null)
      .is("converted_invoice_id", null),
    supabase
      .from("challans")
      .select("id", { count: "exact", head: true })
      .is("cancelled_at", null)
      .not("converted_invoice_id", "is", null),
    // Mig 167 — priced challans waiting on owner approval.
    supabase
      .from("challans")
      .select("id", { count: "exact", head: true })
      .not("priced_at", "is", null)
      .is("owner_approved_at", null)
      .is("owner_rejected_at", null)
      .is("cancelled_at", null)
      .is("converted_invoice_id", null),
    supabase
      .from("invoices")
      .select("id, total"),
    supabase
      .from("challans")
      .select("id, challan_number, doc_fy, doc_seq, challan_date, invoice_party_id, temple, cancelled_at, converted_invoice_id, priced_at, owner_approved_at, owner_rejected_at, invoice_parties(name)")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, customer_name, total")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const invoiceRows = (invoicesQ.data ?? []) as Array<{ id: string; total: number | string }>;
  const invoiceCount = invoiceRows.length;
  const invoiceTotal = invoiceRows.reduce((s, r) => s + Number(r.total ?? 0), 0);

  type RecentChallan = {
    id: string;
    challan_number: string;
    doc_fy: string | null;
    doc_seq: number | null;
    challan_date: string;
    invoice_party_id: string | null;
    temple: string | null;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    priced_at: string | null;
    owner_approved_at: string | null;
    owner_rejected_at: string | null;
    invoice_parties: { name: string } | { name: string }[] | null;
  };
  const recentChallans = (recentChallansQ.data ?? []) as RecentChallan[];

  type RecentInvoice = {
    id: string;
    invoice_number: string;
    invoice_date: string;
    customer_name: string;
    total: number | string;
  };
  const recentInvoices = (recentInvoicesQ.data ?? []) as RecentInvoice[];

  return (
    <section className="page-card">
      <AccountsHero
        title="Invoicing"
        description="Customer parties · delivery challans · invoices. The starred-accountant workflow."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* New challan / New invoice live in the sidebar menu — kept off the
                dashboard hero to avoid duplication (Daksh). */}
            {/* Mig 167 — journey reads Challans → Approval → Invoices. */}
            <Link href="/invoicing/approval" style={BUTTON_STYLES.secondary}>
              🟡 Approval{pendingApprovalCount ? ` (${pendingApprovalCount})` : ""}
            </Link>
            {/* Mig 173 — challans parked for periodic bulk billing. */}
            <Link href="/invoicing/bulk" style={BUTTON_STYLES.secondary}>
              📦 Bulk challans
            </Link>
            <Link href="/invoicing/install-contract" style={BUTTON_STYLES.secondary}>
              📜 Install contract
            </Link>
            {/* Mig 170 — per-temple billing/shipping/installation + default GST. */}
            <Link href="/settings/temples" style={BUTTON_STYLES.secondary}>
              🛕 Client billing &amp; GST
            </Link>
            {/* Mig 171 — HSN code per stone type (prints on the tax invoice). */}
            <Link href="/invoicing/stone-hsn" style={BUTTON_STYLES.secondary}>
              🪨 Stone &amp; HSN code
            </Link>
            <Link href="/invoicing/work-order-doc" style={BUTTON_STYLES.secondary}>
              📝 Work Order Doc
            </Link>
          </div>
        }
      />

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginTop: 18,
          marginBottom: 20,
        }}
      >
        <KpiCard
          label="Clients"
          value={
            <span style={{ fontSize: 30, fontWeight: 800, color: ACCOUNTS_TOKENS.accent }}>
              {partyCount ?? 0}
            </span>
          }
          sublabel="Temples with billing details"
          tone="accent"
          icon="🛕"
        />
        <KpiCard
          label="Open challans"
          value={
            <span style={{ fontSize: 30, fontWeight: 800, color: ACCOUNTS_TOKENS.warning }}>
              {openChallanCount ?? 0}
            </span>
          }
          sublabel={`${convertedChallanCount ?? 0} converted to invoices`}
          tone="warning"
          icon="📋"
          href="/invoicing/challans"
        />
        <KpiCard
          label="Invoices"
          value={
            <Money value={invoiceTotal} size="hero" tone="success" />
          }
          sublabel={`${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"} all-time`}
          tone="success"
          icon="🧾"
          href="/invoicing/invoices"
        />
      </div>

      {/* Recent challans */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader
          title="Recent challans"
          count={recentChallans.length}
          action={
            <Link href="/invoicing/challans" style={{ ...BUTTON_STYLES.ghost, fontSize: 12 }}>
              View all →
            </Link>
          }
        />
        {recentChallans.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No challans yet"
            description="Challans are delivery notes — items + quantity, no money. Create one to start tracking deliveries to a party."
            action={
              <Link href="/invoicing/challans/new" style={BUTTON_STYLES.primary}>
                + New challan
              </Link>
            }
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {recentChallans.map((c) => {
              const legacyParty = c.invoice_parties
                ? Array.isArray(c.invoice_parties)
                  ? c.invoice_parties[0]?.name ?? null
                  : c.invoice_parties.name
                : null;
              const partyName = c.temple ?? legacyParty ?? "—";
              return (
                <Link
                  key={c.id}
                  href={`/invoicing/challans/${c.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "var(--surface, #fff)",
                    border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                    borderRadius: 10,
                    textDecoration: "none",
                    color: "var(--text)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 700,
                      fontSize: 13,
                      color: ACCOUNTS_TOKENS.accent,
                      minWidth: 110,
                    }}
                  >
                    {challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number}
                  </span>
                  <VendorIdentity name={partyName} size={28} />
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.challan_date}</span>
                    <ChallanStatusPill challan={c} />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent invoices */}
      <div>
        <SectionHeader
          title="Recent invoices"
          count={recentInvoices.length}
          action={
            <Link href="/invoicing/invoices" style={{ ...BUTTON_STYLES.ghost, fontSize: 12 }}>
              View all →
            </Link>
          }
        />
        {recentInvoices.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No invoices yet"
            description="Create one directly, or convert an existing challan into an invoice."
            action={
              <Link href="/invoicing/invoices/new" style={BUTTON_STYLES.primary}>
                + New invoice
              </Link>
            }
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recentInvoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/invoicing/invoices/${inv.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  background: "var(--surface, #fff)",
                  border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                  borderRadius: 10,
                  textDecoration: "none",
                  color: "var(--text)",
                }}
              >
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    color: ACCOUNTS_TOKENS.success,
                    minWidth: 120,
                  }}
                >
                  {inv.invoice_number}
                </span>
                <VendorIdentity name={inv.customer_name} size={28} />
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{inv.invoice_date}</span>
                  <Money value={Number(inv.total ?? 0)} size="normal" tone="success" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
