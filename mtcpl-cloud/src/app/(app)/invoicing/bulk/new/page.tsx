/**
 * Create bulk tax invoice (Mig 173) — picks the temples that have bulk challans,
 * pre-loads each temple's GST default (incl. the vendor-HSN 18% rule), and hands
 * it to the client form.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { challanCode } from "@/lib/doc-code";
import type { GstMode } from "@/lib/challan-pricing";
import { BulkInvoiceForm, type TempleData } from "./bulk-invoice-form";

export const dynamic = "force-dynamic";

export default async function NewBulkInvoicePage() {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const admin = createAdminSupabaseClient();

  const { data: rows } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, challan_date, temple")
    .not("sent_to_bulk_at", "is", null)
    .is("priced_at", null)
    .is("converted_invoice_id", null)
    .is("cancelled_at", null)
    .order("challan_date", { ascending: false });
  const all = (rows ?? []) as Array<{ id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null }>;

  const invoiced = new Set<string>();
  {
    const { data, error } = await admin.from("bulk_invoice_challans").select("challan_id");
    if (!error) for (const r of (data ?? []) as Array<{ challan_id: string }>) invoiced.add(r.challan_id);
  }
  const pool = all.filter((c) => !invoiced.has(c.id));

  const byTemple = new Map<string, typeof pool>();
  for (const c of pool) { const k = c.temple ?? "—"; const a = byTemple.get(k) ?? []; a.push(c); byTemple.set(k, a); }

  // Per-temple GST default (best-effort; vendor-HSN forces 18%).
  const gstByTemple = new Map<string, { mode: GstMode; igst: number; cgst: number; sgst: number }>();
  const names = [...byTemple.keys()];
  if (names.length) {
    const { data: tg, error } = await admin.from("temples").select("name, gst_mode, igst_percent, cgst_percent, sgst_percent, hsn_use_vendor").in("name", names);
    if (!error) for (const t of (tg ?? []) as any[]) {
      const vendor = !!t.hsn_use_vendor;
      const mode = (t.gst_mode === "igst" || t.gst_mode === "cgst_sgst" ? t.gst_mode : (vendor ? "igst" : null)) as GstMode;
      gstByTemple.set(t.name, {
        mode,
        igst: vendor ? 18 : (t.igst_percent != null ? Number(t.igst_percent) : 18),
        cgst: vendor ? 9 : (t.cgst_percent != null ? Number(t.cgst_percent) : 9),
        sgst: vendor ? 9 : (t.sgst_percent != null ? Number(t.sgst_percent) : 9),
      });
    }
  }

  const temples: TempleData[] = [...byTemple.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([temple, list]) => ({
      temple,
      gst: gstByTemple.get(temple) ?? { mode: null, igst: 18, cgst: 9, sgst: 9 },
      challans: list.map((c) => ({ id: c.id, code: challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number, date: c.challan_date })),
    }));

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>Create bulk tax invoice</h1>
        <p className="muted">Bill several of a temple&apos;s bulk challans on one tax invoice. Pick the temple, tick the challans it covers, then type the line items.</p>
      </div>
      {temples.length === 0 ? (
        <div className="banner" style={{ marginTop: 14 }}>No bulk challans to invoice. Send open challans to Bulk from the Challans page first.</div>
      ) : (
        <div style={{ marginTop: 14 }}><BulkInvoiceForm temples={temples} /></div>
      )}
      <p style={{ marginTop: 16, fontSize: 12 }}>
        <Link href="/invoicing/bulk" style={{ color: "var(--muted)", textDecoration: "none" }}>← Bulk challans</Link>
      </p>
    </section>
  );
}
