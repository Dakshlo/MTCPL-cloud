"use client";

/**
 * Temple P&L — presentation only (Daksh, Aug 2026). Every number is
 * computed server-side in lib/temple-pnl.ts; this file decides how it
 * reads. Restyled to match the Finance Analysis page (Daksh: "make the
 * UI really good like the finance analysis page, and full-width") —
 * same pinned light palette, radius-20 cards, eyebrow labels, gradient
 * grow-bars and reveal animations as analysis-client.tsx.
 */

import { Fragment, useState } from "react";
// TYPE-ONLY import — temple-pnl.ts pulls in the admin Supabase client, so a
// runtime import here would drag server code into the client bundle.
import type { PnlReport, PnlTempleRow } from "@/lib/temple-pnl";

/** Costs the system cannot attribute at all — stated on the page so the
 *  margin is never mistaken for a full P&L. */
const MISSING_COSTS = [
  "Freight / transport — not stored anywhere in the system",
  "Salaries & office overheads — tracked in Salary, not allocated here",
  "Finance costs, royalty and taxes",
];

// ── Palette — pinned light, identical vocabulary to Finance Analysis ──

const C = {
  ink: "#0b1220",
  ink2: "#3f4a5c",
  muted: "#8892a4",
  line: "#e6eaf0",
  paper: "#ffffff",
  wash: "#f6f8fb",
  green: "#0f9d58",
  greenSoft: "rgba(15,157,88,0.10)",
  amber: "#c2740a",
  amberSoft: "rgba(194,116,10,0.10)",
  indigo: "#4f46e5",
  indigoSoft: "rgba(79,70,229,0.10)",
  sky: "#0284c7",
  skySoft: "rgba(2,132,199,0.10)",
  red: "#c0392b",
  redSoft: "rgba(192,57,43,0.10)",
};

const card: React.CSSProperties = {
  background: C.paper,
  border: `1px solid ${C.line}`,
  borderRadius: 20,
  boxShadow: "0 1px 2px rgba(11,18,32,0.04), 0 8px 24px rgba(11,18,32,0.05)",
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: C.muted,
};

const display: React.CSSProperties = {
  fontWeight: 700,
  letterSpacing: "-0.035em",
  fontVariantNumeric: "tabular-nums",
  color: C.ink,
};

/** The three cost streams share one colour language everywhere on the
 *  page — equation chips, split bar, expanded cost stacks. */
const PARTS = [
  { key: "stone", label: "Stone", color: C.indigo, soft: C.indigoSoft },
  { key: "cutting", label: "Cutting", color: C.amber, soft: C.amberSoft },
  { key: "carving", label: "Carving", color: C.sky, soft: C.skySoft },
] as const;

// ── formatting ────────────────────────────────────────────────────

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const a = Math.abs(n);
  let s: string;
  if (a >= 1e7) s = `₹${(a / 1e7).toFixed(2)} Cr`;
  else if (a >= 1e5) s = `₹${(a / 1e5).toFixed(2)} L`;
  else s = `₹${Math.round(a).toLocaleString("en-IN")}`;
  return neg ? `−${s}` : s;
}

function inrExact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function num(n: number, d = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d });
}

function pct(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;
}

/** Margin bands — green healthy, amber thin, red losing. */
function marginTone(p: number | null): { fg: string; soft: string } {
  if (p == null) return { fg: C.muted, soft: C.wash };
  if (p >= 25) return { fg: C.green, soft: C.greenSoft };
  if (p >= 10) return { fg: C.amber, soft: C.amberSoft };
  return { fg: C.red, soft: C.redSoft };
}

// ── page ──────────────────────────────────────────────────────────

export function PnlClient({ report }: { report: PnlReport }) {
  const [open, setOpen] = useState<string | null>(null);
  const { totals, rateCard, caveats } = report;

  const monthName = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });

  const costShare = totals.revenue > 0 ? Math.min(100, (totals.cost / totals.revenue) * 100) : 0;
  const maxRevenue = Math.max(...report.temples.map((t) => t.revenue), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* A window can be untrustworthy two different ways — say which. */}
      {caveats.noProduction && (
        <Banner>
          <strong>Nothing was cut in this window,</strong> so there is no production to spread cost over and
          no cost is charged to any temple below. Pick a window where cutting actually happened.
        </Banner>
      )}
      {!caveats.noProduction && caveats.predatesCosting && caveats.costingStartsAt && (
        <Banner>
          <strong>Margins here are unreliable.</strong> Cutting and CNC running expenses were first recorded
          in {monthName(caveats.costingStartsAt)}; earlier months in this window contribute machine
          depreciation but no electricity, manpower or tools. Stay inside FY 26-27 to compare temples fairly.
        </Banner>
      )}

      {/* ── KPI band — one wide card, hairline-separated, with the
             revenue → cost | margin split bar under it ── */}
      <div className="tp-reveal" style={{ ...card, padding: "22px 26px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 22 }}>
          <div>
            <div style={eyebrow}>Invoiced revenue</div>
            <div style={{ ...display, fontSize: 32, marginTop: 7 }}>{inr(totals.revenue)}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              {report.temples.length} temples · excl. GST · after discount
            </div>
          </div>
          <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 22 }}>
            <div style={eyebrow}>Cost of sales</div>
            <div style={{ ...display, fontSize: 32, marginTop: 7, color: C.ink2 }}>{inr(totals.cost)}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              allocated · {num(totals.billedCft)} CFT billed
            </div>
          </div>
          <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 22 }}>
            <div style={eyebrow}>Gross margin</div>
            <div style={{ ...display, fontSize: 32, marginTop: 7, color: marginTone(totals.marginPct).fg }}>
              {inr(totals.margin)}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>revenue − allocated cost</div>
          </div>
          <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 22 }}>
            <div style={eyebrow}>Margin %</div>
            <div style={{ ...display, fontSize: 32, marginTop: 7, color: marginTone(totals.marginPct).fg }}>
              {pct(totals.marginPct)}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              {totals.billedCft > 0 ? `${inrExact(totals.revenue / totals.billedCft)}/CFT realised` : "—"}
            </div>
          </div>
        </div>

        {/* Every rupee of revenue, split into cost (amber) and margin (green). */}
        {totals.revenue > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: C.wash }}>
              <div className="tp-grow" style={{ width: `${costShare}%`, background: `linear-gradient(90deg, ${C.amber}, #e0a44a)` }} title={`Cost ${inr(totals.cost)}`} />
              <div className="tp-grow" style={{ flex: 1, background: `linear-gradient(90deg, ${C.green}, #43c98a)`, animationDelay: ".12s" }} title={`Margin ${inr(totals.margin)}`} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 11.5, color: C.muted }}>
              <span><span style={{ color: C.amber, fontWeight: 700 }}>■</span> cost {pct(totals.revenue > 0 ? (totals.cost / totals.revenue) * 100 : null)}</span>
              <span><span style={{ color: C.green, fontWeight: 700 }}>■</span> margin {pct(totals.marginPct)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Rate card — the whole cost model on one line ── */}
      <div className="tp-reveal" style={{ ...card, padding: "20px 26px", animationDelay: ".05s" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 15 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink, letterSpacing: "-0.01em" }}>
            What one CFT costs us to make
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {inr(rateCard.totalPool)} consumed ÷ {num(rateCard.producedCft)} CFT cut in this window
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "stretch", gap: 12, flexWrap: "wrap" }}>
          {PARTS.map((p, i) => {
            const v = p.key === "stone" ? rateCard.stonePerCft : p.key === "cutting" ? rateCard.cuttingPerCft : rateCard.carvingPerCft;
            const note = p.key === "stone"
              ? `blocks cut × ${inrExact(rateCard.stoneRatePerBlockCft)}/CFT`
              : p.key === "cutting" ? "expenses + depreciation" : "CNC + jobwork";
            return (
              <Fragment key={p.key}>
                {i > 0 && <Op>+</Op>}
                <div style={{ flex: "1 1 150px", minWidth: 150, background: C.wash, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 15px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color, boxShadow: `0 0 0 3px ${p.soft}`, display: "inline-block" }} />
                    <span style={eyebrow}>{p.label}</span>
                  </div>
                  <div style={{ ...display, fontSize: 23, marginTop: 6 }}>{inrExact(v)}</div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{note}</div>
                </div>
              </Fragment>
            );
          })}
          <Op>=</Op>
          <div style={{ flex: "1 1 170px", minWidth: 170, background: `linear-gradient(135deg, ${C.indigoSoft}, rgba(79,70,229,0.04))`, border: `1.5px solid ${C.indigo}`, borderRadius: 14, padding: "12px 15px", boxShadow: `0 10px 28px ${C.indigoSoft}` }}>
            <div style={{ ...eyebrow, color: C.indigo }}>Make cost</div>
            <div style={{ ...display, fontSize: 26, marginTop: 6 }}>{inrExact(rateCard.makeCostPerCft)}</div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>per CFT · sold at {totals.billedCft > 0 ? inrExact(totals.revenue / totals.billedCft) : "—"}</div>
          </div>
        </div>

        {/* Share of make cost — one thin stacked bar. */}
        {rateCard.makeCostPerCft > 0 && (
          <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: C.wash, marginTop: 14 }}>
            {PARTS.map((p, i) => {
              const v = p.key === "stone" ? rateCard.stonePerCft : p.key === "cutting" ? rateCard.cuttingPerCft : rateCard.carvingPerCft;
              return <div key={p.key} className="tp-grow" style={{ width: `${(v / rateCard.makeCostPerCft) * 100}%`, background: p.color, animationDelay: `${i * 0.08}s` }} title={`${p.label} ${inrExact(v)}/CFT`} />;
            })}
          </div>
        )}
      </div>

      {/* ── Temple table — full-width, hover rows, expandable ── */}
      <div className="tp-reveal" style={{ ...card, overflow: "hidden", animationDelay: ".1s" }}>
        <div style={{ padding: "18px 26px 14px", borderBottom: `1px solid ${C.line}`, background: `linear-gradient(180deg, #fbfcfe, ${C.paper})`, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink, letterSpacing: "-0.01em" }}>Temple by temple</div>
          <div style={{ fontSize: 12, color: C.muted }}>click a row for its cost stack · sorted by revenue</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr style={{ background: C.wash }}>
                <th style={{ ...th, textAlign: "left", paddingLeft: 26 }}>Temple</th>
                <th style={th}>Revenue</th>
                <th style={{ ...th, minWidth: 120 }} aria-hidden />
                <th style={th}>CFT billed</th>
                <th style={th}>₹/CFT got</th>
                <th style={th}>Cost of sales</th>
                <th style={th}>Margin</th>
                <th style={{ ...th, minWidth: 150, paddingRight: 26 }}>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {report.temples.length === 0 && (
                <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: C.muted, padding: "30px 12px" }}>
                  No invoices in this window.
                </td></tr>
              )}
              {report.temples.map((t) => {
                const tone = marginTone(t.marginPct);
                const isOpen = open === t.temple;
                const bar = Math.max(0, Math.min(100, t.marginPct ?? 0));
                return (
                  <Fragment key={t.temple}>
                    <tr
                      className="tp-row"
                      onClick={() => setOpen(isOpen ? null : t.temple)}
                      style={{ cursor: "pointer", background: isOpen ? C.wash : undefined }}
                    >
                      <td style={{ ...td, textAlign: "left", fontWeight: 700, paddingLeft: 26, maxWidth: 340 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 9, color: C.muted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>▶</span>
                          {t.temple}
                        </span>
                        {t.unmeasuredRevenue > 0 && (
                          <span title="Some invoices have no measurable volume (NOS / unit-less lines), so no cost is allocated against that revenue."
                            style={{ marginLeft: 9, fontSize: 9.5, fontWeight: 800, color: C.amber, background: C.amberSoft, padding: "2.5px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
                            ⚠ {inr(t.unmeasuredRevenue)} unmeasured
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>{inr(t.revenue)}</td>
                      {/* Revenue scale bar — instant sense of who matters. */}
                      <td style={{ ...td, paddingLeft: 4, paddingRight: 14 }}>
                        <div style={{ height: 5, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                          <div className="tp-grow" style={{ width: `${(t.revenue / maxRevenue) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${C.indigo}, #7c8cf8)` }} />
                        </div>
                      </td>
                      <td style={td}>{num(t.billedCft)}</td>
                      <td style={td}>{t.realisationPerCft == null ? "—" : inrExact(t.realisationPerCft)}</td>
                      <td style={{ ...td, color: C.ink2 }}>{inr(t.costTotal)}</td>
                      <td style={{ ...td, fontWeight: 700, color: tone.fg }}>{inr(t.margin)}</td>
                      <td style={{ ...td, paddingRight: 26 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-end" }}>
                          <div style={{ flex: 1, maxWidth: 70, height: 6, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                            <div className="tp-grow" style={{ width: `${bar}%`, height: "100%", borderRadius: 999, background: t.marginPct != null && t.marginPct < 10 ? tone.fg : `linear-gradient(90deg, ${C.green}, #43c98a)` }} />
                          </div>
                          <span style={{ fontWeight: 800, color: tone.fg, minWidth: 52, textAlign: "right", background: tone.soft, borderRadius: 999, padding: "2.5px 8px", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                            {pct(t.marginPct)}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {isOpen && <ExpandedRow t={t} />}
                  </Fragment>
                );
              })}
            </tbody>
            {report.temples.length > 0 && (
              <tfoot>
                <tr style={{ background: C.wash }}>
                  <td style={{ ...tf, textAlign: "left", paddingLeft: 26 }}>Total</td>
                  <td style={tf}>{inr(totals.revenue)}</td>
                  <td style={tf} />
                  <td style={tf}>{num(totals.billedCft)}</td>
                  <td style={tf}>{totals.billedCft > 0 ? inrExact(totals.revenue / totals.billedCft) : "—"}</td>
                  <td style={{ ...tf, color: C.ink2 }}>{inr(totals.cost)}</td>
                  <td style={{ ...tf, color: marginTone(totals.marginPct).fg }}>{inr(totals.margin)}</td>
                  <td style={{ ...tf, color: marginTone(totals.marginPct).fg, paddingRight: 26 }}>{pct(totals.marginPct)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Reconciliation + honesty ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div className="tp-reveal" style={{ ...card, padding: "18px 22px", animationDelay: ".15s" }}>
          <div style={{ ...eyebrow, marginBottom: 10 }}>Where the numbers come from</div>
          <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12.5, lineHeight: 1.8, color: C.ink2 }}>
            <li><strong style={{ color: C.ink }}>Revenue — exact.</strong> Issued invoices only (same source as the Invoicing page), excluding GST, after discount.</li>
            <li><strong style={{ color: C.ink }}>Cost — allocated.</strong> No per-block or per-slab cost exists, so period pools are divided by CFT cut and charged by CFT billed.</li>
            <li><strong style={{ color: C.ink }}>Stone is charged as consumed,</strong> not as bought — blocks actually cut, at this window&apos;s purchase rate.</li>
            <li><strong style={{ color: C.ink }}>Outsource jobwork is the one exact cost</strong> and sits inside the carving pool.</li>
          </ul>
        </div>
        <div className="tp-reveal" style={{ ...card, padding: "18px 22px", animationDelay: ".2s" }}>
          <div style={{ ...eyebrow, marginBottom: 10 }}>Not included in cost</div>
          <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12.5, lineHeight: 1.8, color: C.muted }}>
            {MISSING_COSTS.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <div style={{ marginTop: 11, fontSize: 12, color: C.muted, borderTop: `1px solid ${C.line}`, paddingTop: 11 }}>
            True margin is lower than shown. Treat this as a comparison between temples, not a filed P&amp;L.
          </div>
        </div>
        <div className="tp-reveal" style={{ ...card, padding: "18px 22px", animationDelay: ".25s" }}>
          <div style={{ ...eyebrow, marginBottom: 10 }}>Stone &amp; stock this window</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.85, color: C.ink2 }}>
            Bought <strong style={{ color: C.ink }}>{inr(rateCard.stoneSpend)}</strong> of blocks ({num(rateCard.stoneBillCft)} CFT),
            cut <strong style={{ color: C.ink }}>{num(rateCard.consumedBlockCft)} CFT</strong> of them — so{" "}
            <strong style={{ color: C.ink }}>{inr(rateCard.stonePool)}</strong> of stone is charged above.
            {rateCard.stoneBillCft > rateCard.consumedBlockCft && <> The rest sits in the yard, not a cost yet.</>}
            <br />
            Yield: <strong style={{ color: C.ink }}>{num(rateCard.producedCft)} CFT</strong> of slabs
            {rateCard.recoveryPct != null && <> — <strong style={{ color: C.ink }}>{rateCard.recoveryPct.toFixed(0)}% recovery</strong></>} · billed{" "}
            <strong style={{ color: C.ink }}>{num(totals.billedCft)} CFT</strong>.
          </div>
          {rateCard.stoneSpendNoCft > 0 && (
            <div style={{ marginTop: 9, fontSize: 11.5, color: C.amber }}>
              {inr(rateCard.stoneSpendNoCft)} of block bills have no CFT entered — outside the stone rate.
            </div>
          )}
          {report.otherSalesInvoices > 0 && (
            <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.line}`, fontSize: 12, color: C.muted }}>
              Plus <strong style={{ color: C.ink }}>{inr(report.otherSalesRevenue)}</strong> Other Sales across {report.otherSalesInvoices} invoice(s) — non-temple.
            </div>
          )}
        </div>
      </div>

      {/* Page-scoped animation + hover css (same patterns as analysis). */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
.tp-grow { animation: tpGrow .6s cubic-bezier(.22,1,.36,1) both; }
@keyframes tpGrow { from { transform: scaleX(0); transform-origin: left } to { transform: scaleX(1); transform-origin: left } }
.tp-reveal { animation: tpReveal .45s cubic-bezier(.22,1,.36,1) both; }
@keyframes tpReveal { from { opacity: 0; transform: translateY(7px) } to { opacity: 1; transform: none } }
.tp-row:hover { background: ${C.wash}; }
`,
        }}
      />
    </div>
  );
}

// ── atoms ─────────────────────────────────────────────────────────

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid rgba(194,116,10,0.35)`, background: "rgba(194,116,10,0.06)", borderRadius: 14, padding: "13px 17px", fontSize: 12.5, color: "#8a5407", lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ alignSelf: "center", fontSize: 17, color: C.muted, fontWeight: 700 }}>{children}</span>
  );
}

const th: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 12px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: C.muted,
  borderBottom: `1px solid ${C.line}`,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  textAlign: "right",
  padding: "12px 12px",
  fontSize: 13,
  color: C.ink,
  fontVariantNumeric: "tabular-nums",
  borderBottom: `1px solid ${C.line}`,
};

const tf: React.CSSProperties = {
  ...td,
  fontWeight: 800,
  borderBottom: "none",
  padding: "13px 12px",
};

/** The cost stack behind one temple's number. */
function ExpandedRow({ t }: { t: PnlTempleRow }) {
  const parts = [
    { ...PARTS[0], v: t.costStone },
    { ...PARTS[1], v: t.costCutting },
    { ...PARTS[2], v: t.costCarving },
  ];
  return (
    <tr style={{ background: C.wash }}>
      <td colSpan={8} style={{ padding: "4px 26px 18px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ ...eyebrow, marginBottom: 8 }}>Cost stack</div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              {parts.map((p) => (
                <div key={p.key} style={{ padding: "9px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.paper, minWidth: 108 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2.5, background: p.color, display: "inline-block" }} />
                    <span style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>{p.label}</span>
                  </div>
                  <div style={{ ...display, fontSize: 15.5, marginTop: 4 }}>{inr(p.v)}</div>
                  <div style={{ fontSize: 9.5, color: C.muted }}>
                    {t.costTotal > 0 ? `${((p.v / t.costTotal) * 100).toFixed(0)}% of cost` : "—"}
                  </div>
                </div>
              ))}
            </div>
            {/* Mini stacked bar of the three streams. */}
            {t.costTotal > 0 && (
              <div style={{ display: "flex", height: 5, borderRadius: 999, overflow: "hidden", background: C.paper, marginTop: 9, maxWidth: 360 }}>
                {parts.map((p) => (
                  <div key={p.key} style={{ width: `${(p.v / t.costTotal) * 100}%`, background: p.color }} />
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={{ ...eyebrow, marginBottom: 8 }}>Detail</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.9, color: C.ink2 }}>
              {t.invoices} invoice{t.invoices === 1 ? "" : "s"} · {num(t.billedCft)} CFT billed
              {t.realisationPerCft != null && <> · sold at <strong style={{ color: C.ink }}>{inrExact(t.realisationPerCft)}/CFT</strong></>}
              {t.outsourceJobwork > 0 && (
                <><br />Outsource jobwork billed for this temple&apos;s slabs: <strong style={{ color: C.ink }}>{inr(t.outsourceJobwork)}</strong> (exact — already inside Carving)</>
              )}
              {t.unmeasuredRevenue > 0 && (
                <><br /><span style={{ color: C.amber }}>{inr(t.unmeasuredRevenue)} of revenue has no measurable volume, so it carries no cost — its margin reads high.</span></>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
