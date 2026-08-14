"use client";

/**
 * Temple P&L — presentation only (Daksh, Aug 2026). Every number is
 * computed server-side in lib/temple-pnl.ts; this file decides how it
 * reads. Minimal + professional: four KPIs, the rate card that explains
 * where cost comes from, one dense table, and an honesty footer.
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

// ── formatting ────────────────────────────────────────────────────

/** Indian short money: ₹1.24 Cr / ₹45.2 L / ₹12,340. */
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

/** Exact rupees, for rate-card figures where precision is the point. */
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
function marginTone(p: number | null): { fg: string; bg: string } {
  if (p == null) return { fg: "var(--muted)", bg: "rgba(120,120,120,0.10)" };
  if (p >= 25) return { fg: "#15803d", bg: "rgba(21,128,61,0.10)" };
  if (p >= 10) return { fg: "#b45309", bg: "rgba(180,83,9,0.10)" };
  return { fg: "#b91c1c", bg: "rgba(185,28,28,0.10)" };
}

// ── atoms ─────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--surface, #fff)",
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(45,36,16,0.04), 0 8px 24px rgba(45,36,16,0.05)",
};

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ ...CARD, padding: "15px 17px", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}
      </div>
      <div style={{ marginTop: 7, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: tone ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "right", padding: "9px 12px", fontSize: 10.5, fontWeight: 800,
  letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  textAlign: "right", padding: "11px 12px", fontSize: 13,
  fontVariantNumeric: "tabular-nums", borderBottom: "1px solid var(--border)",
};

// ── page ──────────────────────────────────────────────────────────

export function PnlClient({ report }: { report: PnlReport }) {
  const [open, setOpen] = useState<string | null>(null);
  const { totals, rateCard, caveats } = report;

  const monthName = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* A window can be untrustworthy two different ways — say which. */}
      {caveats.noProduction && (
        <div style={{ ...CARD, borderColor: "rgba(180,83,9,0.4)", background: "rgba(180,83,9,0.05)", padding: "12px 15px", fontSize: 12.5, color: "#92400e", boxShadow: "none" }}>
          <strong>Nothing was cut in this window,</strong> so there is no production to spread cost over and
          no cost is charged to any temple below. Pick a window where cutting actually happened.
        </div>
      )}
      {!caveats.noProduction && caveats.predatesCosting && caveats.costingStartsAt && (
        <div style={{ ...CARD, borderColor: "rgba(180,83,9,0.4)", background: "rgba(180,83,9,0.05)", padding: "12px 15px", fontSize: 12.5, color: "#92400e", boxShadow: "none" }}>
          <strong>Margins here are unreliable.</strong> Cutting and CNC running expenses were first recorded
          in {monthName(caveats.costingStartsAt)}; earlier months in this window contribute machine
          depreciation but no electricity, manpower or tools. Stay inside FY 26-27 to compare temples fairly.
        </div>
      )}

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Kpi
          label="Invoiced revenue"
          value={inr(totals.revenue)}
          sub={`${report.temples.length} temples · excl. GST`}
        />
        <Kpi
          label="Cost of sales"
          value={inr(totals.cost)}
          sub={`allocated · ${num(totals.billedCft)} CFT billed`}
        />
        <Kpi
          label="Gross margin"
          value={inr(totals.margin)}
          tone={marginTone(totals.marginPct).fg}
          sub="revenue − allocated cost"
        />
        <Kpi
          label="Margin %"
          value={pct(totals.marginPct)}
          tone={marginTone(totals.marginPct).fg}
          sub={totals.billedCft > 0 ? `${inrExact(totals.revenue / totals.billedCft)}/CFT realised` : undefined}
        />
      </div>

      {/* ── Rate card: the whole cost model on one line ── */}
      <div style={{ ...CARD, padding: "15px 17px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
            What one CFT costs us to make
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {inr(rateCard.totalPool)} consumed ÷ {num(rateCard.producedCft)} CFT cut in this window
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {[
            { k: "Stone", v: rateCard.stonePerCft, note: `blocks cut × ${inrExact(rateCard.stoneRatePerBlockCft)}/CFT` },
            { k: "Cutting", v: rateCard.cuttingPerCft, note: "expenses + depreciation" },
            { k: "Carving", v: rateCard.carvingPerCft, note: "CNC + jobwork" },
          ].map((p, i) => (
            <div key={p.k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {i > 0 && <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 700 }}>+</span>}
              <div style={{ padding: "8px 13px", borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)", minWidth: 116 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{p.k}</div>
                <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{inrExact(p.v)}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{p.note}</div>
              </div>
            </div>
          ))}
          <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 700 }}>=</span>
          <div style={{ padding: "8px 15px", borderRadius: 11, background: "rgba(180,140,60,0.10)", border: "1.5px solid var(--gold, #b8860b)", minWidth: 130 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--gold, #8a6410)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Make cost</div>
            <div style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{inrExact(rateCard.makeCostPerCft)}</div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>per CFT</div>
          </div>
        </div>
      </div>

      {/* ── Temple table ── */}
      <div style={{ ...CARD, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left" }}>Temple</th>
                <th style={thStyle}>Revenue</th>
                <th style={thStyle}>CFT billed</th>
                <th style={thStyle}>₹/CFT got</th>
                <th style={thStyle}>Cost of sales</th>
                <th style={thStyle}>Margin</th>
                <th style={{ ...thStyle, minWidth: 132 }}>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {report.temples.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "var(--muted)", padding: "28px 12px" }}>
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
                      onClick={() => setOpen(isOpen ? null : t.temple)}
                      style={{ cursor: "pointer", background: isOpen ? "var(--bg)" : undefined }}
                    >
                      <td style={{ ...tdStyle, textAlign: "left", fontWeight: 700, maxWidth: 300 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 9, color: "var(--muted)", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>▶</span>
                          {t.temple}
                        </span>
                        {t.unmeasuredRevenue > 0 && (
                          <span title="Some invoices have no measurable volume (NOS / unit-less lines), so no cost is allocated against that revenue."
                            style={{ marginLeft: 8, fontSize: 9.5, fontWeight: 800, color: "#b45309", background: "rgba(180,83,9,0.12)", padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap" }}>
                            ⚠ {inr(t.unmeasuredRevenue)} unmeasured
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{inr(t.revenue)}</td>
                      <td style={tdStyle}>{num(t.billedCft)}</td>
                      <td style={tdStyle}>{t.realisationPerCft == null ? "—" : inrExact(t.realisationPerCft)}</td>
                      <td style={{ ...tdStyle, color: "var(--muted)" }}>{inr(t.costTotal)}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: tone.fg }}>{inr(t.margin)}</td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                          <div style={{ flex: 1, maxWidth: 62, height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                            <div style={{ width: `${bar}%`, height: "100%", background: tone.fg, borderRadius: 3 }} />
                          </div>
                          <span style={{ fontWeight: 800, color: tone.fg, minWidth: 46, textAlign: "right" }}>{pct(t.marginPct)}</span>
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
                <tr style={{ background: "var(--bg)" }}>
                  <td style={{ ...tdStyle, textAlign: "left", fontWeight: 800, borderBottom: "none" }}>Total</td>
                  <td style={{ ...tdStyle, fontWeight: 800, borderBottom: "none" }}>{inr(totals.revenue)}</td>
                  <td style={{ ...tdStyle, fontWeight: 800, borderBottom: "none" }}>{num(totals.billedCft)}</td>
                  <td style={{ ...tdStyle, borderBottom: "none" }}>
                    {totals.billedCft > 0 ? inrExact(totals.revenue / totals.billedCft) : "—"}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 800, borderBottom: "none", color: "var(--muted)" }}>{inr(totals.cost)}</td>
                  <td style={{ ...tdStyle, fontWeight: 800, borderBottom: "none", color: marginTone(totals.marginPct).fg }}>{inr(totals.margin)}</td>
                  <td style={{ ...tdStyle, fontWeight: 800, borderBottom: "none", color: marginTone(totals.marginPct).fg }}>{pct(totals.marginPct)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Reconciliation + honesty ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <div style={{ ...CARD, padding: "15px 17px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 9 }}>Where the numbers come from</div>
          <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12, lineHeight: 1.75, color: "var(--text)" }}>
            <li><strong>Revenue — exact.</strong> Issued invoices only (same source as the Invoicing page), excluding GST, after discount.</li>
            <li><strong>Cost — allocated.</strong> The system has no per-block or per-slab cost, so period pools are divided by CFT cut and charged to each temple by the CFT it was billed.</li>
            <li><strong>Stone is charged as consumed,</strong> not as bought — blocks actually cut, priced at this window&apos;s purchase rate per block-CFT.</li>
            <li><strong>Outsource jobwork is the one exact cost</strong> and is inside the carving pool.</li>
          </ul>
        </div>
        <div style={{ ...CARD, padding: "15px 17px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 9 }}>Not included in cost</div>
          <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12, lineHeight: 1.75, color: "var(--muted)" }}>
            {MISSING_COSTS.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)" }}>
            True margin is lower than shown. Treat these figures as a comparison between temples, not as a filed P&L.
          </div>
        </div>
        <div style={{ ...CARD, padding: "15px 17px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 9 }}>Stone &amp; stock this window</div>
          <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text)" }}>
            Bought <strong>{inr(rateCard.stoneSpend)}</strong> of blocks ({num(rateCard.stoneBillCft)} CFT),
            but cut only <strong>{num(rateCard.consumedBlockCft)} CFT</strong> of them — so just{" "}
            <strong>{inr(rateCard.stonePool)}</strong> of stone is charged above.
            {rateCard.stoneBillCft > rateCard.consumedBlockCft && (
              <> The rest is stone sitting in the yard, not a cost yet.</>
            )}
            <br />
            Those blocks yielded <strong>{num(rateCard.producedCft)} CFT</strong> of slabs
            {rateCard.recoveryPct != null && <> — <strong>{rateCard.recoveryPct.toFixed(0)}% recovery</strong></>}, of which{" "}
            <strong>{num(totals.billedCft)} CFT</strong> was billed.
          </div>
          {rateCard.stoneSpendNoCft > 0 && (
            <div style={{ marginTop: 9, fontSize: 11, color: "#b45309" }}>
              {inr(rateCard.stoneSpendNoCft)} of block bills have no CFT entered, so they are outside the stone rate.
            </div>
          )}
          {report.otherSalesInvoices > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--muted)" }}>
              Plus <strong>{inr(report.otherSalesRevenue)}</strong> of Other Sales across {report.otherSalesInvoices} invoice(s) — non-temple, so not in the table above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The cost stack behind one temple's number. */
function ExpandedRow({ t }: { t: PnlTempleRow }) {
  const parts = [
    { k: "Stone", v: t.costStone },
    { k: "Cutting", v: t.costCutting },
    { k: "Carving", v: t.costCarving },
  ];
  return (
    <tr style={{ background: "var(--bg)" }}>
      <td colSpan={7} style={{ padding: "0 12px 15px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>
              Cost stack
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {parts.map((p) => (
                <div key={p.k} style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface, #fff)" }}>
                  <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>{p.k}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{inr(p.v)}</div>
                  <div style={{ fontSize: 9.5, color: "var(--muted)" }}>
                    {t.costTotal > 0 ? `${((p.v / t.costTotal) * 100).toFixed(0)}% of cost` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>
              Detail
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.85, color: "var(--text)" }}>
              {t.invoices} invoice{t.invoices === 1 ? "" : "s"} · {num(t.billedCft)} CFT billed
              {t.realisationPerCft != null && <> · sold at <strong>{inrExact(t.realisationPerCft)}/CFT</strong></>}
              {t.outsourceJobwork > 0 && (
                <><br />Outsource jobwork billed for this temple&apos;s slabs: <strong>{inr(t.outsourceJobwork)}</strong> (exact — already inside Carving)</>
              )}
              {t.unmeasuredRevenue > 0 && (
                <><br /><span style={{ color: "#b45309" }}>{inr(t.unmeasuredRevenue)} of revenue has no measurable volume, so it carries no cost — its margin reads high.</span></>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
