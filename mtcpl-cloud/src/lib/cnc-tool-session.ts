// ──────────────────────────────────────────────────────────────────
// Who is standing at the wardrobe (mig 230).
//
// The QR used to take a typed name. Now it takes a person off a roster
// and proves it with a code sent to the number already on their profile,
// so the register is signed by something only they hold.
//
// The session this mints is NOT an app login. It carries exactly one
// right — record a take through this one sticker — and it is checked on
// every single take, server-side, against the database.
// ──────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** One shift. Long enough that a man is not re-typing a code all
 *  morning, short enough that a forgotten phone stops working today. */
export const SESSION_HOURS = 8;

/** Four digits — see the note in lib/action-otp.ts about why this one is
 *  not the two-digit action code. */
export const TOOL_OTP_DIGITS = 4;

/** The cookie is scoped to the guest route, so it is never sent to the
 *  rest of the app, and is per-sticker so one cupboard's session cannot
 *  be replayed at another. */
export const sessionCookieName = (token: string) => `tool_sess_${token.slice(0, 12)}`;

export type ToolPerson = {
  id: string;
  name: string;
  /** Null for a developer, who has no company of their own and picks. */
  vendorId: string | null;
  vendorName: string | null;
  /** "•••••• 6785" — never the whole number. */
  maskedPhone: string;
};

export type ToolSession = {
  id: string;
  profileId: string;
  name: string;
  vendorId: string | null;
  vendorName: string | null;
  expiresAt: string;
};

/**
 * The roster the QR screen shows.
 *
 * Daksh: "we will show all names mohit, manthan, vivek and in future i
 * will add also developer." That is exactly the two roles below, so
 * adding someone is giving them the role in Settings — no code change,
 * no list to maintain in two places.
 *
 * Anyone without a usable phone is left out rather than shown as a dead
 * button: tapping a name that can never receive a code is worse than not
 * seeing the name.
 */
export async function toolRoster(): Promise<ToolPerson[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role, phone, vendor_id, is_active, vendors(id, name)")
    .in("role", ["vendor", "developer"])
    .eq("is_active", true)
    .order("full_name");
  if (error) return [];

  type Row = {
    id: string; full_name: string | null; role: string; phone: string | null;
    vendor_id: string | null;
    vendors: { id: string; name: string } | { id: string; name: string }[] | null;
  };

  return ((data ?? []) as Row[])
    .filter((p) => (p.phone ?? "").replace(/\D/g, "").length >= 10)
    .map((p) => {
      const v = Array.isArray(p.vendors) ? p.vendors[0] ?? null : p.vendors;
      return {
        id: p.id,
        name: (p.full_name || "Unnamed").trim(),
        vendorId: p.vendor_id ?? null,
        vendorName: v?.name ?? null,
        maskedPhone: maskTail(p.phone ?? ""),
      };
    });
}

function maskTail(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length >= 4 ? `•••••• ${d.slice(-4)}` : "their number";
}

/** Mint a session after a code checks out. */
export async function startToolSession(opts: {
  profileId: string;
  linkId: string;
  vendorId: string | null;
}): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const token = randomBytes(24).toString("base64url");
  const { error } = await admin.from("cnc_tool_sessions").insert({
    token,
    profile_id: opts.profileId,
    link_id: opts.linkId,
    vendor_id: opts.vendorId,
    expires_at: new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(),
  });
  return error ? null : token;
}

/**
 * Read the session for this sticker off the cookie, if it is still good.
 *
 * Every field comes back from the database — the cookie holds only an
 * opaque token, so nothing the phone sends can change who it claims to
 * be or which company it takes for.
 */
export async function currentToolSession(linkToken: string, linkId: string): Promise<ToolSession | null> {
  const jar = await cookies();
  const raw = jar.get(sessionCookieName(linkToken))?.value;
  if (!raw) return null;

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_sessions")
    .select("id, profile_id, vendor_id, expires_at, revoked_at, link_id, profiles(full_name), vendors(name)")
    .eq("token", raw)
    .maybeSingle();
  if (!data) return null;

  const row = data as {
    id: string; profile_id: string; vendor_id: string | null;
    expires_at: string; revoked_at: string | null; link_id: string;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
    vendors: { name: string } | { name: string }[] | null;
  };

  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  // A session belongs to the sticker it was created at.
  if (row.link_id !== linkId) return null;

  const prof = Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles;
  const vend = Array.isArray(row.vendors) ? row.vendors[0] ?? null : row.vendors;

  return {
    id: row.id,
    profileId: row.profile_id,
    name: (prof?.full_name || "Unnamed").trim(),
    vendorId: row.vendor_id,
    vendorName: vend?.name ?? null,
    expiresAt: row.expires_at,
  };
}
