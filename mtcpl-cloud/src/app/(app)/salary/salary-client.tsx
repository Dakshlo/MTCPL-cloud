"use client";

/**
 * Employees department — client views (mig 189 + 193 + 194, Daksh Jul 2026).
 *
 * Split across THREE pages, each rendering one exported view:
 *   /salary          → <EmployeesView>   (master, collapsible org→designation)
 *   /salary/pay      → <PayMonthView>    (monthly salary batches + HDFC CSV)
 *   /salary/records  → <RecordsView>     (Salary paid · PF · ESI, 3 sections)
 *
 * Forms post to the server actions (redirect + ?toast=); the MTCPL spinner
 * shows while in flight. Shared sub-components + helpers live here too.
 */

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { Combobox } from "@/app/(app)/invoicing/_ui/combobox";
import { PF_WAGE_CEILING, computePf, computeEsi, computeTds, earnedSalary, daysInSalaryMonth } from "@/lib/salary-permissions";
import { designationColor } from "@/lib/salary-designation-color";
import { SalaryImportButton } from "./salary-import";
import { KpiCard, KpiRow, DesigChip, SALARY_TABLE, segStyle, Pill, NO_DESIG, NO_ORG } from "./_ui/salary-ui";
import type { SalaryEmployee, SalaryPaymentRow, SalaryBatch, PaidRow, PendingBatch } from "./salary-types";
import {
  upsertSalaryEmployeeAction, toggleSalaryEmployeeAction, deleteSalaryEmployeeAction,
  prepareSalaryBatchAction, updateSalaryPaymentAction, removeSalaryPaymentAction,
  markSalaryBatchPaidAction, groupUnbatchedIntoBatchAction, unlockBatchHdfcAction,
  unmarkSalaryPaymentPaidAction, dropSalaryBatchAction, approveSalaryBatchAction,
} from "./actions";

export type { SalaryEmployee, SalaryPaymentRow, SalaryBatch, PaidRow };

/* ── helpers + styles ──────────────────────────────────────────────── */

const inr = (n: number) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};
const monthShort = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
};
const shiftMonth = (ym: string, delta: number): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const dayShort = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const inp: React.CSSProperties = { padding: "9px 11px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)", width: "100%" };
const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", display: "block", marginBottom: 4 };
const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "var(--gold-dark)", cursor: "pointer", whiteSpace: "nowrap" };
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" };
const searchInp: React.CSSProperties = { ...inp, flex: "1 1 240px", maxWidth: 380 };

function FormPending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label={label} />;
}

/** Hidden fields every form carries so the action redirects back to the SAME
 *  page + working month. */
function ReturnCtx({ monthYm, page }: { monthYm: string; page: "employees" | "pay" }) {
  return (
    <>
      <input type="hidden" name="return_month" value={monthYm} />
      <input type="hidden" name="return_page" value={page} />
    </>
  );
}

/** Page hero — title + optional right slot, and a green toast when present. */
function Hero({ icon, title, subtitle, right, toast }: { icon: string; title: string; subtitle: string; right?: React.ReactNode; toast?: string }) {
  const [showToast, setShowToast] = useState(true);
  // A server-action redirect keeps this component mounted — re-show for each
  // new toast so dismissing one doesn't hide all later ones.
  useEffect(() => { setShowToast(true); }, [toast]);
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>{icon} {title}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)", maxWidth: 660 }}>{subtitle}</p>
        </div>
        {right && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{right}</div>}
      </div>
      {toast && showToast && (
        <div onClick={() => setShowToast(false)} style={{ marginBottom: 14, cursor: "pointer", border: "1px solid rgba(21,128,61,0.3)", background: "rgba(22,101,52,0.08)", color: "#15803d", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, fontWeight: 700 }}>
          ✓ {toast} <span style={{ float: "right", opacity: 0.6 }}>✕</span>
        </div>
      )}
    </>
  );
}

/** Collapse state keyed by string; groups default OPEN. */
function useCollapse() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return {
    isOpen: (k: string) => !collapsed.has(k),
    toggle: (k: string) => setCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; }),
  };
}

/** Two-level Organization → Designation grouping. Blank org / designation sort
 *  last under NO_ORG / NO_DESIG. */
function groupByOrgDesig<T>(items: T[], getOrg: (t: T) => string | null, getDesig: (t: T) => string | null) {
  const byOrg = new Map<string, T[]>();
  for (const it of items) { const k = (getOrg(it) ?? "").trim() || NO_ORG; const a = byOrg.get(k) ?? []; a.push(it); byOrg.set(k, a); }
  const orgGroups = [...byOrg.entries()]
    .sort((a, b) => (a[0] === NO_ORG ? 1 : 0) - (b[0] === NO_ORG ? 1 : 0) || a[0].localeCompare(b[0]))
    .map(([org, list]) => {
      const byDesig = new Map<string, T[]>();
      for (const it of list) { const k = (getDesig(it) ?? "").trim() || NO_DESIG; const a = byDesig.get(k) ?? []; a.push(it); byDesig.set(k, a); }
      const desigGroups = [...byDesig.entries()].sort((a, b) => (a[0] === NO_DESIG ? 1 : 0) - (b[0] === NO_DESIG ? 1 : 0) || a[0].localeCompare(b[0]));
      return { org, count: list.length, desigGroups };
    });
  const showOrg = orgGroups.length > 1 || (orgGroups.length === 1 && orgGroups[0].org !== NO_ORG);
  return { orgGroups, showOrg };
}

const caret = (open: boolean, color: string): React.CSSProperties => ({ fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", color, display: "inline-block", width: 12 });

/* ═══════════════════ 👥 EMPLOYEES VIEW ═══════════════════ */

export function EmployeesView({ employees, organizations, designations, isBoss, toast }: {
  employees: SalaryEmployee[]; organizations: string[]; designations: string[]; isBoss: boolean; toast?: string;
}) {
  const [editEmp, setEditEmp] = useState<SalaryEmployee | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [timelineEmp, setTimelineEmp] = useState<SalaryEmployee | null>(null);
  const [q, setQ] = useState("");
  // Organizations default OPEN; designation subgroups default COLLAPSED. So we
  // track org COLLAPSES (default open) and designation OPENS (default closed).
  const [orgCollapsed, setOrgCollapsed] = useState<Set<string>>(new Set());
  const [desigOpened, setDesigOpened] = useState<Set<string>>(new Set());
  const toggleOrg = (k: string) => setOrgCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleDesig = (k: string) => setDesigOpened((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const active = employees.filter((e) => e.isActive);
  const monthlyCost = active.reduce((a, e) => a + (e.salaryType === "fixed" ? e.monthlySalary : 0), 0);
  const pfCount = active.filter((e) => e.pfEnabled).length;
  const esiCount = active.filter((e) => e.esiEnabled).length;
  const missingBank = active.filter((e) => !e.accountNumber).length;

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? employees.filter((e) => [e.name, e.phone, e.accountNumber, e.designation, e.organization].some((v) => (v ?? "").toLowerCase().includes(needle)))
    : employees;
  // While searching, force every group open so the matched employee shows,
  // EXPANDED out of its designation group (not just its designation surfaced).
  const searching = needle.length > 0;
  const orgOpen = (k: string) => searching || !orgCollapsed.has(k);
  const desigOpen = (k: string) => searching || desigOpened.has(k);
  const { orgGroups, showOrg } = groupByOrgDesig(filtered, (e) => e.organization, (e) => e.designation);

  return (
    <div>
      <Hero icon="👥" title="Employees" subtitle="The master list — salary, bank, PF & ESI. Add or edit here; pay them on the Pay salary page." toast={toast}
        right={<>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)", padding: "5px 12px", background: "var(--gold-subtle, rgba(201,161,74,0.14))", border: "1px solid var(--gold-border, var(--border))", borderRadius: 999 }}>👥 {active.length} active</span>
        </>}
      />
      <KpiRow>
        <KpiCard label="Active headcount" value={String(active.length)} sub={`${employees.length} total on file`} tone="gold" icon="👥" />
        <KpiCard label="Monthly (fixed) cost" value={inr(monthlyCost)} sub="fixed salaries only" tone="success" icon="💰" />
        <KpiCard label="PF / ESI" value={`${pfCount} / ${esiCount}`} sub="active employees enrolled" tone="neutral" icon="🏛" />
        <KpiCard label="Missing bank a/c" value={String(missingBank)} sub={missingBank > 0 ? "⚠ bank sheet will refuse" : "all active have a bank a/c"} tone={missingBank > 0 ? "danger" : "neutral"} icon="🏦" />
      </KpiRow>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, account, designation, site…" style={searchInp} />
        {q && <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} of {employees.length}</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
          <SalaryImportButton />
          <button type="button" onClick={() => setEditEmp("new")} style={btnPrimary}>＋ Add employee</button>
        </span>
      </div>

      {employees.length === 0 ? (
        <Empty>No employees yet — ＋ Add employee to start.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No employee matches &ldquo;{q}&rdquo;.</Empty>
      ) : (
        <div style={SALARY_TABLE.wrap}>
          <div style={SALARY_TABLE.scroll}>
            <table style={{ ...SALARY_TABLE.table, minWidth: 880 }}>
              <thead><tr>
                <th style={SALARY_TABLE.th}>Employee</th><th style={SALARY_TABLE.th}>Salary</th><th style={SALARY_TABLE.th}>Bank</th><th style={SALARY_TABLE.th}>PF / ESI</th><th style={SALARY_TABLE.th}>Status</th><th style={{ ...SALARY_TABLE.th, textAlign: "right" }}>Actions</th>
              </tr></thead>
              <tbody>
                {orgGroups.map((og) => {
                  const oc = designationColor(og.org);
                  const orgKey = `o:${og.org}`;
                  const oOpen = orgOpen(orgKey);
                  return (
                  <Fragment key={og.org}>
                    {showOrg && (
                      <tr onClick={() => toggleOrg(orgKey)} style={{ cursor: "pointer" }}>
                        <td colSpan={6} style={{ padding: "9px 12px", fontSize: 12, fontWeight: 900, letterSpacing: "0.03em", color: oc.fg, background: oc.bg, borderTop: "2px solid var(--border)", borderLeft: `4px solid ${oc.fg}`, borderBottom: "1px solid var(--border)" }}>
                          <span style={caret(oOpen, oc.fg)}>▶</span> 🏢 {og.org} <span style={{ opacity: 0.7, fontWeight: 700 }}>· {og.count} employee{og.count === 1 ? "" : "s"}</span>
                        </td>
                      </tr>
                    )}
                    {oOpen && og.desigGroups.map(([desig, emps]) => {
                      const dc = designationColor(desig);
                      const dKey = `${orgKey}|d:${desig}`;
                      const dOpen = desigOpen(dKey);
                      return (
                      <Fragment key={desig}>
                        <tr onClick={() => toggleDesig(dKey)} style={{ cursor: "pointer" }}>
                          <td colSpan={6} style={{ padding: "8px 12px", paddingLeft: showOrg ? 26 : 12, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: dc.fg, background: dc.bg, borderLeft: `3px solid ${dc.fg}`, borderBottom: "1px solid var(--border)" }}>
                            <span style={caret(dOpen, dc.fg)}>▶</span> {desig} <span style={{ opacity: 0.7, fontWeight: 700 }}>· {emps.length}</span>
                          </td>
                        </tr>
                        {dOpen && emps.map((e) => (
                          <tr key={e.id} style={{ opacity: e.isActive ? 1 : 0.55 }}>
                            <td style={SALARY_TABLE.td}>
                              <span style={{ fontWeight: 800, display: "block" }}>{e.name}</span>
                              <span style={{ fontSize: 11, color: "var(--muted)" }}>{[e.designation, e.phone].filter(Boolean).join(" · ") || "—"}</span>
                            </td>
                            <td style={{ ...SALARY_TABLE.td, fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                              {e.salaryType === "variable" ? `${inr(e.dailySalary ?? 0)}` : inr(e.monthlySalary)}
                              <span style={{ display: "block", fontFamily: "inherit", fontSize: 10, fontWeight: 800, marginTop: 2, color: e.salaryType === "variable" ? "#b45309" : "var(--muted)" }}>{e.salaryType === "variable" ? "⏱ PER DAY" : "FIXED / MONTH"}</span>
                            </td>
                            <td style={SALARY_TABLE.td}>
                              {e.accountNumber ? (
                                <>
                                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, display: "block" }}>{e.accountNumber}</span>
                                  <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{[e.bankName, e.ifsc].filter(Boolean).join(" · ")}{e.beneficiaryName ? ` · ${e.beneficiaryName}` : ""}</span>
                                </>
                              ) : <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>⚠ incomplete info — no bank a/c</span>}
                            </td>
                            <td style={SALARY_TABLE.td}>
                              <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
                                {e.pfEnabled && <Pill label={`PF ${e.pfPercent}%`} tone="success" />}
                                {e.esiEnabled && <Pill label={`ESI ${e.esiPercent}%`} tone="gold" />}
                                {!e.pfEnabled && !e.esiEnabled && <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
                              </span>
                            </td>
                            <td style={SALARY_TABLE.td}><Pill label={e.isActive ? "Active" : "Inactive"} tone={e.isActive ? "success" : "neutral"} /></td>
                            <td style={{ ...SALARY_TABLE.td, textAlign: "right", whiteSpace: "nowrap" }}>
                              <button type="button" onClick={() => setEditEmp(e)} style={{ ...btnGhost, padding: "6px 11px", marginRight: 6 }}>✎ Edit</button>
                              {isBoss && <button type="button" onClick={() => setTimelineEmp(e)} title="Full change history — added, edits, salary rises (owner / developer only)" style={{ ...btnGhost, padding: "6px 11px", marginRight: 6 }}>🕑 Timeline</button>}
                              <form action={toggleSalaryEmployeeAction} style={{ display: "inline" }}>
                                <input type="hidden" name="id" value={e.id} />
                                <input type="hidden" name="active" value={e.isActive ? "0" : "1"} />
                                <ReturnCtx monthYm="" page="employees" />
                                <FormPending label={e.isActive ? "Deactivating…" : "Activating…"} />
                                <button type="submit" style={{ ...btnGhost, padding: "6px 11px", marginRight: isBoss ? 6 : 0 }}>{e.isActive ? "⏸ Deactivate" : "▶ Activate"}</button>
                              </form>
                              {isBoss && (confirmDelete === e.id ? (
                                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>Delete + all rows?</span>
                                  <form action={deleteSalaryEmployeeAction} style={{ display: "inline" }}>
                                    <input type="hidden" name="id" value={e.id} />
                                    <ReturnCtx monthYm="" page="employees" />
                                    <FormPending label="Deleting…" />
                                    <button type="submit" style={{ ...btnGhost, padding: "6px 10px", color: "#fff", background: "#b91c1c", border: "none" }}>Yes</button>
                                  </form>
                                  <button type="button" onClick={() => setConfirmDelete(null)} style={{ ...btnGhost, padding: "6px 10px" }}>No</button>
                                </span>
                              ) : (
                                <button type="button" onClick={() => setConfirmDelete(e.id)} style={{ ...btnGhost, padding: "6px 11px", color: "#b91c1c" }}>🗑</button>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                      );
                    })}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editEmp && <EmployeeModal emp={editEmp === "new" ? null : editEmp} organizations={organizations} designations={designations} onClose={() => setEditEmp(null)} />}
      {timelineEmp && <EmployeeTimelineModal emp={timelineEmp} onClose={() => setTimelineEmp(null)} />}
    </div>
  );
}

type TimelineEvent = { id: string; action: string; createdAt: string; actor: string | null; added: boolean; changes: Array<{ field: string; from: string; to: string }> };

/** Owner/dev-only change history for one employee — fetched on open from
 *  /api/salary/employee-timeline. Shows added + each edit's field diffs so you
 *  can see salary rises and other changes over time. */
function EmployeeTimelineModal({ emp, onClose }: { emp: SalaryEmployee; onClose: () => void }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/salary/employee-timeline?id=${emp.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!alive) return; j.ok ? setEvents(j.events as TimelineEvent[]) : setErr(j.error || "Could not load the timeline."); })
      .catch(() => { if (alive) setErr("Could not load the timeline."); });
    return () => { alive = false; };
  }, [emp.id]);

  const fmt = (v: string) => { const n = Number(v.replace(/,/g, "")); return v !== "" && /^[\d.]+$/.test(v) && Number.isFinite(n) ? n.toLocaleString("en-IN") : (v || "—"); };
  const label = (ev: TimelineEvent) => ev.added ? "➕ Employee added" : ev.action === "salary_employee_activated" ? "▶ Re-activated" : ev.action === "salary_employee_deactivated" ? "⏸ Deactivated" : "✎ Edited";

  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 2 }}>🕑 {emp.name} — timeline</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 16 }}>Every change to this employee, newest first. Owner / developer only.</div>
        {err ? (
          <div style={{ fontSize: 12.5, color: "#b91c1c" }}>{err}</div>
        ) : events === null ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading…</div>
        ) : events.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No history recorded yet — changes appear here from now on.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {events.map((ev) => (
              <div key={ev.id} style={{ borderLeft: "3px solid var(--gold-dark)", paddingLeft: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{label(ev)}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{dayShort(ev.createdAt) || ""}{ev.actor ? ` · ${ev.actor}` : ""}</span>
                </div>
                {ev.added ? (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Added to the employee master.</div>
                ) : ev.changes.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Saved (no tracked field changed).</div>
                ) : (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}>
                    {ev.changes.map((c, i) => (
                      <li key={i} style={{ marginBottom: 2 }}>
                        <strong>{c.field}</strong>: <span style={{ color: "#b91c1c", textDecoration: "line-through" }}>{fmt(c.from)}</span> → <span style={{ color: "#15803d", fontWeight: 700 }}>{fmt(c.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 20px", textAlign: "center", color: "var(--muted)" }}>{children}</div>;
}

/* ═══════════════════ 💵 PAY MONTH VIEW ═══════════════════ */

export function PayMonthView({ employees, monthYm, monthRows, batches, approvalEnabled, isBoss, toast }: {
  employees: SalaryEmployee[]; monthYm: string; monthRows: SalaryPaymentRow[]; batches: SalaryBatch[]; approvalEnabled: boolean; isBoss: boolean; toast?: string;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const pickMonth = (ym: string) => startNav(() => router.push(`/salary/pay?month=${ym}`));
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [confirmPaidBatch, setConfirmPaidBatch] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<SalaryPaymentRow | null>(null);
  const [q, setQ] = useState("");

  const draft = monthRows.filter((r) => r.status === "draft");
  const paid = monthRows.filter((r) => r.status === "paid");
  const draftNet = draft.reduce((a, r) => a + r.net, 0);
  const paidNet = paid.reduce((a, r) => a + r.net, 0);

  const needle = q.trim().toLowerCase();
  const match = (r: SalaryPaymentRow) => !needle || [r.employeeName, r.designation, r.organization].some((v) => (v ?? "").toLowerCase().includes(needle));
  const rowsOfBatch = (batchId: string | null) => monthRows.filter((r) => r.batchId === batchId);
  const unbatched = rowsOfBatch(null);
  const inMonthIds = useMemo(() => new Set(monthRows.map((r) => r.employeeId)), [monthRows]);
  // Hide a batch once every employee has been removed from it, so an emptied
  // batch doesn't linger as a "0 employees" card. Uses the UNFILTERED rows, so a
  // batch whose rows merely don't match the search still shows (with its note).
  const visibleBatches = batches.filter((b) => rowsOfBatch(b.id).length > 0);

  return (
    <div>
      <Hero icon="💵" title="Pay salary" subtitle="Prepare a batch → fix each card → download the HDFC bank CSV → mark the batch paid." toast={toast}
        right={
          <div style={{ display: "inline-flex", alignItems: "stretch", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden", background: "var(--bg)", opacity: navPending ? 0.6 : 1 }}>
            <button type="button" disabled={navPending} onClick={() => pickMonth(shiftMonth(monthYm, -1))} title="Previous month" style={{ padding: "0 13px", fontSize: 18, fontWeight: 800, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: navPending ? "wait" : "pointer" }}>‹</button>
            <input type="month" value={monthYm} disabled={navPending} onChange={(e) => e.target.value && pickMonth(e.target.value)} style={{ ...inp, width: 150, fontWeight: 700, border: "none", borderRadius: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }} />
            <button type="button" disabled={navPending} onClick={() => pickMonth(shiftMonth(monthYm, 1))} title="Next month" style={{ padding: "0 13px", fontSize: 18, fontWeight: 800, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: navPending ? "wait" : "pointer" }}>›</button>
          </div>
        }
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button type="button" onClick={() => setPrepareOpen(true)} style={{ ...btnPrimary, background: "var(--gold-dark)" }}>＋ Prepare batch</button>
        <PfExportControl monthYm={monthYm} rows={monthRows} />
        <RegisterExportControl monthYm={monthYm} rows={monthRows} />
        <span style={{ marginLeft: "auto", flex: "1 1 200px", maxWidth: 340, display: monthRows.length ? "block" : "none" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, designation, site…" style={{ ...inp, width: "100%" }} />
        </span>
      </div>

      <KpiRow>
        <KpiCard label={`${monthLabel(monthYm)} · batches`} value={String(visibleBatches.length + (unbatched.length > 0 ? 1 : 0))} sub={`${monthRows.length} employee row${monthRows.length === 1 ? "" : "s"}`} tone="neutral" icon="🗂" />
        <KpiCard label="Net to pay (draft)" value={inr(draftNet)} sub={`${draft.length} draft row${draft.length === 1 ? "" : "s"}`} tone={draft.length > 0 ? "warn" : "neutral"} icon="💸" />
        <KpiCard label="Paid this month" value={inr(paidNet)} sub={`${paid.length} row${paid.length === 1 ? "" : "s"} paid`} tone="success" icon="✓" />
      </KpiRow>

      {monthRows.length === 0 ? (
        <Empty>Nothing for {monthLabel(monthYm)} yet — hit <strong>＋ Prepare batch</strong> and choose who to pay.</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {visibleBatches.map((b, i) => (
            <BatchCard key={b.id} seq={i + 1} batch={b} rows={rowsOfBatch(b.id).filter(match)} allRows={rowsOfBatch(b.id)} monthYm={monthYm} isBoss={isBoss} approvalEnabled={approvalEnabled}
              onEditRow={setEditRow} confirmPaid={confirmPaidBatch === b.id} setConfirmPaid={(on) => setConfirmPaidBatch(on ? b.id : null)} />
          ))}
          {unbatched.length > 0 && (
            <BatchCard seq={0} batch={null} rows={unbatched.filter(match)} allRows={unbatched} monthYm={monthYm} isBoss={isBoss} approvalEnabled={false}
              onEditRow={setEditRow} confirmPaid={false} setConfirmPaid={() => undefined} />
          )}
        </div>
      )}

      {prepareOpen && <PrepareBatchModal monthYm={monthYm} employees={employees.filter((e) => e.isActive)} inMonthIds={inMonthIds} onClose={() => setPrepareOpen(false)} />}
      {editRow && <RowModal row={editRow} monthYm={monthYm} onClose={() => setEditRow(null)} />}
      <FinanceLoadingOverlay show={navPending} label="Loading month…" />
    </div>
  );
}

/** One payment batch — header, employee mini-cards, HDFC CSV + mark-paid. */
function BatchCard({ seq, batch, rows, allRows, monthYm, isBoss, approvalEnabled, onEditRow, confirmPaid, setConfirmPaid }: {
  seq: number; batch: SalaryBatch | null; rows: SalaryPaymentRow[]; allRows: SalaryPaymentRow[];
  monthYm: string; isBoss: boolean; approvalEnabled: boolean; onEditRow: (r: SalaryPaymentRow) => void;
  confirmPaid: boolean; setConfirmPaid: (on: boolean) => void;
}) {
  const [confirmDrop, setConfirmDrop] = useState(false);
  const draft = allRows.filter((r) => r.status === "draft");
  const paidRows = allRows.filter((r) => r.status === "paid");
  const netTotal = allRows.reduce((a, r) => a + r.net, 0);
  const missingBank = draft.filter((r) => !r.hasBank);
  const noAttendance = draft.filter((r) => r.salaryType === "variable" && r.attendanceDays == null);
  const isPaid = batch ? batch.status === "paid" : draft.length === 0 && paidRows.length > 0;
  const locked = !!batch?.hdfcGeneratedAt;
  // Mig 198 — owner approval. When approvalEnabled is off (pre-migration) or
  // there's no batch, everything counts as approved so the CSV keeps working.
  const approved = !approvalEnabled || !batch || !!batch.approvedAt;
  const pendingApproval = !!batch && approvalEnabled && !batch.approvedAt && !isPaid;
  const hdfcReady = !!batch && !isPaid && !locked && approved && draft.length > 0 && missingBank.length === 0 && noAttendance.length === 0;
  const blockReason =
    !batch ? "Group these rows into a batch first"
    : isPaid ? "Batch is already paid"
    : pendingApproval ? "Waiting for owner approval"
    : draft.length === 0 ? "No draft rows"
    : missingBank.length > 0 ? `Incomplete info: ${missingBank.map((r) => r.employeeName).join(", ")}`
    : noAttendance.length > 0 ? `Attendance needed: ${noAttendance.map((r) => r.employeeName).join(", ")}`
    : "";

  // A locked (downloaded-into-HDFC, not-yet-paid) batch gets a big banner + a
  // diagonal watermark + greyed-out table so it's obviously in a bank file.
  const showLock = locked && !isPaid;
  // Whole-rupee cell formatters for the batch register table.
  const m0 = (n: number) => (n ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");
  const mAll = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  return (
    <div style={{ position: "relative", border: showLock ? "2px solid #1e40af" : "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden", opacity: isPaid ? 0.92 : 1 }}>
      {showLock && (
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none", display: "grid", placeItems: "center", overflow: "hidden" }}>
          <span style={{ transform: "rotate(-18deg)", fontSize: "clamp(28px, 6vw, 60px)", fontWeight: 900, letterSpacing: "0.12em", color: "rgba(30,64,175,0.13)", whiteSpace: "nowrap" }}>🔒 IN HDFC FILE</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", background: "var(--bg)", borderBottom: "1px solid var(--border)", position: "relative", zIndex: 3 }}>
        <span style={{ fontSize: 14.5, fontWeight: 900 }}>{batch ? `${seq}. 🗂 ${batch.label}` : "🗂 Earlier rows (no batch)"}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{allRows.length} employee{allRows.length === 1 ? "" : "s"}</span>
        {isPaid ? <Pill label={`✓ PAID${batch?.paidAt ? ` · ${dayShort(batch.paidAt)}` : ""}`} tone="success" />
          : locked ? <Pill label="🔒 In HDFC file" tone="gold" />
          : <Pill label="Draft" tone="warn" />}
        <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontWeight: 900, fontSize: 15, color: isPaid ? "#15803d" : "var(--text)" }}>{inr(netTotal)}</span>
      </div>

      {showLock && (
        <div style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 16px", background: "rgba(30,64,175,0.1)", borderBottom: "1px solid rgba(30,64,175,0.35)", color: "#1e40af" }}>
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.06em" }}>🔒 IN HDFC FILE</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.85 }}>downloaded {dayShort(batch!.hdfcGeneratedAt)} — re-download blocked so this batch can&apos;t be paid twice. Mark it paid, or {isBoss ? "↺ re-allow below" : "ask an owner to re-allow"}.</span>
        </div>
      )}

      {pendingApproval && (
        <div style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 16px", background: "rgba(217,119,6,0.1)", borderBottom: "1px solid rgba(217,119,6,0.35)", color: "#b45309" }}>
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.04em" }}>⏳ WAITING FOR OWNER APPROVAL</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.9 }}>The HDFC bank CSV is locked until an owner approves this batch.</span>
          {isBoss && (
            <form action={approveSalaryBatchAction} style={{ marginLeft: "auto" }}>
              <input type="hidden" name="batch_id" value={batch!.id} />
              <ReturnCtx monthYm={monthYm} page="pay" />
              <FormPending label="Approving…" />
              <button type="submit" style={{ ...btnPrimary, background: "#b45309", padding: "7px 14px" }}>✓ Approve batch</button>
            </form>
          )}
        </div>
      )}

      <div style={{ padding: 14, position: "relative", zIndex: 3 }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 2px" }}>No employee matches the search in this batch.</div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, filter: showLock ? "grayscale(1)" : undefined, opacity: showLock ? 0.6 : 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  {["#", "Employee", "Earned", "OT +", "PF −", "ESI −", "TDS −", "Adv −", "Deduct −", "Add +", "Net", ""].map((h, i) => (
                    <th key={i} style={{ padding: "7px 9px", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--muted)", textAlign: i >= 2 && i <= 10 ? "right" : "left", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", background: "var(--bg)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const isDraft = r.status === "draft";
                  const issue = isDraft && !r.hasBank ? "bank" : isDraft && r.salaryType === "variable" && r.attendanceDays == null ? "attendance" : null;
                  const rowBg = issue === "bank" ? "rgba(220,38,38,0.06)" : issue === "attendance" ? "rgba(217,119,6,0.07)" : r.status === "paid" ? "rgba(22,101,52,0.045)" : idx % 2 ? "var(--bg)" : "transparent";
                  const cell: React.CSSProperties = { padding: "8px 9px", fontSize: 12, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", color: "var(--text)" };
                  const num: React.CSSProperties = { ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace" };
                  return (
                    <tr key={r.id} onClick={() => onEditRow(r)} title={isDraft ? "Edit this row — attendance, OT, advance, deduction…" : "Paid — open to view (owner can un-mark)"} style={{ background: rowBg, cursor: "pointer" }}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{idx + 1}</td>
                      <td style={cell}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 800 }}>{r.employeeName}</span>
                          <DesigChip name={r.designation} size="sm" />
                          {r.salaryType === "variable" && <span style={{ fontSize: 9, fontWeight: 800, color: "#b45309" }}>⏱ {r.attendanceDays != null ? `${r.attendanceDays}d` : "NO ATT"}</span>}
                          {issue === "bank" && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#b91c1c" }}>⚠ no bank a/c</span>}
                          {issue === "attendance" && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#b45309" }}>⏱ needs attendance</span>}
                          {r.status === "paid" && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#15803d" }}>✓ paid{dayShort(r.paidAt) ? ` ${dayShort(r.paidAt)}` : ""}</span>}
                        </span>
                      </td>
                      <td style={{ ...num, fontWeight: 700 }}>{mAll(r.gross)}</td>
                      <td style={num}>{m0(r.otAmount)}</td>
                      <td style={num}>{m0(r.pfAmount)}</td>
                      <td style={num}>{m0(r.esiAmount)}</td>
                      <td style={num}>{m0(r.tdsAmount)}</td>
                      <td style={num}>{m0(r.advance)}</td>
                      <td style={num}>{m0(r.otherDeduction)}</td>
                      <td style={num}>{m0(r.addition)}</td>
                      <td style={{ ...num, fontWeight: 800, color: r.status === "paid" ? "#15803d" : "var(--text)" }}>{mAll(r.net)}</td>
                      <td style={{ ...cell, textAlign: "center", color: locked && isDraft ? "#1e40af" : "var(--muted)" }}>{isDraft ? (locked ? "🔒" : "✎") : "✓"}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ padding: "8px 9px", fontSize: 11, fontWeight: 900, background: "var(--bg)", borderTop: "2px solid var(--border)" }} colSpan={10}>TOTAL · {rows.length} employee{rows.length === 1 ? "" : "s"}</td>
                  <td style={{ padding: "8px 9px", fontSize: 12.5, fontWeight: 900, textAlign: "right", fontFamily: "ui-monospace, monospace", background: "var(--bg)", borderTop: "2px solid var(--border)", color: "#15803d" }}>{mAll(rows.reduce((a, r) => a + r.net, 0))}</td>
                  <td style={{ background: "var(--bg)", borderTop: "2px solid var(--border)" }} />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {(draft.length > 0 || !batch) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            {batch ? (
              <>
                <HdfcCsvButton month={monthYm} batchId={batch.id} ready={hdfcReady} locked={locked} count={draft.length} blockReason={blockReason} />
                <a href={`/api/salary/hdfc-preview-export?month=${monthYm}&batch=${batch.id}`} target="_blank" rel="noopener noreferrer"
                  title="Readable Excel of this batch — names, bank details & amounts. Download any number of times to verify what the CSV contains."
                  style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  📊 Excel view
                </a>
                {locked && isBoss && !isPaid && (
                  <form action={unlockBatchHdfcAction}>
                    <input type="hidden" name="batch_id" value={batch.id} />
                    <ReturnCtx monthYm={monthYm} page="pay" />
                    <FormPending label="Re-allowing…" />
                    <button type="submit" title="Owner only — allow generating the CSV again (file was lost)" style={{ ...btnGhost, padding: "6px 11px", fontSize: 11.5 }}>↺ Re-allow</button>
                  </form>
                )}
                {!hdfcReady && !locked && blockReason && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: missingBank.length > 0 ? "#b91c1c" : "#b45309" }}>{blockReason}</span>
                )}
                {!locked && (confirmDrop ? (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>Drop this whole batch ({draft.length})?</span>
                    <form action={dropSalaryBatchAction} style={{ display: "inline" }}>
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <ReturnCtx monthYm={monthYm} page="pay" />
                      <FormPending label="Dropping…" />
                      <button type="submit" style={{ ...btnGhost, color: "#fff", background: "#b91c1c", border: "none" }}>Yes, drop</button>
                    </form>
                    <button type="button" onClick={() => setConfirmDrop(false)} style={btnGhost}>No</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmDrop(true)} title="Delete this whole batch (all its employees) at once" style={{ ...btnGhost, color: "#b91c1c" }}>🗑 Drop batch</button>
                ))}
                {draft.length > 0 && (confirmPaid ? (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>Paid from the bank — mark {draft.length} row{draft.length === 1 ? "" : "s"} PAID?</span>
                    <form action={markSalaryBatchPaidAction} style={{ display: "inline" }}>
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <ReturnCtx monthYm={monthYm} page="pay" />
                      <FormPending label="Marking paid…" />
                      <button type="submit" style={{ ...btnPrimary, background: "#15803d" }}>Yes, mark paid</button>
                    </form>
                    <button type="button" onClick={() => setConfirmPaid(false)} style={btnGhost}>No</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmPaid(true)} style={{ ...btnGhost, marginLeft: "auto" }}>✓ Mark batch paid</button>
                ))}
              </>
            ) : (
              draft.length > 0 && (
                <form action={groupUnbatchedIntoBatchAction}>
                  <input type="hidden" name="month" value={monthYm} />
                  <ReturnCtx monthYm={monthYm} page="pay" />
                  <FormPending label="Grouping…" />
                  <button type="submit" style={btnPrimary} title="Wrap these earlier rows into a batch so they use the bank-CSV flow">⚙ Group into a batch · {draft.length}</button>
                </form>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** HDFC bulk-payment CSV download for one batch. Fetches the CSV client-side so
 *  the button blocks the INSTANT the download succeeds (the server also stamps
 *  the batch lock) — no page refresh needed, which fixes the old "nothing seems
 *  to happen until I refresh" gap. A 409 (already in a file / raced in another
 *  tab) also flips it straight to the locked state. */
function HdfcCsvButton({ month, batchId, ready, locked, count, blockReason }: {
  month: string; batchId: string; ready: boolean; locked: boolean; count: number; blockReason: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blocked = locked || done;
  const disabled = !ready || busy || blocked;

  async function download() {
    if (disabled) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/salary/hdfc-export?month=${month}&batch=${batchId}`, { cache: "no-store" });
      if (!res.ok) {
        let msg = "Download failed — try again.";
        try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* non-JSON body */ }
        setErr(msg);
        if (res.status === 409) { setDone(true); router.refresh(); } // already in a file — reflect the lock
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const fn = /filename="?([^"]+)"?/.exec(cd)?.[1] || `salary-hdfc-${month}.001`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setDone(true);    // block immediately on a successful download
      router.refresh(); // re-render with the server lock stamp → whole-batch banner + greyscale
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  const okColor = ready && !blocked;
  return (
    <>
      <button type="button" onClick={download} disabled={disabled}
        title={blocked ? "Already downloaded into an HDFC file — blocked so this batch can't be paid twice." : ready ? "HDFC bulk-payment CSV for THIS batch (Finance's format) — downloads, then locks the batch." : blockReason}
        style={{ ...btnPrimary, background: okColor ? "#15803d" : "var(--border)", color: okColor ? "#fff" : "var(--muted)", cursor: disabled ? "not-allowed" : "pointer", opacity: okColor || busy ? 1 : 0.65 }}>
        {busy ? "⏳ Downloading…" : blocked ? "🔒 HDFC CSV downloaded" : `⬇ HDFC CSV · ${count}`}
      </button>
      {err && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c", maxWidth: 340 }}>{err}</span>}
    </>
  );
}

/** Prepare-batch modal: Everyone / by Organization (each org → its own
 *  designations) / hand-picked (searchable). Employees already in a batch this
 *  month are NOT shown at all. The chosen set resolves to employee IDs. */
function PrepareBatchModal({ monthYm, employees, inMonthIds, onClose }: {
  monthYm: string; employees: SalaryEmployee[]; inMonthIds: Set<string>; onClose: () => void;
}) {
  type Mode = "everyone" | "organization" | "employees";
  const [mode, setMode] = useState<Mode>("everyone");
  const [selKeys, setSelKeys] = useState<Set<string>>(new Set()); // org|||desig
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [empQ, setEmpQ] = useState("");
  const { isOpen, toggle } = useCollapse();

  // Only employees NOT already in a batch this month are available.
  const available = employees.filter((e) => !inMonthIds.has(e.id));
  const orgKey = (e: SalaryEmployee) => ((e.organization ?? "").trim() || NO_ORG);
  const desigKey = (e: SalaryEmployee) => ((e.designation ?? "").trim() || NO_DESIG);
  const pairKey = (org: string, desig: string) => `${org}|||${desig}`;

  // org → { desig → count } over the available pool.
  const orgTree = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const e of available) {
      const o = orgKey(e), d = desigKey(e);
      const inner = m.get(o) ?? new Map<string, number>();
      inner.set(d, (inner.get(d) ?? 0) + 1);
      m.set(o, inner);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] === NO_ORG ? 1 : 0) - (b[0] === NO_ORG ? 1 : 0) || a[0].localeCompare(b[0]))
      .map(([org, inner]) => ({
        org,
        total: [...inner.values()].reduce((a, n) => a + n, 0),
        desigs: [...inner.entries()].sort((a, b) => (a[0] === NO_DESIG ? 1 : 0) - (b[0] === NO_DESIG ? 1 : 0) || a[0].localeCompare(b[0])),
      }));
  }, [available]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleKey = (k: string) => setSelKeys((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleOrgAll = (org: string, desigs: [string, number][]) => setSelKeys((p) => {
    const keys = desigs.map(([d]) => pairKey(org, d));
    const allOn = keys.every((k) => p.has(k));
    const n = new Set(p);
    keys.forEach((k) => (allOn ? n.delete(k) : n.add(k)));
    return n;
  });

  const selectedIds = useMemo(() => {
    if (mode === "everyone") return available.map((e) => e.id);
    if (mode === "employees") return [...pickedIds];
    return available.filter((e) => selKeys.has(pairKey(orgKey(e), desigKey(e)))).map((e) => e.id);
  }, [mode, available, pickedIds, selKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const empNeedle = empQ.trim().toLowerCase();
  const empList = empNeedle
    ? available.filter((e) => [e.name, e.designation, e.organization].some((v) => (v ?? "").toLowerCase().includes(empNeedle)))
    : available;

  const modeBtn = (k: Mode, label: string) => (
    <button key={k} type="button" onClick={() => setMode(k)} style={{ flex: 1, fontSize: 12.5, fontWeight: 800, padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: mode === k ? "var(--gold)" : "transparent", color: mode === k ? "#fff" : "var(--muted)", whiteSpace: "nowrap" }}>{label}</button>
  );
  const canSubmit = selectedIds.length > 0;

  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(680px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>⚙ Prepare batch — {monthLabel(monthYm)}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 14px" }}>Only employees not already in a batch this month are shown ({available.length} available).</div>

        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 12 }}>
          {modeBtn("everyone", "Everyone")}
          {modeBtn("organization", "🏢 By organization")}
          {modeBtn("employees", "Pick employees")}
        </div>

        {mode === "organization" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {orgTree.length === 0 && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Nobody left to prepare this month.</span>}
            {orgTree.map(({ org, total, desigs }) => {
              const oc = designationColor(org);
              const keys = desigs.map(([d]) => pairKey(org, d));
              const allOn = keys.every((k) => selKeys.has(k));
              const someOn = keys.some((k) => selKeys.has(k));
              const open = isOpen(`o:${org}`);
              return (
                <div key={org} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: oc.bg, color: oc.fg }}>
                    <button type="button" onClick={() => toggle(`o:${org}`)} style={{ background: "none", border: "none", cursor: "pointer", color: oc.fg }}><span style={caret(open, oc.fg)}>▶</span></button>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontWeight: 900, fontSize: 12.5 }}>
                      <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }} onChange={() => toggleOrgAll(org, desigs)} />
                      🏢 {org === NO_ORG ? "(No organization)" : org}
                    </label>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{total}</span>
                  </div>
                  {open && (
                    <div style={{ padding: "6px 12px 10px 34px", display: "flex", flexDirection: "column", gap: 3 }}>
                      {desigs.map(([d, n]) => {
                        const k = pairKey(org, d);
                        return (
                          <label key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
                            <input type="checkbox" checked={selKeys.has(k)} onChange={() => toggleKey(k)} />
                            <DesigChip name={d === NO_DESIG ? null : d} size="sm" />
                            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{n}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mode === "employees" && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
            <input value={empQ} onChange={(e) => setEmpQ(e.target.value)} placeholder="Search employees…" style={{ ...inp, border: "none", borderBottom: "1px solid var(--border)", borderRadius: 0 }} />
            <div style={{ maxHeight: 260, overflowY: "auto", padding: "6px 10px" }}>
              {empList.map((e) => (
                <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={pickedIds.has(e.id)} onChange={() => setPickedIds((p) => { const n = new Set(p); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })} />
                  <span style={{ fontWeight: 700 }}>{e.name}</span>
                  <DesigChip name={e.designation} size="sm" />
                  {e.organization && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>· {e.organization}</span>}
                </label>
              ))}
              {empList.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 0" }}>{available.length === 0 ? "Nobody left to prepare this month." : "No employee matches."}</div>}
            </div>
          </div>
        )}

        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: "10px 13px", marginBottom: 14, fontSize: 12.5 }}>
          <span style={{ fontWeight: 900, color: selectedIds.length > 0 ? "#15803d" : "var(--muted)" }}>{selectedIds.length}</span> employee{selectedIds.length === 1 ? "" : "s"} will be in this batch.
        </div>

        <form action={prepareSalaryBatchAction} style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <input type="hidden" name="month" value={monthYm} />
          <input type="hidden" name="scope_kind" value="employees" />
          <input type="hidden" name="scope_values" value={JSON.stringify(selectedIds)} />
          <ReturnCtx monthYm={monthYm} page="pay" />
          <FormPending label="Preparing batch…" />
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={!canSubmit} style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}>⚙ Prepare {selectedIds.length} employee{selectedIds.length === 1 ? "" : "s"}</button>
        </form>
      </div>
    </div>
  );
}

/** PF-register download (xlsx) with a designation picker. */
function PfExportControl({ monthYm, rows }: { monthYm: string; rows: SalaryPaymentRow[] }) {
  const desigs = useMemo(() => [...new Set(rows.map((r) => (r.designation ?? "").trim() || NO_DESIG))].sort((a, b) => a.localeCompare(b)), [rows]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string> | null>(null);
  const effective = sel === null ? desigs : desigs.filter((d) => sel.has(d));
  const allOn = effective.length === desigs.length;
  const noneOn = effective.length === 0;
  const disabled = rows.length === 0;
  const href = allOn ? `/api/salary/pf-export?month=${monthYm}` : `/api/salary/pf-export?month=${monthYm}&designations=${encodeURIComponent(effective.join(","))}`;
  const toggle = (d: string) => setSel((prev) => { const n = new Set(prev ?? desigs); n.has(d) ? n.delete(d) : n.add(d); return n; });
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} title="Monthly Salary & PF register (Excel)." style={{ ...btnGhost, fontWeight: 800, color: disabled ? "var(--muted)" : "#6b4652", opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>⬇ PF register ▾</button>
      {open && !disabled && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 51, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.2)", padding: 12, width: 260, maxHeight: 360, overflowY: "auto" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 8 }}>Designations to export</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", fontWeight: 800, fontSize: 12.5, borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
              <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = !allOn && !noneOn; }} onChange={() => setSel(allOn ? new Set() : null)} /> All ({desigs.length})
            </label>
            {desigs.map((d) => {
              const dc = designationColor(d);
              return (
                <label key={d} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12.5 }}>
                  <input type="checkbox" checked={effective.includes(d)} onChange={() => toggle(d)} />
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: dc.bg, border: `1.5px solid ${dc.fg}`, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d}</span>
                </label>
              );
            })}
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => { if (!noneOn) setOpen(false); }} style={{ ...btnPrimary, background: noneOn ? "var(--border)" : "#15803d", display: "block", textAlign: "center", marginTop: 10, textDecoration: "none", pointerEvents: noneOn ? "none" : "auto", opacity: noneOn ? 0.6 : 1 }}>⬇ Download {allOn ? "all" : effective.length}</a>
          </div>
        </>
      )}
    </span>
  );
}

/** Register of Wages (Form 11) download — of the month's PAID employees, for
 *  Everyone / chosen organizations / chosen designations. */
function RegisterExportControl({ monthYm, rows }: { monthYm: string; rows: SalaryPaymentRow[] }) {
  const paid = useMemo(() => rows.filter((r) => r.status === "paid"), [rows]);
  const orgs = useMemo(() => [...new Set(paid.map((r) => (r.organization ?? "").trim() || NO_ORG))].sort((a, b) => a.localeCompare(b)), [paid]);
  const desigs = useMemo(() => [...new Set(paid.map((r) => (r.designation ?? "").trim() || NO_DESIG))].sort((a, b) => a.localeCompare(b)), [paid]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "organization" | "designation">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const disabled = paid.length === 0;
  const options = mode === "organization" ? orgs : mode === "designation" ? desigs : [];
  const chosen = [...sel];
  const canDownload = mode === "all" || chosen.length > 0;
  const href = mode === "all"
    ? `/salary/register?month=${monthYm}`
    : `/salary/register?month=${monthYm}&${mode === "organization" ? "organizations" : "designations"}=${encodeURIComponent(chosen.join(","))}`;
  const toggle = (v: string) => setSel((p) => { const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n; });
  const setModeReset = (k: "all" | "organization" | "designation") => { setMode(k); setSel(new Set()); };

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} title={disabled ? "Mark a batch paid first — the register is of paid wages." : "Register of Wages (Form 11) — Excel template of paid employees."} style={{ ...btnGhost, fontWeight: 800, color: disabled ? "var(--muted)" : "var(--gold-dark)", opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>📋 Register (Form 11) ▾</button>
      {open && !disabled && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 51, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.2)", padding: 12, width: 280, maxHeight: 380, overflowY: "auto" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 8 }}>Register of paid wages — who?</div>
            <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 10 }}>
              {(["all", "organization", "designation"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setModeReset(k)} style={{ flex: 1, fontSize: 11.5, fontWeight: 800, padding: "6px 6px", borderRadius: 7, border: "none", cursor: "pointer", background: mode === k ? "var(--gold)" : "transparent", color: mode === k ? "#fff" : "var(--muted)", whiteSpace: "nowrap" }}>{k === "all" ? "All" : k === "organization" ? "Org" : "Desig"}</button>
              ))}
            </div>
            {mode !== "all" && (
              <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 8 }}>
                {options.map((o) => {
                  const dc = designationColor(o);
                  return (
                    <label key={o} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12.5 }}>
                      <input type="checkbox" checked={sel.has(o)} onChange={() => toggle(o)} />
                      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: dc.bg, border: `1.5px solid ${dc.fg}`, flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!canDownload) { e.preventDefault(); return; } setOpen(false); }} aria-disabled={!canDownload}
              style={{ ...btnPrimary, background: canDownload ? "#15803d" : "var(--border)", display: "block", textAlign: "center", textDecoration: "none", pointerEvents: canDownload ? "auto" : "none", opacity: canDownload ? 1 : 0.6 }}>
              📋 Open register{mode === "all" ? " (all paid)" : chosen.length ? ` (${chosen.length})` : ""}
            </a>
            <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", marginTop: 6 }}>Opens the register — download the Excel from there.</div>
          </div>
        </>
      )}
    </span>
  );
}

/* ═══════════════════ ✅ BATCH APPROVAL VIEW (owner) ═══════════════════ */

export function SalaryApprovalsView({ batches, toast }: { batches: PendingBatch[]; toast?: string }) {
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  return (
    <div>
      <Hero icon="✅" title="Batch approval" subtitle="Salary batches waiting for your sign-off. Approve to unlock the HDFC bank CSV, or reject to drop the whole batch." toast={toast} />
      {batches.length === 0 ? (
        <Empty>No batches waiting for approval — all clear. 🎉</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {batches.map((b) => (
            <div key={b.id} style={{ border: "1px solid var(--border)", borderLeft: "4px solid #b45309", borderRadius: 12, background: "var(--surface)", boxShadow: "var(--shadow)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 900 }}>🗂 {b.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>{monthLabel(b.month)} · {b.employees} employee{b.employees === 1 ? "" : "s"} · created {dayShort(b.createdAt)}</div>
              </div>
              <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontWeight: 900, fontSize: 15 }}>{inr(b.net)}</span>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {confirmReject === b.id ? (
                  <>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>Drop this whole batch?</span>
                    <form action={dropSalaryBatchAction} style={{ display: "inline" }}>
                      <input type="hidden" name="batch_id" value={b.id} />
                      <input type="hidden" name="return_page" value="approvals" />
                      <FormPending label="Dropping…" />
                      <button type="submit" style={{ ...btnGhost, color: "#fff", background: "#b91c1c", border: "none" }}>Yes, drop</button>
                    </form>
                    <button type="button" onClick={() => setConfirmReject(null)} style={btnGhost}>No</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmReject(b.id)} style={{ ...btnGhost, color: "#b91c1c" }}>🗑 Reject</button>
                )}
                <form action={approveSalaryBatchAction} style={{ display: "inline" }}>
                  <input type="hidden" name="batch_id" value={b.id} />
                  <input type="hidden" name="return_page" value="approvals" />
                  <FormPending label="Approving…" />
                  <button type="submit" style={{ ...btnPrimary, background: "#15803d" }}>✓ Approve</button>
                </form>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ 📊 RECORDS VIEW ═══════════════════ */

export function RecordsView({ employees, paidRows, toast }: { employees: SalaryEmployee[]; paidRows: PaidRow[]; toast?: string }) {
  const [section, setSection] = useState<"paid" | "pf" | "esi">("paid");
  return (
    <div>
      <Hero icon="📊" title="Records" subtitle="Everything from paid months — salary paid, PF deducted and ESI deducted." toast={toast} />
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setSection("paid")} style={segStyle(section === "paid")}>📊 Salary paid</button>
        <button type="button" onClick={() => setSection("pf")} style={segStyle(section === "pf")}>🏛 PF record</button>
        <button type="button" onClick={() => setSection("esi")} style={segStyle(section === "esi")}>🏥 ESI record</button>
      </div>
      <RecordSection kind={section} employees={employees} paidRows={paidRows} />
    </div>
  );
}

/** Grouped (org → designation), collapsible, searchable per-employee record —
 *  one component for Salary-paid / PF / ESI. */
function RecordSection({ kind, employees, paidRows }: { kind: "paid" | "pf" | "esi"; employees: SalaryEmployee[]; paidRows: PaidRow[] }) {
  const [openEmp, setOpenEmp] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Organizations default OPEN; designation subgroups default COLLAPSED (search
  // force-opens both so the matched employee shows).
  const [orgCollapsed, setOrgCollapsed] = useState<Set<string>>(new Set());
  const [desigOpened, setDesigOpened] = useState<Set<string>>(new Set());
  const toggleOrg = (k: string) => setOrgCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleDesig = (k: string) => setDesigOpened((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const amountOf = (r: PaidRow) => (kind === "paid" ? r.net : kind === "pf" ? r.pfAmount : r.esiAmount);
  const enabledOf = (e: SalaryEmployee) => (kind === "paid" ? true : kind === "pf" ? e.pfEnabled : e.esiEnabled);
  const NAME = kind === "paid" ? "Salary" : kind === "pf" ? "PF" : "ESI";
  const numOf = (e: SalaryEmployee) => (kind === "pf" ? e.uan : kind === "esi" ? e.esiNumber : null);
  const numLabel = kind === "pf" ? "UAN" : "ESI no.";

  const rows = useMemo(() => paidRows.filter((r) => (kind === "paid" ? r.net !== 0 : amountOf(r) > 0)), [paidRows, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const byEmp = useMemo(() => {
    const m = new Map<string, PaidRow[]>();
    for (const r of rows) { const a = m.get(r.employeeId) ?? []; a.push(r); m.set(r.employeeId, a); }
    return m;
  }, [rows]);
  const withIt = employees.filter((e) => (kind === "paid" ? byEmp.has(e.id) : enabledOf(e) || byEmp.has(e.id)));
  const grand = rows.reduce((a, r) => a + amountOf(r), 0);

  // Month-wise summary (Salary paid) — quick totals across the top.
  const monthTotals = useMemo(() => {
    if (kind !== "paid") return [];
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.month, (m.get(r.month) ?? 0) + r.net);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows, kind]);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? withIt.filter((e) => [e.name, e.designation, e.organization, numOf(e), e.accountNumber].some((v) => (v ?? "").toLowerCase().includes(needle))) : withIt;
  const { orgGroups, showOrg } = groupByOrgDesig(filtered, (e) => e.organization, (e) => e.designation);
  const searching = needle.length > 0;
  const orgOpen = (k: string) => searching || !orgCollapsed.has(k);
  const desigOpen = (k: string) => searching || desigOpened.has(k);

  const groupTotal = (emps: SalaryEmployee[]) => emps.reduce((a, e) => a + (byEmp.get(e.id) ?? []).reduce((s, r) => s + amountOf(r), 0), 0);

  const card = (e: SalaryEmployee) => {
    const empRows = (byEmp.get(e.id) ?? []).slice().sort((a, b) => b.month.localeCompare(a.month));
    const total = empRows.reduce((a, r) => a + amountOf(r), 0);
    const isCardOpen = openEmp === e.id;
    const dc = designationColor(e.designation);
    return (
      <div key={e.id} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${dc.fg}`, borderRadius: 12, overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow)" }}>
        <button type="button" onClick={() => setOpenEmp(isCardOpen ? null : e.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
          <span style={caret(isCardOpen, dc.fg)}>▶</span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{e.name}</span>
          <DesigChip name={e.designation} size="sm" />
          {numOf(e) && <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>{numLabel} {numOf(e)}</span>}
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{empRows.length} month{empRows.length !== 1 ? "s" : ""}</span>
          <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: "#15803d" }}>{inr(total)}</span>
        </button>
        {isCardOpen && (
          <div style={{ padding: "8px 14px 14px", overflowX: "auto" }}>
            {empRows.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing yet — appears once a month with {NAME} is marked paid.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 340 }}>
                <thead><tr>
                  {["Month", "Paid on", NAME].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 2 ? "right" : "left", padding: "6px 9px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {empRows.map((r) => (
                    <tr key={r.month}>
                      <td style={{ padding: "7px 9px", fontSize: 12.5, fontWeight: 700, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{monthLabel(r.month)}</td>
                      <td style={{ padding: "7px 9px", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{dayShort(r.paidAt) || "—"}</td>
                      <td style={{ padding: "7px 9px", fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, monospace", textAlign: "right", borderBottom: "1px solid var(--border)" }}>{inr(amountOf(r))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ padding: "7px 9px", fontSize: 11.5, fontWeight: 900, borderTop: "2px solid var(--border)" }}>Total · {empRows.length} month{empRows.length === 1 ? "" : "s"}</td>
                    <td style={{ padding: "7px 9px", fontSize: 13.5, fontWeight: 900, fontFamily: "ui-monospace, monospace", textAlign: "right", borderTop: "2px solid var(--border)", color: "#15803d" }}>{inr(total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <KpiRow>
        <KpiCard label={`${NAME} till date`} value={inr(grand)} sub={`${withIt.length} employee${withIt.length === 1 ? "" : "s"}`} tone="success" icon={kind === "paid" ? "💸" : kind === "pf" ? "🏛" : "🏥"} />
        <KpiCard label="Months on record" value={String(new Set(rows.map((r) => r.month)).size)} tone="neutral" icon="📅" />
      </KpiRow>

      {kind === "paid" && monthTotals.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {monthTotals.map(([m, t]) => (
            <span key={m} style={{ fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg)" }}>
              <span style={{ color: "var(--muted)" }}>{monthShort(m)}</span> · <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{inr(t)}</span>
            </span>
          ))}
        </div>
      )}

      {withIt.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search name, designation, site${kind !== "paid" ? `, ${numLabel}` : ""}…`} style={searchInp} />
          {q && <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} of {withIt.length}</span>}
        </div>
      )}

      {withIt.length === 0 ? (
        <Empty>No {NAME} on record yet — it builds itself once a batch is marked paid.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No employee matches &ldquo;{q}&rdquo;.</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {orgGroups.map((og) => {
            const oc = designationColor(og.org);
            const oKey = `o:${og.org}`;
            const oOpen = orgOpen(oKey);
            return (
              <div key={og.org} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {showOrg && (
                  <button type="button" onClick={() => toggleOrg(oKey)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: oc.bg, color: oc.fg, borderLeft: `4px solid ${oc.fg}`, fontSize: 12, fontWeight: 900, letterSpacing: "0.03em", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <span style={caret(oOpen, oc.fg)}>▶</span> 🏢 {og.org} <span style={{ opacity: 0.7, fontWeight: 700 }}>· {og.count}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace" }}>{inr(groupTotal(og.desigGroups.flatMap(([, e]) => e)))}</span>
                  </button>
                )}
                {oOpen && og.desigGroups.map(([desig, emps]) => {
                  const dc = designationColor(desig);
                  const dKey = `${oKey}|d:${desig}`;
                  const dOpen = desigOpen(dKey);
                  return (
                    <div key={desig} style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: showOrg ? 12 : 0 }}>
                      <button type="button" onClick={() => toggleDesig(dKey)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: dc.fg, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                        <span style={caret(dOpen, dc.fg)}>▶</span> {desig} <span style={{ opacity: 0.7 }}>· {emps.length}</span>
                        <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>{inr(groupTotal(emps))}</span>
                      </button>
                      {dOpen && emps.map(card)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ MODALS ═══════════════════ */

function FormSection({ title, tone, children }: { title: string; tone?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${tone ?? "var(--border)"}`, borderRadius: 12, padding: "14px 16px", background: "var(--surface)" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold-dark)", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

/** Big, prominent on/off switch — for the three toggles (fixed, PF, ESI). */
function BigToggle({ on, onChange, onLabel, offLabel, accent }: { on: boolean; onChange: (v: boolean) => void; onLabel: string; offLabel: string; accent: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 14px", borderRadius: 10, cursor: "pointer", border: `2px solid ${on ? accent : "var(--border)"}`, background: on ? `${accent}14` : "var(--bg)", color: "var(--text)", textAlign: "left" }}>
      <span aria-hidden style={{ position: "relative", width: 40, height: 22, borderRadius: 999, background: on ? accent : "var(--border)", flexShrink: 0, transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? accent : "var(--muted)" }}>{on ? onLabel : offLabel}</span>
    </button>
  );
}

function EmployeeModal({ emp, organizations, designations, onClose }: { emp: SalaryEmployee | null; organizations: string[]; designations: string[]; onClose: () => void }) {
  const [pfOn, setPfOn] = useState(emp ? emp.pfEnabled : true);
  const [esiOn, setEsiOn] = useState(emp ? emp.esiEnabled : false);
  const [tdsOn, setTdsOn] = useState(emp ? emp.tdsEnabled : false);
  const [organization, setOrganization] = useState(emp?.organization ?? "");
  const [designation, setDesignation] = useState(emp?.designation ?? "");
  // Salary type is NOT pre-selected for a new employee — the salary field stays
  // disabled until Fixed or By-attendance is chosen (Daksh).
  const [salaryType, setSalaryType] = useState<"fixed" | "variable" | null>(emp?.salaryType ?? null);
  const initialAmount = emp ? String((emp.salaryType === "variable" ? emp.dailySalary : emp.monthlySalary) ?? "") : "";
  const [salaryAmount, setSalaryAmount] = useState(initialAmount);
  const chooseType = (t: "fixed" | "variable") => {
    setSalaryType(t);
    // Restore the stored figure if switching back to the employee's own type,
    // else clear (a monthly figure isn't a daily rate and vice-versa).
    setSalaryAmount(emp && emp.salaryType === t ? String((t === "variable" ? emp.dailySalary : emp.monthlySalary) ?? "") : "");
  };
  const canSave = !!salaryType && salaryAmount.trim() !== "";
  const green = "#15803d", gold = "var(--gold-dark)";

  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(940px, 100%)", background: "var(--bg, #fff)", borderRadius: 16, padding: "22px 26px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto" }}>
        <div style={{ fontSize: 19, fontWeight: 900, marginBottom: 4 }}>{emp ? `✎ ${emp.name}` : "＋ Add employee"}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Fill what you have — a bank account + IFSC is needed before the HDFC sheet can include them.</div>
        <form action={upsertSalaryEmployeeAction} autoComplete="off" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {emp && <input type="hidden" name="id" value={emp.id} />}
          <ReturnCtx monthYm="" page="employees" />
          <FormPending label={emp ? "Saving employee…" : "Adding employee…"} />
          {/* The PF/ESI/TDS switches are buttons — carry their state to the server. */}
          <input type="hidden" name="pf_enabled" value={pfOn ? "1" : "0"} />
          <input type="hidden" name="esi_enabled" value={esiOn ? "1" : "0"} />
          <input type="hidden" name="tds_enabled" value={tdsOn ? "1" : "0"} />

          <FormSection title="🪪 Basic details">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              <label><span style={lbl}>Name *</span><input name="name" required defaultValue={emp?.name ?? ""} style={inp} /></label>
              <label><span style={lbl}>Father / husband name</span><input name="father_name" defaultValue={emp?.fatherName ?? ""} style={inp} /></label>
              <label><span style={lbl}>Phone</span><input name="phone" defaultValue={emp?.phone ?? ""} style={inp} /></label>
              <label><span style={lbl}>Organization / site</span><Combobox value={organization} onChange={setOrganization} options={organizations} name="organization" placeholder="e.g. Main Office…" inputStyle={inp} /></label>
              <label><span style={lbl}>Designation</span><Combobox value={designation} onChange={setDesignation} options={designations} name="designation" placeholder="Pick or type…" inputStyle={inp} /></label>
              <label><span style={lbl}>Aadhaar no.</span><input name="aadhaar" inputMode="numeric" maxLength={12} defaultValue={emp?.aadhaar ?? ""} placeholder="12 digits" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
              <label><span style={lbl}>Joined on</span><input type="date" name="joined_on" defaultValue={emp?.joinedOn ?? ""} style={inp} /></label>
            </div>
          </FormSection>

          <FormSection title="💰 Salary" tone={salaryType ? undefined : "rgba(180,83,9,0.5)"}>
            <input type="hidden" name="salary_type" value={salaryType ?? "fixed"} />
            <div style={{ marginBottom: 10 }}>
              <span style={lbl}>How is this employee paid? *</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button type="button" onClick={() => chooseType("fixed")} style={{ padding: "12px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: `2px solid ${salaryType === "fixed" ? gold : "var(--border)"}`, background: salaryType === "fixed" ? "rgba(201,161,74,0.12)" : "var(--bg)", color: "var(--text)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: salaryType === "fixed" ? gold : "var(--text)" }}>{salaryType === "fixed" ? "● " : "○ "}Fixed salary</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Full monthly amount, whatever the attendance</div>
                </button>
                <button type="button" onClick={() => chooseType("variable")} style={{ padding: "12px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: `2px solid ${salaryType === "variable" ? "#b45309" : "var(--border)"}`, background: salaryType === "variable" ? "rgba(217,119,6,0.1)" : "var(--bg)", color: "var(--text)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: salaryType === "variable" ? "#b45309" : "var(--text)" }}>{salaryType === "variable" ? "● " : "○ "}⏱ By attendance</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Daily rate × days present</div>
                </button>
              </div>
            </div>
            <label>
              <span style={lbl}>{salaryType === "variable" ? "Daily salary (₹) *" : salaryType === "fixed" ? "Monthly salary (₹) *" : "Salary — choose a type above first"}</span>
              <input
                name={salaryType === "variable" ? "daily_salary" : "monthly_salary"}
                inputMode="decimal"
                value={salaryAmount}
                onChange={(e) => setSalaryAmount(e.target.value)}
                disabled={!salaryType}
                placeholder={salaryType ? (salaryType === "variable" ? "e.g. 600 per day" : "e.g. 20000 per month") : "Pick Fixed or By attendance ↑"}
                style={{ ...inp, background: salaryType ? "var(--bg)" : "var(--surface)", opacity: salaryType ? 1 : 0.6, cursor: salaryType ? "text" : "not-allowed" }}
              />
            </label>
            <label style={{ display: "block", marginTop: 12 }}>
              <span style={lbl}>Min. rate of wages (₹ / month)</span>
              <input name="min_wage_rate" inputMode="decimal" defaultValue={emp?.minWageRate != null ? String(emp.minWageRate) : ""} placeholder="statutory minimum — for the register" style={inp} />
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Reference only — prints in the register&apos;s &ldquo;Min. Rate of Wages (A)&rdquo; column. Does not change pay.</span>
            </label>
          </FormSection>

          <FormSection title="🏦 Bank — for the HDFC sheet">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              <label><span style={lbl}>Bank name</span><input name="bank_name" defaultValue={emp?.bankName ?? ""} style={inp} /></label>
              <label><span style={lbl}>Account number</span><input name="account_number" defaultValue={emp?.accountNumber ?? ""} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
              <label><span style={lbl}>IFSC</span><input name="ifsc" defaultValue={emp?.ifsc ?? ""} style={{ ...inp, textTransform: "uppercase", fontFamily: "ui-monospace, monospace" }} /></label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span style={lbl}>Beneficiary name (bank sheet)</span>
                <input name="beneficiary_name" defaultValue={emp?.beneficiaryName ?? ""} placeholder="Auto from name if left blank" style={{ ...inp, textTransform: "uppercase" }} />
                <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Max 20 chars, A–Z 0–9 space period — must match the bank&apos;s beneficiary registration.</span>
              </label>
            </div>
          </FormSection>

          <FormSection title="🏛 PF · 🏥 ESI · 🧾 TDS">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
              <div>
                <BigToggle on={pfOn} onChange={setPfOn} onLabel="PF applicable ✓" offLabel="PF not applicable" accent={green} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10, opacity: pfOn ? 1 : 0.5 }}>
                  <label><span style={lbl}>UAN / PF number</span><input name="uan" defaultValue={emp?.uan ?? ""} disabled={!pfOn} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
                  <label><span style={lbl}>PF %</span><input name="pf_percent" inputMode="decimal" defaultValue={String(emp?.pfPercent ?? 12)} disabled={!pfOn} style={inp} /></label>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 5 }}>PF = pf% of min(earned, {inr(PF_WAGE_CEILING)}).</div>
              </div>
              <div>
                <BigToggle on={esiOn} onChange={setEsiOn} onLabel="ESI applicable ✓" offLabel="ESI not applicable" accent="#7c3aed" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10, opacity: esiOn ? 1 : 0.5 }}>
                  <label><span style={lbl}>ESI number</span><input name="esi_number" defaultValue={emp?.esiNumber ?? ""} disabled={!esiOn} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
                  <label><span style={lbl}>ESI %</span><input name="esi_percent" inputMode="decimal" defaultValue={String(emp?.esiPercent ?? 0.75)} disabled={!esiOn} style={inp} /></label>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 5 }}>ESI = esi% of earned salary (default 0.75%).</div>
              </div>
              <div>
                <BigToggle on={tdsOn} onChange={setTdsOn} onLabel="TDS applicable ✓" offLabel="TDS not applicable" accent="#0891b2" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 10, opacity: tdsOn ? 1 : 0.5 }}>
                  <label><span style={lbl}>TDS %</span><input name="tds_percent" inputMode="decimal" defaultValue={String(emp?.tdsPercent ?? 10)} disabled={!tdsOn} style={inp} /></label>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 5 }}>TDS = tds% of earned salary (default OFF).</div>
              </div>
            </div>
          </FormSection>

          <label style={{ display: "block" }}><span style={lbl}>Notes</span><input name="notes" defaultValue={emp?.notes ?? ""} style={inp} /></label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
            {!canSave && <span style={{ fontSize: 11.5, color: "#b45309", fontWeight: 700, marginRight: "auto" }}>Choose Fixed / By-attendance and enter the salary to save.</span>}
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" disabled={!canSave} style={{ ...btnPrimary, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}>{emp ? "✓ Save employee" : "＋ Add employee"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RowModal({ row, monthYm, onClose }: { row: SalaryPaymentRow; monthYm: string; onClose: () => void }) {
  const byAttendance = row.salaryType === "variable";
  const days = daysInSalaryMonth(monthYm);
  const [attendance, setAttendance] = useState(row.attendanceDays != null ? String(row.attendanceDays) : "");
  const [otHours, setOtHours] = useState(row.otHours != null ? String(row.otHours) : "");
  const [otRate, setOtRate] = useState(row.otHours && row.otAmount && Number(row.otHours) > 0 ? String(Math.round((row.otAmount / row.otHours) * 100) / 100) : "");
  const [advance, setAdvance] = useState(String(row.advance || ""));
  const [ded, setDed] = useState(String(row.otherDeduction || ""));
  const [add, setAdd] = useState(String(row.addition || ""));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const n = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const attendanceNum = attendance.trim() === "" ? null : n(attendance);
  const gross = earnedSalary({ monthlySalary: row.monthlySalary, dailySalary: row.dailySalary, salaryType: row.salaryType, attendanceDays: attendanceNum, monthKey: monthYm });
  const pf = computePf(gross, row.pfPercent, row.pfEnabled);
  const esi = computeEsi(gross, row.esiPercent, row.esiEnabled);
  const tds = computeTds(gross, row.tdsPercent, row.tdsEnabled);
  const otAmount = Math.round(n(otHours) * n(otRate) * 100) / 100;
  const net = Math.round((gross - pf - esi - tds + otAmount - n(advance) - n(ded) + n(add)) * 100) / 100;
  const readBox: React.CSSProperties = { ...inp, background: "var(--surface)", fontFamily: "ui-monospace, monospace", fontWeight: 800, display: "flex", alignItems: "center", minHeight: 38 };
  const dailyRate = byAttendance && row.dailySalary ? row.dailySalary : null;
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(600px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 2 }}>✎ {row.employeeName}
          {byAttendance ? <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", marginLeft: 8 }}>⏱ BY ATTENDANCE</span> : <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", marginLeft: 8 }}>FIXED</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14 }}>
          {byAttendance ? (dailyRate ? `${inr(dailyRate)}/day × days present. Enter attendance; net recalculates live.` : `${inr(row.monthlySalary)}/month prorated by days present (no daily rate set yet).`) : "Fixed salary — full amount whatever the attendance. Adjust with OT / advance / deduction / addition."}
        </div>
        <form action={updateSalaryPaymentAction}>
          <input type="hidden" name="id" value={row.id} />
          <ReturnCtx monthYm={monthYm} page="pay" />
          <FormPending label="Saving row…" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={lbl}>Earned salary (₹)</span>
              <div style={readBox}>{inr(gross)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>{byAttendance ? (attendanceNum == null ? "enter attendance →" : dailyRate ? `${inr(dailyRate)} × ${attendanceNum} days` : `${inr(row.monthlySalary)} × ${attendanceNum}⁄${days}`) : "full fixed salary"}</span>
            </div>
            <label><span style={lbl}>Attendance days{byAttendance ? " *" : ""}</span><input name="attendance_days" inputMode="decimal" value={attendance} onChange={(e) => setAttendance(e.target.value)} placeholder={byAttendance ? "days present" : "info only"} style={inp} /></label>
            <div>
              <span style={lbl}>PF − (₹)</span>
              <div style={readBox}>{inr(pf)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>{row.pfEnabled ? `${row.pfPercent}% of min(earned, ${inr(PF_WAGE_CEILING)})` : "PF not applicable"}</span>
            </div>
            <div>
              <span style={lbl}>ESI − (₹)</span>
              <div style={readBox}>{inr(esi)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>{row.esiEnabled ? `${row.esiPercent}% of earned` : "ESI not applicable"}</span>
            </div>
            <div>
              <span style={lbl}>TDS − (₹)</span>
              <div style={readBox}>{inr(tds)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>{row.tdsEnabled ? `${row.tdsPercent}% of earned` : "TDS not applicable"}</span>
            </div>
            <label><span style={lbl}>OT hours</span><input name="ot_hours" inputMode="decimal" value={otHours} onChange={(e) => setOtHours(e.target.value)} placeholder="total OT hours" style={inp} /></label>
            <label><span style={lbl}>OT rate / hour (₹)</span><input name="ot_rate" inputMode="decimal" value={otRate} onChange={(e) => setOtRate(e.target.value)} placeholder="₹ per OT hour" style={inp} /></label>
            <div>
              <span style={lbl}>OT amount + (₹)</span>
              <div style={readBox}>{inr(otAmount)}</div>
              <input type="hidden" name="ot_amount" value={otAmount} />
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>{n(otHours) > 0 && n(otRate) > 0 ? `${n(otHours)} hr × ₹${n(otRate)}/hr` : "hours × rate"}</span>
            </div>
            <label><span style={lbl}>Advance − (₹)</span><input name="advance" inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} style={inp} /></label>
            <label><span style={lbl}>Other deduction − (₹)</span><input name="other_deduction" inputMode="decimal" value={ded} onChange={(e) => setDed(e.target.value)} style={inp} /></label>
            <label><span style={lbl}>Addition / bonus + (₹)</span><input name="addition" inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value)} style={inp} /></label>
          </div>
          <label style={{ display: "block", marginTop: 12 }}><span style={lbl}>Remarks (shown on PF register)</span><input name="remarks" defaultValue={row.remarks ?? ""} placeholder="e.g. joined mid-month, 2 days LOP" style={inp} /></label>
          <label style={{ display: "block", marginTop: 12 }}><span style={lbl}>Note (internal)</span><input name="note" defaultValue={row.note ?? ""} placeholder="e.g. 3 days advance adjusted" style={inp} /></label>
          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(22,101,52,0.07)", border: "1px solid rgba(22,101,52,0.25)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", color: "#15803d" }}>Net pay</span>
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 18, color: "#15803d" }}>{inr(net)}</span>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6, textAlign: "right" }}>Earned − PF − ESI − TDS + OT − Advance − Deduction + Addition</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" style={btnPrimary}>✓ Save row</button>
          </div>
        </form>
        {row.status === "draft" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
            {confirmRemove ? (
              <>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>Remove {row.employeeName} from this batch?</span>
                <form action={removeSalaryPaymentAction} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={row.id} />
                  <ReturnCtx monthYm={monthYm} page="pay" />
                  <FormPending label="Removing…" />
                  <button type="submit" style={{ ...btnGhost, padding: "6px 12px", color: "#fff", background: "#b91c1c", border: "none" }}>Yes, remove</button>
                </form>
                <button type="button" onClick={() => setConfirmRemove(false)} style={{ ...btnGhost, padding: "6px 12px" }}>No</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)} style={{ ...btnGhost, color: "#b91c1c" }}>✕ Remove from this batch</button>
            )}
          </div>
        )}
        {row.status === "paid" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
            <form action={unmarkSalaryPaymentPaidAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={row.id} />
              <ReturnCtx monthYm={monthYm} page="pay" />
              <FormPending label="Reverting…" />
              <button type="submit" title="Owner only — move back to draft" style={btnGhost}>↩ Un-mark paid (owner)</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
