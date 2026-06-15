// ──────────────────────────────────────────────────────────────────
// Material gate pass — print route.
//   GET /api/carving/gate-pass/<workOrderId>?slabs=CODE1,CODE2
// Returns a gate-pass PDF for the given slab codes (the batch leaving for
// the vendor). With no ?slabs it covers every slab currently OUT (sent) on
// the work order. Office roles only; opens inline for printing.
// ──────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildGatePassPdf, type GatePassPdfSlab } from "@/lib/gate-pass-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminSupabaseClient();

  const { data: woRow } = await admin
    .from("carving_work_orders")
    .select("wo_number, vendor_name, temple")
    .eq("id", id)
    .maybeSingle();
  if (!woRow) return new Response("Not found", { status: 404 });
  const wo = woRow as { wo_number: string; vendor_name: string; temple: string | null };

  // The lines of this work order (bound to a slab), to validate / collect codes.
  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("slab_requirement_id, line_status, position")
    .eq("work_order_id", id)
    .not("slab_requirement_id", "is", null)
    .order("position", { ascending: true });
  const woLines = (lineRows ?? []) as Array<{ slab_requirement_id: string | null; line_status: string }>;

  // ?slabs=CODE1,CODE2 → exactly that batch (filtered to lines that belong to
  // this WO). Otherwise: everything currently OUT at the vendor (sent).
  const requested = (req.nextUrl.searchParams.get("slabs") || "").split(",").map((s) => s.trim()).filter(Boolean);
  let codes: string[];
  if (requested.length) {
    const belongs = new Set(woLines.map((l) => l.slab_requirement_id).filter(Boolean) as string[]);
    codes = requested.filter((c) => belongs.has(c));
  } else {
    codes = woLines.filter((l) => l.line_status === "sent").map((l) => l.slab_requirement_id!).filter(Boolean);
  }
  if (codes.length === 0) return new Response("No slabs to include on the gate pass.", { status: 400 });

  const meta = new Map<string, { label: string | null; stone: string | null; l: number; w: number; t: number }>();
  for (let i = 0; i < codes.length; i += 500) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, label, stone, length_ft, width_ft, thickness_ft")
      .in("id", codes.slice(i, i + 500));
    for (const s of (data ?? []) as Array<{ id: string; label: string | null; stone: string | null; length_ft: number | string; width_ft: number | string; thickness_ft: number | string }>) {
      meta.set(s.id, { label: s.label, stone: s.stone, l: Number(s.length_ft) || 0, w: Number(s.width_ft) || 0, t: Number(s.thickness_ft) || 0 });
    }
  }

  const slabs: GatePassPdfSlab[] = codes.map((code) => {
    const m = meta.get(code);
    return { code, label: m?.label ?? null, stone: m?.stone ?? null, lengthIn: m?.l ?? 0, widthIn: m?.w ?? 0, thicknessIn: m?.t ?? 0 };
  });

  const issuedByName = (profile as { full_name?: string | null }).full_name ?? null;
  const bytes = await buildGatePassPdf({
    woNumber: wo.wo_number,
    vendorName: wo.vendor_name,
    temple: wo.temple,
    dateIso: new Date().toISOString(),
    issuedByName,
    slabs,
  });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${wo.wo_number}-gatepass.pdf"`,
    },
  });
}
