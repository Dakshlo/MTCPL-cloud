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
import { fetchTempleBilling } from "@/lib/temple-billing";
import type { GstMode } from "@/lib/challan-pricing";
import { financialYear, challanCode } from "@/lib/doc-code";
import { fetchFreedInvoiceNumbers } from "@/lib/invoice-numbers";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
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
        "id, challan_number, doc_fy, doc_seq, challan_date, notes, cancelled_at, converted_invoice_id, source_dispatch_id, temple, gst_mode, igst_percent, cgst_percent, sgst_percent, priced_at, owner_approved_at, invoice_no_override, inv_fy, inv_seq, invoice_parties(name, gstin, address, phone)",
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
    doc_fy: string | null;
    doc_seq: number | null;
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
    owner_approved_at: string | null;
    temple: string | null;
    invoice_no_override: string | null;
    inv_fy: string | null;
    inv_seq: number | null;
    invoice_parties:
      | { name: string; gstin: string | null; address: string | null; phone: string | null }
      | Array<{ name: string; gstin: string | null; address: string | null; phone: string | null }>
      | null;
  };
  if (c.cancelled_at) redirect(`/invoicing/challans/${id}`);
  // Mig 158 — client = temple. Resolve billing from the temple; fall back to a
  // legacy invoice party for any pre-158 challan.
  const party = c.invoice_parties ? (Array.isArray(c.invoice_parties) ? c.invoice_parties[0] : c.invoice_parties) : null;
  const billing = c.temple
    ? await fetchTempleBilling(admin, c.temple)
    : party
    ? { name: party.name, gstin: party.gstin, pan: null, address: party.address, email: null, phone: party.phone }
    : null;

  // Stone per item — derived from its slab codes (challan_items has no stone),
  // so the review page can group by stone like the invoice.
  const codeStone = new Map<string, string>();
  const allCodes = [...new Set(((items ?? []) as Array<{ codes: string | null }>).flatMap((it) => (it.codes ?? "").split(",").map((s) => s.trim()).filter(Boolean)))];
  for (let i = 0; i < allCodes.length; i += 300) {
    const chunk = allCodes.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data: sr } = await admin.from("slab_requirements").select("id, stone").in("id", chunk);
    for (const s of (sr ?? []) as Array<{ id: string; stone: string | null }>) codeStone.set(s.id, (s.stone ?? "").trim());
  }
  const stoneOf = (codes: string | null) => {
    const f = (codes ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0];
    return (f && codeStone.get(f)) || "—";
  };

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
      stone: stoneOf((it.codes as string | null) ?? null),
    };
  });

  // Mig 170 — default GST for a not-yet-priced challan comes from the TEMPLE's
  // saved GST (Settings → Temple Codes). Best-effort. Once priced, the challan's
  // own saved GST is respected instead.
  let templeGst: { mode: string | null; igst: number | null; cgst: number | null; sgst: number | null } = { mode: null, igst: null, cgst: null, sgst: null };
  if (c.temple) {
    const { data: tg, error } = await admin.from("temples").select("gst_mode, igst_percent, cgst_percent, sgst_percent").eq("name", c.temple).maybeSingle();
    if (!error && tg) {
      const t = tg as Record<string, unknown>;
      templeGst = {
        mode: (t.gst_mode as string) || null,
        igst: t.igst_percent != null ? Number(t.igst_percent) : null,
        cgst: t.cgst_percent != null ? Number(t.cgst_percent) : null,
        sgst: t.sgst_percent != null ? Number(t.sgst_percent) : null,
      };
    }
  }
  // Mig 171 — if the temple bills with the vendor HSN, the GST slab is forced to
  // 18% (IGST 18% or CGST 9% + SGST 9%). Best-effort fetch (separate column).
  let hsnUseVendor = false;
  if (c.temple) {
    const { data: hv, error } = await admin.from("temples").select("hsn_use_vendor").eq("name", c.temple).maybeSingle();
    if (!error && hv) hsnUseVendor = !!(hv as { hsn_use_vendor?: boolean }).hsn_use_vendor;
  }
  const priced = !!c.priced_at;
  const challanHasGst = c.gst_mode === "igst" || c.gst_mode === "cgst_sgst";
  const templeHasGst = templeGst.mode === "igst" || templeGst.mode === "cgst_sgst";
  const initGst = priced
    ? {
        mode: (challanHasGst ? c.gst_mode : null) as GstMode,
        igst: c.igst_percent != null ? Number(c.igst_percent) : 18,
        cgst: c.cgst_percent != null ? Number(c.cgst_percent) : 9,
        sgst: c.sgst_percent != null ? Number(c.sgst_percent) : 9,
      }
    : hsnUseVendor
    ? {
        // Vendor HSN → 18% total, keeping the temple's mode (default IGST).
        mode: (templeHasGst ? templeGst.mode : "igst") as GstMode,
        igst: 18, cgst: 9, sgst: 9,
      }
    : {
        mode: (templeHasGst ? templeGst.mode : null) as GstMode,
        igst: templeGst.igst ?? 18,
        cgst: templeGst.cgst ?? 9,
        sgst: templeGst.sgst ?? 9,
      };

  // Mig 169 — transport companies master + this challan's saved transport
  // details. Best-effort (separate selects, error-checked) so a pre-migration
  // schema never 404s the review page.
  let transportCompanies: string[] = [];
  {
    const { data: tc, error } = await admin.from("transport_companies").select("name").eq("is_active", true).order("name");
    if (!error) transportCompanies = ((tc ?? []) as Array<{ name: string }>).map((r) => r.name).filter(Boolean);
  }
  let initTransport = { company: "", phone: "", lr: "", vehicle: "", driverName: "", driverPhone: "" };
  {
    const { data: tr, error } = await admin
      .from("challans")
      .select("transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone")
      .eq("id", id)
      .maybeSingle();
    if (!error && tr) {
      const t = tr as Record<string, string | null>;
      initTransport = {
        company: t.transport_company ?? "", phone: t.transport_phone ?? "", lr: t.lr_no ?? "",
        vehicle: t.transport_vehicle_no ?? "", driverName: t.transport_driver_name ?? "", driverPhone: t.transport_driver_phone ?? "",
      };
    }
  }

  // Invoice number (INV series, mig 172) — shown as a fixed "INV-26/27-" prefix
  // plus an editable XX. Uses the challan's assigned inv_seq if any; otherwise
  // previews the next number from the shared per-FY INV counter (Daksh Jul 2026).
  const invFy = (c.inv_fy ?? "").trim() || financialYear(c.challan_date);
  const invPrefix = `INV-${invFy}-`;
  let nextSeq = c.inv_seq ?? 1;
  if (c.inv_seq == null) {
    const { data: ctr } = await admin.from("doc_counters").select("last_seq").eq("fy", `INV:${invFy}`).maybeSingle();
    nextSeq = (Number((ctr as { last_seq?: number } | null)?.last_seq) || 0) + 1;
  }
  const initNum = c.inv_seq != null ? String(c.inv_seq) : "";
  const autoNum = String(nextSeq).padStart(2, "0");
  // Mig 178 — freed (gap) numbers from cancelled invoices, indication only.
  const freedNumbers = await fetchFreedInvoiceNumbers(admin, invFy);
  // Jul 2026 — "Edit invoice" mode (from the Invoices page): re-edit a FINAL
  // approved invoice; the INV number + approval stay untouched.
  const editMode = sp.edit === "1" && !!c.owner_approved_at;
  // The proper unified challan code (CH-<fy>-n) — legacy CHLN only as fallback.
  const chCode = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;

  return (
    <>
      {/* Full-screen feel — sidebar collapsed by default (toggle to bring it back). */}
      <CockpitSidebarToggle defaultCollapsed={true} />
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: 40 }}>
        {/* LEFT — the pricing form. */}
        <div style={{ flex: "1 1 620px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ marginTop: 44 }}>
            <Link href={`/invoicing/challans/${id}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
              ← Challan {chCode}
            </Link>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>{editMode ? "Edit invoice" : "Review & price"}</h1>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{chCode}</span>
              <span style={{ fontSize: 14, color: "var(--muted)" }}>· {billing?.name ?? c.temple ?? "—"} · {c.challan_date}</span>
              {editMode
                ? <span style={{ fontSize: 11, fontWeight: 700, color: "#6d28d9", background: "rgba(124,58,237,0.1)", borderRadius: 999, padding: "2px 10px" }}>EDITING FINAL INVOICE — number locked</span>
                : c.priced_at && <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.1)", borderRadius: 999, padding: "2px 10px" }}>PRICED</span>}
            </div>
            {billing && (billing.gstin || billing.pan || billing.address || billing.phone) && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {billing.gstin ? <>GSTIN <strong style={{ fontFamily: "ui-monospace, monospace" }}>{billing.gstin}</strong> · </> : null}
                {billing.pan ? <>PAN <strong style={{ fontFamily: "ui-monospace, monospace" }}>{billing.pan}</strong> · </> : null}
                {billing.address ? <>{billing.address} · </> : null}
                {billing.phone ? <>☎ {billing.phone}</> : null}
              </div>
            )}
          </div>

          {toast && (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "8px 12px" }}>
              {toast}
            </div>
          )}

          <ReviewForm
            challanId={id}
            items={priceItems}
            initGst={initGst}
            invPrefix={invPrefix}
            initNum={initNum}
            autoNum={autoNum}
            freedNumbers={freedNumbers}
            editMode={editMode}
            bill={{ name: billing?.name ?? c.temple ?? "—", address: billing?.address ?? null, gstin: billing?.gstin ?? null }}
            transportCompanies={transportCompanies}
            initTransport={initTransport}
          />
        </div>

        {/* RIGHT — the generated challan, pinned, so the reviewer verifies while
            pricing (Daksh Jul 2026). Only dispatch-sourced challans have one. */}
        {c.source_dispatch_id && (
          <div style={{ flex: "1 1 560px", minWidth: 380, position: "sticky", top: 10, display: "flex", flexDirection: "column", height: "calc(100vh - 20px)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
            <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>📋 Generated challan — verify while you price</span>
              <Link href={`/dispatch/${c.source_dispatch_id}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none", whiteSpace: "nowrap" }}>Open full ↗</Link>
            </div>
            <iframe
              src={`/dispatch/${c.source_dispatch_id}/print?embed=1`}
              title="Generated challan"
              style={{ flex: 1, width: "100%", border: "none", background: "#f0f0f0" }}
            />
          </div>
        )}
      </div>
    </>
  );
}
