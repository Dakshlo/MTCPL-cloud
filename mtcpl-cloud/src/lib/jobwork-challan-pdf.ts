// ──────────────────────────────────────────────────────────────────
// Outsource jobwork challan PDF — letterhead edition
// ──────────────────────────────────────────────────────────────────
// Single-page Letter-size PDF (pdf-lib) on the MTCPL letterhead, like
// the payment voucher (src/lib/voucher-pdf.ts) but laid out as a line-
// item bill: Description / Qty / Unit / Rate / Amount, then subtotal +
// GST (or RCM note) + grand total + amount in words. The small helpers
// are inlined (copied from voucher-pdf.ts) on purpose so this module is
// self-contained and the working voucher PDF stays byte-identical.

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type JobworkChallanPdfInput = {
  company: { name: string; addressLines: string[] };
  challan: { number: string; date: string | null };
  vendor: { name: string; gstin: string | null };
  items: Array<{
    description: string;
    quantity: number;
    // 'job' = flat amount per slab (qty 1); cft/sft multiply by quantity.
    unit: "cft" | "sft" | "job";
    rate: number;
    amount: number;
  }>;
  subtotal: number;
  gstPct: number | null;
  gstAmount: number;
  isRcm: boolean;
  total: number;
  amountInWords: string;
  preparedByName: string | null;
  notes: string | null;
};

const W = 612;
const H = 792;
const MARGIN_X = 50;
const MARGIN_TOP = 140;
const MARGIN_BOTTOM = 95;

const COLOR_TEXT = rgb(0.067, 0.067, 0.067);
const COLOR_MUTED = rgb(0.4, 0.4, 0.4);
const COLOR_LINE = rgb(0.8, 0.8, 0.8);
const COLOR_HEAD_BG = rgb(0.95, 0.93, 0.86);
const COLOR_HIGHLIGHT_BG = rgb(1, 0.953, 0.8);

function fmtINR(n: number): string {
  const fixed = Math.round(n * 100) / 100;
  const [intPart, decPart] = fixed.toFixed(2).split(".");
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
  return `Rs. ${formatted}.${decPart}`;
}

function fmtQty(n: number): string {
  return (Math.round(n * 1000) / 1000).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

function sanitize(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/₹/g, "Rs.")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

function fmtDateIST(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00+05:30` : iso);
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(ist.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return "—";
  }
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

let cachedLetterhead: Uint8Array | null = null;
let letterheadTried = false;
async function loadLetterheadBytes(): Promise<Uint8Array | null> {
  if (letterheadTried) return cachedLetterhead;
  letterheadTried = true;
  try {
    cachedLetterhead = await readFile(path.join(process.cwd(), "public", "letterhead.pdf"));
  } catch (e) {
    console.warn("[jobwork-challan-pdf] letterhead not loaded", e);
  }
  return cachedLetterhead;
}

export async function buildJobworkChallanPdf(raw: JobworkChallanPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Jobwork challan ${sanitize(raw.challan.number)}`);
  doc.setAuthor(sanitize(raw.company.name));
  doc.setSubject("Jobwork Challan");

  const page = doc.addPage([W, H]);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontIta = await doc.embedFont(StandardFonts.HelveticaOblique);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  // Letterhead background (falls back to a plain divider if missing).
  let y = H - MARGIN_TOP;
  const lh = await loadLetterheadBytes();
  let letterheadOk = false;
  if (lh) {
    try {
      const [embedded] = await doc.embedPdf(lh, [0]);
      page.drawPage(embedded, { x: 0, y: 0, width: W, height: H });
      letterheadOk = true;
    } catch (e) {
      console.warn("[jobwork-challan-pdf] embedPdf failed", e);
    }
  }
  if (!letterheadOk) {
    let fy = H - 48;
    const nameSize = 14;
    const name = sanitize(raw.company.name);
    page.drawText(name, {
      x: (W - fontBold.widthOfTextAtSize(name, nameSize)) / 2,
      y: fy,
      size: nameSize,
      font: fontBold,
      color: COLOR_TEXT,
    });
    fy -= 18;
    for (const line of raw.company.addressLines.map(sanitize)) {
      page.drawText(line, {
        x: (W - fontReg.widthOfTextAtSize(line, 9)) / 2,
        y: fy,
        size: 9,
        font: fontReg,
        color: COLOR_MUTED,
      });
      fy -= 12;
    }
    page.drawLine({
      start: { x: MARGIN_X, y: fy - 4 },
      end: { x: W - MARGIN_X, y: fy - 4 },
      thickness: 1,
      color: COLOR_LINE,
    });
    y = fy - 26;
  }

  // ── Title pill ───────────────────────────────────────────────────
  const title = "JOBWORK CHALLAN";
  const titleSize = 13;
  const tW = fontBold.widthOfTextAtSize(title, titleSize);
  page.drawRectangle({
    x: (W - tW) / 2 - 14,
    y: y - 6,
    width: tW + 28,
    height: titleSize + 10,
    color: rgb(0.722, 0.451, 0.2),
  });
  page.drawText(title, {
    x: (W - tW) / 2,
    y,
    size: titleSize,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  y -= titleSize + 26;

  // ── Header rows (challan no / date / vendor) ────────────────────
  const drawKV = (label: string, value: string, mono = false) => {
    page.drawText(label, { x: MARGIN_X, y, size: 9.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(":", { x: MARGIN_X + 110, y, size: 9.5, font: fontReg, color: COLOR_MUTED });
    page.drawText(sanitize(value), {
      x: MARGIN_X + 126,
      y,
      size: mono ? 9.5 : 10,
      font: mono ? fontMono : fontBold,
      color: COLOR_TEXT,
    });
    y -= 16;
  };
  drawKV("Challan No", raw.challan.number, true);
  drawKV("Challan Date", fmtDateIST(raw.challan.date));
  drawKV("Vendor", raw.vendor.name.toUpperCase());
  if (raw.vendor.gstin) drawKV("Vendor GSTIN", raw.vendor.gstin, true);
  y -= 6;

  // ── Line-item table ──────────────────────────────────────────────
  const DESC_X = MARGIN_X;
  const QTY_R = 372;
  const UNIT_C = 405;
  const RATE_R = 482;
  const AMT_R = W - MARGIN_X; // 562
  const rowH = 16;
  const right = (text: string, xRight: number, yy: number, font: PDFFont, size = 9.5) => {
    page.drawText(text, {
      x: xRight - font.widthOfTextAtSize(text, size),
      y: yy,
      size,
      font,
      color: COLOR_TEXT,
    });
  };
  const center = (text: string, xCenter: number, yy: number, font: PDFFont, size = 9.5) => {
    page.drawText(text, {
      x: xCenter - font.widthOfTextAtSize(text, size) / 2,
      y: yy,
      size,
      font,
      color: COLOR_TEXT,
    });
  };

  // Header band
  page.drawRectangle({ x: MARGIN_X, y: y - 4, width: W - 2 * MARGIN_X, height: rowH, color: COLOR_HEAD_BG });
  page.drawText("Description", { x: DESC_X + 4, y, size: 9, font: fontBold, color: COLOR_TEXT });
  right("Qty", QTY_R, y, fontBold, 9);
  center("Unit", UNIT_C, y, fontBold, 9);
  right("Rate", RATE_R, y, fontBold, 9);
  right("Amount", AMT_R - 4, y, fontBold, 9);
  y -= rowH + 2;

  for (const it of raw.items) {
    const desc = truncateToWidth(sanitize(it.description), fontReg, 9.5, QTY_R - DESC_X - 60);
    page.drawText(desc, { x: DESC_X + 4, y, size: 9.5, font: fontReg, color: COLOR_TEXT });
    right(fmtQty(it.quantity), QTY_R, y, fontReg);
    center(it.unit.toUpperCase(), UNIT_C, y, fontReg);
    right(fmtINR(it.rate).replace("Rs. ", ""), RATE_R, y, fontReg);
    right(fmtINR(it.amount).replace("Rs. ", ""), AMT_R - 4, y, fontBold);
    y -= rowH;
    page.drawLine({
      start: { x: MARGIN_X, y: y + 4 },
      end: { x: W - MARGIN_X, y: y + 4 },
      thickness: 0.4,
      color: COLOR_LINE,
    });
  }
  y -= 8;

  // ── Totals ───────────────────────────────────────────────────────
  const totalLabelX = 360;
  const drawTotal = (label: string, value: string, bold = false, highlight = false) => {
    page.drawText(label, {
      x: totalLabelX,
      y,
      size: 9.5,
      font: bold ? fontBold : fontReg,
      color: COLOR_MUTED,
    });
    const vFont = bold ? fontBold : fontReg;
    const vStr = value;
    if (highlight) {
      const vw = vFont.widthOfTextAtSize(vStr, 10);
      page.drawRectangle({ x: AMT_R - 4 - vw - 4, y: y - 3, width: vw + 8, height: 15, color: COLOR_HIGHLIGHT_BG });
    }
    right(vStr, AMT_R - 4, y, vFont, 10);
    y -= 16;
  };
  drawTotal("Subtotal", fmtINR(raw.subtotal));
  if (raw.gstPct != null && raw.gstPct > 0) {
    if (raw.isRcm) {
      drawTotal(`GST @ ${raw.gstPct}% (RCM — by recipient)`, fmtINR(raw.gstAmount));
    } else {
      drawTotal(`GST @ ${raw.gstPct}%`, fmtINR(raw.gstAmount));
    }
  }
  drawTotal("TOTAL", fmtINR(raw.total), true, true);

  if (raw.isRcm) {
    y -= 2;
    page.drawText(
      sanitize(
        "Note: GST is payable by the recipient under Reverse Charge Mechanism (RCM); not added to the amount payable to the vendor.",
      ),
      { x: MARGIN_X, y, size: 8, font: fontIta, color: COLOR_MUTED },
    );
    y -= 14;
  }

  // ── Amount in words ──────────────────────────────────────────────
  y -= 6;
  page.drawText("Amount in words:", { x: MARGIN_X, y, size: 9, font: fontReg, color: COLOR_MUTED });
  page.drawText(sanitize(`${raw.amountInWords} Only`), {
    x: MARGIN_X + 96,
    y,
    size: 9.5,
    font: fontBold,
    color: COLOR_TEXT,
  });
  y -= 16;

  if (raw.notes) {
    page.drawText(truncateToWidth(sanitize(`Note: ${raw.notes}`), fontReg, 9, W - 2 * MARGIN_X), {
      x: MARGIN_X,
      y,
      size: 9,
      font: fontReg,
      color: COLOR_MUTED,
    });
    y -= 16;
  }

  // ── Signature blocks ─────────────────────────────────────────────
  const colW = (W - 2 * MARGIN_X - 36) / 2;
  const col1X = MARGIN_X;
  const col2X = MARGIN_X + colW + 36;
  const sigY = MARGIN_BOTTOM + 60;
  page.drawText("PREPARED BY", { x: col1X, y: sigY + 24, size: 8.5, font: fontBold, color: COLOR_MUTED });
  page.drawLine({ start: { x: col1X, y: sigY + 16 }, end: { x: col1X + colW, y: sigY + 16 }, thickness: 0.5, color: COLOR_MUTED });
  page.drawText(sanitize(raw.preparedByName ?? "Carving Head"), { x: col1X, y: sigY, size: 10, font: fontBold, color: COLOR_TEXT });
  page.drawText("AUTHORISED SIGNATORY", { x: col2X, y: sigY + 24, size: 8.5, font: fontBold, color: COLOR_MUTED });
  page.drawLine({ start: { x: col2X, y: sigY + 16 }, end: { x: col2X + colW, y: sigY + 16 }, thickness: 0.5, color: COLOR_MUTED });
  page.drawText(sanitize(`For ${raw.company.name}`), { x: col2X, y: sigY, size: 9.5, font: fontBold, color: COLOR_TEXT });

  page.drawText(`Computer-generated jobwork challan  ·  ${fmtDateIST(new Date().toISOString())}`, {
    x: MARGIN_X,
    y: MARGIN_BOTTOM + 6,
    size: 7.5,
    font: fontIta,
    color: COLOR_MUTED,
  });

  return await doc.save();
}
