import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildCncAuditPdf } from "@/lib/cnc-audit-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const { profile } = await requireAuth();
    if (!["owner", "developer", "carving_head", "senior_incharge", "team_head", "tender_manager"].includes(profile.role)) {
      return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  try {
    const { bytes, totals, stamp } = await buildCncAuditPdf();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=MTCPL-CNC-Audit.pdf`,
        "Cache-Control": "no-store",
        "X-Audit-Totals": JSON.stringify({ ...totals, stamp }),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
