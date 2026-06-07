// Activity Register — proof viewer (Mig 101).
// Auth-gated (owner/dev) GET that mints a short-lived signed URL for the
// entry's proof file and 302-redirects to it. Keeps the bucket private and
// avoids minting a URL for every row of the list up front.
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Mig 104 — owner/dev + Tender Manager + senior_incharge + carving_head.
const ALLOWED = ["owner", "developer", "tender_manager", "senior_incharge", "carving_head"];
const PROOF_BUCKET = "activity_proofs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("activity_register")
    .select("proof_path")
    .eq("id", id)
    .maybeSingle();
  const path = (data as { proof_path?: string | null } | null)?.proof_path ?? null;
  if (!path) return new Response("No proof attached", { status: 404 });

  const { data: signed, error } = await admin.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !signed?.signedUrl) return new Response("Could not load proof", { status: 500 });

  return Response.redirect(signed.signedUrl, 302);
}
