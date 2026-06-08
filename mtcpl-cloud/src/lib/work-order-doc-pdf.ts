// ──────────────────────────────────────────────────────────────────
// Manual Work Order Document — letterhead PDF (Invoicing, Mig 105)
//
// Standalone: NOT linked to carving work orders or any incoming logic.
// All values are typed by hand on /invoicing/work-order-doc. Prints on the
// company letterhead in the format we already use: header fields (vendor /
// address / job-work description + no. / date), a single line item
// (unit · quantity · rate · total), the standard terms, and a Vendor
// signature line. Built with pdf-lib on /public/letterhead.pdf.
// ──────────────────────────────────────────────────────────────────

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type WorkOrderDocInput = {
  vendor: string;
  address: string | null;
  jobDescription: string | null;
  descriptionDetail?: string | null;
  jobWorkNo: string | null;
  dateIso: string | null;
  unit: "cft" | "sft";
  quantity: number;
  rate: number;
  total: number;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;

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
  return lines;
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

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  if (lhEmbed) page.drawPage(lhEmbed, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  const text = (s: string, x: number, y: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, y: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x: xRight - f.widthOfTextAtSize(san(s), size), y, size, font: f, color });

  // ── Header block (below the letterhead's own divider line) ──────────
  let y = 632;
  text("WORK ORDER", MARGIN_X, y, 15, bold, accent);
  right(`No: ${inp.jobWorkNo || "-"}`, PAGE_W - MARGIN_X, y + 2, 10, bold, ink);
  right(`Date: ${fmtDate(inp.dateIso)}`, PAGE_W - MARGIN_X, y - 12, 9, font, muted);
  y -= 30;

  const labelW = 96;
  const valX = MARGIN_X + labelW;
  const valW = PAGE_W - MARGIN_X - valX;

  text("Vendor:", MARGIN_X, y, 10, bold, muted);
  for (const ln of wrap(inp.vendor, font, 11, valW)) {
    text(ln, valX, y, 11, bold, ink);
    y -= 15;
  }
  y -= 3;

  if (inp.address && inp.address.trim()) {
    text("Address:", MARGIN_X, y, 10, bold, muted);
    const addrLines = wrap(inp.address, font, 10, valW);
    for (let i = 0; i < addrLines.length; i++) {
      text(addrLines[i], valX, y, 10, font, ink);
      y -= 14;
    }
    y -= 3;
  }

  if (inp.jobDescription && inp.jobDescription.trim()) {
    text("Job work:", MARGIN_X, y, 10, bold, muted);
    const descLines = wrap(inp.jobDescription, font, 10, valW);
    for (let i = 0; i < descLines.length; i++) {
      text(descLines[i], valX, y, 10, font, ink);
      y -= 14;
    }
    y -= 3;
  }

  if (inp.descriptionDetail && inp.descriptionDetail.trim()) {
    text("Details:", MARGIN_X, y, 10, bold, muted);
    const detailLines = wrap(inp.descriptionDetail, font, 10, valW);
    for (let i = 0; i < detailLines.length; i++) {
      text(detailLines[i], valX, y, 10, font, ink);
      y -= 14;
    }
    y -= 3;
  }

  // ── Line-item table: Unit · Quantity · Rate · Total ─────────────────
  y -= 12;
  const cols = {
    unit: MARGIN_X + 6,
    qty: MARGIN_X + 150,
    rate: MARGIN_X + 300,
    total: PAGE_W - MARGIN_X - 6,
  };
  page.drawRectangle({ x: MARGIN_X, y: y - 4, width: PAGE_W - 2 * MARGIN_X, height: 18, color: headBg });
  text("Unit", cols.unit, y, 9, bold, muted);
  text("Quantity", cols.qty, y, 9, bold, muted);
  text("Rate", cols.rate, y, 9, bold, muted);
  right("Total", cols.total, y, 9, bold, muted);
  y -= 22;
  text(inp.unit.toUpperCase(), cols.unit, y, 11, font, ink);
  text(String(Math.round(inp.quantity * 1000) / 1000), cols.qty, y, 11, font, ink);
  text(`${rs(inp.rate)} / ${inp.unit.toUpperCase()}`, cols.rate, y, 10, font, ink);
  right(rs(inp.total), cols.total, y, 12, bold, ink);
  y -= 10;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.7, color: muted });
  y -= 18;
  right(`Total: ${rs(inp.total)}`, PAGE_W - MARGIN_X, y, 12, bold, accent);

  // ── Terms (full width), anchored near the bottom ────────────────────
  const contentW = PAGE_W - 2 * MARGIN_X;
  const TSIZE = 8.5;
  const LH = 13;
  const bodyLines: { text: string; indent: boolean }[] = [];
  for (const t of TERMS) {
    wrap(t, font, TSIZE, contentW).forEach((ln, i) => bodyLines.push({ text: ln, indent: i > 0 }));
  }
  const sigLabelY = 108;
  const sigLineY = sigLabelY + 14;
  const termsBottomY = sigLineY + 30;
  let ty = termsBottomY + bodyLines.length * LH;
  text("Terms:", MARGIN_X, ty, 9.5, bold, ink);
  ty -= LH;
  for (const ln of bodyLines) {
    text(ln.text, MARGIN_X + (ln.indent ? 12 : 0), ty, TSIZE, font, muted);
    ty -= LH;
  }

  // ── Vendor signature (bottom-right) ─────────────────────────────────
  page.drawLine({ start: { x: PAGE_W - MARGIN_X - 220, y: sigLineY }, end: { x: PAGE_W - MARGIN_X, y: sigLineY }, thickness: 0.7, color: ink });
  text("Vendor signature", PAGE_W - MARGIN_X - 220, sigLabelY, 8.5, font, muted);

  return await pdf.save();
}
