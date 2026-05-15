// ──────────────────────────────────────────────────────────────────
// HDFC bulk-payment CSV builder
// ──────────────────────────────────────────────────────────────────
// Generates a CSV row in HDFC's "RBI File Format - NEFT RTGS" layout
// from one bill_payment + its bill + its vendor.
//
// Reference: the format spec PDF Daksh got from HDFC (May 2024),
// 28-column CSV, no header row, comma-delimited, .001 extension.
//
// Column layout (A → AB):
//    A  Transaction Type            R / N / I / M
//    B  Beneficiary Code            01,02,03 sequence (or vendor code)
//    C  Beneficiary Account Number  text — preserves leading zeros
//    D  Instrument Amount           rupees (no commas, no decimals
//                                   — HDFC's sample has whole rupees)
//    E  Beneficiary Name            ≤20 chars, CAPS, no specials
//    F  Drawee Location             blank
//    G  Print Location              blank
//    H  Bene Address 1              blank
//    I  Bene Address 2              blank
//    J  Bene Address 3              blank
//    K  Bene Address 4              blank
//    L  Bene Address 5              blank
//    M  Instruction Ref Number      ≤20 chars, no specials
//    N  Customer Reference Number   ≤20 chars, no specials
//    O  Payment details 1           free text (we use cost head)
//    P  Payment details 2           free text (we use description)
//    Q  Payment details 3           blank
//    R  Payment details 4           blank
//    S  Payment details 5           blank
//    T  Payment details 6           blank
//    U  Payment details 7           blank
//    V  Cheque Number               blank for NEFT/RTGS
//    W  Cheque Date                 DD/MM/YYYY (today, value date)
//    X  MICR NO                     blank
//    Y  IFSC COD                    vendor's IFSC
//    Z  BENE BANK                   vendor's bank name (CAPS)
//    AA Bene Bank Branch            blank (HDFC infers from IFSC)
//    AB Bene Email Id               vendor's email (specials OK here)

/** Strip every char HDFC bans: `/ \ - # @ % & ( ) _ , ' "` etc.
 *  Keeps a-z, A-Z, 0-9, space, period. Output is also UPPER-cased
 *  for the file-level "all caps" rule. */
export function sanitiseHdfcText(input: string | null | undefined, maxLen = 20): string {
  if (!input) return "";
  const upper = input.toString().toUpperCase().trim();
  // Replace special chars with space, then collapse multiple spaces.
  const cleaned = upper
    .replace(/[^A-Z0-9 .]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen);
}

/** Email: HDFC explicitly permits special chars here. Just trim + upper. */
function sanitiseEmail(input: string | null | undefined): string {
  if (!input) return "";
  return input.toString().trim().toUpperCase().slice(0, 80);
}

/** Strip dashes from a bill token so it fits HDFC's "no specials"
 *  rule on the reference columns. `T-2026-9` → `T20269`. */
function compactToken(token: string | null | undefined): string {
  if (!token) return "";
  return token.toString().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
}

/** DD/MM/YYYY — HDFC's expected date format. */
export function formatHdfcDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/** Map our payment_method enum / bill amount to HDFC's transaction
 *  type code. Indian convention for NEFT vs RTGS:
 *    - amount < ₹2,00,000 → NEFT (cheap, batched)
 *    - amount ≥ ₹2,00,000 → RTGS (real-time, gross)
 *  IMPS is "M", same-bank HDFC→HDFC is "I". For now we ignore those
 *  and just pick NEFT/RTGS by amount.
 */
export function chooseTxnType(amountInr: number): "N" | "R" {
  return amountInr >= 200000 ? "R" : "N";
}

export type HdfcExportRow = {
  /** Sequence within the file — 1, 2, 3, ... — used as Beneficiary
   *  Code (column B). HDFC accepts plain serial numbers. */
  seq: number;
  /** Vendor's HDFC-registered bene name (column E). Must already be
   *  set on the vendor by Daksh before export. */
  hdfcBeneName: string;
  /** Bank account number — text format to preserve leading zeros. */
  accountNumber: string;
  /** IFSC code, e.g. ICIC0000012. */
  ifsc: string;
  /** Bank name, e.g. ICIC BANK. */
  bankName: string;
  /** Bene email (optional). */
  beneEmail: string | null;
  /** Amount in INR — whole rupees, no commas, no decimals. */
  amountInr: number;
  /** Bill token, e.g. T-2026-9. We dash-strip for cols M+N. */
  billToken: string;
  /** Free text — typically the bill's cost head (col O). */
  costHead: string | null;
  /** Free text — bill description (col P). Truncated 20 chars. */
  description: string | null;
  /** Value date for the txn. Defaults to today. */
  valueDate: Date;
};

/** Build one CSV line (no trailing newline). 28 fields, comma-
 *  separated. Each field is wrapped in double-quotes for safety
 *  against embedded commas (HDFC accepts both quoted + unquoted). */
export function buildHdfcCsvRow(row: HdfcExportRow): string {
  const txnType = chooseTxnType(row.amountInr);
  const refToken = compactToken(row.billToken);

  // 28 fields, in HDFC's column order.
  const fields: string[] = [
    /* A */ txnType,
    /* B */ String(row.seq).padStart(2, "0"),
    /* C */ row.accountNumber.replace(/\D/g, ""),
    /* D */ String(Math.round(row.amountInr)),
    /* E */ sanitiseHdfcText(row.hdfcBeneName, 20),
    /* F */ "",
    /* G */ "",
    /* H */ "",
    /* I */ "",
    /* J */ "",
    /* K */ "",
    /* L */ "",
    /* M */ refToken,
    /* N */ refToken,
    /* O */ sanitiseHdfcText(row.costHead, 20),
    /* P */ sanitiseHdfcText(row.description, 20),
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
    /* AB */ sanitiseEmail(row.beneEmail),
  ];

  // Quote each field; escape embedded quotes by doubling.
  return fields
    .map((f) => `"${f.replace(/"/g, '""')}"`)
    .join(",");
}

/** Compose the full file body (no header row per HDFC's spec).
 *  Uses CRLF line endings — HDFC's example .001 files are
 *  Windows-format and their upload tool is sensitive. */
export function buildHdfcCsvFile(rows: HdfcExportRow[]): string {
  return rows.map(buildHdfcCsvRow).join("\r\n") + "\r\n";
}

/**
 * Filename per HDFC spec: {ClientCode}{DDMM}.001
 * Example from HDFC's docs: RT70RBI1810.001
 *
 * MTCPL's HDFC client code is currently a placeholder. Once HDFC
 * gives us the real code, swap the constant below and redeploy.
 * The file still uploads fine with any code — HDFC's tool just
 * uses the prefix for batch identification on their dashboard.
 */
export const HDFC_CLIENT_CODE = "MTCPLRBI"; // TODO confirm with HDFC

export function buildHdfcFilename(when: Date = new Date()): string {
  const dd = String(when.getDate()).padStart(2, "0");
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  return `${HDFC_CLIENT_CODE}${dd}${mm}.001`;
}
