// ──────────────────────────────────────────────────────────────────
// Indian numbering-system to words.
// ──────────────────────────────────────────────────────────────────
// Converts a number like 308452.50 → "Three Lakh Eight Thousand Four
// Hundred Fifty-Two Rupees and Fifty Paise". Used on the payment
// voucher to produce the "Amount in Words" line that matches the
// way Indian bank advices and invoices read.
// ──────────────────────────────────────────────────────────────────

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigit(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]}-${ONES[u]}`;
}

function threeDigit(n: number): string {
  if (n === 0) return "";
  if (n < 100) return twoDigit(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return `${ONES[h]} Hundred${r ? ` ${twoDigit(r)}` : ""}`;
}

/** Indian-system spelling for amounts up to 99 crore. Returns just
 *  the number portion (e.g. "Three Lakh Twenty Thousand"). Use
 *  numberToIndianWords for the full "₹ Rupees and Paise" form. */
export function indianNumberWords(amount: number): string {
  const n = Math.floor(Math.abs(amount));
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${twoDigit(crore)} Crore`);
  if (lakh) parts.push(`${twoDigit(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigit(thousand)} Thousand`);
  if (rest) parts.push(threeDigit(rest));
  return parts.join(" ");
}

/** Full "Three Lakh Eight Thousand Four Hundred Fifty-Two Rupees
 *  and Fifty Paise" form. Handles the rupees + paise split for
 *  voucher printing. Zero amounts return "Zero Rupees". */
export function numberToIndianWords(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const sign = amount < 0 ? "Minus " : "";
  const abs = Math.abs(amount);
  const rupees = Math.floor(abs);
  // Round to 2 decimal places to avoid floating-point junk
  const paise = Math.round((abs - rupees) * 100);
  const rupeesWords = indianNumberWords(rupees) || "Zero";
  if (paise === 0) {
    return `${sign}${rupeesWords} Rupees`;
  }
  const paiseWords = twoDigit(paise);
  return `${sign}${rupeesWords} Rupees and ${paiseWords} Paise`;
}
