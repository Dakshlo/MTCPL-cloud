// ──────────────────────────────────────────────────────────────────
// Material gate pass / exit permit — letterhead PDF.
//
// When a batch of slabs leaves the premises for jobwork at an outsource
// vendor, the security gate needs a document to verify the exit and stamp
// a seal on it. This prints exactly the slabs in that batch: company
// letterhead, the destination vendor, the slab table (code / label / size
// / CFT), totals, and three sign-off blocks (issued by · carrier ·
// security gate seal). Built with pdf-lib on /public/letterhead.pdf,
// matching the work-order document style.
// ──────────────────────────────────────────────────────────────────

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type GatePassPdfSlab = {
  code: string;
  label: string | null;
  stone: string | null;
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
};
export type GatePassPdfInput = {
  woNumber: string;
  vendorName: string;
  temple: string | null;
  dateIso: string | null;
  issuedByName: string | null;
  slabs: GatePassPdfSlab[];
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const TOP = 156;
const BOTTOM = 96;
const HEADER_Y = PAGE_H - TOP;
const CONTENT_TOP = HEADER_Y - 36;

function san(s: string | null | undefined): string {
  return (s ?? "").replace(/₹/g, "Rs.").replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");
}
function cft(l: number, w: number, t: number) {
  return (l * w * t) / 1728;
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

export async function buildGatePassPdf(inp: GatePassPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const lhBytes = await loadLetterhead();
  let lhEmbed: Awaited<ReturnType<typeof pdf.embedPdf>>[number] | null = null;
  if (lhBytes) {
    try { [lhEmbed] = await pdf.embedPdf(lhBytes, [0]); } catch { lhEmbed = null; }
  }

  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  const accent = rgb(0.486, 0.231, 0.047);

  let pageNum = 0;
  const newPage = (): PDFPage => {
    const p = pdf.addPage([PAGE_W, PAGE_H]);
    if (lhEmbed) p.drawPage(lhEmbed, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    pageNum += 1;
    p.drawText(san(`MATERIAL GATE PASS  -  ${inp.woNumber}`), { x: MARGIN_X, y: HEADER_Y, size: 13, font: bold, color: accent });
    p.drawText(san(`Page ${pageNum}`), { x: PAGE_W - MARGIN_X - 48, y: HEADER_Y, size: 9, font, color: muted });
    p.drawText(san(`To: ${inp.vendorName}  -  ${fmtDate(inp.dateIso)}${inp.temple ? `  -  ${inp.temple}` : ""}`), {
      x: MARGIN_X, y: HEADER_Y - 14, size: 8.5, font, color: muted,
    });
    p.drawLine({ start: { x: MARGIN_X, y: HEADER_Y - 22 }, end: { x: PAGE_W - MARGIN_X, y: HEADER_Y - 22 }, thickness: 1, color: accent });
    return p;
  };

  let page = newPage();
  let y = CONTENT_TOP;
  const text = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x, y: yy, size, font: f, color });

  // Purpose line.
  text("Permit the following material to EXIT the premises for carving / jobwork", MARGIN_X, y, 9.5, font, ink);
  y -= 13;
  text("at the vendor named above. Gate: verify count and sizes, then stamp the seal.", MARGIN_X, y, 9.5, font, ink);
  y -= 22;

  // Slab table
  const cols = {
    no: MARGIN_X,
    code: MARGIN_X + 26,
    label: MARGIN_X + 130,
    stone: MARGIN_X + 270,
    dims: MARGIN_X + 350,
    cft: PAGE_W - MARGIN_X - 44,
  };
  const hdr = (yy: number) => {
    page.drawRectangle({ x: MARGIN_X - 4, y: yy - 4, width: PAGE_W - 2 * MARGIN_X + 8, height: 17, color: rgb(0.96, 0.93, 0.88) });
    text("#", cols.no, yy, 8, bold, muted);
    text("Slab", cols.code, yy, 8, bold, muted);
    text("Label", cols.label, yy, 8, bold, muted);
    text("Stone", cols.stone, yy, 8, bold, muted);
    text("Size (in)", cols.dims, yy, 8, bold, muted);
    text("CFT", cols.cft, yy, 8, bold, muted);
  };
  hdr(y);
  y -= 21;

  let totCft = 0;
  let n = 0;
  for (const s of inp.slabs) {
    if (y < BOTTOM + 40) { page = newPage(); y = CONTENT_TOP; hdr(y); y -= 21; }
    n += 1;
    const c = cft(s.lengthIn, s.widthIn, s.thicknessIn);
    totCft += c;
    text(String(n), cols.no, y, 8, font);
    text(s.code, cols.code, y, 8, font);
    text((s.label ?? "").slice(0, 24), cols.label, y, 8, font);
    text((s.stone ?? "").slice(0, 13), cols.stone, y, 8, font);
    text(`${s.lengthIn}x${s.widthIn}x${s.thicknessIn}`, cols.dims, y, 8, font);
    text(c.toFixed(2), cols.cft, y, 8, font);
    y -= 14;
  }
  y -= 4;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.7, color: muted });
  y -= 16;

  if (y < BOTTOM + 50) { page = newPage(); y = CONTENT_TOP; }
  text(`Total slabs: ${inp.slabs.length}`, MARGIN_X, y, 10, bold, accent);
  text(`Total CFT: ${totCft.toFixed(2)}`, MARGIN_X + 170, y, 10, bold, accent);
  y -= 28;

  // Three sign-off / seal blocks. Keep them together on the page.
  if (y < BOTTOM + 120) { page = newPage(); y = CONTENT_TOP; }
  const colW = (PAGE_W - 2 * MARGIN_X - 2 * 16) / 3;
  const x0 = MARGIN_X;
  const x1 = MARGIN_X + colW + 16;
  const x2 = MARGIN_X + 2 * (colW + 16);
  const lineY = y - 56;
  for (const x of [x0, x1, x2]) {
    page.drawLine({ start: { x, y: lineY }, end: { x: x + colW, y: lineY }, thickness: 0.7, color: ink });
  }
  // Security column gets a seal box above its line.
  page.drawRectangle({ x: x2, y: lineY + 8, width: colW, height: 40, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.7 });
  text("Gate seal", x2 + 4, lineY + 30, 7.5, font, muted);

  text("Issued by (MTCPL)", x0, lineY - 12, 8, bold, ink);
  text(san(inp.issuedByName || "—"), x0, lineY - 24, 8, font, muted);
  text("Carrier / Driver", x1, lineY - 12, 8, bold, ink);
  text("Name & signature", x1, lineY - 24, 8, font, muted);
  text("Security — Gate", x2, lineY - 12, 8, bold, ink);
  text("Sign & stamp on exit", x2, lineY - 24, 8, font, muted);

  return await pdf.save();
}
