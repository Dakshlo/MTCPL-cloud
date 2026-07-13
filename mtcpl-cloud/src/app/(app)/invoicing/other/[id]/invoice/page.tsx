/**
 * Convert an OTHER-SALES challan → invoice (Daksh, mig 176 two-step). Full-screen
 * split: the challan LEFT (iframe), the item tables with an editable RATE + GST
 * RIGHT. "Convert to invoice" (convertOtherChallanAction) prices the existing
 * items, sets GST, and assigns the locked INV number. Preview shows the full tax
 * invoice (NOT VALID watermark). GST defaults from the client party.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode, financialYear } from "@/lib/doc-code";
import { groupBulkItems } from "@/lib/bulk-items";
import type { GstMode } from "@/lib/challan-pricing";
import type { PreviewParty } from "../../../bulk/new/bulk-invoice-preview";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import { OtherInvoiceForm } from "./other-invoice-form";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function OtherInvoicePage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: ocRow } = await admin
    .from("other_challans")
    .select("id, party_id, challan_date, doc_fy, doc_seq, inv_fy, inv_seq, converted_at, cancelled_at, gst_mode, igst_percent, cgst_percent, sgst_percent, other_challan_items(position, particulars, hsn, unit, quantity, rate, section_index, section_head)")
    .eq("id", id)
    .maybeSingle();
  const o = ocRow as any;
  if (!o) notFound();
  if (o.cancelled_at) redirect("/invoicing/other?toast=Challan+is+cancelled");
  const editMode = o.inv_seq != null;

  const { data: pty } = await admin.from("invoice_parties").select("*").eq("id", o.party_id).maybeSingle();
  const p = (pty ?? {}) as any;

  // section_gst (mig 199) fetched separately best-effort so a pre-mig schema
  // doesn't 404 the page.
  const rawItems = ((o.other_challan_items ?? []) as any[]).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  {
    const { data: sg, error } = await admin.from("other_challan_items").select("position, section_gst").eq("other_challan_id", id);
    if (!error && sg) {
      const byPos = new Map<number, number | null>();
      for (const r of sg as any[]) byPos.set(Number(r.position) || 0, r.section_gst != null ? Number(r.section_gst) : null);
      for (const it of rawItems) it.section_gst = byPos.get(Number(it.position) || 0) ?? null;
    }
  }
  // Legacy per-table prefill: the invoice's stored slab (edit) / the party
  // default (first convert) when no per-table slab is stored yet.
  const ownMode0 = (o.gst_mode === "igst" || o.gst_mode === "cgst_sgst" ? o.gst_mode : null) as GstMode;
  const partyMode0 = (p.gst_mode === "igst" || p.gst_mode === "cgst_sgst" ? p.gst_mode : null) as GstMode;
  const legacyPct = o.inv_seq != null
    ? (ownMode0 === "igst" ? Number(o.igst_percent) || 0 : ownMode0 === "cgst_sgst" ? (Number(o.cgst_percent) || 0) + (Number(o.sgst_percent) || 0) : 0)
    : (partyMode0 === "igst" ? Number(p.igst_percent) || 0 : partyMode0 === "cgst_sgst" ? (Number(p.cgst_percent) || 0) + (Number(p.sgst_percent) || 0) : 0);
  const initSections = groupBulkItems(rawItems).map((g) => ({
    head: g.head ?? "",
    gst: g.gst != null ? String(g.gst) : legacyPct ? String(legacyPct) : "18",
    lines: g.rows.map((it: any) => ({ particulars: it.particulars ?? "", hsn: it.hsn ?? "", unit: it.unit ?? "", quantity: it.quantity != null ? String(it.quantity) : "", rate: it.rate != null ? String(it.rate) : "" })),
  }));

  const bill: PreviewParty = { name: p.name ?? null, address: p.address ?? null, city: p.city ?? null, state: p.state ?? null, state_code: p.state_code ?? null, gstin: p.gstin ?? null, pan: p.pan ?? null, phone: p.phone ?? null, email: p.email ?? null };
  const ship: PreviewParty | null = (p.ship_name || p.ship_address || p.ship_city)
    ? { name: p.ship_name ?? null, address: p.ship_address ?? null, city: p.ship_city ?? null, state: p.ship_state ?? null, state_code: p.ship_state_code ?? null, gstin: p.ship_gstin ?? null, pan: null, phone: p.ship_phone ?? null, email: null }
    : null;

  // GST — when re-editing a converted bill use its stored GST; otherwise default
  // from the client party's saved GST.
  const partyMode = (p.gst_mode === "igst" || p.gst_mode === "cgst_sgst" ? p.gst_mode : null) as GstMode;
  const ownMode = (o.gst_mode === "igst" || o.gst_mode === "cgst_sgst" ? o.gst_mode : null) as GstMode;
  const initGst = editMode
    ? { mode: ownMode, igst: Number(o.igst_percent) || 18, cgst: Number(o.cgst_percent) || 9, sgst: Number(o.sgst_percent) || 9 }
    : { mode: partyMode, igst: Number(p.igst_percent) || 18, cgst: Number(p.cgst_percent) || 9, sgst: Number(p.sgst_percent) || 9 };

  const chCode = challanCode(o.doc_fy, o.doc_seq) ?? `CH-${id.slice(0, 6).toUpperCase()}`;
  const invFy = (o.inv_fy ?? "").trim() || financialYear(o.challan_date);
  const invPrefix = `INV-${invFy}-`;
  let autoNum = "01";
  if (o.inv_seq == null) {
    const { data: ctr } = await admin.from("doc_counters").select("last_seq").eq("fy", `INV:${invFy}`).maybeSingle();
    autoNum = String((Number((ctr as { last_seq?: number } | null)?.last_seq) || 0) + 1).padStart(2, "0");
  }
  const initNum = o.inv_seq != null ? String(o.inv_seq).padStart(2, "0") : autoNum;

  return (
    <>
      <CockpitSidebarToggle defaultCollapsed={true} />
      <OtherInvoiceForm
        id={o.id}
        chCode={chCode}
        party={p.name ?? "—"}
        editMode={editMode}
        initSections={initSections}
        initGst={initGst}
        bill={bill}
        ship={ship}
        invLabel={`${invPrefix}${initNum}`}
      />
    </>
  );
}
