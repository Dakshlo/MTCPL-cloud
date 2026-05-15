// ──────────────────────────────────────────────────────────────────
// Payment voucher PDF generator
// ──────────────────────────────────────────────────────────────────
// Single-page A4 PDF built with pdf-lib. Mirrors the on-screen
// voucher (src/app/(app)/accounts/payments/[id]/voucher/voucher-view.tsx)
// layout so a vendor opening the emailed PDF sees the same thing
// the accountant sees inside MTCPL Cloud.
//
// Layout (matches on-screen voucher):
//   • Logo centred at top
//   • Company name + address (centred)
//   • Horizontal divider
//   • "PAYMENT VOUCHER" title (centred, larger)
//   • Two-column label : value list (with yellow-highlight boxes
//     around Token / UTR / Amount)
//   • Salutation paragraph
//   • Bill Description box (cream background, bordered)
//   • Two-column signature blocks (PREPARED BY + AUTHORISED SIGNATORY)
//   • Footer note (computer-generated, generation timestamp)
//
// Logo: embedded from /public/MTCPL-Final-logo-2 copy 2.png at
// build time. Loaded via fs in node runtime — Vercel bundles
// /public into the serverless function so this works there too.

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type VoucherPdfInput = {
  company: {
    name: string;
    addressLines: string[];
  };
  vendor: {
    name: string;
    address: string | null;
    gstin: string | null;
    pan: string | null;
    bankAccount: string | null;
    ifsc: string | null;
  };
  bill: {
    token: string;
    vendorBillNo: string;
    billDate: string; // ISO
    description: string;
    costHead: string | null;
  };
  payment: {
    paymentId: string;
    paidAmount: number;
    paymentMethod: string | null;
    paymentReference: string | null;
    paymentNote: string | null;
    paidAt: string | null; // ISO
    paidByName: string | null;
  };
  amountInWords: string;
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_X = 50;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 36;

// Colours sampled from the on-screen voucher
const COLOR_TEXT = rgb(0.067, 0.067, 0.067); // #111
const COLOR_MUTED = rgb(0.4, 0.4, 0.4); // #666
const COLOR_DIVIDER = rgb(0.13, 0.13, 0.13); // ~#222
const COLOR_HIGHLIGHT_BG = rgb(1, 0.953, 0.8); // #fff3cd
const COLOR_DESC_BG = rgb(0.976, 0.969, 0.945); // #f9f7f1
const COLOR_DESC_BORDER = rgb(0.867, 0.839, 0.761); // #ddd6c2

function fmtINR(n: number): string {
  // 2 decimal places, Indian thousands separator (2,3,3 grouping)
  const fixed = Math.round(n * 100) / 100;
  const [intPart, decPart] = fixed.toFixed(2).split(".");
  // Apply Indian comma grouping: last 3 digits, then groups of 2.
  let formatted = "";
  let s = intPart;
  if (s.length > 3) {
    formatted = "," + s.slice(-3);
    s = s.slice(0, -3);
    while (s.length > 2) {
      formatted = "," + s.slice(-2) + formatted;
      s = s.slice(0, -2);
    }
    formatted = s + formatted;
  } else {
    formatted = s;
  }
  return `₹${formatted}.${decPart}`;
}

function fmtDateIST(iso: string | null, format: "short" | "long" = "short"): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    // IST = UTC+5:30 — shift then read UTC accessors.
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(ist.getUTCFullYear());
    if (format === "long") {
      const months = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December",
      ];
      return `${dd} ${months[ist.getUTCMonth()]} ${yyyy}`;
    }
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return "—";
  }
}

function fmtVoucherNo(paymentId: string, paidAtIso: string | null): string {
  // Matches formatVoucherNo() in voucher-view.tsx:446 — same format
  // so the emailed PDF's Voucher No matches what shows on-screen.
  const d = paidAtIso ? new Date(paidAtIso) : new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(ist.getUTCFullYear()).slice(2);
  const short = paymentId.replace(/-/g, "").slice(-6).toUpperCase();
  return `MTCPL/${dd}${mm}${yy}/${short}`;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Read the company logo PNG from /public. Cached at module level
 *  so multiple PDFs in the same serverless invocation share the
 *  embed. Returns null if the file is unreadable (logo is optional
 *  — voucher still renders without it). */
let cachedLogoBytes: Uint8Array | null = null;
let logoLoadAttempted = false;
async function loadLogoBytes(): Promise<Uint8Array | null> {
  if (logoLoadAttempted) return cachedLogoBytes;
  logoLoadAttempted = true;
  try {
    const logoPath = path.join(
      process.cwd(),
      "public",
      "MTCPL-Final-logo-2 copy 2.png",
    );
    cachedLogoBytes = await readFile(logoPath);
    return cachedLogoBytes;
  } catch (e) {
    console.warn("[voucher-pdf] logo not loaded", e);
    return null;
  }
}

export async function buildVoucherPdf(input: VoucherPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Payment voucher ${input.bill.token}`);
  doc.setAuthor(input.company.name);
  doc.setSubject("Payment Voucher");

  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontIta = await doc.embedFont(StandardFonts.HelveticaOblique);
  const fontMono = await doc.embedFont(StandardFonts.Courier);
  const fontMonoBold = await doc.embedFont(StandardFonts.CourierBold);

  // Try to embed logo (optional — voucher still renders without it).
  let logoImage: PDFImage | null = null;
  const logoBytes = await loadLogoBytes();
  if (logoBytes) {
    try {
      logoImage = await doc.embedPng(logoBytes);
    } catch (e) {
      console.warn("[voucher-pdf] embedPng failed", e);
    }
  }

  let y = A4_HEIGHT - MARGIN_TOP;

  // ── Logo (centred at top) ────────────────────────────────────────
  if (logoImage) {
    const logoHeight = 56;
    const aspect = logoImage.width / logoImage.height;
    const logoWidth = logoHeight * aspect;
    page.drawImage(logoImage, {
      x: (A4_WIDTH - logoWidth) / 2,
      y: y - logoHeight,
      width: logoWidth,
      height: logoHeight,
    });
    y -= logoHeight + 8;
  }

  // ── Company name + address (centred) ─────────────────────────────
  const nameSize = 13;
  const nameWidth = fontBold.widthOfTextAtSize(input.company.name, nameSize);
  page.drawText(input.company.name, {
    x: (A4_WIDTH - nameWidth) / 2,
    y,
    size: nameSize,
    font: fontBold,
    color: COLOR_TEXT,
  });
  y -= 16;
  for (const addrLine of input.company.addressLines) {
    const w = fontReg.widthOfTextAtSize(addrLine, 9.5);
    page.drawText(addrLine, {
      x: (A4_WIDTH - w) / 2,
      y,
      size: 9.5,
      font: fontReg,
      color: COLOR_MUTED,
    });
    y -= 12;
  }
  // Divider
  y -= 8;
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: A4_WIDTH - MARGIN_X, y },
    thickness: 1.2,
    color: COLOR_DIVIDER,
  });
  y -= 22;

  // ── "PAYMENT VOUCHER" title (centred) ────────────────────────────
  const title = "PAYMENT VOUCHER";
  const titleSize = 12.5;
  const titleWidth = fontBold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (A4_WIDTH - titleWidth) / 2,
    y,
    size: titleSize,
    font: fontBold,
    color: COLOR_TEXT,
  });
  y -= 26;

  // ── Field list ───────────────────────────────────────────────────
  // Lays out label : value pairs in a single column with consistent
  // alignment. Highlight rows (Token / UTR / Amount) get a yellow
  // bg rectangle behind the value.

  const LABEL_X = MARGIN_X;
  const COLON_X = MARGIN_X + 140;
  const VALUE_X = MARGIN_X + 160;
  const LINE_HEIGHT = 17;

  const drawRow = (
    label: string,
    value: string,
    opts: { mono?: boolean; highlight?: boolean } = {},
  ) => {
    page.drawText(label, {
      x: LABEL_X,
      y,
      size: 9.5,
      font: fontReg,
      color: COLOR_MUTED,
    });
    page.drawText(":", {
      x: COLON_X,
      y,
      size: 9.5,
      font: fontReg,
      color: COLOR_MUTED,
    });
    const valFont = opts.mono
      ? opts.highlight
        ? fontMonoBold
        : fontMono
      : fontBold;
    const valSize = opts.mono ? 9.5 : 10;
    const valWidth = valFont.widthOfTextAtSize(value, valSize);
    if (opts.highlight) {
      // Yellow rounded-rect background
      page.drawRectangle({
        x: VALUE_X - 4,
        y: y - 3,
        width: valWidth + 8,
        height: 14,
        color: COLOR_HIGHLIGHT_BG,
      });
    }
    page.drawText(value, {
      x: VALUE_X,
      y,
      size: valSize,
      font: valFont,
      color: COLOR_TEXT,
    });
    y -= LINE_HEIGHT;
  };

  const voucherNo = fmtVoucherNo(input.payment.paymentId, input.payment.paidAt);

  drawRow("Voucher No", voucherNo, { mono: true });
  drawRow("Voucher Date", fmtDateIST(input.payment.paidAt));
  drawRow("Remitter Name", input.company.name);
  drawRow("Beneficiary Name", input.vendor.name.toUpperCase());
  if (input.vendor.bankAccount)
    drawRow("Beneficiary A/c No", input.vendor.bankAccount, { mono: true });
  if (input.vendor.ifsc) drawRow("Beneficiary IFSC", input.vendor.ifsc, { mono: true });
  if (input.vendor.gstin)
    drawRow("Beneficiary GSTIN", input.vendor.gstin, { mono: true });
  if (input.vendor.pan)
    drawRow("Beneficiary PAN", input.vendor.pan, { mono: true });

  drawRow("Bill Token", input.bill.token, { mono: true, highlight: true });

  drawRow("Vendor's Bill No", input.bill.vendorBillNo, { mono: true });
  drawRow("Bill Date", fmtDateIST(input.bill.billDate));
  if (input.bill.costHead) drawRow("Cost Head", input.bill.costHead);
  drawRow(
    "Payment Mode",
    (input.payment.paymentMethod ?? "—").toUpperCase(),
    { mono: true },
  );
  if (input.payment.paymentReference) {
    const refLabel =
      input.payment.paymentMethod === "cheque"
        ? "Cheque No"
        : input.payment.paymentMethod === "upi"
          ? "UPI Txn Ref"
          : "UTR / Reference";
    drawRow(refLabel, input.payment.paymentReference, { mono: true, highlight: true });
  }
  if (input.payment.paymentNote) {
    drawRow("Payment Note", input.payment.paymentNote.slice(0, 70));
  }
  drawRow("Amount", fmtINR(input.payment.paidAmount), { mono: true, highlight: true });
  // Amount in Words can be long; wrap if needed
  const amtWordsValue = `${input.amountInWords} Only`;
  const maxWordsWidth = A4_WIDTH - VALUE_X - MARGIN_X;
  const wordsLines = wrapText(amtWordsValue, fontBold, 10, maxWordsWidth);
  page.drawText("Amount in Words", {
    x: LABEL_X,
    y,
    size: 9.5,
    font: fontReg,
    color: COLOR_MUTED,
  });
  page.drawText(":", {
    x: COLON_X,
    y,
    size: 9.5,
    font: fontReg,
    color: COLOR_MUTED,
  });
  for (let i = 0; i < wordsLines.length; i++) {
    page.drawText(wordsLines[i], {
      x: VALUE_X,
      y: y - i * 13,
      size: 10,
      font: fontBold,
      color: COLOR_TEXT,
    });
  }
  y -= LINE_HEIGHT + (wordsLines.length - 1) * 13;
  y -= 8;

  // ── Salutation paragraph ─────────────────────────────────────────
  y -= 4;
  const salutation =
    `Dear Sir / Madam,\n` +
    `We are pleased to credit your account` +
    (input.vendor.bankAccount ? ` (${input.vendor.bankAccount})` : "") +
    ` with us for ${fmtINR(input.payment.paidAmount)} (${input.amountInWords} Only) ` +
    `against bill ${input.bill.token} (${input.bill.vendorBillNo}) dated ${fmtDateIST(input.bill.billDate, "long")}.`;
  const salutationLines = salutation
    .split("\n")
    .flatMap((l) => wrapText(l, fontReg, 10, A4_WIDTH - 2 * MARGIN_X));
  for (const line of salutationLines) {
    page.drawText(line, {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontReg,
      color: COLOR_TEXT,
    });
    y -= 14;
  }

  // ── Bill description box ─────────────────────────────────────────
  if (input.bill.description) {
    y -= 12;
    const descLines = wrapText(
      input.bill.description,
      fontReg,
      9.5,
      A4_WIDTH - 2 * MARGIN_X - 24,
    );
    const boxHeight = 20 + descLines.length * 13 + 8;
    page.drawRectangle({
      x: MARGIN_X,
      y: y - boxHeight + 16,
      width: A4_WIDTH - 2 * MARGIN_X,
      height: boxHeight,
      color: COLOR_DESC_BG,
      borderColor: COLOR_DESC_BORDER,
      borderWidth: 1,
    });
    // Heading
    page.drawText("BILL DESCRIPTION", {
      x: MARGIN_X + 12,
      y,
      size: 8.5,
      font: fontBold,
      color: COLOR_MUTED,
    });
    y -= 13;
    for (const line of descLines) {
      page.drawText(line, {
        x: MARGIN_X + 12,
        y,
        size: 9.5,
        font: fontReg,
        color: COLOR_TEXT,
      });
      y -= 13;
    }
    y -= 14;
  }

  // ── Signature blocks ─────────────────────────────────────────────
  y = Math.min(y, MARGIN_BOTTOM + 100);
  const colWidth = (A4_WIDTH - 2 * MARGIN_X - 36) / 2;
  const col1X = MARGIN_X;
  const col2X = MARGIN_X + colWidth + 36;
  const sigY = MARGIN_BOTTOM + 60;
  const sigLineY = sigY + 16;
  const sigLabelY = sigLineY + 8;

  page.drawText("PREPARED BY", {
    x: col1X,
    y: sigLabelY,
    size: 8.5,
    font: fontBold,
    color: COLOR_MUTED,
  });
  page.drawLine({
    start: { x: col1X, y: sigLineY },
    end: { x: col1X + colWidth, y: sigLineY },
    thickness: 0.5,
    color: COLOR_MUTED,
  });
  page.drawText(input.payment.paidByName ?? "Accountant", {
    x: col1X,
    y: sigY,
    size: 10,
    font: fontBold,
    color: COLOR_TEXT,
  });

  page.drawText("AUTHORISED SIGNATORY", {
    x: col2X,
    y: sigLabelY,
    size: 8.5,
    font: fontBold,
    color: COLOR_MUTED,
  });
  page.drawLine({
    start: { x: col2X, y: sigLineY },
    end: { x: col2X + colWidth, y: sigLineY },
    thickness: 0.5,
    color: COLOR_MUTED,
  });
  page.drawText(`For ${input.company.name}`, {
    x: col2X,
    y: sigY,
    size: 9.5,
    font: fontBold,
    color: COLOR_TEXT,
  });

  // ── Footer ───────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN_X, y: MARGIN_BOTTOM + 24 },
    end: { x: A4_WIDTH - MARGIN_X, y: MARGIN_BOTTOM + 24 },
    thickness: 0.3,
    color: COLOR_DESC_BORDER,
  });
  const generatedAt = fmtDateIST(new Date().toISOString(), "long");
  const footer = `This is a computer-generated voucher and does not require a physical signature unless otherwise marked above. Voucher generated ${generatedAt}.`;
  const footerLines = wrapText(footer, fontIta, 8, A4_WIDTH - 2 * MARGIN_X);
  let footerY = MARGIN_BOTTOM + 12;
  for (let i = footerLines.length - 1; i >= 0; i--) {
    page.drawText(footerLines[i], {
      x: MARGIN_X,
      y: footerY,
      size: 8,
      font: fontIta,
      color: COLOR_MUTED,
    });
    footerY -= 10;
  }

  return await doc.save();
}
