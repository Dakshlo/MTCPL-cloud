// Manual Work Order Document PDF (Invoicing, Mig 105). Role-gated GET that
// builds the letterhead PDF from the stored record. ?print=1 -> inline.
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildWorkOrderDocPdf } from "@/lib/work-order-doc-pdf";

export const runtime = "nodejs";

const ALLOWED = ["developer", "owner", "accountant_star"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("invoicing_work_order_docs")
    .select("doc_date, vendor, address, job_description, job_work_no, unit, quantity, rate, total")
    .eq("id", id)
    .maybeSingle();
  if (!data) return new Response("Document not found", { status: 404 });
  const d = data as {
    doc_date: string | null;
    vendor: string;
    address: string | null;
    job_description: string | null;
    job_work_no: string | null;
    unit: string;
    quantity: number | string;
    rate: number | string;
    total: number | string;
  };

  const pdf = await buildWorkOrderDocPdf({
    vendor: d.vendor,
    address: d.address,
    jobDescription: d.job_description,
    jobWorkNo: d.job_work_no,
    dateIso: d.doc_date,
    unit: d.unit === "sft" ? "sft" : "cft",
    quantity: Number(d.quantity),
    rate: Number(d.rate),
    total: Number(d.total),
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
