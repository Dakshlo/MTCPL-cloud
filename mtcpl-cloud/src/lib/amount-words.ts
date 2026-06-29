// Indian-system amount → words for the tax invoice ("Rupees … Only").
// Uses crore / lakh / thousand grouping. Up to 999 crore (well past any invoice).

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below1000(n: number): string {
  let s = "";
  if (n >= 100) { s += `${ONES[Math.floor(n / 100)]} hundred`; n %= 100; if (n) s += " "; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; n %= 10; if (n) s += ` ${ONES[n]}`; }
  else if (n > 0) s += ONES[n];
  return s.trim();
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** e.g. 489256.94 → "Rupees Four Lakh Eighty Nine Thousand Two Hundred Fifty Six and Ninety Four Paise Only". */
export function amountInWordsIN(amount: number): string {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  let rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";

  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  const hundred = rupees;

  const parts: string[] = [];
  if (crore) parts.push(`${below1000(crore)} crore`);
  if (lakh) parts.push(`${below1000(lakh)} lakh`);
  if (thousand) parts.push(`${below1000(thousand)} thousand`);
  if (hundred) parts.push(below1000(hundred));

  let out = `Rupees ${titleCase(parts.join(" ").trim())}`;
  if (paise > 0) out += ` and ${titleCase(below1000(paise))} Paise`;
  return `${out} Only`;
}
