// ──────────────────────────────────────────────────────────────────
// Passphrase hash + verify helpers for vendor private notes (mig 050)
// ──────────────────────────────────────────────────────────────────
// Uses Node's built-in crypto.scrypt — no new npm dependency.
//
// scrypt parameters (N=16384, r=8, p=1) follow the OWASP 2024
// guidance for password-equivalent hashing. KEYLEN=32 bytes (256-bit)
// is plenty against brute force.
//
// Salt is stored alongside the hash in system_settings (mig 050
// seeds a 16-byte random salt). Hash is hex-encoded for JSON safety.
//
// timingSafeEqual on the verify path avoids leaking timing
// information when the wrong passphrase is supplied.

import crypto from "node:crypto";

const KEYLEN = 32;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Returns the hex-encoded scrypt hash of `plain` salted by `saltHex`. */
export function hashPassphrase(plain: string, saltHex: string): string {
  const salt = Buffer.from(saltHex, "hex");
  const buf = crypto.scryptSync(plain, salt, KEYLEN, SCRYPT_OPTS);
  return buf.toString("hex");
}

/** Constant-time compare. Returns true iff the candidate plain
 *  passphrase hashes to the stored hex hash under the same salt. */
export function verifyPassphrase(
  plain: string,
  saltHex: string,
  expectedHashHex: string,
): boolean {
  if (!plain || !saltHex || !expectedHashHex) return false;
  let candidateHex: string;
  try {
    candidateHex = hashPassphrase(plain, saltHex);
  } catch {
    return false;
  }
  const a = Buffer.from(candidateHex, "hex");
  const b = Buffer.from(expectedHashHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Shape of the JSON blob stored under system_settings.key =
 *  'vendor_notes_password'. `hash === null` means "not set yet";
 *  the UI prompts the user to set one on first access. */
export type VendorNotesPasswordRow = {
  algo: string;
  salt: string;
  hash: string | null;
};
