// ──────────────────────────────────────────────────────────────────
// Blank company document — letterhead PDF (standalone, NOT tied to any
// system record). A printable MTCPL letterhead with:
//   • logo + accent rule at the top (from /public/letterhead.pdf),
//   • the full address / contact footer at the bottom (also letterhead),
//   • the standard jobwork / vendor terms near the bottom,
//   • a single "Vendor signature" line,
//   • an intentionally BLANK middle so the owner can fill it by hand for
//     any vendor dealing.
// Built with pdf-lib on the same letterhead the work-order doc uses.
// ──────────────────────────────────────────────────────────────────

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;

// pdf-lib StandardFonts cover WinAnsi only — swap the rupee glyph and drop
// anything outside Latin-1 (mirror of work-order-pdf.ts san()).
function san(s: string): string {
  return (s ?? "").replace(/₹/g, "Rs.").replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");
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

// Standard jobwork / vendor terms — mirror of work-order-pdf.ts so this
// standalone blank document carries the same terms without a work order.
const TERMS = [
  "Terms:",
  "1. The above slabs are handed over to the vendor for carving / jobwork only.",
  "2. The material remains the property of Mateshwari Temple Construction Pvt Ltd at all times.",
  "3. The vendor is responsible for safe custody and the quality of the work until returned.",
  "4. Payment is on the agreed rate above, against approved / received work only.",
  "5. Only a part-payment is released; the balance is held until the carved slab is",
  "   successfully installed at the site.",
  "6. Any installation problem caused by a carving or handling defect remains the vendor's",
  "   responsibility to help rectify. The full and final payment is released only after our",
  "   client approves and releases the payment to us, and 90 days after that release.",
];

export async function buildBlankVendorDoc(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("MTCPL document");
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

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  if (lhEmbed) page.drawPage(lhEmbed, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  // Accent rule just under the letterhead logo — frames the blank writing
  // area below it.
  const RULE_Y = PAGE_H - 150;
  page.drawLine({
    start: { x: MARGIN_X, y: RULE_Y },
    end: { x: PAGE_W - MARGIN_X, y: RULE_Y },
    thickness: 1,
    color: accent,
  });

  // ── Intentionally blank middle (write the deal / slabs / rate by hand) ──

  // Terms near the bottom.
  let y = 300;
  for (const line of TERMS) {
    const isHead = line === "Terms:";
    page.drawText(san(line), {
      x: MARGIN_X,
      y,
      size: isHead ? 9 : 8,
      font: isHead ? bold : font,
      color: isHead ? ink : muted,
    });
    y -= 13;
  }

  // Single Vendor signature line at the bottom (above the letterhead footer).
  const sigY = 138;
  page.drawLine({
    start: { x: PAGE_W - MARGIN_X - 200, y: sigY },
    end: { x: PAGE_W - MARGIN_X, y: sigY },
    thickness: 0.7,
    color: ink,
  });
  page.drawText(san("Vendor signature"), {
    x: PAGE_W - MARGIN_X - 200,
    y: sigY - 12,
    size: 8,
    font,
    color: muted,
  });

  return await pdf.save();
}
