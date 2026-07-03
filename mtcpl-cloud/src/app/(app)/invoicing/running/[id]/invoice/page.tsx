/**
 * Convert a RUNNING CHALLAN → invoice (Daksh, mig 182). Full-screen split: the
 * running challan LEFT (iframe), the item tables with an editable RATE + GST
 * RIGHT. "Convert to invoice" (convertRunningToInvoiceAction) prices the existing
 * items, sets GST, and assigns the locked INV number. Preview shows the full
 * tax invoice (NOT VALID watermark).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode, financialYear } from "@/lib/doc-code";
import { fetchTempleBilling } from "@/lib/temple-billing";
import { groupBulkItems } from "@/lib/bulk-items";
import type { GstMode } from "@/lib/challan-pricing";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import { RunningInvoiceForm } from "./running-invoice-form";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function RunningInvoicePage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: chRow } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, running_challan_at, inv_fy, inv_seq, gst_mode, igst_percent, cgst_percent, sgst_percent, source_dispatch_id, challan_custom_items(position, particulars, hsn, unit, quantity, rate, section_index, section_head)")
    .eq("id", id)
    .maybeSingle();
  const c = chRow as any;
  if (!c || !c.running_challan_at) notFound();
  const editMode = c.inv_seq != null;

  const initSections = groupBulkItems((c.challan_custom_items ?? []) as any[]).map((g) => ({
    head: g.head ?? "",
    lines: g.rows.map((it: any) => ({ particulars: it.particulars ?? "", hsn: it.hsn ?? "", unit: it.unit ?? "", quantity: it.quantity != null ? String(it.quantity) : "", rate: it.rate != null ? String(it.rate) : "" })),
  }));

  const billing = await fetchTempleBilling(admin, c.temple);
  const bill = billing
    ? { name: billing.name ?? c.temple ?? "—", address: billing.address, city: billing.city, state: billing.state, state_code: billing.state_code, gstin: billing.gstin, pan: billing.pan, phone: billing.phone, email: billing.email }
    : { name: c.temple ?? "—", address: null, city: null, state: null, state_code: null, gstin: null, pan: null, phone: null, email: null };
  const ship = billing?.shipping ?? null;

  const code = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;
  // GST — respect the bill's own saved GST; on first convert default from the
  // temple's Client Billing & GST (Daksh).
  const challanMode = (c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null) as GstMode;
  const tGst = billing?.gst ?? { mode: null, igst: null, cgst: null, sgst: null };
  const initGst = challanMode
    ? { mode: challanMode, igst: Number(c.igst_percent) || 18, cgst: Number(c.cgst_percent) || 9, sgst: Number(c.sgst_percent) || 9 }
    : { mode: tGst.mode as GstMode, igst: tGst.igst ?? 18, cgst: tGst.cgst ?? 9, sgst: tGst.sgst ?? 9 };

  const invFy = (c.inv_fy ?? "").trim() || financialYear(c.challan_date);
  const invPrefix = `INV-${invFy}-`;
  let autoNum = "01";
  if (c.inv_seq == null) {
    const { data: ctr } = await admin.from("doc_counters").select("last_seq").eq("fy", `INV:${invFy}`).maybeSingle();
    autoNum = String((Number((ctr as { last_seq?: number } | null)?.last_seq) || 0) + 1).padStart(2, "0");
  }
  const initNum = c.inv_seq != null ? String(c.inv_seq).padStart(2, "0") : autoNum;

  return (
    <>
      <CockpitSidebarToggle defaultCollapsed={true} />
      <RunningInvoiceForm
        id={c.id}
        code={code}
        temple={c.temple ?? "—"}
        editMode={editMode}
        sourceDispatchId={c.source_dispatch_id}
        initSections={initSections}
        initGst={initGst}
        bill={bill}
        ship={ship}
        invLabel={`${invPrefix}${initNum}`}
      />
    </>
  );
}
