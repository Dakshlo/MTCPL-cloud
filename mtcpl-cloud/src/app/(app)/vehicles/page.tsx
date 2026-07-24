// Vehicles → Overview (mig 204). Fleet-health donut + expiry radar (one
// column per document type, commercial/personal grouped) + EMI monitor
// (grouped the same way, coloured by how soon the next EMI hits).
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

/** Whole months of EMIs still to pay until the loan end date. */
function monthsLeft(end: string | null): number | null {
  if (!end) return null;
  const now = new Date();
  const e = new Date(`${end.slice(0, 10)}T00:00:00+05:30`);
  const m = (e.getFullYear() - now.getFullYear()) * 12 + (e.getMonth() - now.getMonth());
  return Math.max(0, m + (e.getDate() >= now.getDate() ? 1 : 0));
}

const RED = "#dc2626", AMBER = "#d97706", GREEN = "#16a34a", GREY = "#94a3b8", ACCENT = "#4f6d9c";

export default async function VehiclesOverviewPage() {
  await requireAuth(VEHICLES_ROLES);
  const { rows, migMissing } = await loadVehicles();

  const commercial = rows.filter((v) => v.kind === "commercial").length;
  const emis = rows.filter((v) => v.emi_active && v.emi_amount != null);

  // ── Expiry radar, grouped by document type ────────────────────────
  // One column per doc type (Fitness · PUC · Insurance); fitness only exists
  // for commercial vehicles. Inside a column, items are grouped commercial →
  // personal (headers only when both kinds appear).
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

  // Today (IST) at midnight UTC-encoded — for "next EMI in N days".
  const istNow = new Date(Date.now() + 5.5 * 3_600_000);
  const todayUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());

  // ── shared card chrome (matches the Fleet health card) ────────────
  const cardBox: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: "16px 18px", marginTop: 14 };
  const cardHd: React.CSSProperties = { fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 12 };
  const groupHd = (label: string): React.ReactNode => (
    <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", margin: "2px 2px 6px" }}>{label}</div>
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
      <div style={{ ...cardBox, marginTop: 16 }}>
        <div style={cardHd}>🩺 Fleet health</div>
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

  /** Split a list into commercial → personal groups; group headers only when
   *  BOTH kinds are present (Daksh). */
  function kindGroups<T extends { kind: "commercial" | "personal" }>(items: T[]) {
    const groups = [
      { key: "commercial", label: "🚛 Commercial", items: items.filter((i) => i.kind === "commercial") },
      { key: "personal", label: "🚗 Personal", items: items.filter((i) => i.kind === "personal") },
    ].filter((g) => g.items.length > 0);
    return { groups, showHeaders: groups.length > 1 };
  }

  const alertCard = (a: Alert, i: number): React.ReactNode => {
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
  };

  const emptyBox = (t: string): React.ReactNode => (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 12, background: "var(--bg)", padding: "22px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t}</div>
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
          {/* Fleet health */}
          {donut()}

          {/* Expiry radar — card chrome matches Fleet health */}
          <div style={cardBox}>
            <div style={cardHd}>📅 Expiry radar — next 45 days</div>
            {allAlerts.length === 0 ? emptyBox("✅ Nothing expiring in the next 45 days.") : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, alignItems: "start" }}>
                {radarCols.map((col) => {
                  const { groups, showHeaders } = kindGroups(byDoc[col.key]);
                  return (
                    <div key={col.key} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg)", overflow: "hidden" }}>
                      <div style={{ padding: "9px 12px", background: "var(--surface)", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {col.icon} {col.label}
                        <span style={{ color: "var(--muted)", fontWeight: 800 }}>{byDoc[col.key].length ? ` · ${byDoc[col.key].length}` : ""}</span>
                      </div>
                      {groups.length === 0 ? (
                        <div style={{ padding: "16px 12px", textAlign: "center", color: GREEN, fontSize: 12, fontWeight: 700 }}>✓ all valid</div>
                      ) : (
                        <div style={{ display: "grid", gap: 6, padding: 8 }}>
                          {groups.map((g) => (
                            <div key={g.key} style={{ display: "grid", gap: 6 }}>
                              {showHeaders && groupHd(g.label)}
                              {g.items.map((a, i) => alertCard(a, i))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* EMI monitor — grouped commercial / personal, coloured by urgency */}
          <div style={cardBox}>
            <div style={cardHd}>💳 EMI monitor — next payment</div>
            {emis.length === 0 ? emptyBox("No vehicles on EMI.") : (() => {
              const { groups, showHeaders } = kindGroups(emis);
              // The two numbers Daksh wants at a glance: this month's total
              // EMI outgo, and how much loan is still left to pay overall
              // (Σ EMI × months remaining).
              const emiTotal = emis.reduce((s, v) => s + (v.emi_amount ?? 0), 0);
              const liability = emis.reduce((s, v) => s + (v.emi_amount ?? 0) * (monthsLeft(v.emi_end) ?? 0), 0);
              // Whole-loan value (EMI × full term) so the ring can show how much
              // of ALL the loans is still left. A loan missing its start date
              // counts as fully remaining.
              const termMonths = (start: string | null, end: string | null): number | null => {
                if (!start || !end) return null;
                const s = new Date(`${start.slice(0, 10)}T00:00:00+05:30`);
                const e = new Date(`${end.slice(0, 10)}T00:00:00+05:30`);
                const m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + (e.getDate() >= s.getDate() ? 1 : 0);
                return Math.max(0, m);
              };
              const totalLoan = emis.reduce((s, v) => {
                const amt = v.emi_amount ?? 0;
                const tm = termMonths(v.emi_start, v.emi_end);
                return s + amt * (tm ?? monthsLeft(v.emi_end) ?? 0);
              }, 0);
              const paid = Math.max(0, totalLoan - liability);
              const pctLeft = totalLoan > 0 ? Math.round((liability / totalLoan) * 100) : 0;
              const stat = (label: string, value: string, sub: string): React.ReactNode => (
                <div style={{ flex: "1 1 200px", border: "1px solid rgba(79,109,156,0.3)", background: "rgba(79,109,156,0.07)", borderRadius: 11, padding: "10px 14px" }}>
                  <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "ui-monospace, monospace", color: ACCENT, marginTop: 2 }}>{value}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{sub}</div>
                </div>
              );
              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
                    {stat("Monthly EMI", inr(emiTotal), `${emis.length} active loan${emis.length === 1 ? "" : "s"} / month`)}
                    {stat("Total liability left", inr(liability), "sum of all remaining EMIs")}
                    {/* Ring: how much of ALL the loans is still left. Paid part
                        green, remaining part blue — % left in the centre. */}
                    <div style={{ flex: "1 1 230px", border: "1px solid rgba(79,109,156,0.3)", background: "rgba(79,109,156,0.07)", borderRadius: 11, padding: "10px 14px", display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ position: "relative", width: 76, height: 76, flexShrink: 0 }}>
                        <div style={{ width: 76, height: 76, borderRadius: "50%", background: `conic-gradient(${ACCENT} 0% ${pctLeft}%, ${GREEN} ${pctLeft}% 100%)` }} />
                        <div style={{ position: "absolute", inset: 9, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center" }}>
                          <div style={{ textAlign: "center", lineHeight: 1.05 }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: ACCENT }}>{pctLeft}%</div>
                            <div style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>left</div>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 3, fontSize: 11, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>Loan progress</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: GREEN, flexShrink: 0 }} /><span style={{ fontWeight: 700 }}>Paid</span><span style={{ marginLeft: "auto", fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>{inr(paid)}</span></div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: ACCENT, flexShrink: 0 }} /><span style={{ fontWeight: 700 }}>Left</span><span style={{ marginLeft: "auto", fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>{inr(liability)}</span></div>
                        <div style={{ color: "var(--muted)", fontSize: 10.5 }}>of {inr(totalLoan)} total loan</div>
                      </div>
                    </div>
                  </div>
                  {groups.map((g) => (
                    <div key={g.key} style={{ display: "grid", gap: 8 }}>
                      {showHeaders && groupHd(g.label)}
                      {[...g.items]
                        .map((v) => ({ v, due: nextEmiDue(v.emi_day) }))
                        .sort((a, b) => (a.due?.iso ?? "9999").localeCompare(b.due?.iso ?? "9999"))
                        .map(({ v, due }) => {
                          // Urgency tint: due within 3 days = red, within 7 = amber.
                          const dueIn = due ? Math.round((Date.UTC(due.y, due.m, due.d) - todayUtc) / 86_400_000) : null;
                          const tone = dueIn != null && dueIn <= 3 ? RED : dueIn != null && dueIn <= 7 ? AMBER : ACCENT;
                          return (
                            <Link key={v.id} href={`/vehicles/${v.kind}`} style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", padding: "11px 14px", borderRadius: 11, textDecoration: "none", color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderLeft: `4px solid ${tone}` }}>
                              {/* next-due calendar chip: month over day */}
                              <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "stretch", width: 46, borderRadius: 9, overflow: "hidden", border: `1px solid ${tone}55`, flexShrink: 0, textAlign: "center", lineHeight: 1 }}>
                                <span style={{ fontSize: 8.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", color: "#fff", background: tone, padding: "2px 0" }}>{due ? MON[due.m] : "—"}</span>
                                <span style={{ fontSize: 18, fontWeight: 900, color: tone, padding: "3px 0", background: `${tone}18` }}>{due ? due.d : "—"}</span>
                              </span>
                              <span style={{ minWidth: 150, flex: "1 1 auto" }}>
                                <span style={{ display: "block", fontSize: 14, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>{v.kind === "commercial" ? "🚛" : "🚗"} {v.reg_no || v.name}</span>
                                {v.reg_no && <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{v.name}</span>}
                                <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{v.emi_lender || "—"}</span>
                              </span>
                              <span style={{ marginLeft: "auto", textAlign: "right" }}>
                                <span style={{ display: "block", fontSize: 15, fontWeight: 900, fontFamily: "ui-monospace, monospace", color: tone }}>{inr(v.emi_amount ?? 0)}</span>
                                <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: dueIn != null && dueIn <= 7 ? tone : "var(--muted)" }}>
                                  {due ? `next EMI · ${fmtD(due.iso)}${dueIn != null ? ` · ${dueIn === 0 ? "TODAY" : `in ${dueIn}d`}` : ""}` : "next EMI"}
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </>
      )}
    </section>
  );
}
