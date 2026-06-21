// ──────────────────────────────────────────────────────────────────
// Installation Vendor Contract — letterhead PDF (Invoicing, Mig 148/149)
//
// Formal contract printed on /public/letterhead.pdf. The user picks an
// installation vendor + project site + a RATE (per CFT / SFT / install /
// piece, or a lump sum). Flows onto a 2nd letterhead page if the content
// is long — never overflows. Header (CONTRACT no + date), recital, a
// bordered Project + Vendor block, the contract rate (figures + words),
// the standard clauses (scope, value, payment, MATERIAL & DAMAGE,
// quality, labour, timeline) with bold headings, and two signatures.
// ──────────────────────────────────────────────────────────────────

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export type InstallContractInput = {
  contractNo: string | null;
  dateIso: string | null;
  vendorName: string;
  vendorContact: string | null;
  vendorPhone: string | null;
  vendorAddress: string | null;
  vendorGstin: string | null;
  siteProject: string;
  siteLocation: string | null;
  price: number;
  priceUnit: string | null; // cft | sft | installation | piece | lump
  priceWords: string | null;
  scopeNote: string | null;
  cancelled?: boolean;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const CONTENT_W = PAGE_W - 2 * MARGIN_X;
const CONTENT_TOP = 620; // below the letterhead header (continuation pages)
const CONTENT_BOTTOM = 96; // above the letterhead footer

function san(s: string | null | undefined): string {
  return (s ?? "").replace(/₹/g, "Rs.").replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");
}
function rs(n: number) {
  return "Rs. " + (Math.round(n * 100) / 100).toLocaleString("en-IN");
}
function unitLabel(u: string | null): string {
  switch ((u ?? "cft").toLowerCase()) {
    case "sft": return "per SFT";
    case "installation": return "per installation";
    case "piece": return "per piece";
    case "lump": return "";
    default: return "per CFT";
  }
}
function fmtDate(iso: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso.length <= 10 ? `${iso}T00:00:00+05:30` : iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
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

export async function buildInstallContractPdf(inp: InstallContractInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Installation Contract ${san(inp.contractNo) || ""}`.trim());
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

  // ── Page + flow cursor (auto page-break onto a fresh letterhead) ────
  const drawLh = (p: PDFPage) => {
    if (lhEmbed) p.drawPage(lhEmbed, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  };
  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  drawLh(page);
  let y = CONTENT_TOP;
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    drawLh(page);
    y = CONTENT_TOP;
  };
  const ensure = (h: number) => {
    if (y - h < CONTENT_BOTTOM) newPage();
  };

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x, y: yy, size, font: f, color });
  const ctr = (s: string, cx: number, yy: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x: cx - f.widthOfTextAtSize(san(s), size) / 2, y: yy, size, font: f, color });
  const right = (s: string, xR: number, yy: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(san(s), { x: xR - f.widthOfTextAtSize(san(s), size), y: yy, size, font: f, color });
  const strokeBox = (p: PDFPage, x1: number, yTop: number, x2: number, yBot: number, c: RGB, w: number) => {
    p.drawLine({ start: { x: x1, y: yTop }, end: { x: x2, y: yTop }, thickness: w, color: c });
    p.drawLine({ start: { x: x1, y: yBot }, end: { x: x2, y: yBot }, thickness: w, color: c });
    p.drawLine({ start: { x: x1, y: yTop }, end: { x: x1, y: yBot }, thickness: w, color: c });
    p.drawLine({ start: { x: x2, y: yTop }, end: { x: x2, y: yBot }, thickness: w, color: c });
  };

  // ── Title (page 1, in the gap above the content area) ───────────────
  ctr("INSTALLATION WORK CONTRACT", PAGE_W / 2, 636, 15, bold, accent);
  text(`Contract No: ${san(inp.contractNo) || "-"}`, MARGIN_X, 619, 9.5, bold, ink);
  right(`Date: ${fmtDate(inp.dateIso)}`, PAGE_W - MARGIN_X, 619, 9.5, font, muted);
  y = 602;

  // ── Recital ─────────────────────────────────────────────────────────
  const recital =
    "This Installation Work Contract (\"Contract\") is made on the date stated above between " +
    "Mateshwari Temple Construction Pvt Ltd, Pindwara, Sirohi, Rajasthan (\"the Company\"), and the " +
    "Contractor named below (\"the Contractor\"), for the stone installation work at the project site " +
    "stated below, on the following terms and conditions:";
  for (const ln of wrap(recital, font, 9, CONTENT_W)) {
    text(ln, MARGIN_X, y, 9, font, ink);
    y -= 12;
  }

  // ── Project + Vendor block (two columns, bordered) ──────────────────
  y -= 6;
  const boxTop = y;
  const colLx = MARGIN_X + 10;
  const colRx = MARGIN_X + CONTENT_W / 2 + 8;
  const colW = CONTENT_W / 2 - 18;
  const kv = (label: string, value: string | null | undefined, x: number, yy: number, maxW: number): number => {
    text(label, x, yy, 7.5, bold, muted);
    let yyy = yy - 11;
    for (const ln of wrap(value && value.trim() ? value : "-", font, 9.5, maxW)) {
      text(ln, x, yyy, 9.5, font, ink);
      yyy -= 12;
    }
    return yyy;
  };

  let ly = boxTop - 14;
  text("PROJECT / SITE", colLx, ly, 7.5, bold, accent);
  ly -= 13;
  let lyy = kv("Temple / Project", inp.siteProject, colLx, ly, colW);
  lyy = kv("Site Location", inp.siteLocation, colLx, lyy - 2, colW);

  let ry = boxTop - 14;
  text("CONTRACTOR / VENDOR", colRx, ry, 7.5, bold, accent);
  ry -= 13;
  let ryy = kv("Name", inp.vendorName, colRx, ry, colW);
  ryy = kv("Contact / Phone", [inp.vendorContact, inp.vendorPhone].filter(Boolean).join(" · ") || null, colRx, ryy - 2, colW);
  ryy = kv("GSTIN", inp.vendorGstin, colRx, ryy - 2, colW);
  ryy = kv("Address", inp.vendorAddress, colRx, ryy - 2, colW);

  const boxBottom = Math.min(lyy, ryy) - 4;
  strokeBox(page, MARGIN_X, boxTop + 2, PAGE_W - MARGIN_X, boxBottom, lineCol, 0.8);

  // ── Contract rate band ──────────────────────────────────────────────
  const isLump = (inp.priceUnit ?? "cft").toLowerCase() === "lump";
  const uLabel = unitLabel(inp.priceUnit);
  y = boxBottom - 18;
  page.drawRectangle({ x: MARGIN_X, y: y - 7, width: CONTENT_W, height: 22, color: headBg });
  text(isLump ? "CONTRACT VALUE" : "CONTRACT RATE", MARGIN_X + 8, y, 9.5, bold, accent);
  right(isLump ? rs(inp.price) : `${rs(inp.price)} ${uLabel}`, PAGE_W - MARGIN_X - 8, y, 13, bold, accent);
  y -= 20;
  if (inp.priceWords) {
    const wordsLine = `Rupees ${inp.priceWords} only${isLump ? "" : ` ${uLabel}`}.`;
    for (const ln of wrap(wordsLine, bold, 8.5, CONTENT_W)) {
      text(ln, MARGIN_X, y, 8.5, bold, ink);
      y -= 11;
    }
  }

  // ── Clauses (flow onto page 2 if needed) ────────────────────────────
  const valueClause = isLump
    ? `The total agreed value for the entire scope of work is ${rs(inp.price)}` +
      (inp.priceWords ? ` (Rupees ${inp.priceWords} only)` : "") +
      ", inclusive of the Contractor's labour and charges. Any GST / taxes, if applicable, shall be as per law."
    : `The agreed rate for the work is ${rs(inp.price)} ${uLabel}` +
      (inp.priceWords ? ` (Rupees ${inp.priceWords} only ${uLabel})` : "") +
      ". The final contract value is this rate applied to the actual measured / installed quantity, payable " +
      "on verified joint measurement. Any GST / taxes, if applicable, shall be as per law.";

  const clauses: Array<{ heading: string; body: string; boldBody?: boolean }> = [
    {
      heading: "1. Scope of Work",
      body:
        (inp.scopeNote && inp.scopeNote.trim() ? inp.scopeNote.trim() + " " : "") +
        "The Contractor shall carry out the complete installation and fixing of the carved and finished stone " +
        "supplied by the Company at the above project site, strictly as per the Company's drawings, designs and " +
        "on-site instructions, using the Contractor's own skilled labour, tools and tackle.",
    },
    { heading: "2. Contract Rate & Value", body: valueClause },
    {
      heading: "3. Payment Terms",
      body:
        "Payment shall be released against verified progress at the Company's discretion. Part / running payments " +
        "may be made during the work; the FULL AND FINAL PAYMENT IS RELEASED ONLY AFTER THE WORK IS FULLY COMPLETED " +
        "AND APPROVED BY THE COMPANY. No payment is due for incomplete, defective or unapproved work.",
    },
    {
      heading: "4. Material & Damage Liability",
      boldBody: true,
      body:
        "All stone and material at the site remains the property of the Company at all times. ANY DAMAGE, BREAKAGE, " +
        "CHIPPING OR LOSS TO THE STONE OR MATERIAL AT THE SITE, CAUSED DURING HANDLING, SHIFTING OR INSTALLATION, IS " +
        "SOLELY THE CONTRACTOR'S RESPONSIBILITY, AND ITS COST SHALL BE RECOVERED FROM THE CONTRACTOR'S DUES.",
    },
    {
      heading: "5. Quality & Workmanship",
      body:
        "All work shall be executed in a proper, workmanlike manner to the Company's satisfaction and as per " +
        "temple-construction standards. Any defective work shall be rectified by the Contractor at its own cost.",
    },
    {
      heading: "6. Labour, Safety & Statutory",
      body:
        "The Contractor is solely responsible for its labour, their wages, safety, insurance and all statutory " +
        "compliances at the site. The Company shall have no liability whatsoever in this regard.",
    },
    {
      heading: "7. Timeline & General",
      body:
        "The work shall be completed within the time mutually agreed at the site, and shall not be abandoned or " +
        "delayed without the Company's written consent. This Contract is governed by the laws of India and subject " +
        "to the jurisdiction of the courts at Sirohi, Rajasthan.",
    },
  ];

  y -= 6;
  const CS = 8;
  const CLH = 10.5;
  for (const c of clauses) {
    const bodyFont = c.boldBody ? bold : font;
    const lines = wrap(c.body, bodyFont, CS, CONTENT_W);
    ensure(11 + lines.length * CLH + 6);
    text(c.heading, MARGIN_X, y, 8.5, bold, accent);
    y -= 11;
    for (const ln of lines) {
      text(ln, MARGIN_X, y, CS, bodyFont, c.boldBody ? ink : muted);
      y -= CLH;
    }
    y -= 4;
  }

  // ── Signatures (flow with the clauses) ──────────────────────────────
  ensure(56);
  y -= 22;
  const sigLineY = y;
  const sigLabelY = y - 13;
  page.drawLine({ start: { x: MARGIN_X, y: sigLineY }, end: { x: MARGIN_X + 210, y: sigLineY }, thickness: 0.7, color: ink });
  text("For Mateshwari Temple Construction Pvt Ltd", MARGIN_X, sigLabelY, 8, font, muted);
  text("(Authorised Signatory & Company Seal)", MARGIN_X, sigLabelY - 11, 7.5, font, muted);
  page.drawLine({ start: { x: PAGE_W - MARGIN_X - 210, y: sigLineY }, end: { x: PAGE_W - MARGIN_X, y: sigLineY }, thickness: 0.7, color: ink });
  text("Contractor / Vendor (Signature)", PAGE_W - MARGIN_X - 210, sigLabelY, 8, font, muted);
  text(san(inp.vendorName), PAGE_W - MARGIN_X - 210, sigLabelY - 11, 7.5, font, muted);

  // ── CANCELLED stamp on every page (soft-deleted) ────────────────────
  if (inp.cancelled) {
    const red = rgb(0.85, 0.12, 0.12);
    for (const p of pdf.getPages()) {
      p.drawLine({ start: { x: 28, y: PAGE_H - 28 }, end: { x: PAGE_W - 28, y: 28 }, thickness: 6, color: red, opacity: 0.45 });
      const big = "CANCELLED";
      p.drawText(big, { x: (PAGE_W - bold.widthOfTextAtSize(big, 60)) / 2, y: PAGE_H / 2 + 6, size: 60, font: bold, color: red, opacity: 0.5 });
      const sub = "(NOT VALID)";
      p.drawText(sub, { x: (PAGE_W - bold.widthOfTextAtSize(sub, 26)) / 2, y: PAGE_H / 2 - 34, size: 26, font: bold, color: red, opacity: 0.5 });
    }
  }

  return await pdf.save();
}
