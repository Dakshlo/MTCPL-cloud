// ──────────────────────────────────────────────────────────────────
// Work-order handover document — download route.
//   GET /api/carving/work-order-pdf/<id>
// Returns the printable jobwork work-order PDF (letterhead + slab list +
// agreed rate + totals + terms + signatures) for handover to the vendor.
// Office roles only.
// ──────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildWorkOrderPdf, type WorkOrderPdfSlab } from "@/lib/work-order-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminSupabaseClient();

  const { data: woRow } = await admin
    .from("carving_work_orders")
    .select("id, wo_number, vendor_name, title, temple, jobwork_rate, jobwork_unit, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!woRow) return new Response("Not found", { status: 404 });
  const wo = woRow as {
    wo_number: string;
    vendor_name: string;
    title: string | null;
    temple: string | null;
    jobwork_rate: number | string | null;
    jobwork_unit: string | null;
    created_at: string;
  };

  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("slab_requirement_id, description, planned_length_ft, planned_width_ft, planned_thickness_ft, line_status, position")
    .eq("work_order_id", id)
    .neq("line_status", "cancelled")
    .order("position", { ascending: true });
  const lines = (lineRows ?? []) as Array<{
    slab_requirement_id: string | null;
    description: string | null;
    planned_length_ft: number | string | null;
    planned_width_ft: number | string | null;
    planned_thickness_ft: number | string | null;
  }>;

  const slabIds = lines.map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  const meta = new Map<string, { label: string | null; stone: string | null; l: number; w: number; t: number }>();
  if (slabIds.length) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, label, stone, length_ft, width_ft, thickness_ft")
      .in("id", slabIds);
    for (const s of (data ?? []) as Array<{ id: string; label: string | null; stone: string | null; length_ft: number | string; width_ft: number | string; thickness_ft: number | string }>) {
      meta.set(s.id, { label: s.label, stone: s.stone, l: Number(s.length_ft) || 0, w: Number(s.width_ft) || 0, t: Number(s.thickness_ft) || 0 });
    }
  }

  const slabs: WorkOrderPdfSlab[] = lines.map((l) => {
    const m = l.slab_requirement_id ? meta.get(l.slab_requirement_id) : null;
    return {
      code: l.slab_requirement_id ?? (l.description || "future need"),
      label: m?.label ?? l.description ?? null,
      stone: m?.stone ?? null,
      lengthIn: m?.l ?? (Number(l.planned_length_ft) || 0),
      widthIn: m?.w ?? (Number(l.planned_width_ft) || 0),
      thicknessIn: m?.t ?? (Number(l.planned_thickness_ft) || 0),
    };
  });

  const unit = wo.jobwork_unit === "sft" ? "sft" : wo.jobwork_unit === "job" ? "job" : "cft";
  const bytes = await buildWorkOrderPdf({
    woNumber: wo.wo_number,
    vendorName: wo.vendor_name,
    title: wo.title,
    temple: wo.temple,
    dateIso: wo.created_at,
    rate: wo.jobwork_rate != null ? Number(wo.jobwork_rate) : null,
    unit,
    slabs,
  });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${wo.wo_number}-workorder.pdf"`,
    },
  });
}
