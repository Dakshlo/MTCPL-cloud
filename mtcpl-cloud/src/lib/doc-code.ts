// Unified document code (Mig 168). One per-FY number shared by a dispatch, its
// invoicing challan, and its tax invoice:
//   CH-26/27-01  (dispatch challan + invoicing challan)
//   INV-26/27-01 (tax invoice — SAME number)
// The financial year runs Apr–Mar and is shown as the two-digit "26/27".

/** Financial-year label for a date, e.g. 2026-06-29 → "26/27", 2027-02 → "26/27",
 *  2027-04 → "27/28". Accepts an ISO string or Date; defaults sanely on junk. */
export function financialYear(dateInput: string | Date): string {
  const d = typeof dateInput === "string" ? new Date(`${dateInput.length <= 10 ? `${dateInput}T00:00:00+05:30` : dateInput}`) : dateInput;
  if (Number.isNaN(d.getTime())) return "";
  // Use IST so a late-night dispatch doesn't slip into the wrong day/FY.
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear();
  const m = ist.getMonth() + 1; // 1–12
  const startYear = m >= 4 ? y : y - 1; // FY starts in April
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return `${a}/${b}`;
}

function pad(seq: number): string {
  return String(seq).padStart(2, "0");
}

/** "CH-26/27-01" from a stored doc_fy + doc_seq. Returns null if either is missing
 *  (caller falls back to the legacy code). */
export function challanCode(docFy: string | null | undefined, docSeq: number | null | undefined): string | null {
  if (!docFy || docSeq == null) return null;
  return `CH-${docFy}-${pad(docSeq)}`;
}

/** "INV-26/27-01" — same FY + number as the challan. */
export function invoiceCodeFromDoc(docFy: string | null | undefined, docSeq: number | null | undefined): string | null {
  if (!docFy || docSeq == null) return null;
  return `INV-${docFy}-${pad(docSeq)}`;
}
