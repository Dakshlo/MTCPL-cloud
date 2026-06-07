// ──────────────────────────────────────────────────────────────────
// Work-order (jobwork) handover document — letterhead PDF.
//
// A printable sheet the office hands to an outsource vendor when a work
// order is approved: company letterhead (logo + footer) as background,
// a per-slab table, the AGREED rate + total CFT/SFT (no invoice-style
// grand total), jobwork terms, and two signature lines (our authorised
// sign + vendor sign). Built with pdf-lib on /public/letterhead.pdf.
//
// EVERY page carries a compact identifying header (WO number + vendor +
// date + page no.) so a signature page that flows onto its own sheet is
// never an unidentified orphan.
// ──────────────────────────────────────────────────────────────────

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type WorkOrderPdfSlab = {
  code: string;
  label: string | null;
  stone: string | null;
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
};
export type WorkOrderPdfInput = {
  woNumber: string;
  vendorName: string;
  title: string | null;
  temple: string | null;
  dateIso: string | null;
  rate: number | null;
  unit: "cft" | "sft" | "job";
  slabs: WorkOrderPdfSlab[];
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const TOP = 156; // below the letterhead's logo + accent line
const BOTTOM = 96; // above the letterhead footer
const HEADER_Y = PAGE_H - TOP; // baseline of the per-page identity header
const CONTENT_TOP = HEADER_Y - 36; // content starts below the header band

// pdf-lib StandardFonts cover WinAnsi only — swap the rupee glyph for
// "Rs." and drop anything outside Latin-1.
function san(s: string | null | undefined): string {
  return (s ?? "").replace(/₹/g, "Rs.").replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");
}
function cft(l: number, w: number, t: number) {
  return (l * w * t) / 1728;
}
function sft(l: number, w: number) {
  return (l * w) / 144;
}
function rs(n: number) {
  return "Rs. " + (Math.round(n * 100) / 100).toLocaleString("en-IN");
}
function fmtDate(iso: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch {
    return iso;
  }
}

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

export async function buildWorkOrderPdf(inp: WorkOrderPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
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

  let pageNum = 0;
  // Every page: letterhead background + a compact identity header so a
  // signature page is never an unidentified orphan.
  const newPage = (): PDFPage => {
    const p = pdf.addPage([PAGE_W, PAGE_H]);
    if (lhEmbed) p.drawPage(lhEmbed, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    pageNum += 1;
    p.drawText(san(`WORK ORDER  ${inp.woNumber}`), { x: MARGIN_X, y: HEADER_Y, size: 13, font: bold, color: accent });
    p.drawText(san(`Page ${pageNum}`), { x: PAGE_W - MARGIN_X - 48, y: HEADER_Y, size: 9, font, color: muted });
    p.drawText(san(`${inp.vendorName}  -  ${fmtDate(inp.dateIso)}${inp.temple ? `  -  ${inp.temple}` : ""}${inp.title ? `  -  ${inp.title}` : ""}`), {
      x: MARGIN_X,
      y: HEADER_Y - 14,
      size: 8.5,
      font,
      color: muted,
    });
    p.drawLine({ start: { x: MARGIN_X, y: HEADER_Y - 22 }, end: { x: PAGE_W - MARGIN_X, y: HEADER_Y - 22 }, thickness: 1, color: accent });
    return p;
  };

  let page = newPage();
  let y = CONTENT_TOP;
  const text = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x, y: yy, size, font: f, color });

  text("Jobwork handover", MARGIN_X, y, 11, bold, ink);
  y -= 18;

  // Slab table
  const cols = {
    code: MARGIN_X,
    label: MARGIN_X + 95,
    stone: MARGIN_X + 240,
    dims: MARGIN_X + 320,
    cft: PAGE_W - MARGIN_X - 88,
    sft: PAGE_W - MARGIN_X - 40,
  };
  const hdr = (yy: number) => {
    page.drawRectangle({ x: MARGIN_X - 4, y: yy - 4, width: PAGE_W - 2 * MARGIN_X + 8, height: 17, color: rgb(0.96, 0.93, 0.88) });
    text("Slab", cols.code, yy, 8, bold, muted);
    text("Label", cols.label, yy, 8, bold, muted);
    text("Stone", cols.stone, yy, 8, bold, muted);
    text("Size (in)", cols.dims, yy, 8, bold, muted);
    text("CFT", cols.cft, yy, 8, bold, muted);
    text("SFT", cols.sft, yy, 8, bold, muted);
  };
  hdr(y);
  y -= 21;

  let totCft = 0;
  let totSft = 0;
  for (const s of inp.slabs) {
    if (y < BOTTOM + 40) {
      page = newPage();
      y = CONTENT_TOP;
      hdr(y);
      y -= 21;
    }
    const c = cft(s.lengthIn, s.widthIn, s.thicknessIn);
    const sf = sft(s.lengthIn, s.widthIn);
    totCft += c;
    totSft += sf;
    text(s.code, cols.code, y, 8, font);
    text((s.label ?? "").slice(0, 26), cols.label, y, 8, font);
    text((s.stone ?? "").slice(0, 13), cols.stone, y, 8, font);
    text(`${s.lengthIn}x${s.widthIn}x${s.thicknessIn}`, cols.dims, y, 8, font);
    text(c.toFixed(2), cols.cft, y, 8, font);
    text(sf.toFixed(2), cols.sft, y, 8, font);
    y -= 14;
  }
  y -= 4;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.7, color: muted });
  y -= 16;

  // Totals — slab count + total CFT/SFT + agreed rate. NO grand total.
  if (y < BOTTOM + 60) {
    page = newPage();
    y = CONTENT_TOP;
  }
  text(`Total slabs: ${inp.slabs.length}`, MARGIN_X, y, 9, bold);
  text(`Total CFT: ${totCft.toFixed(2)}`, MARGIN_X + 150, y, 9, bold);
  text(`Total SFT: ${totSft.toFixed(2)}`, MARGIN_X + 290, y, 9, bold);
  y -= 18;
  const priceLine =
    inp.rate == null
      ? "Agreed rate: (to be filled)"
      : inp.unit === "job"
        ? `Agreed rate: ${rs(inp.rate)} per slab (flat / job basis)`
        : `Agreed rate: ${rs(inp.rate)} per ${inp.unit.toUpperCase()}`;
  text(priceLine, MARGIN_X, y, 11, bold, accent);
  y -= 26;

  // Terms
  const terms = [
    "Terms:",
    "1. The above slabs are handed over to the vendor for carving / jobwork only.",
    "2. The material remains the property of Mateshwari Temple Construction Pvt Ltd at all times.",
    "3. The vendor is responsible for safe custody and the quality of the work until returned.",
    "4. Payment is on the agreed rate above, against approved / received work only.",
  ];
  // Keep the terms + signatures together: if they won't fit, start a fresh
  // page (which carries the identity header).
  if (y < BOTTOM + 130) {
    page = newPage();
    y = CONTENT_TOP;
  }
  for (const line of terms) {
    const isHead = line === "Terms:";
    text(line, MARGIN_X, y, isHead ? 9 : 8, isHead ? bold : font, isHead ? ink : muted);
    y -= 13;
  }

  // Signatures
  const sigY = y - 40;
  page.drawLine({ start: { x: MARGIN_X, y: sigY }, end: { x: MARGIN_X + 200, y: sigY }, thickness: 0.7, color: ink });
  page.drawLine({ start: { x: PAGE_W - MARGIN_X - 200, y: sigY }, end: { x: PAGE_W - MARGIN_X, y: sigY }, thickness: 0.7, color: ink });
  text("For Mateshwari Temple Construction Pvt Ltd", MARGIN_X, sigY - 12, 8, font, muted);
  text("Authorised signature", MARGIN_X, sigY - 24, 8, font, muted);
  text(`Vendor: ${inp.vendorName}`, PAGE_W - MARGIN_X - 200, sigY - 12, 8, font, muted);
  text("Vendor signature", PAGE_W - MARGIN_X - 200, sigY - 24, 8, font, muted);

  return await pdf.save();
}
