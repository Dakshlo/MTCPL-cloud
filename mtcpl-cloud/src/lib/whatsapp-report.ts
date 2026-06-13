// ──────────────────────────────────────────────────────────────────
// Daily WhatsApp work-report (MSG91 → Meta) — Daksh, June 2026.
//
// Every evening (6 PM IST cron) we:
//   1. aggregate the day's work  → buildDailyReportData()
//   2. render it as a PDF        → buildDailyReportPdf()
//   3. upload to a public bucket → public url
//   4. send the approved Utility template `daily_work_report` with the
//      PDF as its Document header + {{1}} = the date, to the configured
//      recipients, via MSG91's WhatsApp API.
//
// Reuses the existing MSG91 account auth key (MSG91_AUTH_KEY) — one key
// serves SMS + WhatsApp. No new secrets.
// ──────────────────────────────────────────────────────────────────

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// ── Config ──────────────────────────────────────────────────────────
const WA_BULK_URL = "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
// Template name + language are env-overridable so a rename in MSG91 (e.g.
// after a stuck edit) needs no redeploy — set MSG91_WA_TEMPLATE / _LANG.
const TEMPLATE_NAME = process.env.MSG91_WA_TEMPLATE || "mtcpl_daily_report";
const TEMPLATE_LANG = process.env.MSG91_WA_TEMPLATE_LANG || "en";
// The WhatsApp sender number registered on MSG91 (env override allowed).
const INTEGRATED_NUMBER = process.env.MSG91_WA_NUMBER || "917627065482";
// Recipients (env override: comma-separated). Country code added if a
// bare 10-digit number is given.
const DEFAULT_RECIPIENTS = ["8003689760", "9929277566"];

function recipients(): string[] {
  const raw = process.env.MSG91_WA_REPORT_TO;
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_RECIPIENTS;
  return list.map((n) => {
    const d = n.replace(/\D/g, "");
    return d.length === 10 ? `91${d}` : d;
  });
}

const cft = (l: number, w: number, t: number) => (l * w * t) / 1728;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** IST day window [startUTC, endUTC] + a human label for today. */
function istToday() {
  const nowMs = Date.now();
  const ist = new Date(nowMs + 5.5 * 3600 * 1000); // UTC fields now read as IST wall clock
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const startUTC = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - 5.5 * 3600 * 1000).toISOString();
  const endUTC = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - 5.5 * 3600 * 1000).toISOString();
  return { startUTC, endUTC, label: `${d} ${MONTHS[m]} ${y}` };
}

// ── Data ────────────────────────────────────────────────────────────

export type DailyReport = {
  label: string;
  cutting: { byStone: Array<{ stone: string; slabs: number; cft: number }>; totalSlabs: number; totalCft: number };
  carving: { byVendor: Array<{ vendor: string; slabs: number; cft: number }>; totalSlabs: number; totalCft: number };
  dispatch: { byTemple: Array<{ temple: string; slabs: number; cft: number }>; trucks: number; totalSlabs: number; totalCft: number };
};

export async function buildDailyReportData(): Promise<DailyReport> {
  const admin = createAdminSupabaseClient();
  const { startUTC, endUTC, label } = istToday();

  // Helper: dims for a set of slab ids → map id → cft.
  async function cftBySlab(ids: string[]): Promise<Map<string, { cft: number; stone: string | null }>> {
    const out = new Map<string, { cft: number; stone: string | null }>();
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      if (chunk.length === 0) break;
      const { data } = await admin
        .from("slab_requirements")
        .select("id, stone, length_ft, width_ft, thickness_ft")
        .in("id", chunk);
      for (const s of (data ?? []) as Array<{ id: string; stone: string | null; length_ft: number; width_ft: number; thickness_ft: number }>) {
        out.set(s.id, { cft: cft(Number(s.length_ft), Number(s.width_ft), Number(s.thickness_ft)), stone: s.stone });
      }
    }
    return out;
  }

  // ── 1. CUTTING done today — blocks that became 'done' today; the
  //       slabs cut from them, grouped by stone.
  const cutting = { byStone: [] as Array<{ stone: string; slabs: number; cft: number }>, totalSlabs: 0, totalCft: 0 };
  {
    const { data: doneBlocks } = await admin
      .from("cut_session_blocks")
      .select("block_id, status, updated_at")
      .eq("status", "done")
      .gte("updated_at", startUTC)
      .lte("updated_at", endUTC);
    const blockIds = [...new Set(((doneBlocks ?? []) as Array<{ block_id: string }>).map((b) => b.block_id).filter(Boolean))];
    if (blockIds.length > 0) {
      // Cut slabs from those blocks (anything that left the cut stage,
      // i.e. not still open / rejected).
      const slabs: Array<{ id: string; stone: string | null; length_ft: number; width_ft: number; thickness_ft: number }> = [];
      for (let i = 0; i < blockIds.length; i += 200) {
        const { data } = await admin
          .from("slab_requirements")
          .select("id, stone, length_ft, width_ft, thickness_ft, status")
          .in("source_block_id", blockIds.slice(i, i + 200))
          .not("status", "in", "(open,rejected,cancelled)");
        slabs.push(...((data ?? []) as typeof slabs));
      }
      const byStone = new Map<string, { slabs: number; cft: number }>();
      for (const s of slabs) {
        const key = s.stone || "—";
        const c = cft(Number(s.length_ft), Number(s.width_ft), Number(s.thickness_ft));
        const g = byStone.get(key) ?? { slabs: 0, cft: 0 };
        g.slabs += 1; g.cft += c;
        byStone.set(key, g);
        cutting.totalSlabs += 1; cutting.totalCft += c;
      }
      cutting.byStone = [...byStone.entries()].map(([stone, v]) => ({ stone, ...v })).sort((a, b) => b.cft - a.cft);
    }
  }

  // ── 2. CARVING done today — carving_items approved today, by vendor.
  const carving = { byVendor: [] as Array<{ vendor: string; slabs: number; cft: number }>, totalSlabs: 0, totalCft: 0 };
  {
    const { data: items } = await admin
      .from("carving_items")
      .select("slab_requirement_id, vendor_name, review_approved_at")
      .not("review_approved_at", "is", null)
      .gte("review_approved_at", startUTC)
      .lte("review_approved_at", endUTC);
    const rows = (items ?? []) as Array<{ slab_requirement_id: string | null; vendor_name: string | null }>;
    const slabIds = rows.map((r) => r.slab_requirement_id).filter(Boolean) as string[];
    const dims = await cftBySlab(slabIds);
    const byVendor = new Map<string, { slabs: number; cft: number }>();
    for (const r of rows) {
      const key = r.vendor_name || "—";
      const c = r.slab_requirement_id ? dims.get(r.slab_requirement_id)?.cft ?? 0 : 0;
      const g = byVendor.get(key) ?? { slabs: 0, cft: 0 };
      g.slabs += 1; g.cft += c;
      byVendor.set(key, g);
      carving.totalSlabs += 1; carving.totalCft += c;
    }
    carving.byVendor = [...byVendor.entries()].map(([vendor, v]) => ({ vendor, ...v })).sort((a, b) => b.cft - a.cft);
  }

  // ── 3. DISPATCH today — trucks sent today, by temple.
  const dispatch = { byTemple: [] as Array<{ temple: string; slabs: number; cft: number }>, trucks: 0, totalSlabs: 0, totalCft: 0 };
  {
    const { data: disp } = await admin
      .from("dispatches")
      .select("id, temple, dispatched_at")
      .gte("dispatched_at", startUTC)
      .lte("dispatched_at", endUTC);
    const dispatches = (disp ?? []) as Array<{ id: string; temple: string }>;
    dispatch.trucks = dispatches.length;
    if (dispatches.length > 0) {
      const { data: logs } = await admin
        .from("dispatch_logs")
        .select("dispatch_id, slab_requirement_id")
        .in("dispatch_id", dispatches.map((d) => d.id));
      const templeOf = new Map(dispatches.map((d) => [d.id, d.temple]));
      const allSlabIds = ((logs ?? []) as Array<{ slab_requirement_id: string | null }>).map((l) => l.slab_requirement_id).filter(Boolean) as string[];
      const dims = await cftBySlab(allSlabIds);
      const byTemple = new Map<string, { slabs: number; cft: number }>();
      for (const l of (logs ?? []) as Array<{ dispatch_id: string | null; slab_requirement_id: string | null }>) {
        if (!l.dispatch_id || !l.slab_requirement_id) continue;
        const temple = templeOf.get(l.dispatch_id) || "—";
        const c = dims.get(l.slab_requirement_id)?.cft ?? 0;
        const g = byTemple.get(temple) ?? { slabs: 0, cft: 0 };
        g.slabs += 1; g.cft += c;
        byTemple.set(temple, g);
        dispatch.totalSlabs += 1; dispatch.totalCft += c;
      }
      dispatch.byTemple = [...byTemple.entries()].map(([temple, v]) => ({ temple, ...v })).sort((a, b) => b.cft - a.cft);
    }
  }

  return { label, cutting, carving, dispatch };
}

// ── PDF ─────────────────────────────────────────────────────────────

export async function buildDailyReportPdf(data: DailyReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const M = 44;
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.42, 0.4, 0.36);
  const brown = rgb(0.486, 0.231, 0.047);
  const line = rgb(0.85, 0.82, 0.77);
  let y = 800;

  const text = (s: string, x: number, yy: number, size: number, f = font, c = ink) => page.drawText(s, { x, y: yy, size, font: f, color: c });
  const right = (s: string, xr: number, yy: number, size: number, f = font, c = ink) => page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color: c });
  const hr = (yy: number) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 1, color: line });

  // Header
  text("MATESHWARI TEMPLE CONSTRUCTION PVT LTD", M, y, 13, bold, brown);
  y -= 16;
  text("Daily Work Report", M, y, 20, bold, ink);
  right(data.label, W - M, y + 2, 13, bold, ink);
  y -= 10;
  hr(y); y -= 24;

  const section = (title: string, total: string) => {
    text(title, M, y, 12, bold, brown);
    right(total, W - M, y, 11, bold, ink);
    y -= 8;
    hr(y); y -= 16;
  };
  const rowLine = (left: string, mid: string, rt: string) => {
    text(left, M + 4, y, 10.5, font, ink);
    text(mid, 330, y, 10.5, font, muted);
    right(rt, W - M, y, 10.5, font, ink);
    y -= 16;
  };
  const empty = (msg: string) => { text(msg, M + 4, y, 10.5, font, muted); y -= 16; };

  // 1. Cutting
  section("CUTTING DONE  (CFT by stone)", `${data.cutting.totalSlabs} slabs  ·  ${data.cutting.totalCft.toFixed(2)} CFT`);
  if (data.cutting.byStone.length === 0) empty("No cutting completed today.");
  else for (const r of data.cutting.byStone) rowLine(r.stone, `${r.slabs} slabs`, `${r.cft.toFixed(2)} CFT`);
  y -= 12;

  // 2. Carving
  section("CARVING DONE  (by vendor)", `${data.carving.totalSlabs} slabs  ·  ${data.carving.totalCft.toFixed(2)} CFT`);
  if (data.carving.byVendor.length === 0) empty("No carving approved today.");
  else for (const r of data.carving.byVendor) rowLine(r.vendor, `${r.slabs} slabs`, `${r.cft.toFixed(2)} CFT`);
  y -= 12;

  // 3. Dispatch
  section("DISPATCH  (by temple)", `${data.dispatch.trucks} trucks  ·  ${data.dispatch.totalSlabs} slabs  ·  ${data.dispatch.totalCft.toFixed(2)} CFT`);
  if (data.dispatch.byTemple.length === 0) empty("No trucks dispatched today.");
  else for (const r of data.dispatch.byTemple) rowLine(r.temple, `${r.slabs} slabs`, `${r.cft.toFixed(2)} CFT`);

  // Footer
  hr(70);
  text("Automated daily report · MTCPL", M, 56, 8.5, font, muted);
  const gen = new Date(Date.now() + 5.5 * 3600 * 1000);
  right(`Generated ${gen.getUTCDate()} ${MONTHS[gen.getUTCMonth()]} ${gen.getUTCFullYear()}, ${String(gen.getUTCHours()).padStart(2, "0")}:${String(gen.getUTCMinutes()).padStart(2, "0")} IST`, W - M, 56, 8.5, font, muted);

  return pdf.save();
}

// ── Send ────────────────────────────────────────────────────────────

async function sendTemplate(to: string[], pdfUrl: string, dateLabel: string): Promise<void> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) throw new Error("MSG91_AUTH_KEY is not set in the environment.");

  const body = {
    integrated_number: INTEGRATED_NUMBER,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG, policy: "deterministic" },
        to_and_components: [
          {
            to,
            components: {
              header_1: { type: "document", value: pdfUrl, filename: "MTCPL-Daily-Report.pdf" },
              body_1: { type: "text", value: dateLabel },
            },
          },
        ],
      },
    },
  };

  const res = await fetch(WA_BULK_URL, {
    method: "POST",
    headers: { authkey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json: { type?: string; message?: string; hasError?: boolean } = {};
  try { json = JSON.parse(txt); } catch { /* non-JSON */ }
  if (!res.ok || json.type === "error" || json.hasError) {
    throw new Error(`MSG91 WhatsApp send failed: ${json.message || txt || `HTTP ${res.status}`}`);
  }
}

/** Full pipeline: aggregate → PDF → upload → send. Returns a summary. */
export async function sendDailyWhatsAppReport(): Promise<{
  ok: true; label: string; recipients: string[]; pdfUrl: string;
  totals: { cuttingCft: number; carvingCft: number; dispatchSlabs: number };
}> {
  const admin = createAdminSupabaseClient();
  const data = await buildDailyReportData();
  const pdfBytes = await buildDailyReportPdf(data);

  // Upload to the public bucket (uuid path so it isn't guessable).
  const safeDate = data.label.replace(/\s+/g, "-");
  const path = `${safeDate}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await admin.storage
    .from("whatsapp_reports")
    .upload(path, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`Report PDF upload failed: ${upErr.message}`);
  const pdfUrl = admin.storage.from("whatsapp_reports").getPublicUrl(path).data.publicUrl;

  const to = recipients();
  await sendTemplate(to, pdfUrl, data.label);

  return {
    ok: true,
    label: data.label,
    recipients: to,
    pdfUrl,
    totals: { cuttingCft: data.cutting.totalCft, carvingCft: data.carving.totalCft, dispatchSlabs: data.dispatch.totalSlabs },
  };
}
