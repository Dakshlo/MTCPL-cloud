/**
 * Prepare work order challan (Daksh, Jul 2026). Reached right after a challan is
 * dragged onto Bulk (sendChallanToBulkAction redirects here). Full-screen split:
 *   LEFT  — the delivery challan that came from dispatch (iframe, verify it),
 *   RIGHT — transport / LR / vehicle / driver form.
 * "Convert to work order challan" (saveBulkTransportAction) fills transport, marks
 * it the FINAL work order challan, and releases the dispatch on the road — so the
 * Bulk page no longer needs an awaiting/final split. The work order challan IS the
 * dispatch challan (same CH number).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode } from "@/lib/doc-code";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import { PrepareForm } from "./prepare-form";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function PrepareWorkOrderChallanPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: chRow } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, challan_date, temple, sent_to_bulk_at, full_challan_at, priced_at, converted_invoice_id, cancelled_at, dropped_at, source_dispatch_id, transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone")
    .eq("id", id)
    .maybeSingle();
  const c = chRow as any;
  if (!c) notFound();
  // Stay-on-Challans (Jul 2026) — the challan is NOT flagged sent_to_bulk on drop;
  // it's flagged only when "Convert to work order challan" runs. So an open (not
  // priced/converted/cancelled/dropped) challan is valid to prepare here.
  if (c.cancelled_at || c.priced_at || c.converted_invoice_id || c.dropped_at) redirect(`/invoicing/bulk?toast=${encodeURIComponent("This challan can't be prepared for bulk")}`);

  // Vehicle/driver fall back to the source dispatch when the challan's own
  // mig-169 transport columns are empty.
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

  return (
    <>
      <CockpitSidebarToggle defaultCollapsed={true} />
      <PrepareForm
        id={c.id}
        code={code}
        temple={c.temple ?? "—"}
        alreadyReady={!!c.full_challan_at}
        sourceDispatchId={c.source_dispatch_id}
        transport={transport}
        companies={companies}
      />
    </>
  );
}
