// ──────────────────────────────────────────────────────────────────
// Manual Work Order Document — letterhead PDF (Invoicing, Mig 105 / 114 / 115)
//
// Standalone: NOT linked to carving work orders or any incoming logic.
// The vendor is picked from the Finance master and snapshotted onto the doc.
// Prints on the company letterhead: header (WORK ORDER + no + date), a
// bordered vendor block (name / GST no / category / mobile / email /
// address), a bordered line-items table (up to 4 — # · description · unit ·
// qty · rate · amount), a grand total, an optional "exclusive of GST" note,
// the standard terms, and two signature lines (MTCPL + Vendor). Built with
// pdf-lib on /public/letterhead.pdf.
// ──────────────────────────────────────────────────────────────────

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export type WorkOrderLineItem = {
  description: string | null;
  unit: "cft" | "sft";
  quantity: number;
  rate: number;
  total: number;
};

export type WorkOrderDocInput = {
  vendorName: string;
  vendorGstin: string | null;
  vendorCategory: string | null;
  vendorMobile: string | null;
  vendorEmail: string | null;
  vendorAddress: string | null;
  jobWorkNo: string | null;
  dateIso: string | null;
  lineItems: WorkOrderLineItem[];
  grandTotal: number;
  gstExclusive: boolean;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const CONTENT_W = PAGE_W - 2 * MARGIN_X;

function san(s: string | null | undefined): string {
  return (s ?? "").replace(/₹/g, "Rs.").replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");
}
function rs(n: number) {
  return "Rs. " + (Math.round(n * 100) / 100).toLocaleString("en-IN");
}
function fmtDate(iso: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso.length <= 10 ? `${iso}T00:00:00+05:30` : iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return iso;
  }
}
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = san(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) cur = trial;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ["-"];
}

const TERMS = [
  "1. The above slabs are handed over to the vendor for carving / jobwork only.",
  "2. The material remains the property of Mateshwari Temple Construction Pvt Ltd at all times.",
  "3. The vendor is responsible for safe custody and the quality of the work until returned.",
  "4. Payment is on the agreed rate above, against approved / received work only.",
  "5. Only a part-payment is released; the balance is held until the carved slab is successfully installed at the site.",
  "6. Any installation problem caused by a carving or handling defect remains the vendor's responsibility to help rectify. The full and final payment is released only after our client approves and releases the payment to us, and 90 days after that release.",
];

let lhCache: Uint8Array | null = null;
let lhTried = false;
async function loadLetterhead(): Promise<Uint8Array | null> {
  if (lhTried) return lhCache;
  lhTried = true;
  try {
    lhCache = new Uint8Array(await readFile(path.join(process.cwd(), "public", "letterhead.pdf")));
  } catch {
    lhCache = null;
  }
  return lhCache;
}

export async function buildWorkOrderDocPdf(inp: WorkOrderDocInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Work Order ${san(inp.jobWorkNo) || ""}`.trim());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const lhBytes = await loadLetterhead();
  let lhEmbed: Awaited<ReturnType<typeof pdf.embedPdf>>[number] | null = null;
  if (lhBytes) {
    try {
      [lhEmbed] = await pdf.embedPdf(lhBytes, [0]);
    } catch {
      lhEmbed = null;
    }
  }

  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  const accent = rgb(0.486, 0.231, 0.047);
  const headBg = rgb(0.96, 0.93, 0.88);
  const lineCol = rgb(0.8, 0.78, 0.74);

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  if (lhEmbed) page.drawPage(lhEmbed, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  const text = (s: string, x: number, y: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, y: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x: xRight - f.widthOfTextAtSize(san(s), size), y, size, font: f, color });
  const strokeBox = (p: PDFPage, x1: number, yTop: number, x2: number, yBot: number, c: RGB, w: number) => {
    p.drawLine({ start: { x: x1, y: yTop }, end: { x: x2, y: yTop }, thickness: w, color: c });
    p.drawLine({ start: { x: x1, y: yBot }, end: { x: x2, y: yBot }, thickness: w, color: c });
    p.drawLine({ start: { x: x1, y: yTop }, end: { x: x1, y: yBot }, thickness: w, color: c });
    p.drawLine({ start: { x: x2, y: yTop }, end: { x: x2, y: yBot }, thickness: w, color: c });
  };

  // ── Header ──────────────────────────────────────────────────────────
  text("WORK ORDER", MARGIN_X, 636, 15, bold, accent);
  right(`No: ${inp.jobWorkNo || "-"}`, PAGE_W - MARGIN_X, 638, 10, bold, ink);
  right(`Date: ${fmtDate(inp.dateIso)}`, PAGE_W - MARGIN_X, 624, 9, font, muted);

  // ── Vendor block (bordered) ─────────────────────────────────────────
  const boxTop = 612;
  const padX = MARGIN_X + 12;
  const colRx = MARGIN_X + CONTENT_W / 2 + 6;
  const kv = (label: string, value: string | null | undefined, x: number, yy: number) => {
    text(`${label}:`, x, yy, 8, bold, muted);
    const v = value && value.trim() ? value : "-";
    text(v, x + 52, yy, 9.5, font, ink);
  };

  let by = boxTop - 16;
  text("VENDOR", padX, by, 8, bold, muted);
  by -= 16;
  for (const ln of wrap(inp.vendorName || "-", bold, 12.5, CONTENT_W - 24)) {
    text(ln, padX, by, 12.5, bold, ink);
    by -= 16;
  }
  by -= 2;
  kv("GST No", inp.vendorGstin, padX, by);
  kv("Category", inp.vendorCategory, colRx, by);
  by -= 15;
  kv("Mobile", inp.vendorMobile, padX, by);
  kv("Email", inp.vendorEmail, colRx, by);
  by -= 15;
  text("Address:", padX, by, 8, bold, muted);
  for (const ln of wrap(inp.vendorAddress || "-", font, 9.5, CONTENT_W - 24 - 52)) {
    text(ln, padX + 52, by, 9.5, font, ink);
    by -= 12.5;
  }
  by -= 8;
  const boxBottom = by;
  strokeBox(page, MARGIN_X, boxTop + 2, PAGE_W - MARGIN_X, boxBottom, lineCol, 0.8);

  // ── Line-item table ─────────────────────────────────────────────────
  const amtX = PAGE_W - MARGIN_X - 6;
  const rateX = PAGE_W - MARGIN_X - 92;
  const qtyX = PAGE_W - MARGIN_X - 178;
  const unitX = PAGE_W - MARGIN_X - 250;
  const numX = MARGIN_X + 4;
  const descX = MARGIN_X + 22;
  const descMaxW = unitX - 10 - descX;

  let y = boxBottom - 18;
  page.drawRectangle({ x: MARGIN_X, y: y - 5, width: CONTENT_W, height: 18, color: headBg });
  text("#", numX, y, 8.5, bold, muted);
  text("Description", descX, y, 8.5, bold, muted);
  text("Unit", unitX, y, 8.5, bold, muted);
  right("Qty", qtyX, y, 8.5, bold, muted);
  right("Rate", rateX, y, 8.5, bold, muted);
  right("Amount", amtX, y, 8.5, bold, muted);
  y -= 21;

  const items = inp.lineItems.length > 0 ? inp.lineItems : [];
  items.forEach((it, idx) => {
    const descLines = wrap(it.description?.trim() || "-", font, 9.5, descMaxW);
    const rowTopY = y;
    text(`${idx + 1}.`, numX, rowTopY, 9.5, font, ink);
    descLines.forEach((ln, i) => text(ln, descX, rowTopY - i * 12, 9.5, font, ink));
    text(it.unit.toUpperCase(), unitX, rowTopY, 9.5, font, ink);
    right(String(Math.round(it.quantity * 1000) / 1000), qtyX, rowTopY, 9.5, font, ink);
    right(rs(it.rate), rateX, rowTopY, 9, font, ink);
    right(rs(it.total), amtX, rowTopY, 9.5, bold, ink);
    y = rowTopY - Math.max(descLines.length, 1) * 12 - 7;
    page.drawLine({ start: { x: MARGIN_X, y: y + 3 }, end: { x: PAGE_W - MARGIN_X, y: y + 3 }, thickness: 0.5, color: lineCol });
    y -= 7;
  });

  // ── Grand total + GST note ──────────────────────────────────────────
  y -= 2;
  const totBandX = PAGE_W - MARGIN_X - 230;
  page.drawRectangle({ x: totBandX, y: y - 6, width: PAGE_W - MARGIN_X - totBandX, height: 21, color: headBg });
  text("GRAND TOTAL", totBandX + 8, y, 10, bold, accent);
  right(rs(inp.grandTotal), amtX, y, 13, bold, accent);
  y -= 24;
  if (inp.gstExclusive) {
    right("Amount is exclusive of GST — GST charged extra as applicable.", PAGE_W - MARGIN_X, y, 8.5, font, muted);
    y -= 14;
  }

  // ── Terms (compact), anchored above the signatures ──────────────────
  const TSIZE = 8;
  const LH = 12;
  const bodyLines: { text: string; indent: boolean }[] = [];
  for (const t of TERMS) {
    wrap(t, font, TSIZE, CONTENT_W).forEach((ln, i) => bodyLines.push({ text: ln, indent: i > 0 }));
  }
  const sigLabelY = 96;
  const sigLineY = sigLabelY + 14;
  const termsBottomY = sigLineY + 30;
  let ty = termsBottomY + bodyLines.length * LH;
  text("Terms:", MARGIN_X, ty, 9, bold, ink);
  ty -= LH;
  for (const ln of bodyLines) {
    text(ln.text, MARGIN_X + (ln.indent ? 12 : 0), ty, TSIZE, font, muted);
    ty -= LH;
  }

  // ── Signatures (two) ────────────────────────────────────────────────
  page.drawLine({ start: { x: MARGIN_X, y: sigLineY }, end: { x: MARGIN_X + 210, y: sigLineY }, thickness: 0.7, color: ink });
  text("For Mateshwari Temple Construction Pvt Ltd", MARGIN_X, sigLabelY, 8, font, muted);
  page.drawLine({ start: { x: PAGE_W - MARGIN_X - 210, y: sigLineY }, end: { x: PAGE_W - MARGIN_X, y: sigLineY }, thickness: 0.7, color: ink });
  text("Vendor signature", PAGE_W - MARGIN_X - 210, sigLabelY, 8, font, muted);

  return await pdf.save();
}
