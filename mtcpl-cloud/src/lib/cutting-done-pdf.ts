// ──────────────────────────────────────────────────────────────────
// Cutting Done summary PDF
// ──────────────────────────────────────────────────────────────────
// Daksh May 2026 round 3 — downloadable PDF of every "Done" block,
// either all of today's or a user-picked subset (from the
// select-by-tick modal). The report lists each block as a section
// with its cut metadata + the slabs that came out, in a clean
// table layout for handing to the office.
//
// Built with pdf-lib (same dependency the voucher PDF uses). No
// logo / no graphics — text-only so it stays fast to generate and
// small to download. Page break logic flows new pages when the
// current page runs out of room.
//
// Inputs are pre-resolved (block + slabs + lookups) — the caller
// does the Supabase queries and hands a structured array. Keeps
// this generator pure and easy to test.

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type DoneBlockSection = {
  /** Cut-session-block ID (so the office can cross-reference). */
  cutSessionBlockId: string;
  /** User-facing block code (e.g. "MT-B-387"). */
  blockCode: string;
  stone: string;
  yard: string;
  /** Block dimensions string (e.g. "53×30×29″" or "3.018 T" for marble). */
  blockDims: string;
  cutDate: string;          // formatted IST date + time
  operator: string;         // operator name or "—"
  planGenerator: string;    // profile.full_name or "—"
  sessionCode: string;      // "CS-2026-05-001" or "—"
  approvedBy: string;       // profile.full_name or "—"
  slabs: Array<{
    id: string;
    temple: string;
    dims: string;           // "36×3×4″"
  }>;
};

export type CuttingDonePdfInput = {
  /** Title shown at the top — "Cutting Done · Today" or
   *  "3 Selected Blocks" depending on mode. */
  title: string;
  /** Sub-title (e.g. "25 May 2026" for date-scoped, or "Picked from
   *  the Done bucket" for select mode). */
  subtitle: string;
  /** ISO timestamp of generation; shown in the footer. */
  generatedAt: string;
  /** Name of the person who downloaded — for the audit footer. */
  generatedBy: string;
  /** Pre-resolved block + slab data. */
  blocks: DoneBlockSection[];
};

const MARGIN_X = 36;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 40;
const PAGE_W = 595; // A4 portrait
const PAGE_H = 842;

const COLOR_TEXT = rgb(0.1, 0.1, 0.1);
const COLOR_MUTED = rgb(0.45, 0.45, 0.45);
const COLOR_RULE = rgb(0.85, 0.82, 0.74);
const COLOR_ACCENT = rgb(0.71, 0.45, 0.20); // app gold
const COLOR_HEAD_BG = rgb(0.97, 0.95, 0.88); // pale gold for header row

export async function generateCuttingDonePdf(
  input: CuttingDonePdfInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontReg = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_TOP;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN_TOP;
      drawHeader(true);
    }
  }

  function drawHeader(continuation = false) {
    page.drawText("MTCPL · Cutting Done Report", {
      x: MARGIN_X,
      y,
      size: 14,
      font: fontBold,
      color: COLOR_TEXT,
    });
    y -= 18;
    page.drawText(continuation ? "(continued)" : input.title, {
      x: MARGIN_X,
      y,
      size: 11,
      font: fontReg,
      color: COLOR_TEXT,
    });
    if (!continuation) {
      y -= 13;
      page.drawText(input.subtitle, {
        x: MARGIN_X,
        y,
        size: 9.5,
        font: fontReg,
        color: COLOR_MUTED,
      });
    }
    y -= 8;
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: PAGE_W - MARGIN_X, y },
      thickness: 1,
      color: COLOR_ACCENT,
    });
    y -= 14;
  }

  drawHeader();

  if (input.blocks.length === 0) {
    page.drawText("No blocks to report.", {
      x: MARGIN_X,
      y,
      size: 11,
      font: fontReg,
      color: COLOR_MUTED,
    });
  } else {
    for (const block of input.blocks) {
      drawBlockSection(block);
    }
  }

  // Footer on the last page.
  page.drawLine({
    start: { x: MARGIN_X, y: MARGIN_BOTTOM + 14 },
    end: { x: PAGE_W - MARGIN_X, y: MARGIN_BOTTOM + 14 },
    thickness: 0.5,
    color: COLOR_RULE,
  });
  page.drawText(
    `Generated ${input.generatedAt}  ·  by ${input.generatedBy}  ·  Computer-generated, no signature required`,
    {
      x: MARGIN_X,
      y: MARGIN_BOTTOM + 4,
      size: 7.5,
      font: fontReg,
      color: COLOR_MUTED,
    },
  );

  return pdf.save();

  function drawBlockSection(block: DoneBlockSection) {
    // Block header — title row + meta grid + slab table.
    // Estimate space: ~40px header + 14px per meta line + 16px per
    // slab row + 20px footer breathing room. Use a generous estimate.
    const slabRows = Math.max(1, block.slabs.length);
    const estimatedHeight = 40 + 14 * 3 + 16 * slabRows + 20;
    ensureSpace(estimatedHeight);

    // Block title bar — block code + stone, accent rule
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 18,
      width: PAGE_W - MARGIN_X * 2,
      height: 20,
      color: COLOR_HEAD_BG,
    });
    page.drawText(block.blockCode, {
      x: MARGIN_X + 6,
      y: y - 13,
      size: 12,
      font: fontBold,
      color: COLOR_TEXT,
    });
    const stoneText = `${block.stone}  ·  ${block.yard}  ·  ${block.blockDims}`;
    page.drawText(stoneText, {
      x: MARGIN_X + 110,
      y: y - 13,
      size: 10,
      font: fontReg,
      color: COLOR_MUTED,
    });
    y -= 28;

    // Meta grid — two columns, three rows: Cut date / Operator,
    // Plan gen / Session code, Approved by / (blank).
    function metaRow(leftLabel: string, leftVal: string, rightLabel: string, rightVal: string) {
      const xLeft = MARGIN_X + 4;
      const xRight = PAGE_W / 2 + 10;
      page.drawText(leftLabel, { x: xLeft, y, size: 8, font: fontBold, color: COLOR_MUTED });
      page.drawText(leftVal, { x: xLeft + 70, y, size: 9.5, font: fontReg, color: COLOR_TEXT });
      page.drawText(rightLabel, { x: xRight, y, size: 8, font: fontBold, color: COLOR_MUTED });
      page.drawText(rightVal, { x: xRight + 70, y, size: 9.5, font: fontReg, color: COLOR_TEXT });
      y -= 14;
    }
    metaRow("CUT DATE", block.cutDate, "SESSION", block.sessionCode);
    metaRow("OPERATOR", block.operator, "PLAN GEN", block.planGenerator);
    metaRow("APPROVED BY", block.approvedBy, "", "");

    y -= 4;

    // Slab table
    if (block.slabs.length === 0) {
      page.drawText("No slabs linked to this cut.", {
        x: MARGIN_X + 4,
        y,
        size: 9,
        font: fontReg,
        color: COLOR_MUTED,
      });
      y -= 16;
    } else {
      // Column headers
      const cols = [
        { x: MARGIN_X + 4, label: "#" },
        { x: MARGIN_X + 24, label: "SLAB ID" },
        { x: MARGIN_X + 150, label: "TEMPLE" },
        { x: PAGE_W - MARGIN_X - 90, label: "DIMENSIONS" },
      ];
      for (const c of cols) {
        page.drawText(c.label, {
          x: c.x,
          y,
          size: 8,
          font: fontBold,
          color: COLOR_MUTED,
        });
      }
      y -= 10;
      page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: PAGE_W - MARGIN_X, y },
        thickness: 0.5,
        color: COLOR_RULE,
      });
      y -= 12;

      block.slabs.forEach((s, i) => {
        ensureSpace(16);
        page.drawText(String(i + 1), {
          x: cols[0].x,
          y,
          size: 9,
          font: fontReg,
          color: COLOR_TEXT,
        });
        page.drawText(s.id, {
          x: cols[1].x,
          y,
          size: 9,
          font: fontMono,
          color: COLOR_TEXT,
        });
        page.drawText(truncate(s.temple, 24, fontReg, 9), {
          x: cols[2].x,
          y,
          size: 9,
          font: fontReg,
          color: COLOR_TEXT,
        });
        page.drawText(s.dims, {
          x: cols[3].x,
          y,
          size: 9,
          font: fontMono,
          color: COLOR_TEXT,
        });
        y -= 14;
      });
    }

    y -= 10;
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: PAGE_W - MARGIN_X, y },
      thickness: 0.4,
      color: COLOR_RULE,
    });
    y -= 12;
  }
}

// Truncate text to fit a max width — pdf-lib doesn't do this for us.
function truncate(text: string, maxChars: number, _font: PDFFont, _size: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}
