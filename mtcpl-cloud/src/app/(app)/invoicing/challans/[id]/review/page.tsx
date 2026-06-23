/**
 * Mig 157 — Invoicing "review & price" page.
 *
 * Shows the exact same Excel grid the dispatch team verified (all columns
 * locked) and adds an editable Rate column + GST controls (IGST, or CGST+SGST,
 * manual %). Saving prices the challan, which then prints as a landscape tax
 * invoice. Blank fields show "-".
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import type { GstMode } from "@/lib/challan-pricing";
import { ReviewForm, type PriceItem } from "./review-form";

type Params = Promise<{ id: string }>;
type Search = Promise<{ [k: string]: string | string[] | undefined }>;

export default async function ChallanReviewPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const toast = typeof sp.toast === "string" ? sp.toast : null;
  const admin = createAdminSupabaseClient();

  const [{ data: challan }, { data: items }] = await Promise.all([
    admin
      .from("challans")
      .select(
        "id, challan_number, challan_date, notes, cancelled_at, converted_invoice_id, source_dispatch_id, gst_mode, igst_percent, cgst_percent, sgst_percent, priced_at, invoice_parties(name, gstin, address, phone)",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("challan_items")
      .select(
        "id, position, description, quantity, unit, codes, label, additional_description, component_section, component_element, length_ft, width_ft, thickness_ft, weight_tonnes, measure_unit, measure_qty, rate",
      )
      .eq("challan_id", id)
      .order("position"),
  ]);

  if (!challan) notFound();
  const c = challan as {
    id: string;
    challan_number: string;
    challan_date: string;
    notes: string | null;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    source_dispatch_id: string | null;
    gst_mode: string | null;
    igst_percent: number | null;
    cgst_percent: number | null;
    sgst_percent: number | null;
    priced_at: string | null;
    invoice_parties:
      | { name: string; gstin: string | null; address: string | null; phone: string | null }
      | Array<{ name: string; gstin: string | null; address: string | null; phone: string | null }>
      | null;
  };
  if (c.cancelled_at) redirect(`/invoicing/challans/${id}`);
  const party = c.invoice_parties ? (Array.isArray(c.invoice_parties) ? c.invoice_parties[0] : c.invoice_parties) : null;

  const priceItems: PriceItem[] = ((items ?? []) as Array<Record<string, unknown>>).map((it) => {
    const measureQty =
      it.measure_qty != null && Number(it.measure_qty) > 0
        ? Number(it.measure_qty)
        : Number(it.quantity) || 0;
    return {
      id: it.id as string,
      codes: (it.codes as string | null) ?? "",
      label: (it.label as string | null) ?? null,
      description: (it.description as string | null) ?? null,
      additional_description: (it.additional_description as string | null) ?? null,
      component_section: (it.component_section as string | null) ?? null,
      component_element: (it.component_element as string | null) ?? null,
      length_ft: it.length_ft != null ? Number(it.length_ft) : null,
      width_ft: it.width_ft != null ? Number(it.width_ft) : null,
      thickness_ft: it.thickness_ft != null ? Number(it.thickness_ft) : null,
      qty: Number(it.quantity) || 0,
      weightTonnes: it.weight_tonnes != null ? Number(it.weight_tonnes) : 0,
      unit: ((it.measure_unit as string | null) || (it.unit as string | null) || "cft") as "cft" | "sft",
      measureQty,
      rate: it.rate != null ? Number(it.rate) : 0,
    };
  });

  const initGst = {
    mode: (c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null) as GstMode,
    igst: c.igst_percent != null ? Number(c.igst_percent) : 18,
    cgst: c.cgst_percent != null ? Number(c.cgst_percent) : 9,
    sgst: c.sgst_percent != null ? Number(c.sgst_percent) : 9,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 40, maxWidth: 1280 }}>
      <div>
        <Link href={`/invoicing/challans/${id}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
          ← Challan {c.challan_number}
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>🧾 Review &amp; price</h1>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{c.challan_number}</span>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>· {party?.name ?? "—"} · {c.challan_date}</span>
          {c.priced_at && <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.1)", borderRadius: 999, padding: "2px 10px" }}>PRICED</span>}
        </div>
        {party && (party.gstin || party.address || party.phone) && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {party.gstin ? <>GSTIN <strong style={{ fontFamily: "ui-monospace, monospace" }}>{party.gstin}</strong> · </> : null}
            {party.address ? <>{party.address} · </> : null}
            {party.phone ? <>☎ {party.phone}</> : null}
          </div>
        )}
      </div>

      {toast && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          {toast}
        </div>
      )}

      <ReviewForm challanId={id} items={priceItems} initGst={initGst} />
    </div>
  );
}
