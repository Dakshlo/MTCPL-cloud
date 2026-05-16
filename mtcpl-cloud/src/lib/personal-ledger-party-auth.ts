/**
 * Migration 056 — Personal-ledger per-party PIN authentication.
 *
 * 4-digit PIN, scrypt-hashed at rest (`salt:hash` format), no
 * plaintext stored. Verification uses constant-time compare to
 * dodge timing attacks. PIN strength is intentionally weak (4
 * digits = 10,000 combos) — this is a "casual eyes" speedbump for
 * a personal-money tool, not a fortress. Brute-force resistance
 * relies on rate-limiting at the UI layer + the fact that you
 * already have to be authenticated as the owner of the party to
 * even see the unlock prompt.
 *
 * Unlock tokens are session cookies signed with HMAC-SHA256 using
 * an app secret. Cookie name pattern: `pl-unlock-<partyId>`. No
 * Max-Age → browser auto-clears when the browser session ends.
 * Within a session the same cookie is shared across tabs (we don't
 * try to defeat that — it's "all tabs in this browser" scope).
 */

import {
  scrypt as scryptCb,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 32;

/** Hash a PIN. Returns `salt:hexhash`. Never log the input. */
export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits.");
  }
  const salt = randomBytes(12).toString("hex");
  const hash = await scrypt(pin, salt, SCRYPT_KEYLEN);
  return `${salt}:${hash.toString("hex")}`;
}

/** Verify a PIN against a stored hash. Constant-time. */
export async function verifyPin(
  pin: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  if (!/^\d{4}$/.test(pin)) return false;
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = await scrypt(pin, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

/** App secret for HMAC-signing unlock cookies. Falls back through a
 *  small list of env vars so dev / preview / prod don't need an
 *  extra config step. Throws loudly if none are present so we never
 *  silently sign with an empty key. */
function getSigningSecret(): string {
  const candidates = [
    process.env.PERSONAL_LEDGER_PIN_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ];
  for (const c of candidates) {
    if (c && c.length >= 16) return c;
  }
  throw new Error(
    "No signing secret available. Set PERSONAL_LEDGER_PIN_SECRET, NEXTAUTH_SECRET, or SUPABASE_SERVICE_ROLE_KEY.",
  );
}

/** Build the unlock-cookie value: profileId.partyId.nonce.sig
 *  • profileId / partyId scope the cookie so a leaked cookie can't
 *    unlock a different user's party
 *  • nonce makes every issued cookie unique (defeats simple replay
 *    after a PIN change)
 *  • sig is HMAC over the rest with the app secret */
export function buildUnlockToken(profileId: string, partyId: string): string {
  const nonce = randomBytes(8).toString("hex");
  const payload = `${profileId}.${partyId}.${nonce}`;
  const sig = createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

/** Verify an unlock-cookie value. Returns true only if the
 *  signature checks out AND the profile/party scope matches. */
export function verifyUnlockToken(
  token: string | undefined,
  profileId: string,
  partyId: string,
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [pid, paid, nonce, sig] = parts;
  if (pid !== profileId || paid !== partyId) return false;
  const expected = createHmac("sha256", getSigningSecret())
    .update(`${pid}.${paid}.${nonce}`)
    .digest("hex");
  // Constant-time compare on equal-length hex strings.
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

/** Standard cookie name pattern. */
export function unlockCookieName(partyId: string): string {
  return `pl-unlock-${partyId}`;
}
