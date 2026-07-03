/**
 * "Other Sales" (mig 176 + 183) — non-temple challans → invoices (two-step).
 * Loads the client list (invoice_parties) + this section's challans (with their
 * sectioned items) and hands them to the client component. Best-effort so a pre-
 * migration deploy shows a "run mig 176/183" banner instead of 500ing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { financialYear, challanCode } from "@/lib/doc-code";
import { OtherSalesClient, type Party, type OtherChallan } from "./other-client";

export const dynamic = "force-dynamic";

const pad = (n: number | null | undefined) => (n == null ? "" : String(n).padStart(2, "0"));

export default async function OtherSalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  let needsMigration = false;

  // Clients — full select (mig 176 cols); fall back to base cols if not migrated.
  let clients: Party[] = [];
  {
    const { data, error } = await admin
      .from("invoice_parties")
      .select("id, name, category, gstin, pan, address, city, state, state_code, phone, email, ship_name, ship_address, ship_city, ship_state, ship_state_code, ship_gstin, ship_phone, gst_mode, igst_percent, cgst_percent, sgst_percent")
      .eq("is_active", true)
      .order("name");
    if (error) {
      needsMigration = true;
      const { data: base } = await admin.from("invoice_parties").select("id, name, gstin, pan, address, phone, email").eq("is_active", true).order("name");
      clients = ((base ?? []) as any[]).map((c) => ({
        id: c.id, name: c.name, category: null, gstin: c.gstin ?? null, pan: c.pan ?? null, address: c.address ?? null,
        city: null, state: null, state_code: null, phone: c.phone ?? null, email: c.email ?? null,
        ship_name: null, ship_address: null, ship_city: null, ship_state: null, ship_state_code: null, ship_gstin: null, ship_phone: null,
        gst_mode: null, igst_percent: null, cgst_percent: null, sgst_percent: null,
      }));
    } else {
      clients = (data ?? []) as Party[];
    }
  }

  // This section's challans + items. Try with the section cols (mig 183); if the
  // schema lacks them, retry without so the page still works pre-183.
  const baseCols = "id, party_id, challan_date, doc_fy, doc_seq, notes, inv_fy, inv_seq, converted_at, cancelled_at, invoice_parties(name, category)";
  let challans: OtherChallan[] = [];
  {
    let rows: any[] | null = null;
    const withSec = await admin
      .from("other_challans")
      .select(`${baseCols}, other_challan_items(position, particulars, hsn, unit, quantity, rate, amount, section_index, section_head)`)
      .is("cancelled_at", null)
      .order("created_at", { ascending: false });
    if (withSec.error) {
      const plain = await admin
        .from("other_challans")
        .select(`${baseCols}, other_challan_items(position, particulars, hsn, unit, quantity, rate, amount)`)
        .is("cancelled_at", null)
        .order("created_at", { ascending: false });
      if (plain.error) needsMigration = true; else rows = plain.data as any[];
    } else {
      rows = withSec.data as any[];
    }
    challans = ((rows ?? []) as any[]).map((r) => {
      const code = challanCode(r.doc_fy, r.doc_seq) ?? `CH-${String(r.id).slice(0, 6).toUpperCase()}`;
      const invoiceCode = r.inv_fy && r.inv_seq != null ? `INV-${r.inv_fy}-${pad(r.inv_seq)}` : null;
      const p = Array.isArray(r.invoice_parties) ? r.invoice_parties[0] : r.invoice_parties;
      const items = ((r.other_challan_items ?? []) as any[])
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((it) => ({ particulars: it.particulars ?? "", hsn: it.hsn ?? "", unit: it.unit ?? "", quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: Number(it.amount) || 0, sectionIndex: Number(it.section_index) || 0, sectionHead: it.section_head ?? null }));
      const total = items.reduce((a, it) => a + (it.amount || 0), 0);
      return {
        id: r.id, code, date: r.challan_date, partyId: r.party_id, partyName: p?.name ?? "—", category: p?.category ?? null,
        notes: r.notes ?? null, items, converted: !!r.converted_at, invoiceCode, total,
      };
    });
  }

  // Preview CH number for the create form (shared counter, same as dispatch).
  const fy = financialYear(new Date());
  const chPrefix = `CH-${fy}-`;
  const { data: ctr } = await admin.from("doc_counters").select("last_seq").eq("fy", `${fy}`).maybeSingle();
  const chAuto = String((Number((ctr as any)?.last_seq) || 0) + 1).padStart(2, "0");

  return (
    <section className="page-card">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h1>Other Sales</h1>
          <p className="muted">Non-temple goods — create a challan for a client, then convert it to an invoice. No dispatch link.</p>
        </div>
        <Link href="/invoicing/parties" style={{ textDecoration: "none", fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}>👥 Clients</Link>
      </div>

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {sp.toast}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <OtherSalesClient
          clients={clients}
          challans={challans}
          chPrefix={chPrefix}
          chAuto={chAuto}
          preselectId={sp.client}
          openNew={sp.new === "1"}
          needsMigration={needsMigration}
        />
      </div>
    </section>
  );
}
