// Vehicles → Overview (mig 204). A compliance cockpit over BOTH fleets:
// per-fleet counts + how many are on EMI, a fleet-health donut, an expiry
// radar organised into one column per document type, and the EMI monitor.
// Pure server render — fast.

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
const fmtD = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The next date this EMI's due-day falls on, from today (IST). Day 1 with
 *  today = 24 Jul → 1 Aug. Clamps day 31 to the target month's length. */
function nextEmiDue(day: number | null | undefined): { y: number; m: number; d: number; iso: string } | null {
  if (!day || day < 1) return null;
  const ist = new Date(Date.now() + 5.5 * 3_600_000); // shift so getUTC* = IST wall clock
  let y = ist.getUTCFullYear();
  let m = ist.getUTCMonth();
  const today = ist.getUTCDate();
  const dim = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  let d = Math.min(day, dim(y, m));
  if (d < today) { // this month's due-day already passed → roll to next month
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    d = Math.min(day, dim(y, m));
  }
  return { y, m, d, iso: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

const RED = "#dc2626", AMBER = "#d97706", GREEN = "#16a34a", GREY = "#94a3b8", ACCENT = "#4f6d9c";

export default async function VehiclesOverviewPage() {
  await requireAuth(VEHICLES_ROLES);
  const { rows, migMissing } = await loadVehicles();

  const commercial = rows.filter((v) => v.kind === "commercial").length;
  const personal = rows.length - commercial;
  const emis = rows.filter((v) => v.emi_active && v.emi_amount != null).sort((a, b) => (a.emi_day ?? 32) - (b.emi_day ?? 32));

  // ── Expiry radar, grouped by document type ────────────────────────
  // One column per doc type. Fitness only applies to commercial vehicles, so
  // it only appears when the fleet has any. Order (left→right) per Daksh:
  // Fitness, PUC, Insurance.
  type Alert = { vehicle: string; name: string; kind: "commercial" | "personal"; date: string; days: number };
  const docDefs = [
    { key: "fitness", label: "Fitness", icon: "🛠", applies: commercial > 0, get: (v: (typeof rows)[number]) => (v.kind === "commercial" ? v.fitness_expiry : null) },
    { key: "puc", label: "PUC", icon: "🌿", applies: true, get: (v: (typeof rows)[number]) => v.puc_expiry },
    { key: "insurance", label: "Insurance", icon: "📄", applies: true, get: (v: (typeof rows)[number]) => v.insurance_expiry },
  ] as const;
  const byDoc: Record<string, Alert[]> = { fitness: [], puc: [], insurance: [] };
  for (const v of rows) {
    for (const d of docDefs) {
      const date = d.get(v);
      const dd = daysTo(date);
      if (date && dd != null && dd <= 45) byDoc[d.key].push({ vehicle: v.reg_no || v.name, name: v.name, kind: v.kind, date, days: dd });
    }
  }
  for (const k of Object.keys(byDoc)) byDoc[k].sort((a, b) => a.days - b.days);
  const allAlerts = [...byDoc.fitness, ...byDoc.puc, ...byDoc.insurance];
  const expired = allAlerts.filter((a) => a.days < 0).length;
  const soon = allAlerts.filter((a) => a.days >= 0 && a.days <= 30).length;
  const radarCols = docDefs.filter((d) => d.applies);

  // ── fleet health: worst applicable-doc status per vehicle ─────────
  const health = { ok: 0, warn: 0, crit: 0, none: 0 };
  for (const v of rows) {
    const ds = [v.insurance_expiry, v.puc_expiry, ...(v.kind === "commercial" ? [v.fitness_expiry] : [])]
      .map(daysTo).filter((d): d is number => d != null);
    if (ds.length === 0) health.none++;
    else if (ds.some((d) => d < 0)) health.crit++;
    else if (ds.some((d) => d <= 30)) health.warn++;
    else health.ok++;
  }

  // ── little presentational helpers (server) ────────────────────────
  const Tile = (icon: string, value: string | number, label: string, sub?: string, color?: string): React.ReactNode => (
    <div style={{ flex: "1 1 150px", minWidth: 140, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: "15px 16px" }}>
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
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: "16px 18px", marginTop: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 12 }}>🩺 Fleet health</div>
        <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
            <div style={{ width: 132, height: 132, borderRadius: "50%", background: `conic-gradient(${ring})` }} />
            <div style={{ position: "absolute", inset: 17, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{rows.length}</div>
              <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>vehicles</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 7, flex: "1 1 180px", minWidth: 180 }}>
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
        <p className="muted">Fleet cockpit — compliance at a glance and what expires next.</p>
      </div>

      {migMissing ? (
        <div className="banner" style={{ marginTop: 14 }}>Run migration <strong>204_vehicles_department.sql</strong> to switch this department on.</div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 18, border: "1px dashed var(--border)", borderRadius: 16, background: "var(--surface)", padding: "44px 22px", textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>🚚</div>
          <div style={{ fontSize: 16, fontWeight: 900, marginTop: 8 }}>No vehicles yet</div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Open <strong>Commercial</strong> or <strong>Personal</strong> from the menu and add your first vehicle.<br />This cockpit fills in automatically — expiries, compliance and EMI load.</p>
        </div>
      ) : (
        <>
          {/* KPI strip — fleet counts, EMI coverage, and what needs attention */}
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginTop: 16 }}>
            {Tile("🚛", commercial, "Commercial", `vehicle${commercial === 1 ? "" : "s"}`)}
            {Tile("🚗", personal, "Personal", `vehicle${personal === 1 ? "" : "s"}`)}
            {Tile("💳", `${emis.length} / ${rows.length}`, "On EMI / loan", "of all vehicles", ACCENT)}
            {Tile("⛔", expired, "Expired documents", expired ? "renew now" : "none overdue", expired ? RED : undefined)}
            {Tile("⏳", soon, "Expiring ≤ 30 days", soon ? "coming due" : "nothing soon", soon ? AMBER : undefined)}
          </div>

          {/* Fleet health donut */}
          {donut()}

          {/* Expiry radar — one column per document type */}
          <div style={{ marginTop: 22 }}>
            {sectionHd("📅 Expiry radar — next 45 days")}
            {allAlerts.length === 0 ? emptyBox("✅ Nothing expiring in the next 45 days.") : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, alignItems: "start" }}>
                {radarCols.map((col) => {
                  const items = byDoc[col.key];
                  return (
                    <div key={col.key} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
                      <div style={{ padding: "9px 12px", background: "var(--bg)", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {col.icon} {col.label}
                        <span style={{ color: "var(--muted)", fontWeight: 800 }}>{items.length ? ` · ${items.length}` : ""}</span>
                      </div>
                      {items.length === 0 ? (
                        <div style={{ padding: "16px 12px", textAlign: "center", color: GREEN, fontSize: 12, fontWeight: 700 }}>✓ all valid</div>
                      ) : (
                        <div style={{ display: "grid", gap: 6, padding: 8 }}>
                          {items.map((a, i) => {
                            const exp = a.days < 0;
                            return (
                              <Link key={i} href={`/vehicles/${a.kind}`} style={{ display: "block", textDecoration: "none", color: "var(--text)", padding: "7px 9px", borderRadius: 9, background: exp ? "rgba(220,38,38,0.05)" : "rgba(217,119,6,0.05)", border: `1px solid ${exp ? "#fecaca" : "#fde68a"}`, borderLeft: `4px solid ${exp ? RED : AMBER}` }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                  <span style={{ fontSize: 13 }}>{a.kind === "commercial" ? "🚛" : "🚗"}</span>
                                  <span style={{ fontWeight: 800, fontSize: 12.5, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.vehicle}</span>
                                </div>
                                {a.name !== a.vehicle && (
                                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                                )}
                                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6, marginTop: 3 }}>
                                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{fmtD(a.date)}</span>
                                  <span style={{ fontSize: 11, fontWeight: 900, color: exp ? "#b91c1c" : "#b45309" }}>{exp ? `expired ${Math.abs(a.days)}d` : a.days === 0 ? "TODAY" : `${a.days}d left`}</span>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
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
                  // The overview answers "when is the next payment and how much".
                  // The % paid / EMIs-left detail lives on the vehicle's own card.
                  const due = nextEmiDue(v.emi_day);
                  return (
                    <Link key={v.id} href={`/vehicles/${v.kind}`} style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", padding: "11px 14px", borderRadius: 11, textDecoration: "none", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `4px solid ${ACCENT}` }}>
                      {/* next-due calendar chip: month over day, so it reads as a date */}
                      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "stretch", width: 46, borderRadius: 9, overflow: "hidden", border: "1px solid rgba(79,109,156,0.35)", flexShrink: 0, textAlign: "center", lineHeight: 1 }}>
                        <span style={{ fontSize: 8.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", color: "#fff", background: ACCENT, padding: "2px 0" }}>{due ? MON[due.m] : "—"}</span>
                        <span style={{ fontSize: 18, fontWeight: 900, color: ACCENT, padding: "3px 0", background: "rgba(79,109,156,0.1)" }}>{due ? due.d : "—"}</span>
                      </span>
                      <span style={{ minWidth: 150, flex: "1 1 auto" }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>{v.kind === "commercial" ? "🚛" : "🚗"} {v.reg_no || v.name}</span>
                        {v.reg_no && <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{v.name}</span>}
                        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{v.emi_lender || "—"}</span>
                      </span>
                      <span style={{ marginLeft: "auto", textAlign: "right" }}>
                        <span style={{ display: "block", fontSize: 15, fontWeight: 900, fontFamily: "ui-monospace, monospace", color: ACCENT }}>{inr(v.emi_amount ?? 0)}</span>
                        <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>{due ? `next EMI · ${fmtD(due.iso)}` : "next EMI"}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
