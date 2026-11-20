// ──────────────────────────────────────────────────────────────────
// Who is standing at the wardrobe (migs 230 + 234).
//
// The QR used to take a typed name. Now it takes a person off a roster
// and proves it with a code sent to the number already on record, so
// the register is signed by something only they hold.
//
// Mig 234 — that roster is two kinds of person now:
//
//   a PROFILE   Mohit, Manthan, Vivek, and the developer. Real app
//               accounts; the number comes off their profile row.
//   an OPERATOR Shyam, working under Mohit. A tool-store-only identity
//               the vendor enrolled himself. No app login, ever.
//
// Both sign the register the same way and both appear under the company
// they belong to. The difference only matters in two places: an
// operator cannot enrol anyone, and an operator cannot log in anywhere
// else in the world.
//
// The session this mints is NOT an app login either. It carries exactly
// one right — record a take through this one sticker — and it is
// checked on every single take, server-side, against the database.
// ──────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { maskTail } from "@/lib/cnc-tool-operators";
import {
  canKeepAtCupboard,
  canSignInAtCupboard,
} from "@/lib/cnc-tool-permissions";

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

export type PersonKind = "profile" | "operator";

export type ToolPerson = {
  id: string;
  kind: PersonKind;
  name: string;
  /** "•••••• 6785" — never the whole number. */
  maskedPhone: string;
  /** The company. Null for the developer, who works for the plant. */
  company: string | null;
  /** True for the man whose company it is — he heads his own group on
   *  the roster and he is the one who can enrol. */
  isPrincipal: boolean;
};

export type ToolSession = {
  id: string;
  kind: PersonKind;
  /** Exactly one of these two is set — mig 234 has the database
   *  enforcing it, not just this type. */
  profileId: string | null;
  operatorId: string | null;
  name: string;
  vendorId: string | null;
  vendorName: string | null;

  /** May this person fill the shelf from the cupboard itself — add a
   *  tool, add stock, fix a count? The office three, and nobody else.
   *  Daksh, Nov 2026: "so i can directly maintain or add stock from
   *  phone only." */
  canKeep: boolean;

  expiresAt: string;
};

/**
 * The roster the QR screen shows.
 *
 * Daksh: "we will show all names mohit, manthan, vivek and in future i
 * will add also developer" — and then, Nov 2026, "in that qr login i
 * dont see vinay and nikhil."
 *
 * So the list is: the CNC vendors, and whoever keeps the store. Not a
 * list of roles, which is what left the two owners off — the rule is
 * canSignInAtCupboard(), the same one the sign-in action re-checks.
 *
 * ── Operators are no longer on it (Nov 2026) ──────────────────────
 *
 * Mig 234 gave each vendor's men a tile of their own and a code to
 * their own number. Daksh has taken it back out: "that login module we
 * made so vendors' operators can also login — remove that thing. If a
 * vendor's operator wants access they will click on their respective
 * vendor, eg Vivek, then his operator will click on Vivek and take the
 * OTP from Vivek. No separate thing for them."
 *
 * Which is how the shed actually works. The vendor is on site with his
 * men and the code reaches his phone; a second identity per man bought
 * nothing the vendor's own name did not already cover, and cost a
 * screen, an enrolment form and a phone number per person to maintain.
 *
 * What this means for the register: a take now says MOHIT, not Shyam.
 * The firm is accountable, which is the relationship the company
 * actually has — the men are Mohit's, not ours.
 *
 * Nothing is dropped from the database. cnc_tool_operators and the
 * taken_by_operator_id column stay exactly as they are, so the handful
 * of takes ever signed by an operator still read correctly in history.
 * They are simply never written again.
 *
 * Anyone without a usable phone is left out rather than shown as a dead
 * button: tapping a name that can never receive a code is worse than
 * not seeing the name.
 */
export async function toolRoster(): Promise<ToolPerson[]> {
  const admin = createAdminSupabaseClient();

  const { data: profileRows } = await admin
    .from("profiles")
    .select("id, full_name, role, phone, is_active, vendor_id, can_keep_tool_store, vendors(name)")
    // Vendors by role, keepers by flag. Narrowed here so the query
    // does not drag the whole staff list back; the real gate is the
    // filter below, which is the same function the action uses.
    .or("role.eq.vendor,role.eq.developer,can_keep_tool_store.is.true")
    .eq("is_active", true)
    .order("full_name");

  type Row = {
    id: string;
    full_name: string | null;
    role: string;
    phone: string | null;
    vendor_id: string | null;
    can_keep_tool_store: boolean | null;
    vendors: { name: string } | { name: string }[] | null;
  };

  const principals = ((profileRows ?? []) as Row[])
    .filter((p) => canSignInAtCupboard(p as Parameters<typeof canSignInAtCupboard>[0]))
    .filter((p) => (p.phone ?? "").replace(/\D/g, "").length >= 10)
    .map((p) => {
      const v = Array.isArray(p.vendors) ? p.vendors[0] ?? null : p.vendors;
      return {
        person: {
          id: p.id,
          kind: "profile" as const,
          name: (p.full_name || "Unnamed").trim(),
          maskedPhone: maskTail(p.phone ?? ""),
          company: v?.name ?? null,
          isPrincipal: !!p.vendor_id,
        },
        vendorId: p.vendor_id,
      };
    });

  // The companies first, then the office — a man scanning this looks
  // for his firm's name, and the office three are not what he is after.
  return [
    ...principals.filter((p) => p.vendorId).map((p) => p.person),
    ...principals.filter((p) => !p.vendorId).map((p) => p.person),
  ];
}

/** Mint a session after a code checks out. Exactly one of profileId /
 *  operatorId, which the database also insists on. */
export async function startToolSession(opts: {
  profileId?: string | null;
  operatorId?: string | null;
  linkId: string;
  vendorId: string | null;
}): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const token = randomBytes(24).toString("base64url");
  const { error } = await admin.from("cnc_tool_sessions").insert({
    token,
    profile_id: opts.profileId ?? null,
    operator_id: opts.operatorId ?? null,
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
 * be, which company it takes for, or whether it may enrol anybody.
 */
export async function currentToolSession(
  linkToken: string,
  linkId: string,
): Promise<ToolSession | null> {
  const jar = await cookies();
  const raw = jar.get(sessionCookieName(linkToken))?.value;
  if (!raw) return null;

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_sessions")
    .select("id, profile_id, operator_id, vendor_id, expires_at, revoked_at, link_id, profiles(full_name, is_active, vendor_id, role, can_keep_tool_store), cnc_tool_operators(name, is_active, vendor_id), vendors(name)")
    .eq("token", raw)
    .maybeSingle();
  if (!data) return null;

  const row = data as {
    id: string;
    profile_id: string | null;
    operator_id: string | null;
    vendor_id: string | null;
    expires_at: string;
    revoked_at: string | null;
    link_id: string;
    profiles: ProfileSide | ProfileSide[] | null;
    cnc_tool_operators: OperatorSide | OperatorSide[] | null;
    vendors: { name: string } | { name: string }[] | null;
  };

  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  // A session belongs to the sticker it was created at.
  if (row.link_id !== linkId) return null;

  const prof = one(row.profiles);
  const op = one(row.cnc_tool_operators);
  const vend = one(row.vendors);

  // Switched off since sign-in? The session dies with the person. This
  // is why removing an operator takes effect at once rather than at the
  // end of his shift.
  if (row.profile_id) {
    if (!prof || prof.is_active === false) return null;
  } else {
    if (!op || op.is_active === false) return null;
  }

  const name = row.profile_id
    ? (prof?.full_name || "Unnamed").trim()
    : (op?.name || "Unnamed").trim();

  return {
    id: row.id,
    kind: row.profile_id ? "profile" : "operator",
    profileId: row.profile_id,
    operatorId: row.operator_id,
    name,
    vendorId: row.vendor_id,
    vendorName: vend?.name ?? null,
    // A vendor principal manages his own men. Anyone who keeps the
    // store — the developer, Nikhil, Vinay — manages all three teams
    // and picks the company each time. An operator can never grow a
    // team of his own: that is the one thing the two kinds of signer
    // genuinely differ on.
    canKeep:
      !!row.profile_id &&
      !!prof &&
      canKeepAtCupboard(prof as Parameters<typeof canKeepAtCupboard>[0], {
        hasOwnCompany: !!row.vendor_id,
      }),

    expiresAt: row.expires_at,
  };
}

type ProfileSide = {
  full_name: string | null;
  is_active: boolean;
  vendor_id: string | null;
  role: string;
  can_keep_tool_store: boolean | null;
};
type OperatorSide = { name: string | null; is_active: boolean; vendor_id: string | null };

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}
