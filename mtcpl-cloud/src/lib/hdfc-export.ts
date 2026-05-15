// ──────────────────────────────────────────────────────────────────
// HDFC bulk-payment file builder (RBI format — NEFT / RTGS / IFT)
// ──────────────────────────────────────────────────────────────────
// Per Daksh (May 2026, after watching HDFC's walkthrough video):
//
//   Transaction Type (col A):
//     - HDFC → HDFC (IFSC starts with "HDFC") → I  (Internal)
//     - amount ≥ ₹2,00,000                    → R  (RTGS)
//     - otherwise                             → N  (NEFT)
//     M (IMPS) not used today.
//
//   Beneficiary Code (col B):
//     - Internal HDFC payments: bene's own account number
//     - Other banks: leave EMPTY
//
//   Bene Name (col E): vendor's hdfc_bene_name (≤20 chars, caps,
//     no special chars).
//
//   Reference cols (M, N): same value in both — auto-generated like
//     PARESHMAY2026 (vendor first-word + month + year), all caps,
//     truncated to 20 chars. Daksh wanted "anything like
//     vendormay2026" so the bank statement reads as a descriptive
//     vendor + period reference.
//
//   Cheque Date (col W): DD/MM/YYYY of the day the file is
//     generated.
//
//   IFSC (Y), Bank (Z): from vendor record. Email (AB): from
//     vendor record, with a single house default if the vendor
//     doesn't have one stored.
//
//   Filename: {ClientCode}{DD}{MM}.{NNN}
//     ClientCode is a 4-char prefix HDFC will assign to MTCPL —
//     placeholder "1111" until Daksh gets the real one.
//     NNN is a 3-digit sequence (001, 002, ...) — incremented for
//     each export within the same day, looked up from audit_logs.
//
//   Output format: .xlsx WITH header row for now (Daksh wants to
//     visually verify columns). Production mode (CSV with .001
//     extension, no header) toggles on once a real test upload is
//     confirmed.

import * as XLSX from "xlsx";

/** Strip every char HDFC bans: / \ - # @ % & ( ) _ , ' " etc. Keeps
 *  a-z, A-Z, 0-9, space, period. Output is also UPPER-cased. */
export function sanitiseHdfcText(
  input: string | null | undefined,
  maxLen = 20,
): string {
  if (!input) return "";
  const upper = input.toString().toUpperCase().trim();
  const cleaned = upper
    .replace(/[^A-Z0-9 .]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen);
}

/** Email: HDFC explicitly permits special chars here. */
function sanitiseEmail(input: string | null | undefined): string {
  if (!input) return "";
  return input.toString().trim().toUpperCase().slice(0, 80);
}

/** IST = UTC + 5:30. Returns DD / MM / YYYY components computed in
 *  Indian Standard Time regardless of where the server runs. Vercel
 *  runtime is UTC; without this offset the filename + Cheque Date
 *  would shift to yesterday whenever IST is past midnight but UTC
 *  is still on the previous day. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istParts(d: Date): {
  dd: string;
  mm: string;
  yyyy: string;
  monthShort: string;
} {
  // Shift the timestamp INTO IST, then read the UTC accessors —
  // those now reflect IST values. Cleaner than building a TZ-aware
  // Date.
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return {
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    yyyy: String(ist.getUTCFullYear()),
    monthShort: MONTHS_SHORT[ist.getUTCMonth()],
  };
}

/** DD/MM/YYYY in IST — HDFC's expected date format. */
export function formatHdfcDate(d: Date): string {
  const { dd, mm, yyyy } = istParts(d);
  return `${dd}/${mm}/${yyyy}`;
}

/** True when the IFSC starts with "HDFC" — used to decide if a row
 *  is an internal HDFC→HDFC transfer (txn type I) versus external
 *  NEFT/RTGS. */
function isHdfcIfsc(ifsc: string | null | undefined): boolean {
  if (!ifsc) return false;
  return ifsc.trim().toUpperCase().startsWith("HDFC");
}

/** Transaction Type for column A. */
export function chooseTxnType(
  amountInr: number,
  ifsc: string | null | undefined,
): "I" | "N" | "R" {
  if (isHdfcIfsc(ifsc)) return "I"; // intra-HDFC
  return amountInr >= 200000 ? "R" : "N";
}

/** Beneficiary Code for column B. Empty for external transfers;
 *  bene's account number for internal HDFC transfers. */
export function buildBeneCode(
  ifsc: string | null | undefined,
  accountNumber: string,
): string {
  if (isHdfcIfsc(ifsc)) {
    return accountNumber.replace(/\D/g, "").slice(0, 20);
  }
  return "";
}

/** Reference number for cols M + N. Format: first-word of bene
 *  name + month-short + year, all caps, ≤20 chars. E.g.
 *    bene "PARESH KMR ENT", date May 15 2026 → "PARESHKMRENMAY2026"
 *    bene "PACETAL", date Oct 03 2026         → "PACETALOCT2026"
 *  Daksh's intent: a descriptive reference so bank statement lines
 *  read as `<vendor-ish> <period>`. Same value goes to both M and N
 *  per HDFC sample (their sample has "BANK CHARGES" in both). */
export function buildReferenceNumber(beneName: string, valueDate: Date): string {
  const firstWord = (beneName.split(/\s+/)[0] || "VENDOR")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  // Use IST parts so a download at 1 AM IST May 1 reads "MAY2026",
  // not "APR2026" (which is what UTC server time would say).
  const { monthShort, yyyy } = istParts(valueDate);
  // Reserve 7 chars for MMMYYYY (e.g. MAY2026), so vendor portion
  // is at most 13 chars. Total ≤20.
  return (firstWord.slice(0, 13) + monthShort + yyyy).slice(0, 20);
}

/** Fallback email used when a vendor row has no email of its own.
 *  Confirmed by Daksh on 15 May 2026 — his personal Gmail handles
 *  bounce-backs for HDFC payment notifications. */
export const DEFAULT_BENE_EMAIL = "DASKHLOHAR0097@GMAIL.COM";

/** Client code prefix on the filename. HDFC assigned this to MTCPL
 *  on 15 May 2026 — per Daksh, code is "5604". This becomes the
 *  4-char prefix on every payment file: e.g. `56041505.001` for
 *  May 15's first file of the day. */
export const HDFC_CLIENT_CODE = "5604";

/** Build the filename per HDFC spec: {ClientCode}{DD}{MM}.{NNN}
 *  e.g. 11111505.001 — for May 15, first file of the day.
 *  NNN is the 3-digit sequence within the day (caller supplies). */
export function buildHdfcFilename(
  when: Date,
  daySequence: number,
  extension: "001" | "002" | "xlsx" = "001",
): string {
  // IST parts — see istParts() above. Without this, a download at
  // 2 AM IST May 15 would name the file 56041405.001 (May 14 UTC)
  // instead of 56041505.001 (May 15 IST).
  const { dd, mm } = istParts(when);
  const seq = String(daySequence).padStart(3, "0");
  if (extension === "xlsx") {
    return `${HDFC_CLIENT_CODE}${dd}${mm}-${seq}.xlsx`;
  }
  return `${HDFC_CLIENT_CODE}${dd}${mm}.${seq}`;
}

// ── Column headers (kept in xlsx testing mode for visual check) ───
export const HDFC_HEADERS: readonly string[] = [
  /* A  */ "Transaction Type",
  /* B  */ "Beneficiary Code",
  /* C  */ "Beneficiary Account Number",
  /* D  */ "Instrument Amount",
  /* E  */ "Beneficiary Name",
  /* F  */ "Drawee Location",
  /* G  */ "Print Location",
  /* H  */ "Bene Address 1",
  /* I  */ "Bene Address 2",
  /* J  */ "Bene Address 3",
  /* K  */ "Bene Address 4",
  /* L  */ "Bene Address 5",
  /* M  */ "Instruction Reference Number",
  /* N  */ "Customer Reference Number",
  /* O  */ "Payment details 1",
  /* P  */ "Payment details 2",
  /* Q  */ "Payment details 3",
  /* R  */ "Payment details 4",
  /* S  */ "Payment details 5",
  /* T  */ "Payment details 6",
  /* U  */ "Payment details 7",
  /* V  */ "Cheque Number",
  /* W  */ "Cheque Date",
  /* X  */ "MICR NO",
  /* Y  */ "IFSC COD",
  /* Z  */ "BENE BANK",
  /* AA */ "Bene Bank Bracnh", // sic — HDFC's template has this typo
  /* AB */ "Bene Emai Id", // sic — HDFC's template has this typo
];

export type HdfcExportRow = {
  hdfcBeneName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  beneEmail: string | null;
  amountInr: number;
  valueDate: Date;
};

/** Turn one input row into a 28-cell array in HDFC's column order. */
export function buildHdfcRowCells(row: HdfcExportRow): string[] {
  const txnType = chooseTxnType(row.amountInr, row.ifsc);
  const beneCode = buildBeneCode(row.ifsc, row.accountNumber);
  const beneName = sanitiseHdfcText(row.hdfcBeneName, 20);
  const reference = buildReferenceNumber(beneName || row.hdfcBeneName, row.valueDate);
  const email = sanitiseEmail(row.beneEmail) || DEFAULT_BENE_EMAIL;

  return [
    /* A */ txnType,
    /* B */ beneCode,
    /* C */ row.accountNumber.replace(/\D/g, ""),
    /* D */ String(Math.round(row.amountInr)),
    /* E */ beneName,
    /* F */ "",
    /* G */ "",
    /* H */ "",
    /* I */ "",
    /* J */ "",
    /* K */ "",
    /* L */ "",
    /* M */ reference,
    /* N */ reference,
    /* O */ "",
    /* P */ "",
    /* Q */ "",
    /* R */ "",
    /* S */ "",
    /* T */ "",
    /* U */ "",
    /* V */ "",
    /* W */ formatHdfcDate(row.valueDate),
    /* X */ "",
    /* Y */ sanitiseHdfcText(row.ifsc, 20),
    /* Z */ sanitiseHdfcText(row.bankName, 40),
    /* AA */ "",
    /* AB */ email,
  ];
}

// ── XLSX output (testing mode — keeps header so Daksh can verify) ─
export function buildHdfcXlsxBuffer(rows: HdfcExportRow[]): Buffer {
  const wb = XLSX.utils.book_new();
  const data: (string | number)[][] = [
    [...HDFC_HEADERS],
    ...rows.map((r) => buildHdfcRowCells(r)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Force every cell to TEXT type so leading zeros in account
  // numbers don't get nuked by Excel auto-numerification on open.
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        cell.t = "s";
        if (cell.v != null) cell.v = String(cell.v);
      }
    }
  }
  // Reasonable widths so the file looks tidy when Daksh opens it.
  ws["!cols"] = HDFC_HEADERS.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── CSV output (production mode — no header, .001 extension) ──────
/** Build one CSV line from a row. Each field is wrapped in double
 *  quotes; embedded quotes are escaped by doubling. */
export function buildHdfcCsvRow(row: HdfcExportRow): string {
  const cells = buildHdfcRowCells(row);
  return cells.map((f) => `"${f.replace(/"/g, '""')}"`).join(",");
}

/** Compose the full CSV file body. No header per HDFC spec.
 *  CRLF line endings — HDFC's upload tool is Windows-native. */
export function buildHdfcCsvFile(rows: HdfcExportRow[]): string {
  return rows.map(buildHdfcCsvRow).join("\r\n") + "\r\n";
}
