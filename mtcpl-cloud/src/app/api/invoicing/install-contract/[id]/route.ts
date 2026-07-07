// Installation Vendor Contract PDF (Invoicing, Mig 148). Role-gated GET
// that builds the letterhead contract from the stored snapshot.
// ?print=1 -> inline.
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildInstallContractPdf } from "@/lib/install-contract-pdf";

export const runtime = "nodejs";

const ALLOWED = ["developer", "owner", "accountant_star", "accountant", "crosscheck"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("install_contracts")
    .select(
      "contract_no, doc_date, vendor_name, vendor_contact, vendor_phone, vendor_address, vendor_gstin, vendor_aadhaar, site_project, site_location, price, price_unit, price_words, scope_note, deleted_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return new Response("Contract not found", { status: 404 });
  const d = data as {
    contract_no: string | null;
    doc_date: string | null;
    vendor_name: string;
    vendor_contact: string | null;
    vendor_phone: string | null;
    vendor_address: string | null;
    vendor_gstin: string | null;
    vendor_aadhaar: string | null;
    site_project: string;
    site_location: string | null;
    price: number | string;
    price_unit: string | null;
    price_words: string | null;
    scope_note: string | null;
    deleted_at: string | null;
  };

  const pdf = await buildInstallContractPdf({
    contractNo: d.contract_no,
    dateIso: d.doc_date,
    vendorName: d.vendor_name,
    vendorContact: d.vendor_contact,
    vendorPhone: d.vendor_phone,
    vendorAddress: d.vendor_address,
    vendorGstin: d.vendor_gstin,
    vendorAadhaar: d.vendor_aadhaar,
    siteProject: d.site_project,
    siteLocation: d.site_location,
    price: Number(d.price) || 0,
    priceUnit: d.price_unit,
    priceWords: d.price_words,
    scopeNote: d.scope_note,
    cancelled: d.deleted_at != null,
  });

  const inline = new URL(req.url).searchParams.get("print") === "1";
  const fname = `contract-${(d.contract_no || "doc").replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${fname}"`,
      "cache-control": "no-store",
    },
  });
}
