/**
 * How many digits an in-app action code has (mig 226).
 *
 * Its own file with no imports on purpose: the number is needed by both
 * the server (lib/action-otp.ts, which pulls in node:crypto and the
 * admin Supabase client) and the "use client" panel that renders the
 * input. Importing the server module into the client bundle to reach
 * one constant would drag node:crypto in with it and fail the build.
 */
export const CODE_LENGTH = 3;
