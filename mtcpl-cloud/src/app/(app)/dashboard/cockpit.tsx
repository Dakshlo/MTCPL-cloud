/**
 * Cockpit dashboard (Daksh, Aug 2026) — the "new" dashboard, developer-only,
 * reached via the Classic ⁄ Cockpit toggle. The CLASSIC dashboard is
 * untouched and stays the default; this file renders only when the
 * dash_view cookie says "cockpit" (see page.tsx + switch-view/route.ts).
 *
 * Design brief (from the reference shot Daksh sent): warm ivory cards,
 * bilingual section titles, one screen that reads top-to-bottom —
 *   hero (greeting + daily photo) → today's production vs yesterday →
 *   live right now → pending approvals → finance snapshot → stock →
 *   alerts → quick actions → Ask-AI banner LAST (his explicit ask).
 *
 * Numbers reuse buildDailyReportData() — the same builder behind the
 * 6 PM WhatsApp DPR — so this page and the PDF can never disagree.
 * Only the live/approval/finance extras are queried here directly.
 *
 * Daily hero photo: files land in public/daily/ and get listed in
 * DAILY_ART below; rotation is dayOfYear % count. Manifest instead of
 * fs.readdir because public/ isn't in the serverless bundle on Vercel.
 */

import Link from "next/link";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildDailyReportData, type DailyReport } from "@/lib/whatsapp-report";
import type { Profile } from "@/lib/types";
import { HeroArt, CockpitClock } from "./cockpit-bits";
import { DashViewToggle } from "./view-toggle";

/** Images that exist in public/daily/ — extend when Daksh drops files. */
const DAILY_ART: string[] = [];

// ── formatting ────────────────────────────────────────────────────

const GOLD = "#8a6410";

function fmt0(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—";
}

/** ₹ short form: ₹2.47 Cr / ₹45.2 L / ₹12,340. */
function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e7) return `${neg}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${neg}₹${(a / 1e5).toFixed(2)} L`;
  return `${neg}₹${Math.round(a).toLocaleString("en-IN")}`;
}

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

const greetingOf = (h: number) =>
  h < 12
    ? { en: "Good morning", hi: "शुभ प्रभात! आज का दिन मंगलमय हो।" }
    : h < 17
      ? { en: "Good afternoon", hi: "नमस्कार! आपका दिन शुभ हो।" }
      : { en: "Good evening", hi: "शुभ संध्या! दिन भर के काम की झलक नीचे है।" };

/** vs-yesterday pill: ↑ 16% green / ↓ 8% red / "—" when yesterday was 0. */
function DeltaPill({ today, prev, unit }: { today: number; prev: number; unit: string }) {
  const base = (
    <span style={{ fontSize: 10.5, color: "var(--muted)" }}>vs yesterday ({fmt0(prev)}{unit})</span>
  );
  if (prev <= 0 || !Number.isFinite(prev)) return base;
  const pct = ((today - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: up ? "#15803d" : "#b91c1c", background: up ? "rgba(21,128,61,0.10)" : "rgba(185,28,28,0.10)", borderRadius: 6, padding: "1.5px 6px" }}>
        {up ? "↑" : "↓"} {Math.abs(pct).toFixed(0)}%
      </span>
      {base}
    </span>
  );
}

// ── layout atoms ──────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "var(--surface, #fff)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(45,36,16,0.04), 0 8px 24px rgba(45,36,16,0.05)",
};

function SectionTitle({ icon, en, hi }: { icon: string; en: string; hi: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 13 }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)" }}>{hi}</span>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>({en})</span>
    </div>
  );
}

function Stat({ label, hi, value, unit, extra }: { label: string; hi: string; value: string; unit?: string; extra?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }}>{label}</div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 5 }}>{hi}</div>
      <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "var(--text)", lineHeight: 1.1 }}>
        {value}
        {unit && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginLeft: 4 }}>{unit}</span>}
      </div>
      {extra && <div style={{ marginTop: 5 }}>{extra}</div>}
    </div>
  );
}

const vline: React.CSSProperties = { width: 1, background: "var(--border)", alignSelf: "stretch" };

// ── the page ──────────────────────────────────────────────────────

export async function CockpitDashboard({ profile }: { profile: Profile }) {
  const admin = createAdminSupabaseClient();
  const nowIst = istNow();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [report, live, trucksOnRoad, cuttingApprovals, invoiceApprovals, slabImports, otherApprovals, finance, readyByStone, blockStockByStone, online, vehicleDocs] =
    await Promise.all([
      // The DPR builder — production, stock, pipeline, payments.
      buildDailyReportData(),

      // Live cutting floor: on machine / approved-waiting / awaiting slab entry.
      admin.from("cut_session_blocks").select("status").in("status", ["pending_worker", "cutting", "done_prompt"]),

      // Trucks released and still on the road.
      admin.from("dispatches").select("*", { count: "exact", head: true })
        .not("approved_at", "is", null).is("delivered_at", null).not("on_road_at", "is", null),

      // Approval queues (same filters as /tasks so counts always agree).
      admin.from("cut_session_blocks").select("*", { count: "exact", head: true })
        .in("status", ["awaiting_approval", "awaiting_cutter_edit"]),
      admin.from("challans").select("*", { count: "exact", head: true })
        .not("priced_at", "is", null).is("owner_approved_at", null).is("owner_rejected_at", null)
        .is("cancelled_at", null).is("converted_invoice_id", null),
      admin.from("slab_import_batches").select("*", { count: "exact", head: true }).eq("status", "pending"),
      Promise.all([
        admin.from("carving_work_orders").select("*", { count: "exact", head: true }).eq("status", "pending_approval"),
        admin.from("carving_items").select("*", { count: "exact", head: true }).eq("owner_review_status", "open"),
        admin.from("slab_requirements").select("*", { count: "exact", head: true })
          .not("cancel_requested_at", "is", null).neq("status", "cancelled"),
        admin.from("bills").select("*", { count: "exact", head: true }).eq("status", "pending_approval"),
      ]).then((rs) => rs.reduce((s, r) => s + (r.count ?? 0), 0)),

      // Finance: outstanding on approved bills + the live pay queue.
      Promise.all([
        admin.from("bills").select("amount_outstanding").eq("status", "approved").is("cancelled_at", null).limit(5000),
        admin.from("bill_payments").select("amount").in("status", ["proposed", "confirmed"]).limit(5000),
      ]).then(([b, p]) => ({
        outstanding: (b.data ?? []).reduce((s, r) => s + (Number(r.amount_outstanding) || 0), 0),
        outstandingBills: (b.data ?? []).length,
        queueTotal: (p.data ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0),
        queueCount: (p.data ?? []).length,
      })),

      // Ready-to-dispatch slabs grouped by stone (completed, not parked).
      fetchReadyByStone(admin),

      // Usable raw-block stock by stone (available + reserved — same rule
      // as the DPR's stock figure; report.blocksByStone is TODAY'S INTAKE,
      // not stock, so it must not feed this table).
      fetchBlockStockByStone(admin),

      // Who's online (last_seen within 5 min) — same rule as classic.
      admin.from("profiles").select("full_name").gte("last_seen_at", fiveMinAgo).eq("is_active", true),

      // Vehicle documents expiring inside 45 days (insurance/PUC/fitness).
      fetchVehicleDocAlerts(admin, 45),
    ]);

  const liveCounts = { cutting: 0, pending_worker: 0, done_prompt: 0 };
  for (const r of live.data ?? []) {
    const s = r.status as keyof typeof liveCounts;
    if (s in liveCounts) liveCounts[s] += 1;
  }

  const g = greetingOf(nowIst.getUTCHours());
  const firstName = (profile.full_name ?? "").trim().split(/\s+/)[0] || "ji";
  const dateLine = nowIst.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const art = DAILY_ART.length > 0 ? `/daily/${DAILY_ART[dayOfYear(nowIst) % DAILY_ART.length]}` : null;
  const onlineNames = (online.data ?? []).map((o) => o.full_name ?? "?");

  const t = report.today;
  const p = report.prev;
  const pipeline = report.pipeline;
  const inCarving = (pipeline?.queue ?? 0) + (pipeline?.onMachine ?? 0);
  const carvingBacklog = pipeline?.cutWaiting ?? 0;

  const approvalsTotal = (cuttingApprovals.count ?? 0) + (invoiceApprovals.count ?? 0) + (slabImports.count ?? 0) + otherApprovals;

  const alerts: Array<{ icon: string; label: string; count: number; href: string; tone: "red" | "amber" }> = [];
  if (carvingBacklog >= 15) alerts.push({ icon: "🪨", label: "Carving backlog — slabs cut & waiting", count: carvingBacklog, href: "/carving", tone: "red" });
  if (vehicleDocs > 0) alerts.push({ icon: "📄", label: "Vehicle documents expiring within 45 days", count: vehicleDocs, href: "/vehicles", tone: "amber" });
  if (approvalsTotal > 0) alerts.push({ icon: "✍️", label: "Approvals waiting on you", count: approvalsTotal, href: "/tasks", tone: "amber" });

  const quickActions = [
    { icon: "📄", en: "Daily Report (PDF)", hi: "दैनिक रिपोर्ट", href: "/api/whatsapp-report/preview", ext: true },
    { icon: "📒", en: "Work Diary", hi: "काम का रजिस्टर", href: "/diary", ext: false },
    { icon: "📊", en: "Temple P&L", hi: "मंदिर लाभ-हानि", href: "/reports/temple-pnl", ext: false },
    { icon: "🧮", en: "Tender / Price Breakdown", hi: "टेंडर / रेट ब्रेकअप", href: "/reports/tender", ext: false },
    { icon: "🏭", en: "Production DPR", hi: "उत्पादन रिपोर्ट", href: "/reports/dpr", ext: false },
  ];

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "14px 16px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Toggle back to the untouched classic dashboard. */}
      <DashViewToggle current="cockpit" />

      {/* ── HERO — greeting left, daily photo right ── */}
      <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 340px)", gap: 0 }}>
          <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)" }}>
                {g.en}, <span style={{ color: GOLD }}>{firstName} ji</span> 🙏
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>{g.hi}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "5px 12px" }}>
                📅 {dateLine}
              </span>
              <CockpitClock />
            </div>
            <div style={{ marginTop: "auto" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>
                Online now · {onlineNames.length}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {onlineNames.length === 0 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>No one else right now</span>}
                {onlineNames.slice(0, 8).map((n, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#15803d", background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 999, padding: "3px 10px" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                    {n}
                  </span>
                ))}
                {onlineNames.length > 8 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>+{onlineNames.length - 8}</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ padding: 10 }}>
            <HeroArt src={art} />
          </div>
        </div>
      </div>

      {/* ── TODAY'S PRODUCTION ── */}
      <div style={{ ...CARD, padding: "17px 20px" }}>
        <SectionTitle icon="🏭" hi="आज का उत्पादन" en="Today's Production" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr auto 1fr", gap: 16, alignItems: "start" }}>
          <Stat label="Blocks Added" hi="नए ब्लॉक" value={fmt0(t.blocks.count)} unit="Nos."
            extra={<DeltaPill today={t.blocks.count} prev={p.blocks.count} unit="" />} />
          <div style={vline} />
          <Stat label="Slabs Cut" hi="कटे हुए स्लैब" value={fmt0(t.cutting.slabs)} unit={`· ${fmt0(t.cutting.cft)} CFT`}
            extra={<DeltaPill today={t.cutting.cft} prev={p.cutting.cft} unit=" CFT" />} />
          <div style={vline} />
          <Stat label="Carved" hi="कार्विंग पूर्ण" value={fmt0(t.carving.slabs)} unit={`· ${fmt0(t.carving.cft)} CFT`}
            extra={<DeltaPill today={t.carving.slabs} prev={p.carving.slabs} unit="" />} />
          <div style={vline} />
          <Stat label="Dispatched" hi="डिस्पैच" value={fmt0(t.dispatch.slabs)} unit={`· ${fmt0(t.dispatch.trucks)} truck${t.dispatch.trucks === 1 ? "" : "s"}`}
            extra={<DeltaPill today={t.dispatch.slabs} prev={p.dispatch.slabs} unit="" />} />
        </div>
      </div>

      {/* ── LIVE RIGHT NOW + FINANCE ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <div style={{ ...CARD, padding: "17px 20px" }}>
          <SectionTitle icon="📈" hi="वर्तमान स्थिति" en="Live Right Now" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 14, alignItems: "start" }}>
            <Stat label="On Cutting Machine" hi="कटिंग मशीन पर" value={fmt0(liveCounts.cutting)} unit="blocks"
              extra={<span style={{ fontSize: 10.5, color: "var(--muted)" }}>{fmt0(liveCounts.pending_worker)} waiting · {fmt0(liveCounts.done_prompt)} recording</span>} />
            <div style={vline} />
            <Stat label="In Carving" hi="कार्विंग में" value={fmt0(inCarving)} unit="slabs"
              extra={<span style={{ fontSize: 10.5, color: "var(--muted)" }}>{fmt0(pipeline?.onMachine ?? 0)} on machine · {fmt0(pipeline?.onHold ?? 0)} on hold</span>} />
            <div style={vline} />
            <Stat label="Trucks On Road" hi="रास्ते में ट्रक" value={fmt0(trucksOnRoad.count ?? 0)} unit="trucks"
              extra={<Link href="/dispatch" style={{ fontSize: 10.5, color: GOLD, fontWeight: 700, textDecoration: "none" }}>Dispatch board →</Link>} />
          </div>
        </div>

        <div style={{ ...CARD, padding: "17px 20px" }}>
          <SectionTitle icon="₹" hi="वित्तीय स्थिति" en="Finance Snapshot" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 14, alignItems: "start" }}>
            <Stat label="Total Outstanding" hi="वेंडर को बकाया" value={inr(finance.outstanding)}
              extra={<span style={{ fontSize: 10.5, color: "var(--muted)" }}>{fmt0(finance.outstandingBills)} open bills</span>} />
            <div style={vline} />
            <Stat label="In Pay Queue" hi="भुगतान कतार में" value={inr(finance.queueTotal)}
              extra={<span style={{ fontSize: 10.5, color: "var(--muted)" }}>{fmt0(finance.queueCount)} payments proposed</span>} />
            <div style={vline} />
            <Stat label={`Paid — ${report.month.monthName}`} hi="इस माह भुगतान" value={inr(report.paymentsMtd)}
              extra={<span style={{ fontSize: 10.5, color: "var(--muted)" }}>today: {inr(report.payments.total)}</span>} />
          </div>
        </div>
      </div>

      {/* ── PENDING APPROVALS ── */}
      <div style={{ ...CARD, padding: "17px 20px" }}>
        <SectionTitle icon="✍️" hi="आपकी मंज़ूरी अपेक्षित" en="Pending Approvals" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {[
            { icon: "🪓", en: "Cutting Approvals", hi: "कटिंग अप्रूवल", count: cuttingApprovals.count ?? 0, href: "/tasks" },
            { icon: "🧾", en: "Invoice Approvals", hi: "इनवॉइस अप्रूवल", count: invoiceApprovals.count ?? 0, href: "/invoicing/approval" },
            { icon: "📥", en: "Slab Imports", hi: "स्लैब इम्पोर्ट", count: slabImports.count ?? 0, href: "/tasks" },
            { icon: "🗂", en: "Other Queues", hi: "अन्य कतारें", count: otherApprovals, href: "/tasks" },
          ].map((a) => (
            <Link key={a.en} href={a.href} style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 13, padding: "13px 15px", background: a.count > 0 ? "rgba(180,140,60,0.06)" : "var(--bg)", display: "block" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }}>{a.icon} {a.en}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{a.hi}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 7 }}>
                <span style={{ fontSize: 25, fontWeight: 800, color: a.count > 0 ? "#b45309" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{a.count}</span>
                <span style={{ fontSize: 10.5, color: "var(--muted)" }}>pending</span>
                <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: GOLD }}>Review →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── STOCK — blocks + ready slabs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <div style={{ ...CARD, padding: "17px 20px" }}>
          <SectionTitle icon="🧱" hi="उपलब्ध ब्लॉक स्टॉक" en="Available Blocks" />
          <StoneTable
            rows={blockStockByStone.map((b) => ({ stone: b.stone, a: b.blocks, b: b.cft }))}
            aHead="Blocks" bHead="CFT"
          />
          {report.stock && (
            <div style={{ marginTop: 9, fontSize: 10.5, color: "var(--muted)" }}>
              Sandstone {fmt0(report.stock.sandstoneCft)} CFT · Marble {report.stock.marbleTonnes.toLocaleString("en-IN", { maximumFractionDigits: 1 })} T
            </div>
          )}
        </div>

        <div style={{ ...CARD, padding: "17px 20px" }}>
          <SectionTitle icon="🚚" hi="डिस्पैच के लिए तैयार स्लैब" en="Ready to Dispatch" />
          <StoneTable rows={readyByStone.map((r) => ({ stone: r.stone, a: r.slabs, b: r.cft }))} aHead="Slabs" bHead="CFT" />
          <div style={{ marginTop: 9, fontSize: 10.5, color: "var(--muted)" }}>
            + {fmt0(pipeline?.storageReady ?? 0)} more in Main Storage (parked)
          </div>
        </div>
      </div>

      {/* ── ALERTS ── */}
      <div style={{ ...CARD, padding: "17px 20px" }}>
        <SectionTitle icon="🔔" hi="महत्वपूर्ण अलर्ट" en="Alerts & Important Updates" />
        {alerts.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#15803d", fontWeight: 700 }}>✅ All clear — nothing needs attention right now.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a) => (
              <Link key={a.label} href={a.href} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 11, border: "1px solid var(--border)", borderRadius: 11, padding: "10px 13px", background: "var(--bg)" }}>
                <span style={{ fontSize: 15 }}>{a.icon}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{a.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: "#fff", background: a.tone === "red" ? "#dc2626" : "#d97706", borderRadius: 999, padding: "2px 10px", fontVariantNumeric: "tabular-nums" }}>
                  {a.count}
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: GOLD }}>View →</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div style={{ ...CARD, padding: "17px 20px" }}>
        <SectionTitle icon="⚡" hi="त्वरित कार्य" en="Quick Actions" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {quickActions.map((q) =>
            q.ext ? (
              <a key={q.en} href={q.href} target="_blank" rel="noreferrer" style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 13, padding: "13px 15px", background: "var(--bg)", display: "block" }}>
                <div style={{ fontSize: 19 }}>{q.icon}</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", marginTop: 5 }}>{q.en}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{q.hi}</div>
              </a>
            ) : (
              <Link key={q.en} href={q.href} style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 13, padding: "13px 15px", background: "var(--bg)", display: "block" }}>
                <div style={{ fontSize: 19 }}>{q.icon}</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", marginTop: 5 }}>{q.en}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{q.hi}</div>
              </Link>
            ),
          )}
        </div>
      </div>

      {/* ── ASK AI — deliberately the LAST thing on the page (Daksh). ── */}
      <Link href="/ask-ai" style={{ textDecoration: "none" }}>
        <div style={{ borderRadius: 16, padding: "19px 24px", background: "linear-gradient(120deg, #2d2410 0%, #6b5316 60%, #a07d1f 100%)", display: "flex", alignItems: "center", gap: 15, boxShadow: "0 10px 30px rgba(90,70,20,0.28)" }}>
          <span style={{ fontSize: 27 }}>🤖</span>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#fdf6e3" }}>Ask AI Assistant</div>
            <div style={{ fontSize: 11.5, color: "rgba(253,246,227,0.75)" }}>AI से पूछें — production, accounts, diary… whole business, instantly</div>
          </div>
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: "#fdf6e3", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 999, padding: "8px 18px" }}>
            Open chat →
          </span>
        </div>
      </Link>
    </div>
  );
}

// ── data helpers ──────────────────────────────────────────────────

type Admin = ReturnType<typeof createAdminSupabaseClient>;

/** Completed (ready-to-dispatch) slabs grouped by stone — dims are inches. */
async function fetchReadyByStone(admin: Admin): Promise<Array<{ stone: string; slabs: number; cft: number }>> {
  type Row = { stone: string | null; length_ft: number | string | null; width_ft: number | string | null; thickness_ft: number | string | null; is_parked: boolean | null };
  const rows: Row[] = [];
  for (let off = 0; off < 20_000; off += 1000) {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("stone, length_ft, width_ft, thickness_ft, is_parked")
      .eq("status", "completed")
      .order("id")
      .range(off, off + 999);
    if (error) break;
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const by = new Map<string, { slabs: number; cft: number }>();
  for (const r of rows) {
    if (r.is_parked) continue; // parked = Main Storage, shown separately
    const stone = r.stone || "Other";
    const cft = ((Number(r.length_ft) || 0) * (Number(r.width_ft) || 0) * (Number(r.thickness_ft) || 0)) / 1728;
    const e = by.get(stone) ?? { slabs: 0, cft: 0 };
    e.slabs += 1;
    e.cft += cft;
    by.set(stone, e);
  }
  return [...by.entries()]
    .map(([stone, e]) => ({ stone, slabs: e.slabs, cft: e.cft }))
    .sort((a, b) => b.cft - a.cft);
}

/** Usable raw-block stock grouped by stone — status available/reserved,
 *  the same "usable" rule as the DPR's stock figure. Dims are inches;
 *  marble rows have NULL dims and carry tonnes (8 CFT/T house rate). */
async function fetchBlockStockByStone(admin: Admin): Promise<Array<{ stone: string; blocks: number; cft: number }>> {
  type Row = { stone: string | null; length_ft: number | string | null; width_ft: number | string | null; height_ft: number | string | null; tonnes: number | string | null };
  const rows: Row[] = [];
  for (let off = 0; off < 20_000; off += 1000) {
    const { data, error } = await admin
      .from("blocks")
      .select("stone, length_ft, width_ft, height_ft, tonnes")
      .in("status", ["available", "reserved"])
      .order("id")
      .range(off, off + 999);
    if (error) break;
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const by = new Map<string, { blocks: number; cft: number }>();
  for (const r of rows) {
    const stone = r.stone || "Other";
    const vol = ((Number(r.length_ft) || 0) * (Number(r.width_ft) || 0) * (Number(r.height_ft) || 0)) / 1728;
    const cft = vol > 0 ? vol : (Number(r.tonnes) || 0) * 8;
    const e = by.get(stone) ?? { blocks: 0, cft: 0 };
    e.blocks += 1;
    e.cft += cft;
    by.set(stone, e);
  }
  return [...by.entries()]
    .map(([stone, e]) => ({ stone, blocks: e.blocks, cft: e.cft }))
    .sort((a, b) => b.cft - a.cft);
}

/** Count vehicles with any document (insurance/PUC/fitness) expiring within
 *  `days` days — or already expired. Table may not exist on old DBs → 0. */
async function fetchVehicleDocAlerts(admin: Admin, days: number): Promise<number> {
  const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("vehicles")
    .select("insurance_expiry, puc_expiry, fitness_expiry")
    .limit(2000);
  if (error) return 0;
  let n = 0;
  for (const v of (data ?? []) as Array<{ insurance_expiry: string | null; puc_expiry: string | null; fitness_expiry: string | null }>) {
    if ([v.insurance_expiry, v.puc_expiry, v.fitness_expiry].some((d) => d != null && d <= limit)) n += 1;
  }
  return n;
}

/** Compact two-metric stone table used by both stock cards. */
function StoneTable({ rows, aHead, bHead }: { rows: Array<{ stone: string; a: number; b: number }>; aHead: string; bHead: string }) {
  const top = rows.slice(0, 5);
  const totalA = rows.reduce((s, r) => s + r.a, 0);
  const totalB = rows.reduce((s, r) => s + r.b, 0);
  const th: React.CSSProperties = { textAlign: "right", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", padding: "4px 8px", borderBottom: "1px solid var(--border)" };
  const td: React.CSSProperties = { textAlign: "right", fontSize: 12.5, padding: "7px 8px", borderBottom: "1px solid var(--border)", fontVariantNumeric: "tabular-nums" };
  if (rows.length === 0) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing right now.</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: "left" }}>Stone</th>
          <th style={th}>{aHead}</th>
          <th style={th}>{bHead}</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.stone}>
            <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.stone}</td>
            <td style={td}>{fmt0(r.a)}</td>
            <td style={td}>{fmt0(r.b)}</td>
          </tr>
        ))}
        {rows.length > 5 && (
          <tr>
            <td style={{ ...td, textAlign: "left", color: "var(--muted)" }}>+ {rows.length - 5} more stones</td>
            <td style={td} />
            <td style={td} />
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <td style={{ ...td, textAlign: "left", fontWeight: 800, borderBottom: "none" }}>Total</td>
          <td style={{ ...td, fontWeight: 800, borderBottom: "none" }}>{fmt0(totalA)}</td>
          <td style={{ ...td, fontWeight: 800, borderBottom: "none" }}>{fmt0(totalB)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
