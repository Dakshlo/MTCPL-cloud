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
    /** Daksh May 2026 round 4 — surface the slab label (set at cut
     *  time, e.g. "Jali Embedment") + free-text description so the
     *  office can identify each piece without cross-referencing
     *  Required Sizes. */
    label?: string | null;
    description?: string | null;
    /** additional_description — shown after Description. */
    additional?: string | null;
    /** Category 1 = component_section, Category 2 = component_element.
     *  Shown after Additional, Cat 2 before Cat 1 (challan/invoice convention). */
    section?: string | null;
    element?: string | null;
  }>;
  /** Leftover "Reused" blocks restocked from this cut (Daksh Jul 2026). Rendered
   *  as a small section under the slabs — ONLY when at least one is present. */
  remainingBlocks?: Array<{ code: string; dims: string; location: string }>;
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

// pdf-lib's StandardFonts.Helvetica uses WinAnsi (Windows-1252)
// encoding. Anything outside that 256-char set (e.g. ″ U+2033 inch
// mark, ′ prime, em dash variants, smart quotes, the rupee sign)
// throws at drawText time. This map covers the chars we actually
// produce in this PDF — extend as needed. Unmapped chars fall back
// to "?" via the regex sweep below.
const WIN_ANSI_REPLACEMENTS: Record<string, string> = {
  "″": '"',   // ″ double prime → inch mark
  "′": "'",   // ′ prime
  "‘": "'",   // ' smart open single
  "’": "'",   // ' smart close single
  "“": '"',   // " smart open double
  "”": '"',   // " smart close double
  "–": "-",   // – en dash
  "—": "-",   // — em dash
  "…": "...", // … ellipsis
  " ": " ",   // nbsp
  "₹": "Rs.", // ₹ Indian rupee
};
function ansiSafe(input: string): string {
  let out = input;
  for (const [k, v] of Object.entries(WIN_ANSI_REPLACEMENTS)) {
    if (out.includes(k)) out = out.split(k).join(v);
  }
  // Strip anything still outside WinAnsi range (0x00–0xFF). The full
  // WinAnsi spec carves out a few high-bit slots, but for the chars
  // this PDF actually uses (× ·  em dash) WinAnsi has them mapped
  // explicitly, so the 0xFF cutoff is safe.
  return out.replace(/[^\x00-\xFF]/g, "?");
}

const COLOR_TEXT = rgb(0.1, 0.1, 0.1);
const COLOR_MUTED = rgb(0.45, 0.45, 0.45);
const COLOR_LABEL = rgb(0.31, 0.20, 0.07); // dark brown for label text
const COLOR_NOTE = rgb(0.40, 0.40, 0.45);  // slightly cool muted for descriptions
const COLOR_RULE = rgb(0.85, 0.82, 0.74);
const COLOR_ACCENT = rgb(0.71, 0.45, 0.20); // app gold
const COLOR_HEAD_BG = rgb(0.97, 0.95, 0.88); // pale gold for header row
const COLOR_ZEBRA = rgb(0.98, 0.97, 0.94);   // even-row tint for slab table

export async function generateCuttingDonePdf(
  input: CuttingDonePdfInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontReg = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_TOP;

  // Sanitised drawText wrapper — runs every string through ansiSafe()
  // so non-WinAnsi characters (″ ′ ₹ smart quotes etc.) can't blow up
  // pdf-lib mid-render. Closes over the live `page` reference so a
  // page-break inside ensureSpace flows transparently.
  function drawText(
    text: string,
    opts: Parameters<typeof page.drawText>[1],
  ) {
    // Important: call page.drawText (the pdf-lib method), NOT this
    // wrapper. The original first cut had a replace-all that
    // converted "page.drawText" → "drawText" everywhere and turned
    // this body into infinite recursion.
    page.drawText(ansiSafe(text), opts);
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN_TOP;
      drawHeader(true);
    }
  }

  function drawHeader(continuation = false) {
    drawText("MTCPL · Cutting Done Report", {
      x: MARGIN_X,
      y,
      size: 14,
      font: fontBold,
      color: COLOR_TEXT,
    });
    y -= 18;
    drawText(continuation ? "(continued)" : input.title, {
      x: MARGIN_X,
      y,
      size: 11,
      font: fontReg,
      color: COLOR_TEXT,
    });
    if (!continuation) {
      y -= 13;
      drawText(input.subtitle, {
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
    drawText("No blocks to report.", {
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
  drawText(
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
    const estimatedHeight = 40 + 14 * 3 + 16 * slabRows + (block.remainingBlocks?.length ?? 0) * 16 + 24 + 20;
    ensureSpace(estimatedHeight);

    // Block title bar — block code + stone, accent rule
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 18,
      width: PAGE_W - MARGIN_X * 2,
      height: 20,
      color: COLOR_HEAD_BG,
    });
    drawText(block.blockCode, {
      x: MARGIN_X + 6,
      y: y - 13,
      size: 12,
      font: fontBold,
      color: COLOR_TEXT,
    });
    const stoneText = `${block.stone}  ·  ${block.yard}  ·  ${block.blockDims}`;
    drawText(stoneText, {
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
      drawText(leftLabel, { x: xLeft, y, size: 8, font: fontBold, color: COLOR_MUTED });
      drawText(leftVal, { x: xLeft + 70, y, size: 9.5, font: fontReg, color: COLOR_TEXT });
      drawText(rightLabel, { x: xRight, y, size: 8, font: fontBold, color: COLOR_MUTED });
      drawText(rightVal, { x: xRight + 70, y, size: 9.5, font: fontReg, color: COLOR_TEXT });
      y -= 14;
    }
    metaRow("CUT DATE", block.cutDate, "SESSION", block.sessionCode);
    metaRow("OPERATOR", block.operator, "PLAN GEN", block.planGenerator);
    metaRow("APPROVED BY", block.approvedBy, "", "");

    y -= 4;

    // Slab table — Daksh May 2026 round 5: redesigned for legibility
    // on tall lists. Zebra-striped row background (subtle gold tint
    // on every other row), wider temple column so names don't get
    // ellipsised to "UMIYA MATAJI TEMPLE AHM...", and combined
    // label + description into one indented sub-line per slab when
    // the slab has either. Fixed indent so the eye can track the
    // hierarchy down the page.
    if (block.slabs.length === 0) {
      drawText("No slabs linked to this cut.", {
        x: MARGIN_X + 4,
        y,
        size: 9,
        font: fontReg,
        color: COLOR_MUTED,
      });
      y -= 16;
    } else {
      // Mobile-first per-slab layout (Daksh, Jun 2026): one block per slab,
      // read top-to-bottom on a phone. A tinted bar HIGHLIGHTS the code + size;
      // below it the detail in order — Label, Description, Additional, Category 2,
      // Category 1 — each label:value, long values word-wrapped. A gap + rule
      // separates slabs so a long list stays scannable.
      const LEFT = MARGIN_X;
      const RIGHT = PAGE_W - MARGIN_X;
      const PAD = 8;
      const LABEL_X = LEFT + PAD;
      const VALUE_X = LEFT + PAD + 84;
      const VALUE_W = RIGHT - PAD - VALUE_X;

      block.slabs.forEach((s, i) => {
        // Detail fields in the requested order; blanks dropped.
        const fields: Array<{ k: string; v: string; color: ReturnType<typeof rgb> }> = [];
        if (s.label && s.label.trim()) fields.push({ k: "Label", v: s.label.trim(), color: COLOR_LABEL });
        if (s.description && s.description.trim()) fields.push({ k: "Description", v: s.description.trim(), color: COLOR_NOTE });
        if (s.additional && s.additional.trim()) fields.push({ k: "Additional", v: s.additional.trim(), color: COLOR_NOTE });
        if (s.element && s.element.trim()) fields.push({ k: "Category 2", v: s.element.trim(), color: COLOR_ACCENT });
        if (s.section && s.section.trim()) fields.push({ k: "Category 1", v: s.section.trim(), color: COLOR_ACCENT });

        // Pre-wrap so we can size the block + never orphan the code bar.
        const wrapped = fields.map((f) => ({ ...f, lines: wrapText(f.v, fontReg, 10.5, VALUE_W) }));
        const templeLine = s.temple && s.temple !== "—" ? wrapText(s.temple, fontReg, 9.5, RIGHT - PAD - (LEFT + PAD + 50)) : [];
        const fieldsH = wrapped.reduce((a, f) => a + f.lines.length * 13 + 3, 0);
        const blockH = 28 /*bar*/ + templeLine.length * 14 + fieldsH + 16 /*gap+rule*/;
        ensureSpace(blockH);

        // Code + size bar — highlighted.
        page.drawRectangle({ x: LEFT, y: y - 18, width: RIGHT - LEFT, height: 22, color: COLOR_HEAD_BG });
        drawText(`${i + 1}.`, { x: LABEL_X, y: y - 12, size: 10, font: fontBold, color: COLOR_MUTED });
        drawText(s.id, { x: LABEL_X + 20, y: y - 13, size: 13, font: fontBold, color: COLOR_TEXT });
        const sizeW = fontBold.widthOfTextAtSize(ansiSafe(s.dims), 11.5);
        drawText(s.dims, { x: RIGHT - PAD - sizeW, y: y - 12, size: 11.5, font: fontBold, color: COLOR_ACCENT });
        y -= 26;

        // Temple — context line under the bar (muted).
        if (templeLine.length > 0) {
          drawText("Temple", { x: LABEL_X, y, size: 8, font: fontBold, color: COLOR_MUTED });
          templeLine.forEach((ln, li) => {
            drawText(ln, { x: LABEL_X + 50, y, size: 9.5, font: fontReg, color: COLOR_MUTED });
            if (li < templeLine.length - 1) y -= 12;
          });
          y -= 14;
        }

        // Detail fields.
        for (const f of wrapped) {
          drawText(f.k, { x: LABEL_X, y, size: 8.5, font: fontBold, color: COLOR_MUTED });
          f.lines.forEach((ln, li) => {
            drawText(ln, { x: VALUE_X, y, size: 10.5, font: f.k === "Label" ? fontBold : fontReg, color: f.color });
            if (li < f.lines.length - 1) y -= 13;
          });
          y -= 16;
        }

        // Gap + separator between slabs.
        y -= 2;
        page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.4, color: COLOR_RULE });
        y -= 12;
      });
    }

    // Remaining block(s) — leftover pieces restocked from this cut. Only shown
    // when present (Daksh Jul 2026). code · dims · location, one per line.
    const remaining = block.remainingBlocks ?? [];
    if (remaining.length > 0) {
      ensureSpace(20 + remaining.length * 16 + 6);
      drawText(`REMAINING BLOCK${remaining.length === 1 ? "" : "S"}`, { x: MARGIN_X + 4, y, size: 8.5, font: fontBold, color: COLOR_ACCENT });
      y -= 15;
      remaining.forEach((r) => {
        drawText(r.code, { x: MARGIN_X + 8, y, size: 11, font: fontBold, color: COLOR_TEXT });
        drawText(`${r.dims}   ·   ${r.location}`, { x: MARGIN_X + 120, y, size: 10, font: fontReg, color: COLOR_MUTED });
        y -= 16;
      });
      y -= 4;
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

// Word-wrap a value to fit maxWidth, measured with the real font metrics so the
// per-slab detail reads top-to-bottom on a phone. Hard-breaks an over-long word;
// caps at `maxLines` (last line gets an ellipsis) to keep one field from running away.
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 4): string[] {
  const safe = ansiSafe(text);
  const words = safe.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  const push = (s: string) => lines.push(s);
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (!line || font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      push(line);
      line = w;
    }
    // Hard-break a single word that's wider than the line.
    while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--;
      push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, "…");
  }
  return lines;
}
