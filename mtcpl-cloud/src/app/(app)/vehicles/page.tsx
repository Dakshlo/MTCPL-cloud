// Vehicles → Overview (mig 204). An analytics cockpit over BOTH fleets:
// fleet-health donut, monthly + remaining EMI liability with per-loan progress,
// document coverage, and the expiry radar. Pure server render — fast.

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { VEHICLES_ROLES } from "@/lib/vehicles-access";
import { loadVehicles } from "./_data";

export const dynamic = "force-dynamic";

// Local copies — do NOT import runtime values from the "use client" module
// (client-reference proxy gotcha).
function daysTo(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00+05:30`).getTime();
  return Math.floor((target - Date.now()) / 86_400_000);
}
function monthsLeft(end: string | null): number | null {
  if (!end) return null;
  const now = new Date();
  const e = new Date(`${end.slice(0, 10)}T00:00:00+05:30`);
  const m = (e.getFullYear() - now.getFullYear()) * 12 + (e.getMonth() - now.getMonth());
  return Math.max(0, m + (e.getDate() >= now.getDate() ? 1 : 0));
}
function loanPct(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = new Date(`${start.slice(0, 10)}T00:00:00+05:30`).getTime();
  const e = new Date(`${end.slice(0, 10)}T00:00:00+05:30`).getTime();
  if (!(e > s)) return null;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - s) / (e - s)) * 100)));
}
const fmtD = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const inrShort = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : inr(n);

const RED = "#dc2626", AMBER = "#d97706", GREEN = "#16a34a", GREY = "#94a3b8", ACCENT = "#4f6d9c";

export default async function VehiclesOverviewPage() {
  await requireAuth(VEHICLES_ROLES);
  const { rows, migMissing } = await loadVehicles();

  // ── expiry radar (both fleets, next 45 days) ──────────────────────
  type Alert = { vehicle: string; kind: "commercial" | "personal"; doc: string; date: string; days: number };
  const alerts: Alert[] = [];
  for (const v of rows) {
    const docs: Array<[string, string | null]> = [
      ["Insurance", v.insurance_expiry],
      ["PUC", v.puc_expiry],
      ...(v.kind === "commercial" ? ([["Fitness", v.fitness_expiry]] as Array<[string, string | null]>) : []),
    ];
    for (const [doc, date] of docs) {
      const d = daysTo(date);
      if (date && d != null && d <= 45) alerts.push({ vehicle: v.name, kind: v.kind, doc, date, days: d });
    }
  }
  alerts.sort((a, b) => a.days - b.days);
  const expired = alerts.filter((a) => a.days < 0).length;
  const soon = alerts.filter((a) => a.days >= 0 && a.days <= 30).length;

  // ── fleet health: worst applicable-doc status per vehicle ─────────
  let health = { ok: 0, warn: 0, crit: 0, none: 0 };
  for (const v of rows) {
    const ds = [v.insurance_expiry, v.puc_expiry, ...(v.kind === "commercial" ? [v.fitness_expiry] : [])]
      .map(daysTo).filter((d): d is number => d != null);
    if (ds.length === 0) health.none++;
    else if (ds.some((d) => d < 0)) health.crit++;
    else if (ds.some((d) => d <= 30)) health.warn++;
    else health.ok++;
  }

  // ── EMI analytics ─────────────────────────────────────────────────
  const emis = rows.filter((v) => v.emi_active && v.emi_amount != null).sort((a, b) => (a.emi_day ?? 32) - (b.emi_day ?? 32));
  const emiTotal = emis.reduce((s, v) => s + (v.emi_amount ?? 0), 0);
  const liability = emis.reduce((s, v) => s + (v.emi_amount ?? 0) * (monthsLeft(v.emi_end) ?? 0), 0);

  const commercial = rows.filter((v) => v.kind === "commercial").length;
  const personal = rows.length - commercial;
  const docsOnFile = rows.reduce((s, v) => s + v.docs.length, 0);

  // ── little presentational helpers (server) ────────────────────────
  const Tile = (icon: string, value: string | number, label: string, sub?: string, color?: string): React.ReactNode => (
    <div style={{ flex: "1 1 160px", minWidth: 150, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: "15px 16px" }}>
      <div style={{ fontSize: 12.5 }}>{icon}</div>
      <div style={{ fontSize: 23, fontWeight: 900, color: color ?? "var(--text)", marginTop: 3, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{sub}</div>}
    </div>
  );

  const donut = () => {
    const segs = [
      { v: health.crit, c: RED, l: "Expired" },
      { v: health.warn, c: AMBER, l: "Expiring ≤30d" },
      { v: health.ok, c: GREEN, l: "All valid" },
      { v: health.none, c: GREY, l: "No dates set" },
    ];
    const sum = segs.reduce((s, x) => s + x.v, 0) || 1;
    let acc = 0;
    const stops = segs.filter((s) => s.v > 0).map((s) => {
      const a = (acc / sum) * 100; acc += s.v; const b = (acc / sum) * 100;
      return `${s.c} ${a}% ${b}%`;
    });
    const ring = stops.length ? stops.join(", ") : `${GREY} 0% 100%`;
    return (
      <div style={{ flex: "1 1 260px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: "16px 18px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 12 }}>🩺 Fleet health</div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
            <div style={{ width: 132, height: 132, borderRadius: "50%", background: `conic-gradient(${ring})` }} />
            <div style={{ position: "absolute", inset: 17, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{rows.length}</div>
              <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>vehicles</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 7, flex: "1 1 140px" }}>
            {segs.map((s) => (
              <div key={s.l} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c, flexShrink: 0 }} />
                <span style={{ fontWeight: 700 }}>{s.l}</span>
                <span style={{ marginLeft: "auto", fontWeight: 900 }}>{s.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const split = () => {
    const total = rows.length || 1;
    const cPct = Math.round((commercial / total) * 100);
    return (
      <div style={{ flex: "1 1 260px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: "16px 18px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 14 }}>🚦 Fleet split &amp; documents</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>
          <span>🚛 Commercial · {commercial}</span>
          <span>🚗 Personal · {personal}</span>
        </div>
        <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "var(--bg)", border: "1px solid var(--border)" }}>
          <div style={{ width: `${cPct}%`, background: ACCENT }} />
          <div style={{ width: `${100 - cPct}%`, background: "#c9a15a" }} />
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>📄 Documents on file</span>
            <span style={{ fontSize: 17, fontWeight: 900 }}>{docsOnFile}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>💳 On EMI / loan</span>
            <span style={{ fontSize: 17, fontWeight: 900 }}>{emis.length}<span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}> / {rows.length}</span></span>
          </div>
        </div>
      </div>
    );
  };

  const sectionHd = (t: string): React.ReactNode => (
    <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 9 }}>{t}</div>
  );
  const emptyBox = (t: string): React.ReactNode => (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 12, background: "var(--surface)", padding: "22px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t}</div>
  );

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>🚚 Vehicles</h1>
        <p className="muted">Fleet cockpit — compliance at a glance, EMI load and liability, and what expires next.</p>
      </div>

      {migMissing ? (
        <div className="banner" style={{ marginTop: 14 }}>Run migration <strong>204_vehicles_department.sql</strong> to switch this department on.</div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 18, border: "1px dashed var(--border)", borderRadius: 16, background: "var(--surface)", padding: "44px 22px", textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>🚚</div>
          <div style={{ fontSize: 16, fontWeight: 900, marginTop: 8 }}>No vehicles yet</div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Open <strong>Commercial</strong> or <strong>Personal</strong> from the menu and add your first vehicle.<br />This cockpit fills in automatically — expiries, EMI load and document coverage.</p>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginTop: 16 }}>
            {Tile("🚚", rows.length, "Fleet size", `${commercial} commercial · ${personal} personal`)}
            {Tile("💳", emis.length ? inrShort(emiTotal) : "—", "Monthly EMI", `${emis.length} active loan${emis.length === 1 ? "" : "s"}`, ACCENT)}
            {Tile("🏦", liability ? inrShort(liability) : "—", "EMI liability left", "sum of remaining EMIs", ACCENT)}
            {Tile("⛔", expired, "Expired documents", expired ? "renew now" : "none overdue", expired ? RED : undefined)}
            {Tile("⏳", soon, "Expiring ≤ 30 days", soon ? "coming due" : "nothing soon", soon ? AMBER : undefined)}
          </div>

          {/* analytics row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
            {donut()}
            {split()}
          </div>

          {/* Expiry radar */}
          <div style={{ marginTop: 22 }}>
            {sectionHd("📅 Expiry radar — next 45 days")}
            {alerts.length === 0 ? emptyBox("✅ Nothing expiring in the next 45 days.") : (
              <div style={{ display: "grid", gap: 7 }}>
                {alerts.map((a, i) => {
                  const exp = a.days < 0;
                  return (
                    <Link key={i} href={`/vehicles/${a.kind}`} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: 11, textDecoration: "none", color: "var(--text)", background: exp ? "rgba(220,38,38,0.05)" : "rgba(217,119,6,0.05)", border: `1px solid ${exp ? "#fecaca" : "#fde68a"}`, borderLeft: `4px solid ${exp ? RED : AMBER}` }}>
                      <span style={{ fontSize: 16 }}>{a.kind === "commercial" ? "🚛" : "🚗"}</span>
                      <span style={{ fontWeight: 900, fontSize: 13.5, minWidth: 120 }}>{a.vehicle}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: exp ? "#b91c1c" : "#b45309", background: exp ? "rgba(220,38,38,0.1)" : "rgba(217,119,6,0.12)", borderRadius: 999, padding: "2px 10px" }}>{a.doc.toUpperCase()}</span>
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{fmtD(a.date)}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 900, color: exp ? "#b91c1c" : "#b45309" }}>
                        {exp ? `EXPIRED ${Math.abs(a.days)}d ago` : a.days === 0 ? "expires TODAY" : `${a.days} days left`}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* EMI monitor — per-loan progress, ordered by due day */}
          <div style={{ marginTop: 22 }}>
            {sectionHd("💳 EMI monitor — by due day")}
            {emis.length === 0 ? emptyBox("No vehicles on EMI.") : (
              <div style={{ display: "grid", gap: 8 }}>
                {emis.map((v) => {
                  const pct = loanPct(v.emi_start, v.emi_end);
                  const mLeft = monthsLeft(v.emi_end);
                  return (
                    <Link key={v.id} href={`/vehicles/${v.kind}`} style={{ display: "block", padding: "11px 14px", borderRadius: 11, textDecoration: "none", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `4px solid ${ACCENT}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 9, background: "rgba(79,109,156,0.1)", border: "1px solid rgba(79,109,156,0.3)", flexShrink: 0 }}>
                          <span style={{ fontSize: 15, fontWeight: 900, color: ACCENT, lineHeight: 1 }}>{v.emi_day ?? "—"}</span>
                          <span style={{ fontSize: 7.5, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>day</span>
                        </span>
                        <span style={{ minWidth: 130 }}>
                          <span style={{ display: "block", fontSize: 13.5, fontWeight: 900 }}>{v.kind === "commercial" ? "🚛" : "🚗"} {v.name}</span>
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>{v.emi_lender || "—"}</span>
                        </span>
                        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 900, fontFamily: "ui-monospace, monospace", color: ACCENT }}>{inr(v.emi_amount ?? 0)}</span>
                      </div>
                      {pct != null && (
                        <div style={{ marginTop: 9 }}>
                          <div style={{ height: 6, borderRadius: 999, background: "var(--bg)", overflow: "hidden", border: "1px solid var(--border)" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: ACCENT }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginTop: 3 }}>
                            <span>{pct}% paid{v.emi_end ? ` · ends ${fmtD(v.emi_end)}` : ""}</span>
                            {mLeft != null && <span>{mLeft} EMI{mLeft === 1 ? "" : "s"} left · {inr((v.emi_amount ?? 0) * mLeft)}</span>}
                          </div>
                        </div>
                      )}
                    </Link>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 18, fontSize: 12.5, fontWeight: 900, padding: "4px 14px" }}>
                  <span>Monthly outgo <span style={{ fontFamily: "ui-monospace, monospace", color: ACCENT, marginLeft: 6 }}>{inr(emiTotal)}</span></span>
                  <span>Liability left <span style={{ fontFamily: "ui-monospace, monospace", color: ACCENT, marginLeft: 6 }}>{inr(liability)}</span></span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
