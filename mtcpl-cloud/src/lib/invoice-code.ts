/**
 * Tax-invoice code helpers (Daksh, June 2026).
 *
 * The priced challan IS the tax invoice (mig 157). On the invoice we show it as
 * INV-<FY>-<n>, where FY is the Indian financial year (Apr–Mar) of the challan
 * date — e.g. a challan dated 2026-06-27 → FY 26/27 → "INV-26/27-12".
 */

/** "26/27" for a date in FY 2026-27 (Apr 2026 – Mar 2027). TZ-safe (parses
 *  the YYYY-MM-DD parts; no locale Date()). */
export function fyLabel(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const [y, m] = dateStr.split("-").map(Number);
  if (!y || !m) return null;
  const startYear = m >= 4 ? y : y - 1; // FY starts in April
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return `${a}/${b}`;
}

/** Trailing running number from a code like "CH-2026-12" → 12. */
function trailingNumber(code: string | null | undefined): number | null {
  if (!code) return null;
  const m = code.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/** INV-<FY>-<n> from a challan's number + date. Falls back to a plain CH→INV
 *  swap (then the raw code) when the date/number can't be parsed. */
export function invoiceCode(challanNumber: string | null | undefined, challanDate: string | null | undefined): string {
  const fy = fyLabel(challanDate);
  const n = trailingNumber(challanNumber);
  if (fy && n != null) return `INV-${fy}-${n}`;
  if (challanNumber) return challanNumber.replace(/^CH-/i, "INV-");
  return "—";
}
