// ──────────────────────────────────────────────────────────────────
// Mig 087 — component image route (the inventory-speed fix).
// ──────────────────────────────────────────────────────────────────
// Serves a scaffolding component's uploaded photo as a real image
// file with a long cache, instead of inlining ~200 KB of base64 into
// every inventory page's HTML. The board / add-stock loaders now emit
// a tiny URL (this route + ?v=updated_at) and the browser caches the
// bytes — so the HTML payload drops from megabytes to kilobytes and
// the image is fetched once, not re-sent on every page render.
//
// The image lives as a base64 data URL in scaffolding_components.
// image_data_url; we decode it back to bytes here. The ?v= query
// (the component's updated_at) busts the cache when the photo changes.
// ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Must be signed in — the route follows the browser's session cookie
  // (the <img> request carries it). Component icons aren't sensitive,
  // but we keep it consistent with the rest of the app.
  await requireAuth();

  const { id } = await params;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("scaffolding_components")
    .select("image_data_url")
    .eq("id", id)
    .maybeSingle();

  const dataUrl = (data as { image_data_url: string | null } | null)?.image_data_url;
  if (error || !dataUrl) {
    return new NextResponse(null, { status: 404 });
  }

  // data:<mime>;base64,<payload>
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl));
  if (!m) return new NextResponse(null, { status: 404 });

  const mime = m[1];
  const bytes = Buffer.from(m[2], "base64");
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": mime,
      // URL is versioned by ?v=updated_at, so the bytes for a given
      // URL never change → safe to cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(bytes.length),
    },
  });
}
