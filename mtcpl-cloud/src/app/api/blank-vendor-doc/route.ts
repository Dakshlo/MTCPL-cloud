// Blank company document (letterhead + terms + vendor signature) — a
// standalone printable PDF, not tied to any record. Owner/dev only.
import { requireAuth } from "@/lib/auth";
import { buildBlankVendorDoc } from "@/lib/blank-vendor-doc";

export const runtime = "nodejs";

const ALLOWED = ["owner", "developer"];

export async function GET() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }
  const pdf = await buildBlankVendorDoc();
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="MTCPL-blank-document.pdf"',
      "cache-control": "no-store",
    },
  });
}
