/**
 * Bulk challans (Mig 173). Open challans "sent to bulk" land here, grouped by
 * temple in a card board (same look as the Challans page — search + collapsible
 * temple sections + cards). Each card downloads the delivery challan or sends it
 * back. "Create tax invoice" bills several of a temple's bulk challans on one
 * invoice.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode, invoiceCodeFromDoc } from "@/lib/doc-code";
import { BUTTON_STYLES } from "../../accounts/_ui/components";
import { BulkBoard, type BulkGroup, type BulkCard } from "./bulk-board";
import { BulkCancel } from "./bulk-cancel";

export const dynamic = "force-dynamic";

type Search = Promise<{ toast?: string }>;
type BulkRow = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; source_dispatch_id: string | null };

export default async function BulkChallansPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const { data: rows } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, source_dispatch_id")
    .not("sent_to_bulk_at", "is", null)
    .is("priced_at", null)
    .is("converted_invoice_id", null)
    .is("cancelled_at", null)
    .order("challan_date", { ascending: false });
  const all = (rows ?? []) as BulkRow[];

  // Drop challans already on a bulk invoice (best-effort).
  const invoiced = new Set<string>();
  {
    const { data, error } = await admin.from("bulk_invoice_challans").select("challan_id");
    if (!error) for (const r of (data ?? []) as Array<{ challan_id: string }>) invoiced.add(r.challan_id);
  }
  const pool = all.filter((c) => !invoiced.has(c.id));

  // Slab codes / labels per challan → folded into the search blob (parity with
  // the Challans page search). challan_items.codes is comma-separated text.
  const codesByChallan = new Map<string, string>();
  {
    const ids = pool.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      if (!chunk.length) break;
      const { data, error } = await admin.from("challan_items").select("challan_id, codes, label, description").in("challan_id", chunk);
      if (error) break;
      for (const it of (data ?? []) as Array<{ challan_id: string; codes: string | null; label: string | null; description: string | null }>) {
        const extra = [it.codes, it.label, it.description].filter(Boolean).join(" ");
        const prev = codesByChallan.get(it.challan_id) ?? "";
        codesByChallan.set(it.challan_id, `${prev} ${extra}`.trim());
      }
    }
  }

  // Mig 175 — full_challan_at (Tab-2 = challan ready) + transport per challan.
  // Best-effort: a pre-migration schema errors here and every card stays Tab-1.
  const fullByChallan = new Map<string, { ready: boolean; company: string; phone: string; lr: string; vehicle: string; driver: string; driverPhone: string }>();
  {
    const ids = pool.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      if (!chunk.length) break;
      const { data, error } = await admin.from("challans").select("id, full_challan_at, transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone").in("id", chunk);
      if (error) break;
      for (const r of (data ?? []) as Array<Record<string, string | null>>) {
        fullByChallan.set(r.id as string, {
          ready: !!r.full_challan_at,
          company: r.transport_company ?? "", phone: r.transport_phone ?? "", lr: r.lr_no ?? "",
          vehicle: r.transport_vehicle_no ?? "", driver: r.transport_driver_name ?? "", driverPhone: r.transport_driver_phone ?? "",
        });
      }
    }
  }

  // Dispatch vehicle/driver → prefill the Get-challan form.
  const dispById = new Map<string, { vehicle: string; driver: string; driverPhone: string }>();
  {
    const dispIds = [...new Set(pool.map((c) => c.source_dispatch_id).filter(Boolean) as string[])];
    for (let i = 0; i < dispIds.length; i += 300) {
      const chunk = dispIds.slice(i, i + 300);
      if (!chunk.length) break;
      const { data } = await admin.from("dispatches").select("id, vehicle_no, driver_name, driver_phone").in("id", chunk);
      for (const d of (data ?? []) as Array<{ id: string; vehicle_no: string | null; driver_name: string | null; driver_phone: string | null }>) {
        dispById.set(d.id, { vehicle: d.vehicle_no ?? "", driver: d.driver_name ?? "", driverPhone: d.driver_phone ?? "" });
      }
    }
  }

  // Transport company master for the Get-challan datalist.
  let companies: string[] = [];
  {
    const { data } = await admin.from("transport_companies").select("name").order("name");
    companies = ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
  }

  const byTemple = new Map<string, BulkCard[]>();
  for (const c of pool) {
    const temple = c.temple ?? "—";
    const code = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;
    const full = fullByChallan.get(c.id);
    const disp = c.source_dispatch_id ? dispById.get(c.source_dispatch_id) : undefined;
    const card: BulkCard = {
      id: c.id,
      code,
      date: c.challan_date,
      sourceDispatchId: c.source_dispatch_id,
      search: `${temple} ${code} ${c.challan_number} ${codesByChallan.get(c.id) ?? ""}`.toLowerCase(),
      ready: full?.ready ?? false,
      transport: {
        company: full?.company ?? "",
        phone: full?.phone ?? "",
        lr: full?.lr ?? "",
        vehicle: (full?.vehicle || disp?.vehicle) ?? "",
        driver: (full?.driver || disp?.driver) ?? "",
        driverPhone: (full?.driverPhone || disp?.driverPhone) ?? "",
      },
    };
    const a = byTemple.get(temple) ?? [];
    a.push(card);
    byTemple.set(temple, a);
  }
  const groups: BulkGroup[] = [...byTemple.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([temple, list]) => ({ temple, rows: list }));

  // Owner-rejected bulk invoices. Their challans are ALREADY back in the pool
  // (reject returns them); this list just shows the reason + a dismiss. Best-effort.
  type RejBulk = { id: string; temple: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; owner_reject_reason: string | null };
  let rejected: RejBulk[] = [];
  {
    const { data, error } = await admin.from("bulk_invoices")
      .select("id, temple, inv_fy, inv_seq, invoice_no_override, owner_reject_reason")
      .not("owner_rejected_at", "is", null).is("cancelled_at", null)
      .order("created_at", { ascending: false });
    if (!error) rejected = (data ?? []) as RejBulk[];
  }

  return (
    <section className="page-card">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h1>Bulk challans</h1>
        <Link href="/invoicing/bulk/new" style={BUTTON_STYLES.primary}>🧾 Create work order invoice</Link>
      </div>

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
          {sp.toast}
        </div>
      )}

      {rejected.length > 0 && (
        <div style={{ marginTop: 14, marginBottom: 14, border: "1px solid #fca5a5", borderRadius: 12, background: "#fef2f2", padding: "12px 14px" }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#991b1b", marginBottom: 8 }}>⚠ Owner-rejected bulk invoices — their challans are back in the pool below; re-bill them, then dismiss</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rejected.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", border: "1px solid #fecaca", borderRadius: 8, background: "#fff" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{(b.invoice_no_override ?? "").trim() || invoiceCodeFromDoc(b.inv_fy, b.inv_seq) || `INV-${b.id.slice(0, 6).toUpperCase()}`}</span>
                <span className="muted" style={{ fontSize: 12 }}>🏛 {b.temple}</span>
                {b.owner_reject_reason && <span style={{ fontSize: 12, color: "#991b1b" }}>Reason: {b.owner_reject_reason}</span>}
                <span style={{ marginLeft: "auto" }}><BulkCancel id={b.id} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <BulkBoard groups={groups} companies={companies} />
      </div>

      <p style={{ marginTop: 16, fontSize: 12 }}>
        <Link href="/invoicing/challans" style={{ color: "var(--muted)", textDecoration: "none" }}>← Challans</Link>
      </p>
    </section>
  );
}
