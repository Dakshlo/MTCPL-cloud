/**
 * Dashboard view switcher (Daksh, Aug 2026) — sets the dash_view cookie
 * (classic | cockpit) and returns to /dashboard. Developer only; anyone
 * else is bounced without a cookie so the classic dashboard stays the
 * one and only view for every other user.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  const res = NextResponse.redirect(url);

  if (profile.role === "developer") {
    const to = req.nextUrl.searchParams.get("to") === "cockpit" ? "cockpit" : "classic";
    res.cookies.set("dash_view", to, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return res;
}
