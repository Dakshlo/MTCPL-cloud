// ──────────────────────────────────────────────────────────────────
// The men working under a CNC vendor (mig 234).
//
// Daksh, Nov 2026: "eg i am mohit, i scan the qr code, enter otp, i see
// place where i can add operator eg shyam and his number. so next time
// shyam can also login from the login thing, his name will show under
// mohit."
//
// An operator is a tool-store identity and nothing more: a name, a
// number, and the vendor who vouched for them. It is NOT a profile, so
// it cannot sign in to the app, and it is created only by a vendor who
// is themselves holding a live OTP session at the cupboard. See the
// migration for why that line is drawn where it is.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type ToolOperator = {
  id: string;
  name: string;
  /** "•••••• 6785" — the whole number never leaves the server. */
  maskedPhone: string;
  vendorId: string;
  vendorName: string;
  /** The profile that vouched for this man. Used as `requested_by` on
   *  his sign-in code, since an operator has no profile of his own. */
  enrolledBy: string;
  createdAt: string;
};

/** Digits only. "+91 93520 16785" and "9352016785" are one number. */
export function phoneDigits(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

/** The ten digits that actually identify an Indian mobile, whatever
 *  country code somebody typed in front of them. Matches the unique
 *  index in mig 234, so the two can never disagree. */
export function phoneKey(raw: string): string {
  return phoneDigits(raw).slice(-10);
}

export function maskTail(raw: string): string {
  const d = phoneDigits(raw);
  return d.length >= 4 ? `•••••• ${d.slice(-4)}` : "their number";
}

/** A number is usable if it is a real ten-digit Indian mobile. The code
 *  has to arrive on it or the operator can never sign in. */
export function phoneProblem(raw: string): string | null {
  const d = phoneDigits(raw);
  const ten = d.slice(-10);
  if (ten.length < 10) return "That number is too short — give all 10 digits.";
  if (d.length > 13) return "That number is too long. Just the 10 digits.";
  if (!/^[6-9]/.test(ten)) return "An Indian mobile starts with 6, 7, 8 or 9.";
  return null;
}

type Row = {
  id: string;
  name: string;
  phone: string;
  vendor_id: string;
  enrolled_by: string;
  created_at: string;
  vendors: { name: string } | { name: string }[] | null;
};

function shape(r: Row): ToolOperator {
  const v = Array.isArray(r.vendors) ? r.vendors[0] ?? null : r.vendors;
  return {
    id: r.id,
    name: (r.name || "").trim(),
    maskedPhone: maskTail(r.phone),
    vendorId: r.vendor_id,
    vendorName: v?.name ?? "—",
    enrolledBy: r.enrolled_by,
    createdAt: r.created_at,
  };
}

// One literal, never split across a `+`: a concatenated select string
// collapses the PostgREST row type to GenericStringError and every
// field read off it stops compiling.
const OPERATOR_SELECT =
  "id, name, phone, vendor_id, enrolled_by, created_at, vendors(name)";

/** Everyone currently on a vendor's team. */
export async function operatorsForVendor(vendorId: string): Promise<ToolOperator[]> {
  if (!vendorId) return [];
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_operators")
    .select(OPERATOR_SELECT)
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("name");
  return ((data ?? []) as Row[]).map(shape);
}

/** Every live operator, for the roster and for the office's view of
 *  who can walk up to the cupboard. */
export async function allActiveOperators(): Promise<ToolOperator[]> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_operators")
    .select(OPERATOR_SELECT)
    .eq("is_active", true)
    .order("name");
  return ((data ?? []) as Row[]).map(shape);
}

export async function operatorById(id: string): Promise<ToolOperator | null> {
  if (!id) return null;
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("cnc_tool_operators")
    .select(OPERATOR_SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  return data ? shape(data as Row) : null;
}

/**
 * Is this number already somebody?
 *
 * Checked against BOTH tables on purpose. If a number belonged to a
 * profile and to an operator at once, the cupboard list would show two
 * names ringing one phone and whichever was tapped would sign in — so
 * the roster would be lying about who is standing there.
 *
 * Returns a sentence for the vendor to read, or null when the number is
 * free.
 */
export async function phoneAlreadyTaken(raw: string): Promise<string | null> {
  const key = phoneKey(raw);
  if (key.length < 10) return null; // phoneProblem() already said so

  const admin = createAdminSupabaseClient();

  const { data: ops } = await admin
    .from("cnc_tool_operators")
    .select("name, phone, is_active, vendors(name)")
    .eq("is_active", true);
  for (const o of (ops ?? []) as Array<{
    name: string; phone: string; vendors: { name: string } | { name: string }[] | null;
  }>) {
    if (phoneKey(o.phone) === key) {
      const v = Array.isArray(o.vendors) ? o.vendors[0] ?? null : o.vendors;
      return `That number is already ${o.name.trim()}${v ? `, under ${v.name}` : ""}.`;
    }
  }

  // Profiles are few (22 rows) and this runs once per enrolment, so a
  // scan beats an RPC. Comparing in JS, because the column holds
  // "919352016785" on some rows and "9352016785" on others.
  const { data: people } = await admin
    .from("profiles")
    .select("full_name, phone, is_active")
    .eq("is_active", true);
  for (const p of (people ?? []) as Array<{ full_name: string | null; phone: string | null }>) {
    if (p.phone && phoneKey(p.phone) === key) {
      return `That number is already ${(p.full_name || "someone").trim()}, who has their own login.`;
    }
  }

  return null;
}
