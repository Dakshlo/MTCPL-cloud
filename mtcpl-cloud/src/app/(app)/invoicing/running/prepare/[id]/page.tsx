/**
 * Prepare RUNNING CHALLAN (Daksh, Jul 2026). Reached by dragging a challan onto
 * 🏃 Running bill. Full-screen split: the dispatch challan LEFT (live preview),
 * item tables (with heads, NO rate) + transport RIGHT. "Create running challan"
 * (createRunningChallanAction) builds it, delivers the dispatch, and lands it on
 * the Running bills page — where it's later converted to an invoice (adds rate).
 * The challan STAYS on the Challans page until Create is pressed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode } from "@/lib/doc-code";
import { groupBulkItems } from "@/lib/bulk-items";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import { RunningPrepareForm } from "./running-prepare-form";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function RunningPreparePage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: chRow } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, running_challan_at, custom_billed_at, inv_seq, priced_at, converted_invoice_id, cancelled_at, source_dispatch_id, transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone, challan_custom_items(position, particulars, hsn, unit, quantity, section_index, section_head)")
    .eq("id", id)
    .maybeSingle();
  const c = chRow as any;
  if (!c) notFound();
  if (c.cancelled_at || c.priced_at || c.converted_invoice_id || c.inv_seq != null) redirect(`/invoicing/challans?toast=${encodeURIComponent("This challan can't be a running bill")}`);

  const editMode = !!c.running_challan_at;

  // Vehicle/driver fall back to the source dispatch.
  let disp: { vehicle_no: string | null; driver_name: string | null; driver_phone: string | null } | null = null;
  if (c.source_dispatch_id) {
    const { data } = await admin.from("dispatches").select("vehicle_no, driver_name, driver_phone").eq("id", c.source_dispatch_id).maybeSingle();
    disp = (data as any) ?? null;
  }
  let companies: string[] = [];
  {
    const { data } = await admin.from("transport_companies").select("name").order("name");
    companies = ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
  }

  const code = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;
  const transport = {
    company: (c.transport_company ?? "").trim(),
    phone: (c.transport_phone ?? "").trim(),
    lr: (c.lr_no ?? "").trim(),
    vehicle: ((c.transport_vehicle_no ?? "") || (disp?.vehicle_no ?? "")).trim(),
    driver: ((c.transport_driver_name ?? "") || (disp?.driver_name ?? "")).trim(),
    driverPhone: ((c.transport_driver_phone ?? "") || (disp?.driver_phone ?? "")).trim(),
  };

  // Rebuild the item tables for edit (grouped by section → head).
  const initSections = groupBulkItems((c.challan_custom_items ?? []) as any[]).map((g) => ({
    head: g.head ?? "",
    lines: g.rows.map((it: any) => ({ particulars: it.particulars ?? "", hsn: it.hsn ?? "", unit: it.unit ?? "", quantity: it.quantity != null ? String(it.quantity) : "" })),
  }));

  return (
    <>
      <CockpitSidebarToggle defaultCollapsed={true} />
      <RunningPrepareForm
        id={c.id}
        code={code}
        temple={c.temple ?? "—"}
        editMode={editMode}
        sourceDispatchId={c.source_dispatch_id}
        transport={transport}
        companies={companies}
        initSections={initSections}
      />
    </>
  );
}
