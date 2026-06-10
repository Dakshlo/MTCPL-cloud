// ──────────────────────────────────────────────────────────────────
// /api/email-snapshot/attachment?uid=N&index=K — stream one attachment
//
// Owner/developer only. Pulls a single attachment LIVE over read-only
// IMAP (never stored) and serves it inline so the owner can view or
// download the document attached to an email.
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchAttachment } from "@/lib/email-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function isOwnerSession(): Promise<boolean> {
  try {
    const { profile } = await requireAuth();
    return profile.role === "owner" || profile.role === "developer";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isOwnerSession())) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const uid = Number(sp.get("uid"));
  const index = Number(sp.get("index"));
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isInteger(index) || index < 0) {
    return new NextResponse("Bad request", { status: 400 });
  }
  try {
    const att = await fetchAttachment(uid, index);
    if (!att) {
      return new NextResponse("Attachment not found (or too large to serve).", { status: 404 });
    }
    // Sanitize the filename for the header.
    const safeName = att.filename.replace(/[\r\n"]/g, "_");
    return new NextResponse(new Uint8Array(att.content), {
      status: 200,
      headers: {
        "Content-Type": att.mime,
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Failed to load attachment.", { status: 500 });
  }
}
