// ──────────────────────────────────────────────────────────────────
// /api/login-location — fire-and-forget login-location capture
// ──────────────────────────────────────────────────────────────────
// POST endpoint hit by the LoginLocationProbe client component once
// per browser session, right after a user lands in the app. Updates
// the user's profile row with:
//
//   • IP + IP-geo (always — captured from Vercel request headers)
//   • GPS lat/lng + accuracy (only if browser permission granted)
//   • Browser user agent (always — from request header)
//   • Last login timestamp (always)
//
// NEVER blocks anything. NEVER errors loud. If the user isn't
// authenticated, returns 401 silently. If the DB write fails,
// silently returns ok:false but logs server-side. The probe doesn't
// retry on failure.
//
// Privacy / consent:
//   - GPS coordinates only end up here if the browser prompt was
//     granted by the user (standard chrome/safari geolocation prompt).
//   - IP-level geo is captured automatically from Vercel headers —
//     this is unavoidable since every web request shows the client
//     IP. We just persist it.
//
// Migration 046 added the profile columns this route writes to.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type GpsStatus =
  | "granted"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unknown";

function safeStr(v: unknown, maxLen = 200): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function safeNum(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

/** Decode Vercel's percent-encoded geo headers (e.g. "Hyder%C4%81b%C4%81d"). */
function decodeHeader(v: string | null): string | null {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // ── Parse the optional client-side GPS payload ───────────────
    // Body is optional — older clients or denied-permission users
    // post empty/JSON-status only.
    let gpsLat: number | null = null;
    let gpsLng: number | null = null;
    let gpsAccuracy: number | null = null;
    let gpsStatus: GpsStatus = "unknown";
    try {
      const body = (await req.json().catch(() => null)) as {
        lat?: unknown;
        lng?: unknown;
        accuracy?: unknown;
        status?: unknown;
      } | null;
      if (body) {
        const status = safeStr(body.status, 40);
        if (
          status === "granted" ||
          status === "denied" ||
          status === "unavailable" ||
          status === "timeout" ||
          status === "unknown"
        ) {
          gpsStatus = status;
        }
        gpsLat = safeNum(body.lat);
        gpsLng = safeNum(body.lng);
        const acc = safeNum(body.accuracy);
        gpsAccuracy = acc != null ? Math.round(acc) : null;
      }
    } catch {
      // body parse fail — keep defaults
    }

    // ── IP + IP-geo from Vercel request headers ──────────────────
    // x-forwarded-for can list multiple IPs (proxy chain). Take the
    // first one as the originating client.
    const h = req.headers;
    const xff = h.get("x-forwarded-for");
    const ipFromVercel = h.get("x-vercel-forwarded-for");
    const realIp = h.get("x-real-ip");
    const rawIp = xff?.split(",")[0]?.trim() || ipFromVercel || realIp || null;
    const ip = safeStr(rawIp, 80);

    // Vercel adds these on every request — totally free, no API call.
    // https://vercel.com/docs/edge-network/headers#x-vercel-ip-country
    const country = decodeHeader(h.get("x-vercel-ip-country"));
    const region = decodeHeader(h.get("x-vercel-ip-country-region"));
    const city = decodeHeader(h.get("x-vercel-ip-city"));
    const ipLatStr = h.get("x-vercel-ip-latitude");
    const ipLngStr = h.get("x-vercel-ip-longitude");
    const ipLat = ipLatStr ? Number(ipLatStr) : NaN;
    const ipLng = ipLngStr ? Number(ipLngStr) : NaN;

    const userAgent = safeStr(h.get("user-agent"), 500);

    // ── Persist ──────────────────────────────────────────────────
    const admin = createAdminSupabaseClient();
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      last_login_at: now,
      last_login_user_agent: userAgent,
      last_login_gps_status: gpsStatus,
    };
    if (ip) update.last_login_ip = ip;
    if (country) update.last_login_country = safeStr(country, 8);
    if (region) update.last_login_region = safeStr(region, 80);
    if (city) update.last_login_city = safeStr(city, 80);
    if (Number.isFinite(ipLat)) update.last_login_ip_lat = ipLat;
    if (Number.isFinite(ipLng)) update.last_login_ip_lng = ipLng;
    if (gpsStatus === "granted" && gpsLat != null && gpsLng != null) {
      update.last_login_gps_lat = gpsLat;
      update.last_login_gps_lng = gpsLng;
      if (gpsAccuracy != null) update.last_login_gps_accuracy_m = gpsAccuracy;
    }

    const { error } = await admin
      .from("profiles")
      .update(update)
      .eq("id", user.id);
    if (error) {
      console.warn("[/api/login-location] db update failed", error.message);
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    // Catch-all so the route never crashes. Login flow continues
    // regardless.
    console.warn("[/api/login-location] unhandled", e);
    return NextResponse.json({ ok: false });
  }
}
