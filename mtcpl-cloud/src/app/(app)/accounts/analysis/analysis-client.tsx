"use client";

/**
 * Finance Analysis — client shell.
 *
 * Design brief (Daksh): "really good UI, crazy good and premium apple
 * feel." So: a light, calm, high-contrast surface; oversized display
 * numerals with tight tracking; generous whitespace; soft layered
 * shadows and 20px radii; colour used only where it carries meaning
 * (green = paid, amber = outstanding); and one smooth spring for the
 * vendor sheet. No library — everything below is hand-rolled CSS.
 *
 * Read-only view: nothing here mutates anything.
 */

import { useMemo, useState } from "react";

// ── Types shared with the server page ──────────────────────────────

export type VendorBill = {
  id: string;
  token: string | null;
  billNo: string | null;
  date: string | null;
  costHead: string | null;
  status: string;
  billed: number;
  paid: number;
  outstanding: number;
};

export type VendorPayment = {
  id: string;
  date: string | null;
  amount: number;
  method: string | null;
  billToken: string | null;
};

export type VendorAnalysis = {
  id: string;
  name: string;
  category: string | null;
  isActive: boolean;
  billed: number;
  paid: number;
  outstanding: number;
  billCount: number;
  openBillCount: number;
  firstBillDate: string | null;
  lastPaymentDate: string | null;
  oldestOpenDate: string | null;
  bills: VendorBill[];
  payments: VendorPayment[];
};

export type MonthPoint = {
  key: string;
  label: string;
  year: number;
  paid: number;
  billed: number;
};

export type HeadSlice = { head: string; amount: number };

type Totals = { billed: number; paid: number; outstanding: number; bills: number };

// ── Formatting ─────────────────────────────────────────────────────

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** 1,23,45,678 → "1.23 Cr". Keeps hero numbers readable at a glance. */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(Math.round(n));
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const p = iso.split("-").map(Number);
  if (p.length !== 3) return iso;
  return `${p[2]} ${MON[p[1] - 1]} ${p[0]}`;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00+05:30`);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// ── Palette (light, pinned — finance is a light surface) ───────────

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
  red: "#c0392b",
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

export function FinanceAnalysisClient({
  vendors,
  months,
  heads,
  aging,
  totals,
  activeVendorCount,
  generatedFor,
}: {
  vendors: VendorAnalysis[];
  months: MonthPoint[];
  heads: HeadSlice[];
  aging: Array<{ label: string; amount: number; count: number }>;
  totals: Totals;
  activeVendorCount: number;
  generatedFor: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"outstanding" | "paid" | "billed" | "name">("outstanding");
  const [openVendor, setOpenVendor] = useState<VendorAnalysis | null>(null);

  const collectedPct = totals.billed > 0 ? (totals.paid / totals.billed) * 100 : 0;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? vendors.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            (v.category ?? "").toLowerCase().includes(q),
        )
      : vendors;
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => b[sort] - a[sort]);
    return sorted;
  }, [vendors, query, sort]);

  const maxMonth = Math.max(...months.map((m) => Math.max(m.paid, m.billed)), 1);
  const maxHead = Math.max(...heads.map((h) => h.amount), 1);
  const maxAging = Math.max(...aging.map((a) => a.amount), 1);

  return (
    <section style={{ paddingBottom: 40 }}>
      <Styles />

      {/* ── Masthead ─────────────────────────────────────────── */}
      <header style={{ marginBottom: 26 }}>
        <div style={{ ...eyebrow, color: C.indigo }}>Owner view · Finance</div>
        <h1
          style={{
            ...display,
            margin: "6px 0 0",
            fontSize: 38,
            lineHeight: 1.05,
          }}
        >
          Finance Analysis
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: C.muted, maxWidth: 620, lineHeight: 1.55 }}>
          The whole department in one place — what we&apos;ve been billed, what
          we&apos;ve paid, what&apos;s still open, and every vendor&apos;s full history.
          Open any vendor to see its bills and every payment made.
        </p>
      </header>

      {/* ── Hero numbers ─────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <HeroTile
          label="Total billed"
          value={compact(totals.billed)}
          exact={inr(totals.billed)}
          foot={`${totals.bills.toLocaleString("en-IN")} bills · ${vendors.length} vendors`}
          accent={C.indigo}
          soft={C.indigoSoft}
        />
        <HeroTile
          label="Total paid"
          value={compact(totals.paid)}
          exact={inr(totals.paid)}
          foot={`${collectedPct.toFixed(1)}% of everything billed`}
          accent={C.green}
          soft={C.greenSoft}
        />
        <HeroTile
          label="Still outstanding"
          value={compact(totals.outstanding)}
          exact={inr(totals.outstanding)}
          foot={`across ${activeVendorCount} vendor${activeVendorCount === 1 ? "" : "s"}`}
          accent={C.amber}
          soft={C.amberSoft}
        />
      </div>

      {/* ── Settlement bar ───────────────────────────────────── */}
      <div style={{ ...card, padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={eyebrow}>Settlement</div>
          <div style={{ fontSize: 13, color: C.muted }}>
            <strong style={{ color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(totals.paid)}</strong> paid
            {" · "}
            <strong style={{ color: C.amber, fontVariantNumeric: "tabular-nums" }}>{inr(totals.outstanding)}</strong> open
          </div>
        </div>
        <div
          style={{
            marginTop: 14,
            height: 14,
            borderRadius: 999,
            background: C.wash,
            overflow: "hidden",
            display: "flex",
            border: `1px solid ${C.line}`,
          }}
        >
          <div
            className="fa-grow"
            style={{
              width: `${Math.min(collectedPct, 100)}%`,
              background: `linear-gradient(90deg, ${C.green}, #35c07a)`,
            }}
            title={`Paid ${inr(totals.paid)}`}
          />
          <div style={{ flex: 1, background: `linear-gradient(90deg, ${C.amber}, #e0a44a)` }} title={`Outstanding ${inr(totals.outstanding)}`} />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
          {collectedPct.toFixed(1)}% of all billed value has been settled.
        </div>
      </div>

      {/* ── Cash out per month ───────────────────────────────── */}
      <div style={{ ...card, padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={eyebrow}>Last 12 months</div>
            <div style={{ ...display, fontSize: 19, marginTop: 4 }}>Billed vs paid</div>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <Legend color={C.indigo} label="Billed" />
            <Legend color={C.green} label="Paid" />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 22, overflowX: "auto" }}>
          {months.map((m) => (
            <div key={m.key} style={{ flex: 1, minWidth: 44, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {m.paid > 0 ? compact(m.paid) : ""}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 130, width: "100%", justifyContent: "center" }}
                title={`${m.label} ${m.year}\nBilled ${inr(m.billed)}\nPaid ${inr(m.paid)}`}>
                <Bar value={m.billed} max={maxMonth} color={C.indigo} />
                <Bar value={m.paid} max={maxMonth} color={C.green} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.ink2 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Aging + cost heads ───────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={{ ...card, padding: "20px 24px" }}>
          <div style={eyebrow}>How old is the open money</div>
          <div style={{ ...display, fontSize: 19, margin: "4px 0 18px" }}>Aging of outstanding</div>
          {aging.map((a) => (
            <div key={a.label} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: C.ink2, fontWeight: 600 }}>
                  {a.label} <span style={{ color: C.muted, fontWeight: 500 }}>· {a.count} bills</span>
                </span>
                <strong style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(a.amount)}</strong>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                <div
                  className="fa-grow"
                  style={{
                    width: `${(a.amount / maxAging) * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${C.amber}, #e8b45c)`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...card, padding: "20px 24px" }}>
          <div style={eyebrow}>Where the money goes</div>
          <div style={{ ...display, fontSize: 19, margin: "4px 0 18px" }}>By cost head</div>
          {heads.slice(0, 7).map((h) => (
            <div key={h.head} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, gap: 10 }}>
                <span style={{ color: C.ink2, fontWeight: 600, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.head.replace(/_/g, " ")}
                </span>
                <strong style={{ color: C.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{inr(h.amount)}</strong>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                <div
                  className="fa-grow"
                  style={{
                    width: `${(h.amount / maxHead) * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${C.indigo}, #7c8cf8)`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Vendors ──────────────────────────────────────────── */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${C.line}`,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={eyebrow}>Every vendor</div>
            <div style={{ ...display, fontSize: 19, marginTop: 4 }}>
              {shown.length} of {vendors.length}
            </div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor or category…"
            className="fa-input"
            style={{
              flex: "1 1 240px",
              maxWidth: 340,
              padding: "11px 16px",
              fontSize: 14,
              color: C.ink,
              background: C.wash,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              outline: "none",
            }}
          />
          <div style={{ display: "inline-flex", background: C.wash, border: `1px solid ${C.line}`, borderRadius: 12, padding: 4, gap: 3 }}>
            {([
              ["outstanding", "Open"],
              ["paid", "Paid"],
              ["billed", "Billed"],
              ["name", "A–Z"],
            ] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  border: "none",
                  borderRadius: 9,
                  cursor: sort === k ? "default" : "pointer",
                  background: sort === k ? C.paper : "transparent",
                  color: sort === k ? C.ink : C.muted,
                  boxShadow: sort === k ? "0 1px 3px rgba(11,18,32,0.12)" : "none",
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: C.muted, fontSize: 14 }}>
            No vendor matches “{query}”.
          </div>
        ) : (
          <div>
            {shown.map((v) => {
              const pct = v.billed > 0 ? (v.paid / v.billed) * 100 : 0;
              const age = daysSince(v.oldestOpenDate);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setOpenVendor(v)}
                  className="fa-row"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "grid",
                    gridTemplateColumns: "minmax(180px,2.2fr) minmax(120px,1fr) minmax(120px,1fr) minmax(150px,1.3fr)",
                    gap: 16,
                    alignItems: "center",
                    padding: "16px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid ${C.line}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 650, color: C.ink, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                      {v.billCount} bill{v.billCount === 1 ? "" : "s"}
                      {v.category ? ` · ${v.category}` : ""}
                      {v.lastPaymentDate ? ` · last paid ${fmtDate(v.lastPaymentDate)}` : " · never paid"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, ...eyebrow }}>Paid</div>
                    <div style={{ fontSize: 14, fontWeight: 650, color: C.green, fontVariantNumeric: "tabular-nums" }}>{inr(v.paid)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, ...eyebrow }}>Open</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: v.outstanding > 0.5 ? C.amber : C.muted, fontVariantNumeric: "tabular-nums" }}>
                      {v.outstanding > 0.5 ? inr(v.outstanding) : "settled"}
                    </div>
                  </div>
                  <div>
                    <div style={{ height: 7, borderRadius: 999, background: C.wash, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: pct >= 99.5 ? C.green : `linear-gradient(90deg, ${C.green}, #7fd4a4)` }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>
                      {pct.toFixed(0)}% settled
                      {age != null && v.outstanding > 0.5 ? ` · oldest ${age}d` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {openVendor && <VendorSheet vendor={openVendor} onClose={() => setOpenVendor(null)} />}
    </section>
  );
}

// ── Vendor detail sheet ────────────────────────────────────────────

function VendorSheet({ vendor: v, onClose }: { vendor: VendorAnalysis; onClose: () => void }) {
  const [tab, setTab] = useState<"bills" | "payments">("bills");
  const pct = v.billed > 0 ? (v.paid / v.billed) * 100 : 0;
  const age = daysSince(v.oldestOpenDate);

  return (
    <div className="fa-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${v.name} detail`}>
      <div className="fa-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "26px 30px 20px", borderBottom: `1px solid ${C.line}`, background: `linear-gradient(180deg, #fbfcfe, ${C.paper})` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div style={eyebrow}>Vendor</div>
              <h2 style={{ ...display, fontSize: 27, margin: "6px 0 0", lineHeight: 1.15 }}>{v.name}</h2>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 7 }}>
                {v.category ? `${v.category} · ` : ""}
                {v.billCount} bill{v.billCount === 1 ? "" : "s"} · first billed {fmtDate(v.firstBillDate)}
                {!v.isActive && " · inactive"}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="fa-close">✕</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 22 }}>
            <MiniStat label="Billed" value={inr(v.billed)} color={C.ink} />
            <MiniStat label="Paid" value={inr(v.paid)} color={C.green} />
            <MiniStat label="Still open" value={v.outstanding > 0.5 ? inr(v.outstanding) : "Settled"} color={v.outstanding > 0.5 ? C.amber : C.green} />
            <MiniStat label="Last paid" value={fmtDate(v.lastPaymentDate)} color={C.ink2} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ height: 10, borderRadius: 999, background: C.wash, overflow: "hidden", border: `1px solid ${C.line}` }}>
              <div className="fa-grow" style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: `linear-gradient(90deg, ${C.green}, #43c98a)` }} />
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>
              {pct.toFixed(1)}% settled
              {v.openBillCount > 0 && ` · ${v.openBillCount} bill${v.openBillCount === 1 ? "" : "s"} still open`}
              {age != null && v.outstanding > 0.5 && ` · oldest open ${age} days`}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding: "14px 30px 0", display: "flex", gap: 6 }}>
          {([["bills", `Bills (${v.bills.length})`], ["payments", `Payments (${v.payments.length})`]] as const).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                borderRadius: 11,
                cursor: tab === k ? "default" : "pointer",
                background: tab === k ? C.ink : "transparent",
                color: tab === k ? "#fff" : C.muted,
              }}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 30px 30px" }}>
          {tab === "bills" ? (
            v.bills.length === 0 ? (
              <Empty text="No bills recorded for this vendor." />
            ) : (
              v.bills.map((b) => (
                <div key={b.id} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: C.ink }}>
                      {b.token || b.billNo || "—"}
                      {b.billNo && b.token && <span style={{ color: C.muted, fontWeight: 500 }}> · bill {b.billNo}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                      {fmtDate(b.date)}
                      {b.costHead ? ` · ${b.costHead.replace(/_/g, " ")}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 96 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(b.billed)}</div>
                    <div style={{ fontSize: 11, color: C.green, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{inr(b.paid)} paid</div>
                  </div>
                  <div style={{ minWidth: 104, textAlign: "right" }}>
                    {b.outstanding > 0.5 ? (
                      <span style={{ display: "inline-block", padding: "4px 11px", borderRadius: 999, background: C.amberSoft, color: C.amber, fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {inr(b.outstanding)} open
                      </span>
                    ) : (
                      <span style={{ display: "inline-block", padding: "4px 11px", borderRadius: 999, background: C.greenSoft, color: C.green, fontSize: 11.5, fontWeight: 700 }}>
                        Settled
                      </span>
                    )}
                  </div>
                </div>
              ))
            )
          ) : v.payments.length === 0 ? (
            <Empty text="No payment has been made to this vendor yet." />
          ) : (
            <div style={{ position: "relative", paddingLeft: 22 }}>
              {/* timeline rail */}
              <div style={{ position: "absolute", left: 5, top: 8, bottom: 8, width: 2, background: C.line, borderRadius: 2 }} />
              {v.payments.map((p) => (
                <div key={p.id} style={{ position: "relative", padding: "13px 0", borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ position: "absolute", left: -21, top: 20, width: 10, height: 10, borderRadius: "50%", background: C.green, boxShadow: `0 0 0 3px ${C.greenSoft}` }} />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 650, color: C.ink }}>{fmtDate(p.date)}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                        {p.method ? p.method.replace(/_/g, " ") : "payment"}
                        {p.billToken ? ` · ${p.billToken}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.green, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {inr(p.amount)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small pieces ───────────────────────────────────────────────────

function HeroTile({
  label, value, exact, foot, accent, soft,
}: {
  label: string; value: string; exact: string; foot: string; accent: string; soft: string;
}) {
  return (
    <div style={{ ...card, padding: "22px 24px", position: "relative", overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", right: -40, top: -40, width: 140, height: 140, borderRadius: "50%", background: soft, pointerEvents: "none" }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: accent, boxShadow: `0 0 0 3px ${soft}` }} />
          <span style={eyebrow}>{label}</span>
        </div>
        <div style={{ ...display, fontSize: 34, marginTop: 12, lineHeight: 1.05 }}>{value}</div>
        <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{exact}</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 9 }}>{foot}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: C.wash, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ ...eyebrow, fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 5, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      className="fa-bar"
      style={{
        width: 13,
        height: value > 0 ? `${Math.max(pct, 2)}%` : 0,
        background: color,
        borderRadius: "4px 4px 0 0",
      }}
    />
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 44, textAlign: "center", color: C.muted, fontSize: 13.5 }}>{text}</div>;
}

function Styles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.fa-row { transition: background .12s ease; }
.fa-row:hover { background: #f7f9fc; }
.fa-row:last-child { border-bottom: none !important; }
.fa-input:focus { border-color: ${C.indigo} !important; box-shadow: 0 0 0 4px rgba(79,70,229,0.12); background: #fff !important; }
.fa-bar { transition: height .5s cubic-bezier(.22,1,.36,1); }
.fa-grow { animation: faGrow .6s cubic-bezier(.22,1,.36,1) both; }
@keyframes faGrow { from { transform: scaleX(0); transform-origin: left } to { transform: scaleX(1); transform-origin: left } }

.fa-scrim {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(11,18,32,0.34);
  backdrop-filter: saturate(160%) blur(6px);
  display: flex; justify-content: flex-end;
  animation: faFade .18s ease both;
}
@keyframes faFade { from { opacity: 0 } to { opacity: 1 } }
.fa-sheet {
  width: 640px; max-width: 96vw; height: 100%;
  background: ${C.paper};
  display: flex; flex-direction: column;
  box-shadow: -20px 0 60px rgba(11,18,32,0.22);
  animation: faSlide .34s cubic-bezier(.22,1,.36,1) both;
}
@keyframes faSlide { from { transform: translateX(26px); opacity: .4 } to { transform: translateX(0); opacity: 1 } }
.fa-close {
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid ${C.line}; background: ${C.wash};
  border-radius: 50%; cursor: pointer; font-size: 15px; color: ${C.ink2};
  transition: background .12s ease, color .12s ease;
}
.fa-close:hover { background: ${C.ink}; color: #fff; border-color: ${C.ink}; }
`,
      }}
    />
  );
}
