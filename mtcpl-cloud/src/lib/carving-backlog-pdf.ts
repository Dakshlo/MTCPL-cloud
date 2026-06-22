// Carving "Done Approval" backlog sheet — the PDF attached to the backlog
// WhatsApp alert. Vendor-grouped slab cards, each with the app's 3D stone
// block thumbnail. Built with pdf-lib (same toolchain as the daily report).
//
// Kept self-contained: callers pass already-aggregated, vendor-grouped data.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getStonePalette, type StoneTypeDef } from "@/lib/stone-utils";

export type BacklogSlab = {
  code: string;
  temple: string;
  label: string | null;
  stone: string | null;
  l: number;
  w: number;
  t: number;
  location: string | null;
  /** ISO timestamp the slab was marked carving-done (waiting since). */
  completedAt: string | null;
};

export type BacklogVendor = { name: string; slabs: BacklogSlab[] };

export type BacklogPdfData = {
  total: number;
  vendors: BacklogVendor[];
  stoneTypes: Pick<StoneTypeDef, "name" | "color_top" | "color_front" | "color_side">[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hexRgb(hex: string) {
  const h = (hex || "").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return rgb(Number.isNaN(r) ? 0.72 : r, Number.isNaN(g) ? 0.72 : g, Number.isNaN(b) ? 0.72 : b);
}

// Reproduce IsoBlockStaticSVG's fixed-angle projection for a single block,
// returning SVG path strings (y-down, ≥0) for the three visible faces plus
// the local box size. Drawn with pdf-lib drawSvgPath (which uses the SVG
// y-down convention from the anchor).
function isoBlockPaths(l: number, w: number, t: number, sizePx: number) {
  const L = Math.max(0.1, l), W = Math.max(0.1, w), H = Math.max(0.1, t);
  const C = Math.cos(Math.PI / 6), S = 0.5;
  const az = Math.PI * 0.25, Ca = Math.cos(az), Sa = Math.sin(az);
  const diag = Math.sqrt(L * L + W * W);
  const scale = Math.min(sizePx / (diag * C + 4), (sizePx * 0.6) / (diag * S + H + 4), 30);
  const raw = (x: number, y: number, z: number) => ({
    x: (x * Ca - y * Sa) * C * scale,
    y: (x * Sa + y * Ca) * S * scale - z * scale,
  });
  const cornerDefs: [number, number, number][] = [
    [0, 0, 0], [L, 0, 0], [0, W, 0], [L, W, 0], [0, 0, H], [L, 0, H], [0, W, H], [L, W, H],
  ];
  const corners = cornerDefs.map(([x, y, z]) => raw(x, y, z));
  const pad = 3;
  const minX = Math.min(...corners.map((p) => p.x)) - pad;
  const minY = Math.min(...corners.map((p) => p.y)) - pad;
  const maxX = Math.max(...corners.map((p) => p.x)) + pad;
  const maxY = Math.max(...corners.map((p) => p.y)) + pad;
  const pt = (x: number, y: number, z: number) => {
    const p = raw(x, y, z);
    return `${(p.x - minX).toFixed(1)} ${(p.y - minY).toFixed(1)}`;
  };
  const poly = (pts: string[]) => `M ${pts.join(" L ")} Z`;
  return {
    width: maxX - minX,
    height: maxY - minY,
    // Sa>=0 → far +Y face shown; Ca>=0 → far +X face shown.
    front: poly([pt(0, W, 0), pt(L, W, 0), pt(L, W, H), pt(0, W, H)]),
    side: poly([pt(L, 0, 0), pt(L, W, 0), pt(L, W, H), pt(L, 0, H)]),
    top: poly([pt(0, 0, H), pt(L, 0, H), pt(L, W, H), pt(0, W, H)]),
  };
}

function waitLabelTone(completedAt: string | null): { label: string; tone: ReturnType<typeof rgb> } {
  const amber = rgb(0.7, 0.43, 0.04), red = rgb(0.64, 0.18, 0.18), green = rgb(0.15, 0.47, 0.1);
  if (!completedAt) return { label: "—", tone: green };
  const min = Math.max(0, Math.floor((Date.now() - new Date(completedAt).getTime()) / 60000));
  let label: string;
  if (min < 60) label = `${min}m`;
  else if (min < 1440) label = `${Math.floor(min / 60)}h ${min % 60}m`;
  else label = `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
  const tone = min >= 2880 ? red : min >= 480 ? amber : green;
  return { label, tone };
}

export async function buildCarvingBacklogPdf(data: BacklogPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28, H = 841.89, M = 36;
  const contentW = W - 2 * M;
  const ink = rgb(0.13, 0.14, 0.17), muted = rgb(0.45, 0.48, 0.54), faint = rgb(0.6, 0.62, 0.67);
  const line = rgb(0.86, 0.87, 0.89), cardLine = rgb(0.82, 0.83, 0.86);
  const brown = rgb(0.71, 0.45, 0.2), info = rgb(0.11, 0.37, 0.65), infoBg = rgb(0.9, 0.94, 0.99);
  const okBg = rgb(0.91, 0.96, 0.9), ok = rgb(0.15, 0.47, 0.1);

  const roundPath = (w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
  };
  const mk = (pg: ReturnType<typeof pdf.addPage>) => ({
    pg,
    t: (s: string, x: number, y: number, sz: number, f = font, c = ink) => pg.drawText(s, { x, y, size: sz, font: f, color: c }),
    r: (s: string, xr: number, y: number, sz: number, f = font, c = ink) => pg.drawText(s, { x: xr - f.widthOfTextAtSize(s, sz), y, size: sz, font: f, color: c }),
    clip: (s: string, sz: number, maxW: number, f = font) => {
      if (f.widthOfTextAtSize(s, sz) <= maxW) return s;
      let out = s;
      while (out.length > 1 && f.widthOfTextAtSize(out + "…", sz) > maxW) out = out.slice(0, -1);
      return out + "…";
    },
  });

  const gen = new Date(Date.now() + 5.5 * 3600 * 1000);
  const genLabel = `${gen.getUTCDate()} ${MONTHS[gen.getUTCMonth()]} ${gen.getUTCFullYear()}, ${String(gen.getUTCHours()).padStart(2, "0")}:${String(gen.getUTCMinutes()).padStart(2, "0")} IST`;

  let pageNo = 0;
  const newPage = () => {
    const pg = pdf.addPage([W, H]);
    pageNo += 1;
    const P = mk(pg);
    P.t("MTCPL · Carving approval pending", M, 26, 7.5, font, faint);
    P.r(`Page ${pageNo}`, W - M, 26, 7.5, font, faint);
    P.pg.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: line });
    return P;
  };

  const headerHeight = (first: boolean) => (first ? 70 : 30);
  const drawHeader = (P: ReturnType<typeof mk>, first: boolean) => {
    const top = H - 40;
    if (first) {
      P.t("Carving Approval Pending", M, top, 19, bold, ink);
      P.t("MATESHWARI TEMPLE CONSTRUCTION PVT LTD", M, top - 14, 8, bold, muted);
      P.r(genLabel, W - M, top, 8.5, font, muted);
      const badge = `${data.total} waiting`;
      const bw = bold.widthOfTextAtSize(badge, 11) + 18;
      P.pg.drawSvgPath(roundPath(bw, 21, 6), { x: W - M - bw, y: top - 9, color: brown });
      P.pg.drawText(badge, { x: W - M - bw + 9, y: top - 23, size: 11, font: bold, color: rgb(1, 1, 1) });
      const yLine = top - 44;
      P.pg.drawLine({ start: { x: M, y: yLine }, end: { x: W - M, y: yLine }, thickness: 2, color: brown });
      return yLine - 18;
    }
    P.t("Carving Approval Pending (cont.)", M, top, 12, bold, muted);
    P.pg.drawLine({ start: { x: M, y: top - 8 }, end: { x: W - M, y: top - 8 }, thickness: 1, color: line });
    return top - 22;
  };

  const gap = 14, cardW = (contentW - gap) / 2, cardH = 74, rowGap = 10, boxSize = 46;
  const bottomLimit = 48;

  let P = newPage();
  let y = drawHeader(P, true);

  const ensure = (h: number) => {
    if (y - h < bottomLimit) {
      P = newPage();
      y = drawHeader(P, false);
    }
  };

  const drawCard = (x: number, yTop: number, s: BacklogSlab) => {
    const wt = waitLabelTone(s.completedAt);
    // Card body + left accent by waiting tone.
    P.pg.drawSvgPath(roundPath(cardW, cardH, 8), { x, y: yTop, color: rgb(1, 1, 1), borderColor: cardLine, borderWidth: 0.6 });
    P.pg.drawRectangle({ x, y: yTop - cardH, width: 3, height: cardH, color: wt.tone });
    // 3D block thumbnail (top-left).
    const pal = getStonePalette(s.stone ?? "", data.stoneTypes);
    const g = isoBlockPaths(s.l, s.w, s.t, boxSize);
    const bx = x + 10 + Math.max(0, (boxSize - g.width) / 2);
    const by = yTop - 10;
    P.pg.drawSvgPath(g.front, { x: bx, y: by, color: hexRgb(pal.front), borderColor: rgb(0, 0, 0), borderWidth: 0.4, borderOpacity: 0.12 });
    P.pg.drawSvgPath(g.side, { x: bx, y: by, color: hexRgb(pal.side), borderColor: rgb(0, 0, 0), borderWidth: 0.4, borderOpacity: 0.12 });
    P.pg.drawSvgPath(g.top, { x: bx, y: by, color: hexRgb(pal.top), borderColor: rgb(0, 0, 0), borderWidth: 0.4, borderOpacity: 0.12 });
    // Text column.
    const tx = x + 10 + boxSize + 12;
    const tw = x + cardW - 10 - tx;
    P.t(P.clip(s.code, 11, tw, bold), tx, yTop - 16, 11, bold, ink);
    const tl = `${s.temple}${s.label ? ` · ${s.label}` : ""}`;
    P.t(P.clip(tl, 8.5, tw), tx, yTop - 29, 8.5, font, muted);
    const dims = `${s.l}×${s.w}×${s.t} in${s.stone ? ` · ${s.stone}` : ""}`;
    P.t(P.clip(dims, 8.5, tw), tx, yTop - 41, 8.5, font, faint);
    P.t(`Waiting ${wt.label}`, tx, yTop - 56, 8.5, bold, wt.tone);
    if (s.location) P.t(P.clip(`@ ${s.location}`, 8, tw - 78, font), tx + 78, yTop - 56, 8, font, faint);
  };

  for (const v of data.vendors) {
    // Vendor section header.
    ensure(24 + cardH);
    const cnt = v.slabs.length;
    P.t(v.name, M, y, 12.5, bold, ink);
    const nameW = bold.widthOfTextAtSize(v.name, 12.5);
    if (cnt > 0) {
      const pill = `${cnt} pending`;
      const pw = font.widthOfTextAtSize(pill, 8.5) + 14;
      P.pg.drawSvgPath(roundPath(pw, 15, 7.5), { x: M + nameW + 8, y: y + 11, color: infoBg });
      P.t(pill, M + nameW + 8 + 7, y + 0.5, 8.5, font, info);
    } else {
      const pill = "No pending";
      const pw = font.widthOfTextAtSize(pill, 8.5) + 14;
      P.pg.drawSvgPath(roundPath(pw, 15, 7.5), { x: M + nameW + 8, y: y + 11, color: okBg });
      P.t(pill, M + nameW + 8 + 7, y + 0.5, 8.5, font, ok);
    }
    y -= 20;

    for (let i = 0; i < v.slabs.length; i += 2) {
      ensure(cardH + rowGap);
      drawCard(M, y, v.slabs[i]);
      if (v.slabs[i + 1]) drawCard(M + cardW + gap, y, v.slabs[i + 1]);
      y -= cardH + rowGap;
    }
    y -= 8;
  }

  return pdf.save();
}
