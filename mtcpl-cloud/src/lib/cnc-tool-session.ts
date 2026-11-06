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
import { allActiveOperators, maskTail } from "@/lib/cnc-tool-operators";
import { canEnrolForAnyVendor, canSignInAtCupboard } from "@/lib/cnc-tool-permissions";

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
  /** May this session add somebody to a team? */
  canEnrol: boolean;
  /** WHOSE team. A vendor principal manages his own and only his own;
   *  the developer (Daksh, Nov 2026: "as a developer in my number when
   *  i login through qr i can also enroll operator under these 3
   *  vendors") picks the company each time. */
  enrolScope: "own" | "any" | null;
  expiresAt: string;
};

/** The companies a developer may enrol under: the ones with a vendor
 *  account of their own, which is the same set the roster heads. */
export async function enrollableVendors(): Promise<Array<{ id: string; name: string }>> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("profiles")
    .select("vendor_id, is_active, role, vendors(name)")
    .eq("role", "vendor")
    .eq("is_active", true)
    .not("vendor_id", "is", null);

  const rows = (data ?? []) as Array<{
    vendor_id: string | null;
    vendors: { name: string } | { name: string }[] | null;
  }>;

  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.vendor_id) continue;
    const v = Array.isArray(r.vendors) ? r.vendors[0] ?? null : r.vendors;
    out.set(r.vendor_id, v?.name ?? "—");
  }
  return [...out.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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
 * Their operators come from mig 234 and need no office involvement.
 *
 * Ordered company by company, each vendor at the head of his own men,
 * because that is how the man scanning thinks about it: he looks for
 * his boss's name and then for his own underneath it.
 *
 * Anyone without a usable phone is left out rather than shown as a dead
 * button: tapping a name that can never receive a code is worse than
 * not seeing the name.
 */
export async function toolRoster(): Promise<ToolPerson[]> {
  const admin = createAdminSupabaseClient();

  const [{ data: profileRows }, operators] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, role, phone, is_active, vendor_id, can_keep_tool_store, vendors(name)")
      // Vendors by role, keepers by flag. Narrowed here so the query
      // does not drag the whole staff list back; the real gate is the
      // filter below, which is the same function the action uses.
      .or("role.eq.vendor,role.eq.developer,can_keep_tool_store.is.true")
      .eq("is_active", true)
      .order("full_name"),
    allActiveOperators(),
  ]);

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

  const out: ToolPerson[] = [];
  const placed = new Set<string>();

  // A company at a time: the vendor, then his men.
  for (const { person, vendorId } of principals) {
    if (!vendorId) continue; // the developer — he goes at the end
    out.push(person);
    for (const op of operators.filter((o) => o.vendorId === vendorId)) {
      out.push({
        id: op.id,
        kind: "operator",
        name: op.name,
        maskedPhone: op.maskedPhone,
        company: op.vendorName,
        isPrincipal: false,
      });
      placed.add(op.id);
    }
  }

  // An operator whose vendor has no account of their own would otherwise
  // vanish off the list and be unable to sign in. Show them anyway.
  for (const op of operators) {
    if (placed.has(op.id)) continue;
    out.push({
      id: op.id,
      kind: "operator",
      name: op.name,
      maskedPhone: op.maskedPhone,
      company: op.vendorName,
      isPrincipal: false,
    });
  }

  // Then anyone with no company — the developer.
  for (const { person, vendorId } of principals) {
    if (!vendorId) out.push(person);
  }

  return out;
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
    canEnrol:
      !!row.profile_id &&
      (!!row.vendor_id || (!!prof && canEnrolForAnyVendor(prof as Parameters<typeof canEnrolForAnyVendor>[0]))),
    enrolScope: !row.profile_id
      ? null
      : row.vendor_id
        ? "own"
        : prof && canEnrolForAnyVendor(prof as Parameters<typeof canEnrolForAnyVendor>[0])
          ? "any"
          : null,
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
