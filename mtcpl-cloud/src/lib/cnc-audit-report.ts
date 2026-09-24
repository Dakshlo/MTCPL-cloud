/**
 * CNC Audit sheet — what the software thinks is on every machine,
 * right now, in a form somebody can carry onto the floor and tick off.
 *
 * Daksh, Sep 2026: "fetch all CNC machines vendor wise and show on what
 * machine what slab is going… the purpose of this is to audit whether
 * our software is matched with actually working on plant."
 *
 * So this is deliberately NOT a summary. Counts and percentages are what
 * the wall display is for; an auditor needs the individual line — this
 * machine, this slab code — because the whole point is to stand in front
 * of machine 14 and check the code on the stone against the code on the
 * paper. Idle and under-maintenance machines are listed too: a machine
 * the software calls FREE that is actually cutting is exactly the kind of
 * drift this is meant to catch, and it cannot be caught by a sheet that
 * only lists busy machines.
 *
 * It reuses buildFloorViewData(), the same snapshot the wall display
 * runs on, so the audit and the TV can never disagree with each other.
 *
 * Every string is passed through winSafe() before it is drawn: pdf-lib's
 * standard Helvetica is WinAnsi-only and THROWS on anything outside it,
 * and one stray character in a temple or vendor name would take down the
 * whole send. The daily report learnt that the hard way.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { buildFloorViewData } from "@/lib/floor-view-data";
import type { FloorMachine, FloorVendor } from "@/app/(app)/carving/floor/floor-client";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Swap the typographic characters we actually emit for ASCII, then drop
 *  anything still outside Latin-1 so Helvetica can encode it. */
function winSafe(s: string): string {
  return (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[·•]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

/** "24 Sept 2026, 6:12 PM" in IST — the moment the sheet describes. */
export function auditStamp(d = new Date()): string {
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtHours(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  return `${h}h ${mins % 60}m`;
}

export type CncAuditTotals = {
  vendors: number;
  machines: number;
  running: number;
  idle: number;
  maintenance: number;
  slabs: number;
};

/** Build the audit PDF. Returns the bytes and the headline counts, which
 *  the caller puts in the WhatsApp message so the recipient knows the
 *  size of the job before opening the attachment. */
export async function buildCncAuditPdf(): Promise<{
  bytes: Uint8Array;
  totals: CncAuditTotals;
  stamp: string;
}> {
  const vendors = await buildFloorViewData();
  const stamp = auditStamp();
  const now = Date.now();

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595, H = 842, M = 34;          // A4 portrait
  const ink = rgb(0.13, 0.11, 0.06);
  const muted = rgb(0.48, 0.42, 0.32);
  const line = rgb(0.85, 0.82, 0.76);
  const gold = rgb(0.6, 0.45, 0.16);
  const green = rgb(0.08, 0.5, 0.24);
  const red = rgb(0.72, 0.15, 0.15);
  const blue = rgb(0.1, 0.35, 0.6);

  let page = pdf.addPage([W, H]);
  let y = H - M;

  const txt = (
    s: string, x: number, yy: number, size: number,
    f = font, color = ink,
  ) => page.drawText(winSafe(s), { x, y: yy, size, font: f, color });

  const rightTxt = (s: string, xRight: number, yy: number, size: number, f = font, color = ink) => {
    const safe = winSafe(s);
    page.drawText(safe, { x: xRight - f.widthOfTextAtSize(safe, size), y: yy, size, font: f, color });
  };

  /* Truncate to a real measured width, not a character count. Temple
     names run from "PALI GATE" to "SHRI BABA MASTNATH ROHTAK HARYANA";
     a fixed slice fitted one and overflowed the other straight into the
     SIZE column. */
  const fit = (raw: string, f: typeof font, size: number, maxW: number): string => {
    let t = winSafe(raw);
    if (f.widthOfTextAtSize(t, size) <= maxW) return t;
    while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, size) > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };

  const rule = (yy: number, color = line, thickness = 0.6) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness, color });

  /** Start a fresh page when the next block would not fit. */
  const need = (h: number) => {
    if (y - h > M + 26) return;
    footer();
    page = pdf.addPage([W, H]);
    y = H - M;
  };

  let pageNo = 0;
  const footer = () => {
    pageNo += 1;
    txt(`CNC Audit - ${stamp}`, M, M + 8, 8, font, muted);
    rightTxt(`Page ${pageNo}`, W - M, M + 8, 8, font, muted);
  };

  // ── Header ────────────────────────────────────────────────────────
  txt("CNC AUDIT", M, y - 20, 22, bold, ink);
  rightTxt(stamp, W - M, y - 19, 10, bold, muted);
  y -= 34;
  txt(
    "What the software believes is on each machine right now. Walk the floor and tick each line.",
    M, y, 9, font, muted,
  );
  y -= 8;
  rule(y, gold, 1.4);
  y -= 18;

  const totals: CncAuditTotals = {
    vendors: vendors.length, machines: 0, running: 0, idle: 0, maintenance: 0, slabs: 0,
  };
  for (const v of vendors) {
    for (const m of v.machines) {
      totals.machines += 1;
      if (m.status === "carving") { totals.running += 1; totals.slabs += m.current_jobs.length; }
      else if (m.status === "maintenance") totals.maintenance += 1;
      else if (m.status !== "inactive") totals.idle += 1;
    }
  }

  txt(
    `${totals.machines} machines - ${totals.running} running (${totals.slabs} slabs) - ${totals.idle} free - ${totals.maintenance} maintenance`,
    M, y, 10, bold, ink,
  );
  y -= 20;

  // ── One block per vendor ──────────────────────────────────────────
  for (const v of vendors as FloorVendor[]) {
    need(70);
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 20, color: rgb(0.96, 0.94, 0.90) });
    txt(fit(v.name, bold, 12, 260), M + 8, y - 11, 12, bold, ink);
    rightTxt(
      `${v.machines.length} CNC - ${v.totals.carving} running - ${v.totals.idle} free`,
      W - M - 8, y - 10, 9, bold, muted,
    );
    y -= 28;

    // Column header.
    txt("MACHINE", M + 2, y, 7.5, bold, muted);
    txt("SLAB CODE", M + 60, y, 7.5, bold, muted);
    txt("TEMPLE", M + 168, y, 7.5, bold, muted);
    txt("SIZE", M + 310, y, 7.5, bold, muted);
    txt("CFT", M + 386, y, 7.5, bold, muted);
    txt("RUNNING", M + 424, y, 7.5, bold, muted);
    rightTxt("TICK", W - M - 2, y, 7.5, bold, muted);
    y -= 5;
    rule(y);
    y -= 13;

    const machines = [...v.machines].sort((a, b) =>
      a.machine_code.localeCompare(b.machine_code, undefined, { numeric: true }),
    );

    for (const m of machines as FloorMachine[]) {
      const jobs = m.status === "carving" ? m.current_jobs : [];
      const rows = Math.max(1, jobs.length);
      need(rows * 15 + 10);

      // Tick box on every line — this is a sheet to mark up.
      const box = (yy: number) =>
        page.drawRectangle({
          x: W - M - 14, y: yy - 3, width: 10, height: 10,
          borderColor: line, borderWidth: 0.8,
        });

      if (jobs.length === 0) {
        const label =
          m.status === "maintenance" ? "MAINTENANCE"
            : m.status === "inactive" ? "INACTIVE"
              : "FREE";
        const colour = m.status === "maintenance" ? red : muted;
        txt(m.machine_code, M + 2, y, 10, bold, ink);
        txt(label, M + 60, y, 9, bold, colour);
        if (m.status === "maintenance" && m.maintenance_reason) {
          txt(fit(m.maintenance_reason, font, 8, 128), M + 168, y, 8, font, muted);
        } else if (m.idle_since) {
          txt(`idle ${fmtHours(now - new Date(m.idle_since).getTime())}`, M + 168, y, 8, font, muted);
        }
        box(y);
        y -= 15;
      } else {
        jobs.forEach((j, ji) => {
          if (ji === 0) txt(m.machine_code, M + 2, y, 10, bold, ink);
          txt(fit(j.slab_id, bold, 9.5, 104), M + 60, y, 9.5, bold, blue);
          const s = j.slab;
          if (s) {
            txt(fit(s.temple, font, 8, 128), M + 168, y, 8, font, muted);
            txt(fit(`${s.length_in}x${s.width_in}x${s.thickness_in}`, font, 8, 72), M + 310, y, 8, font, muted);
            const cft = (s.length_in * s.width_in * s.thickness_in) / 1728;
            txt(cft > 0 ? cft.toFixed(2) : "-", M + 386, y, 8, font, muted);
          }
          txt(j.loaded_at ? fmtHours(now - new Date(j.loaded_at).getTime()) : "-", M + 424, y, 8, font, green);
          box(y);
          y -= 15;
        });
      }
    }
    y -= 10;
  }

  need(40);
  rule(y, line);
  y -= 14;
  txt(
    "Anything that does not match: note the machine and slab code and send it to the office.",
    M, y, 8.5, font, muted,
  );

  footer();
  return { bytes: await pdf.save(), totals, stamp };
}
