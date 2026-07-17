// Manual Work Order Document PDF (Invoicing, Mig 105). Role-gated GET that
// builds the letterhead PDF from the stored record. ?print=1 -> inline.
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildWorkOrderDocPdf, type WorkOrderLineItem } from "@/lib/work-order-doc-pdf";

export const runtime = "nodejs";

const ALLOWED = ["developer", "owner", "accountant_star", "accountant"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("invoicing_work_order_docs")
    .select("doc_date, vendor, address, vendor_gstin, vendor_category, vendor_email, vendor_mobile, job_description, job_work_no, unit, quantity, rate, total, line_items, gst_exclusive, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return new Response("Document not found", { status: 404 });
  const d = data as {
    doc_date: string | null;
    vendor: string;
    address: string | null;
    vendor_gstin: string | null;
    vendor_category: string | null;
    vendor_email: string | null;
    vendor_mobile: string | null;
    job_description: string | null;
    job_work_no: string | null;
    unit: string;
    quantity: number | string;
    rate: number | string;
    total: number | string;
    line_items: unknown;
    gst_exclusive: boolean | null;
    deleted_at: string | null;
  };

  // Mig 114 — build the line-item list from the JSONB column when present;
  // otherwise fall back to a single item from the legacy columns (older
  // rows created before multi-line support).
  type RawItem = { description?: string | null; unit?: string; quantity?: number | string; rate?: number | string; total?: number | string };
  // Mig 202 — cft/sft/nos/tonnes; anything else prints as cft.
  const asUnit = (v: unknown): "cft" | "sft" | "nos" | "tonnes" =>
    v === "sft" || v === "nos" || v === "tonnes" ? v : "cft";
  let lineItems: WorkOrderLineItem[] = [];
  if (Array.isArray(d.line_items) && d.line_items.length > 0) {
    lineItems = (d.line_items as RawItem[]).map((it) => {
      const quantity = Number(it.quantity ?? 0);
      const rate = Number(it.rate ?? 0);
      const total = it.total != null ? Number(it.total) : Math.round(quantity * rate * 100) / 100;
      return {
        description: typeof it.description === "string" ? it.description : null,
        unit: asUnit(it.unit),
        quantity,
        rate,
        total,
      };
    });
  } else {
    lineItems = [
      {
        description: d.job_description,
        unit: asUnit(d.unit),
        quantity: Number(d.quantity),
        rate: Number(d.rate),
        total: Number(d.total),
      },
    ];
  }
  const grandTotal = Number(d.total) || lineItems.reduce((s, it) => s + (Number(it.total) || 0), 0);

  const pdf = await buildWorkOrderDocPdf({
    vendorName: d.vendor,
    vendorGstin: d.vendor_gstin,
    vendorCategory: d.vendor_category,
    vendorMobile: d.vendor_mobile,
    vendorEmail: d.vendor_email,
    vendorAddress: d.address,
    jobWorkNo: d.job_work_no,
    dateIso: d.doc_date,
    lineItems,
    grandTotal,
    gstExclusive: d.gst_exclusive !== false,
    cancelled: d.deleted_at != null,
  });

  const inline = new URL(req.url).searchParams.get("print") === "1";
  const fname = `work-order-${(d.job_work_no || "doc").replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${fname}"`,
      "cache-control": "no-store",
    },
  });
}
