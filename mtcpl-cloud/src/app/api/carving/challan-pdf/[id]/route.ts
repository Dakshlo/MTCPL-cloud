// Downloadable Outsource jobwork challan PDF (letterhead). Mirrors the
// cutting done-pdf route: nodejs runtime, role-gated, returns the PDF as
// an attachment.
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildJobworkChallanPdf } from "@/lib/jobwork-challan-pdf";
import { numberToIndianWords } from "@/app/(app)/accounts/payments/[id]/voucher/number-to-words";

export const runtime = "nodejs";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }
  const { id } = await ctx.params;
  const admin = createAdminSupabaseClient();

  const { data: chRow } = await admin
    .from("carving_challans")
    .select(
      "id, challan_number, challan_date, vendor_id, vendor_name, amount_subtotal, gst_pct, gst_amount, is_rcm, amount_total, notes",
    )
    .eq("id", id)
    .maybeSingle();
  if (!chRow) return new Response("Challan not found", { status: 404 });
  const ch = chRow as {
    challan_number: string;
    challan_date: string | null;
    vendor_name: string;
    amount_subtotal: number;
    gst_pct: number | null;
    gst_amount: number;
    is_rcm: boolean;
    amount_total: number;
    notes: string | null;
  };

  const { data: itemRows } = await admin
    .from("carving_challan_items")
    .select("description, quantity, unit, rate, amount, position")
    .eq("challan_id", id)
    .order("position", { ascending: true });
  const items = ((itemRows ?? []) as Array<{
    description: string;
    quantity: number | string;
    unit: string;
    rate: number | string;
    amount: number | string;
  }>).map((r) => ({
    description: r.description,
    quantity: Number(r.quantity),
    unit:
      r.unit === "sft"
        ? ("sft" as const)
        : r.unit === "job"
          ? ("job" as const)
          : ("cft" as const),
    rate: Number(r.rate),
    amount: Number(r.amount),
  }));

  const pdf = await buildJobworkChallanPdf({
    company: {
      name: "MATESHWARI TEMPLE CONSTRUCTION PVT LTD",
      addressLines: ["Opposite Ajari Fatak", "Pindwara, Sirohi", "Rajasthan"],
    },
    challan: { number: ch.challan_number, date: ch.challan_date },
    vendor: { name: ch.vendor_name, gstin: null },
    items,
    subtotal: Number(ch.amount_subtotal),
    gstPct: ch.gst_pct != null ? Number(ch.gst_pct) : null,
    gstAmount: Number(ch.gst_amount),
    isRcm: !!ch.is_rcm,
    total: Number(ch.amount_total),
    amountInWords: numberToIndianWords(Number(ch.amount_total)),
    preparedByName: profile.full_name ?? null,
    notes: ch.notes,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${ch.challan_number || "jobwork-challan"}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
