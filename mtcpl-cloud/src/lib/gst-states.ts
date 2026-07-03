// Indian GST state codes (fixed list, 01–38 + territories). Used to auto-fill a
// client's State code from the State name, and to derive state + PAN from a
// GSTIN (first 2 chars = state code, next 10 = PAN). Fully offline — no API.
// Plain module (not "use client") so it's importable anywhere.

export const GST_STATE_BY_CODE: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "28": "Andhra Pradesh",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[.&]/g, "").replace(/\s+/g, " ");

// name → code. Built from the canonical map, plus a few common aliases/spellings.
const NAME_TO_CODE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [code, name] of Object.entries(GST_STATE_BY_CODE)) m[norm(name)] = code;
  Object.assign(m, {
    [norm("j&k")]: "01", [norm("jammu and kashmir")]: "01",
    [norm("uttaranchal")]: "05", [norm("new delhi")]: "07", [norm("nct of delhi")]: "07",
    [norm("orissa")]: "21", [norm("pondicherry")]: "34", [norm("puduchery")]: "34",
    [norm("andaman and nicobar")]: "35", [norm("andaman nicobar")]: "35",
    [norm("dadra and nagar haveli and daman and diu")]: "26", [norm("daman and diu")]: "26",
    [norm("dadra and nagar haveli")]: "26",
  });
  return m;
})();

/** GST state code for a state name (e.g. "Rajasthan" → "08"); null if unknown. */
export function codeForState(name: string | null | undefined): string | null {
  if (!name) return null;
  return NAME_TO_CODE[norm(name)] ?? null;
}

/** Canonical state name for a 2-digit GST code (e.g. "08" → "Rajasthan"). */
export function stateForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return GST_STATE_BY_CODE[code.trim().padStart(2, "0")] ?? null;
}

/** Parse a GSTIN into its encoded parts (no external lookup). Returns null if
 *  it doesn't look like a GSTIN. */
export function parseGstin(raw: string | null | undefined): { stateCode: string; state: string | null; pan: string } | null {
  const g = (raw ?? "").replace(/\s/g, "").toUpperCase();
  if (g.length < 12) return null;
  const stateCode = g.slice(0, 2);
  const pan = g.slice(2, 12);
  if (!/^\d{2}$/.test(stateCode)) return null;
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return null;
  return { stateCode, state: stateForCode(stateCode), pan };
}
