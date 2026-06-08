// Maintenance ticket photo viewer (Mig 108–109).
// Owner/dev gated GET that mints a short-lived signed URL for the ticket's
// problem or done photo and 302-redirects to it. Keeps the bucket private.
//   GET /api/maintenance/proof/[id]?which=problem|done
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ALLOWED = ["owner", "developer"];
const PROOF_BUCKET = "maintenance_proofs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const which = new URL(req.url).searchParams.get("which") === "done" ? "done" : "problem";
  const col = which === "done" ? "done_photo_path" : "problem_photo_path";

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("machine_maintenance_tickets")
    .select(col)
    .eq("id", id)
    .maybeSingle();
  const path = (data as Record<string, string | null> | null)?.[col] ?? null;
  if (!path) return new Response("No photo attached", { status: 404 });

  const { data: signed, error } = await admin.storage.from(PROOF_BUCKET).createSignedUrl(path, 300);
  if (error || !signed?.signedUrl) return new Response("Could not load photo", { status: 500 });
  return Response.redirect(signed.signedUrl, 302);
}
