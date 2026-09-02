/**
 * How many digits an in-app ACTION code has (mig 226) — currently 2.
 *
 * This is NOT the login code. Signing in still uses the 4-digit
 * easy-shape code in lib/short-otp.ts, which is untouched and stays
 * that way; the two are separate systems and only this one is short.
 *
 * Its own file with no imports on purpose: the number is needed by both
 * the server (lib/action-otp.ts, which pulls in node:crypto and the
 * admin Supabase client) and the "use client" panel that renders the
 * input. Importing the server module into the client bundle to reach
 * one constant would drag node:crypto in with it and fail the build.
 */
export const CODE_LENGTH = 2;
