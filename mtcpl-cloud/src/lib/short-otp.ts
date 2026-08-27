// ──────────────────────────────────────────────────────────────────
// Short login OTP — 4 easy digits instead of Supabase's random six.
//
// Daksh, Aug 2026: everyone here logs in on a DESKTOP, reading the
// code off a phone and typing it. Six random digits is the friction.
// He wants four, in an easy shape like 2299.
//
// ── The trade, recorded on purpose ────────────────────────────────
// This was a deliberate, informed decision, made after being shown
// the numbers twice. Patterned four-digit codes are a MUCH smaller
// haystack than Supabase's six random digits:
//
//     random 6-digit          1,000,000 codes
//     random 4-digit             10,000 codes
//     easy-shape 4-digit      ~300 codes   ← what this file makes
//
// With the 3-attempt cap that is roughly a 1-in-100 chance per code,
// against 1-in-333,000 before. Employee phone numbers are not secret,
// so the realistic attack is: request a code for a known number,
// guess three, request another. Everything below exists to make that
// grind as slow and as loud as it can be made:
//
//   • Widest set of shapes that are still genuinely easy to type
//     (~300, not the 90 that AABB alone would give).
//   • Verification happens SERVER-SIDE, so the 3-attempt cap is real
//     rather than a number the browser could ignore.
//   • A burned code costs the caller an escalating cooldown —
//     1 min, then 5, then 30, then 2 hours — so sustained guessing
//     collapses instead of running all night.
//   • Nothing is ever hard-deleted here; a spent code expires.
//
// ── Why the real code is kept, not replaced ───────────────────────
// Supabase generates and verifies its own six-digit code — we cannot
// change that, only what the human sees. So the hook stores a pair:
// the short code (hashed) and Supabase's real one. When the short
// code checks out, the server replays the REAL one to Supabase, which
// mints the session exactly as it always has. Supabase remains the
// only thing that ever issues a session.
//
// The real code stays valid too. If anything in this file fails, the
// six-digit code Supabase sent is still accepted and nobody is locked
// out — that is the point of the fallback, not an oversight.
// ──────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const KEY = "short_otp_pending";
/** A login code should not outlive the walk from phone to keyboard. */
const TTL_MS = 5 * 60 * 1000;
/** Wrong tries on one code before it is dead. */
export const MAX_ATTEMPTS = 3;
/** Cooldown after 1st, 2nd, 3rd, 4th+ burned code, in minutes. */
const COOLDOWN_MINUTES = [1, 5, 30, 120];
/** Cap on stored entries so a script cannot grow the row without bound. */
const MAX_ENTRIES = 300;

type Entry = {
  /** sha256 of the 4-digit code — never the code itself. */
  h: string;
  /** Supabase's real six-digit code, replayed on success. */
  real: string;
  /** issued at (ms) */
  at: number;
  /** wrong attempts so far on this code */
  n: number;
  /** how many codes this phone has burned in a row */
  burned: number;
  /** locked until (ms) — set when a code burns */
  until?: number;
};
type Store = Record<string, Entry>;

const digits = (p: string) => (p || "").replace(/\D/g, "");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Cryptographically uniform integer in [0, max). Modulo on a raw byte
 *  would bias the low values — small space, so bias actually matters. */
function randInt(max: number): number {
  return crypto.randomInt(0, max);
}

/**
 * A 4-digit code in one of the shapes a person would call easy.
 *
 * All FOUR families are used rather than just AABB, because every one
 * of them is equally easy to read off a phone and type — and four
 * families is ~300 codes against AABB's 90. Same convenience, three
 * times the haystack; there is no reason to take the smaller number.
 *
 *   AABB  2299    ABAB  2929    ABBA  2992    AAAA  2222
 *   plus ascending / descending runs: 3456, 6543
 */
export function generateEasyCode(): string {
  return EASY_CODES[randInt(EASY_CODES.length)];
}

/**
 * Every easy code, built once, so a draw can be UNIFORM over the whole
 * set.
 *
 * Picking a shape first and then its digits looks equivalent and is
 * not: the families are different sizes (AABB has 90 members, AAAA has
 * 10), so shape-first made each AAAA code about ten times likelier
 * than each AABB one. Against someone guessing, that is worse than it
 * sounds — they would try 1111, 2222, 3333 first and hit roughly six
 * times more often than the headline odds suggest. Drawing from the
 * flat list removes the edge entirely.
 */
const EASY_CODES: string[] = (() => {
  const out = new Set<string>();
  for (let a = 0; a < 10; a++) {
    out.add(`${a}${a}${a}${a}`);                       // AAAA — 10
    for (let b = 0; b < 10; b++) {
      if (a === b) continue;
      out.add(`${a}${a}${b}${b}`);                     // AABB — 90
      out.add(`${a}${b}${a}${b}`);                     // ABAB — 90
      out.add(`${a}${b}${b}${a}`);                     // ABBA — 90
    }
  }
  for (let s = 0; s < 10; s++) {                       // runs  — 20
    out.add([0, 1, 2, 3].map((i) => (s + i) % 10).join(""));
    out.add([0, 1, 2, 3].map((i) => (s - i + 10) % 10).join(""));
  }
  return [...out];
})();

async function readStore(): Promise<Store> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return data?.value && typeof data.value === "object" ? (data.value as Store) : {};
}

async function writeStore(store: Store): Promise<void> {
  const admin = createAdminSupabaseClient();
  const cutoff = Date.now() - TTL_MS;
  // Keep entries that are either live OR still serving a cooldown —
  // dropping a cooling-down phone would hand back its free attempts.
  const kept = Object.entries(store)
    .filter(([, v]) => v && (v.at > cutoff || (v.until ?? 0) > Date.now()))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ENTRIES);
  await admin.from("app_settings").upsert({
    key: KEY,
    value: Object.fromEntries(kept),
    updated_at: new Date().toISOString(),
  });
}

/** Is this phone in a cooldown from burning codes? Returns ms left. */
export async function cooldownRemaining(phone: string): Promise<number> {
  const k = digits(phone);
  if (!k) return 0;
  try {
    const e = (await readStore())[k];
    const left = (e?.until ?? 0) - Date.now();
    return left > 0 ? left : 0;
  } catch {
    return 0;
  }
}

/**
 * Called from the SMS hook. Mints the short code, remembers it against
 * Supabase's real one, and hands back what to send.
 *
 * Returns null on ANY failure — the caller then sends Supabase's own
 * six-digit code, which still works. A broken store must never mean a
 * login nobody can complete.
 */
export async function issueShortCode(phone: string, realOtp: string): Promise<string | null> {
  const k = digits(phone);
  if (!k || !realOtp) return null;
  try {
    const store = await readStore();
    const prev = store[k];
    // Still cooling down from burned codes? Send the real six-digit
    // one: the cooldown is on GUESSING, not on getting a code, and
    // the long code is the safer thing to hand out meanwhile.
    if ((prev?.until ?? 0) > Date.now()) return null;

    const code = generateEasyCode();
    store[k] = {
      h: sha(code),
      real: realOtp,
      at: Date.now(),
      n: 0,
      burned: prev?.burned ?? 0,
    };
    await writeStore(store);
    return code;
  } catch (err) {
    console.error("[short-otp] could not issue, falling back to the 6-digit:", err);
    return null;
  }
}

export type ShortVerify =
  | { ok: true; realOtp: string }
  | { ok: false; reason: "no_code" | "expired" | "wrong"; attemptsLeft: number; cooldownMs: number };

/**
 * Check a typed 4-digit code. On success hands back Supabase's real
 * code for the caller to replay; the entry is spent either way.
 *
 * The attempt count lives HERE, on the server, which is the whole
 * reason verification moved off the browser.
 */
export async function verifyShortCode(phone: string, typed: string): Promise<ShortVerify> {
  const k = digits(phone);
  const code = digits(typed);
  const miss = (reason: "no_code" | "expired" | "wrong", attemptsLeft = 0, cooldownMs = 0): ShortVerify =>
    ({ ok: false, reason, attemptsLeft, cooldownMs });
  if (!k || code.length !== 4) return miss("wrong", 0, 0);

  const store = await readStore();
  const e = store[k];
  if (!e) return miss("no_code");
  if ((e.until ?? 0) > Date.now()) return miss("wrong", 0, (e.until ?? 0) - Date.now());
  if (e.at < Date.now() - TTL_MS) return miss("expired");

  // Constant-time compare — the hashes are fixed length, so this is
  // safe to feed timingSafeEqual directly.
  const got = Buffer.from(sha(code), "hex");
  const want = Buffer.from(e.h, "hex");
  if (got.length === want.length && crypto.timingSafeEqual(got, want)) {
    delete store[k];
    await writeStore(store);
    return { ok: true, realOtp: e.real };
  }

  e.n += 1;
  if (e.n >= MAX_ATTEMPTS) {
    // Burn the code and start the cooldown. `burned` keeps climbing so
    // a sustained grind gets slower and slower rather than resetting.
    e.burned = (e.burned ?? 0) + 1;
    const mins = COOLDOWN_MINUTES[Math.min(e.burned - 1, COOLDOWN_MINUTES.length - 1)];
    e.until = Date.now() + mins * 60 * 1000;
    e.h = "";      // the code is dead — nothing left to guess against
    e.real = "";
    store[k] = e;
    await writeStore(store);
    return miss("wrong", 0, e.until - Date.now());
  }

  store[k] = e;
  await writeStore(store);
  return miss("wrong", MAX_ATTEMPTS - e.n, 0);
}
