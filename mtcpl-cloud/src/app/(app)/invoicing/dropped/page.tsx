/**
 * Mig 177 — "Dropped" challans page. Challans dragged onto the 🎯 Custom bill
 * drop zone on the Challans page land here (own page, like Bulk challans). Each
 * is re-billed as a custom whole-piece bill (keeps the CH number, delivers the
 * dispatch) or un-dropped. Best-effort so a pre-migration deploy shows an empty
 * list instead of 500ing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode } from "@/lib/doc-code";
import { DroppedSection } from "../_ui/dropped-section";
import { type DroppedChallan } from "../_ui/challans-board";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ toast?: string; edit?: string }>;

export default async function DroppedChallansPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;
  const supabase = createAdminSupabaseClient();

  const dropped: DroppedChallan[] = [];
  {
    const { data, error } = await supabase
      .from("challans")
      .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, custom_billed_at, gst_mode, igst_percent, cgst_percent, sgst_percent, source_dispatch_id, transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone, invoice_parties(name), challan_custom_items(position, particulars, hsn, unit, quantity, rate, amount)")
      .not("dropped_at", "is", null)
      .is("cancelled_at", null)
      .is("inv_seq", null) // invoiced ones live on the Invoices page
      .order("dropped_at", { ascending: false });
    // ?edit=<id> (Invoices page ✎ Edit) — an INVOICED running bill isn't in the
    // normal list (inv_seq filter); fetch it explicitly so its form can open.
    let editRow: any = null;
    if (sp.edit) {
      const { data: er } = await supabase
        .from("challans")
        .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, custom_billed_at, gst_mode, igst_percent, cgst_percent, sgst_percent, source_dispatch_id, transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone, invoice_parties(name), challan_custom_items(position, particulars, hsn, unit, quantity, rate, amount)")
        .eq("id", sp.edit)
        .not("dropped_at", "is", null)
        .is("cancelled_at", null)
        .maybeSingle();
      editRow = er ?? null;
    }
    if (!error) {
      const rows = [
        ...(editRow && !((data ?? []) as any[]).some((r: any) => r.id === editRow.id) ? [editRow] : []),
        ...((data ?? []) as any[]),
      ];
      // Vehicle/driver fall back to the source dispatch when the challan's own
      // mig-169 transport columns are empty.
      const dispIds = [...new Set(rows.map((r) => r.source_dispatch_id).filter(Boolean))] as string[];
      const dispById = new Map<string, { vehicle_no: string | null; driver_name: string | null; driver_phone: string | null }>();
      if (dispIds.length > 0) {
        const { data: disp } = await supabase.from("dispatches").select("id, vehicle_no, driver_name, driver_phone").in("id", dispIds);
        for (const d of (disp ?? []) as any[]) dispById.set(d.id, { vehicle_no: d.vehicle_no ?? null, driver_name: d.driver_name ?? null, driver_phone: d.driver_phone ?? null });
      }
      for (const r of rows) {
        const p = Array.isArray(r.invoice_parties) ? r.invoice_parties[0] : r.invoice_parties;
        const gm = r.gst_mode === "igst" || r.gst_mode === "cgst_sgst" ? r.gst_mode : null;
        const items = ((r.challan_custom_items ?? []) as any[])
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((it) => ({ particulars: it.particulars ?? "", hsn: it.hsn ?? "", unit: it.unit ?? "", quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0, amount: Number(it.amount) || 0 }));
        const disp = r.source_dispatch_id ? dispById.get(r.source_dispatch_id) : null;
        dropped.push({
          id: r.id, code: challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number, temple: r.temple ?? p?.name ?? "—",
          date: r.challan_date, customBilled: !!r.custom_billed_at, gstMode: gm,
          igst: Number(r.igst_percent) || 0, cgst: Number(r.cgst_percent) || 0, sgst: Number(r.sgst_percent) || 0, items,
          sourceDispatchId: r.source_dispatch_id ?? null,
          transport: {
            company: (r.transport_company ?? "").trim(),
            vehicle: ((r.transport_vehicle_no ?? "") || (disp?.vehicle_no ?? "")).trim(),
            driver: ((r.transport_driver_name ?? "") || (disp?.driver_name ?? "")).trim(),
            driverPhone: ((r.transport_driver_phone ?? "") || (disp?.driver_phone ?? "")).trim(),
            lr: (r.lr_no ?? "").trim(),
            phone: (r.transport_phone ?? "").trim(),
          },
        });
      }
    }
  }

  return (
    <section className="page-card">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>🏃 Running bills</h1>
          <p className="muted">Challans dropped here become RUNNING BILLS — re-billed as one whole piece. Create the bill (keeps the CH number &amp; delivers the dispatch) or un-drop back to Challans.</p>
        </div>
        <Link href="/invoicing/challans" style={{ textDecoration: "none", fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", whiteSpace: "nowrap" }}>← Challans</Link>
      </div>

      {sp.toast && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {sp.toast}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <DroppedSection dropped={dropped} showHeader={false} initialEditId={sp.edit} />
      </div>
    </section>
  );
}
