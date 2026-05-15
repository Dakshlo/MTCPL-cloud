// ──────────────────────────────────────────────────────────────────
// Payment voucher PDF generator
// ──────────────────────────────────────────────────────────────────
// Builds a single-page A4 PDF using pdf-lib. No headless browser,
// no React renderer dep — just procedurally laid out text + lines.
// Output goes as base64 attachment on the payment-received email
// vendors receive after Mark Paid lands.
//
// Layout mirrors the on-screen voucher (HDFC Payment Advice pattern):
//   • Top: company header + address
//   • Centred: "PAYMENT VOUCHER"
//   • Beneficiary block (vendor name + address + GSTIN)
//   • Two-column field list (bill no, dates, amount, method, UTR)
//   • Amount in words
//   • Salutation + signature line

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type VoucherPdfInput = {
  company: {
    name: string;
    addressLines: string[];
  };
  vendor: {
    name: string;
    address: string | null;
    gstin: string | null;
  };
  bill: {
    token: string;
    vendorBillNo: string;
    billDate: string; // ISO
    description: string;
  };
  payment: {
    paidAmount: number;
    paymentMethod: string | null;
    paymentReference: string | null;
    paymentNote: string | null;
    paidAt: string | null; // ISO
  };
  /** Pre-computed words for the amount. Caller supplies so we
   *  don't duplicate the Indian-numbering helper here. */
  amountInWords: string;
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;

function fmtINR(n: number): string {
  return `INR ${Math.round(n * 100) / 100}`.replace(
    /(\d)(?=(\d\d)+\d(\.|$))/g,
    "$1,",
  );
}

function fmtDateIST(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    // IST = UTC+5:30 — shift then read UTC accessors. Same trick as
    // the HDFC export helpers in src/lib/hdfc-export.ts.
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(ist.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return "—";
  }
}

/** Word-wrap a string into lines fitting `maxWidth` pts in `font` at `size` pts. */
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
    const width = font.widthOfTextAtSize(trial, size);
    if (width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
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

  const black = rgb(0, 0, 0);
  const grey = rgb(0.4, 0.4, 0.4);
  const accent = rgb(0.78, 0.63, 0.29); // gold-ish like the app theme

  let y = A4_HEIGHT - MARGIN;

  // ── Company header ───────────────────────────────────────────────
  page.drawText(input.company.name, {
    x: MARGIN,
    y,
    size: 14,
    font: fontBold,
    color: black,
  });
  y -= 18;
  for (const line of input.company.addressLines) {
    page.drawText(line, { x: MARGIN, y, size: 9, font: fontReg, color: grey });
    y -= 12;
  }

  // ── Title ────────────────────────────────────────────────────────
  y -= 16;
  const title = "PAYMENT VOUCHER";
  const titleWidth = fontBold.widthOfTextAtSize(title, 16);
  page.drawText(title, {
    x: (A4_WIDTH - titleWidth) / 2,
    y,
    size: 16,
    font: fontBold,
    color: accent,
  });
  y -= 24;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 0.6,
    color: grey,
  });
  y -= 18;

  // ── Beneficiary block ────────────────────────────────────────────
  page.drawText("Beneficiary", {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: grey,
  });
  y -= 14;
  page.drawText(input.vendor.name, {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: black,
  });
  y -= 14;
  if (input.vendor.address) {
    const addressLines = wrapText(
      input.vendor.address,
      fontReg,
      9,
      A4_WIDTH - 2 * MARGIN,
    );
    for (const line of addressLines.slice(0, 3)) {
      page.drawText(line, { x: MARGIN, y, size: 9, font: fontReg, color: grey });
      y -= 11;
    }
  }
  if (input.vendor.gstin) {
    page.drawText(`GSTIN: ${input.vendor.gstin}`, {
      x: MARGIN,
      y,
      size: 9,
      font: fontReg,
      color: grey,
    });
    y -= 14;
  }
  y -= 8;

  // ── Field list (2-column key/value) ──────────────────────────────
  const fields: Array<[string, string]> = [
    ["Voucher / Bill Token", input.bill.token],
    ["Vendor Bill No", input.bill.vendorBillNo],
    ["Bill Date", fmtDateIST(input.bill.billDate)],
    ["Description", input.bill.description.slice(0, 80)],
    ["Amount Paid", fmtINR(input.payment.paidAmount)],
    ["Payment Method", (input.payment.paymentMethod ?? "—").toUpperCase()],
    [
      "Payment Reference / UTR",
      input.payment.paymentReference || "—",
    ],
    ["Payment Date", fmtDateIST(input.payment.paidAt)],
  ];

  const labelX = MARGIN;
  const valueX = MARGIN + 160;
  for (const [label, value] of fields) {
    page.drawText(label, { x: labelX, y, size: 10, font: fontReg, color: grey });
    page.drawText(value, {
      x: valueX,
      y,
      size: 10,
      font: fontBold,
      color: black,
    });
    y -= 16;
  }

  // Payment note (longer free text)
  if (input.payment.paymentNote) {
    y -= 4;
    page.drawText("Note", {
      x: labelX,
      y,
      size: 10,
      font: fontReg,
      color: grey,
    });
    const noteLines = wrapText(
      input.payment.paymentNote,
      fontReg,
      10,
      A4_WIDTH - valueX - MARGIN,
    );
    for (const line of noteLines.slice(0, 4)) {
      page.drawText(line, { x: valueX, y, size: 10, font: fontReg, color: black });
      y -= 13;
    }
  }

  // ── Amount in words ──────────────────────────────────────────────
  y -= 14;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 0.4,
    color: grey,
  });
  y -= 16;
  page.drawText("Amount in Words", {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: grey,
  });
  y -= 13;
  const wordsLines = wrapText(
    input.amountInWords,
    fontIta,
    11,
    A4_WIDTH - 2 * MARGIN,
  );
  for (const line of wordsLines) {
    page.drawText(line, { x: MARGIN, y, size: 11, font: fontIta, color: black });
    y -= 14;
  }

  // ── Salutation + signature line ──────────────────────────────────
  y -= 24;
  const salutation =
    "Thank you for working with us. This voucher confirms the above payment from " +
    input.company.name +
    ".";
  for (const line of wrapText(salutation, fontReg, 10, A4_WIDTH - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y, size: 10, font: fontReg, color: grey });
    y -= 13;
  }

  y = MARGIN + 60;
  page.drawLine({
    start: { x: A4_WIDTH - MARGIN - 180, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: grey,
  });
  page.drawText("Authorised Signatory", {
    x: A4_WIDTH - MARGIN - 180,
    y: y - 12,
    size: 9,
    font: fontReg,
    color: grey,
  });

  page.drawText(
    `Generated ${new Date().toISOString().slice(0, 10)} · ${input.company.name}`,
    {
      x: MARGIN,
      y: MARGIN - 10,
      size: 7,
      font: fontReg,
      color: grey,
    },
  );

  return await doc.save();
}
