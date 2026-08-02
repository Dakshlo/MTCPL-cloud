/**
 * CNC machine codes are usually bare numbers ("10"), which read as a
 * quantity wherever they appear. Prefix those with "No." so a machine
 * always reads as a machine (Daksh, Aug 2026). Codes that already carry
 * letters — "CNC-3", "M12" — are left exactly as entered.
 *
 * Plain module (no "use client"): imported by both the server lookup
 * action and the client Find ID panel.
 */
export function machineNoLabel(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  return /^\d+$/.test(c) ? `No. ${c}` : c;
}
