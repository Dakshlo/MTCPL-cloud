"use client";

/**
 * Employees department client (mig 189 + 193, Daksh Jul 2026).
 *
 * Tabs: 👥 Employees · 💵 Pay month (batches) · 📊 Salary paid ·
 * 🏛 PF record · 🏥 ESI record.
 *
 * Pay month works in BATCHES: prepare a batch scoped to an organization /
 * designation / picked employees → fix each employee card (red = incomplete
 * bank info, amber = attendance needed) → download that batch's HDFC sheet
 * (the batch locks: "IN HDFC FILE", no duplicate export) → mark the batch
 * paid. Employees already in a batch this month can't be prepared again.
 *
 * Forms post straight to the server actions (redirect + ?toast=), matching the
 * house pattern; the MTCPL spinner shows while a form is in flight.
 */

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { Combobox } from "@/app/(app)/invoicing/_ui/combobox";
import { PF_WAGE_CEILING, computePf, computeEsi, earnedSalary, daysInSalaryMonth } from "@/lib/salary-permissions";
import { designationColor } from "@/lib/salary-designation-color";
import { SalaryImportButton } from "./salary-import";
import { KpiCard, KpiRow, DesigChip, SALARY_TABLE, segStyle, Pill, NO_DESIG, NO_ORG } from "./_ui/salary-ui";
import {
  upsertSalaryEmployeeAction, toggleSalaryEmployeeAction, deleteSalaryEmployeeAction,
  prepareSalaryBatchAction, updateSalaryPaymentAction, removeSalaryPaymentAction,
  markSalaryBatchPaidAction, groupUnbatchedIntoBatchAction, unlockBatchHdfcAction,
  unmarkSalaryPaymentPaidAction,
} from "./actions";

export type SalaryEmployee = {
  id: string; name: string; organization: string | null; designation: string | null; fatherName: string | null; phone: string | null; aadhaar: string | null;
  bankName: string | null; accountNumber: string | null; ifsc: string | null; beneficiaryName: string | null;
  monthlySalary: number; salaryType: "fixed" | "variable"; pfEnabled: boolean; uan: string | null; pfPercent: number;
  esiEnabled: boolean; esiNumber: string | null; esiPercent: number;
  joinedOn: string | null; isActive: boolean; notes: string | null;
};
export type SalaryPaymentRow = {
  id: string; employeeId: string; employeeName: string; organization: string | null; designation: string | null; salaryType: "fixed" | "variable"; hasBank: boolean;
  /** Employee's full monthly salary + PF/ESI settings — for the RowModal's
   *  live preview (a by-attendance gross is salary × attendance ÷ days). */
  monthlySalary: number; pfEnabled: boolean; pfPercent: number; esiEnabled: boolean; esiPercent: number;
  batchId: string | null;
  gross: number; pfAmount: number; esiAmount: number; otAmount: number; otHours: number | null; advance: number; attendanceDays: number | null; remarks: string | null;
  otherDeduction: number; addition: number; net: number;
  note: string | null; status: "draft" | "paid"; paidAt: string | null;
};
export type SalaryBatch = {
  id: string; label: string; status: "draft" | "paid";
  hdfcGeneratedAt: string | null; paidAt: string | null; createdAt: string;
};
/** One PAID row (any month) — feeds Salary-paid + PF + ESI record tabs. */
export type PaidRow = { employeeId: string; month: string; net: number; pfAmount: number; esiAmount: number; paidAt: string | null };

const inr = (n: number) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};
const monthShort = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
};
/** Step a YYYY-MM value by ±N months. */
const shiftMonth = (ym: string, delta: number): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
/** Short human date for a timestamp ("5 Jul"). */
const dayShort = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const inp: React.CSSProperties = { padding: "9px 11px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)", width: "100%" };
const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", display: "block", marginBottom: 4 };
const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "var(--gold-dark)", cursor: "pointer", whiteSpace: "nowrap" };
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" };

function FormPending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label={label} />;
}

export function SalaryClient({ me, employees, organizations, designations, monthYm, monthRows, batches, paidRows, initialTab }: {
  me: { id: string; isBoss: boolean };
  employees: SalaryEmployee[];
  organizations: string[];
  designations: string[];
  monthYm: string;
  monthRows: SalaryPaymentRow[];
  batches: SalaryBatch[];
  paidRows: PaidRow[];
  initialTab: "employees" | "month" | "paid" | "pf" | "esi";
}) {
  const router = useRouter();
  const [tab, setTab] = useState<typeof initialTab>(initialTab);
  // A server action redirect can change ?tab while this component stays
  // mounted — follow it so "back to Employees" style redirects always land.
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const [editEmp, setEditEmp] = useState<SalaryEmployee | "new" | null>(null);
  const [editRow, setEditRow] = useState<SalaryPaymentRow | null>(null);
  // Month changes are a server round-trip — wrap in a transition so the overlay
  // shows IMMEDIATELY (was silent + felt frozen).
  const [navPending, startNav] = useTransition();
  const pickMonth = (ym: string) => startNav(() => router.push(`/salary?month=${ym}&tab=month`));

  const active = employees.filter((e) => e.isActive);

  return (
    <div>
      {/* Hero — title left, status pills right. Kept deliberately short. */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>👥 Employees</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)", maxWidth: 660 }}>
            Employees → prepare a batch → HDFC bank sheet → mark paid.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)", padding: "5px 12px", background: "var(--gold-subtle, rgba(201,161,74,0.14))", border: "1px solid var(--gold-border, var(--border))", borderRadius: 999 }}>
            👥 {active.length} active
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", padding: "5px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999 }}>
            📅 {monthLabel(monthYm)}
          </span>
        </div>
      </div>

      {/* Tabs — gold segmented control. */}
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setTab("employees")} style={segStyle(tab === "employees")}>👥 Employees · {employees.length}</button>
        <button type="button" onClick={() => setTab("month")} style={segStyle(tab === "month")}>💵 Pay month · {monthRows.length}</button>
        <button type="button" onClick={() => setTab("paid")} style={segStyle(tab === "paid")}>📊 Salary paid</button>
        <button type="button" onClick={() => setTab("pf")} style={segStyle(tab === "pf")}>🏛 PF record</button>
        <button type="button" onClick={() => setTab("esi")} style={segStyle(tab === "esi")}>🏥 ESI record</button>
      </div>

      {tab === "employees" && <EmployeesTab employees={employees} isBoss={me.isBoss} monthYm={monthYm} onEdit={setEditEmp} />}
      {tab === "month" && (
        <MonthTab
          monthYm={monthYm} rows={monthRows} batches={batches} employees={active} isBoss={me.isBoss}
          onPickMonth={pickMonth} monthBusy={navPending} onEditRow={setEditRow}
        />
      )}
      {tab === "paid" && <PaidTab employees={employees} paidRows={paidRows} />}
      {tab === "pf" && <DeductionRecordTab kind="pf" employees={employees} paidRows={paidRows} />}
      {tab === "esi" && <DeductionRecordTab kind="esi" employees={employees} paidRows={paidRows} />}

      {editEmp && <EmployeeModal emp={editEmp === "new" ? null : editEmp} organizations={organizations} designations={designations} monthYm={monthYm} onClose={() => setEditEmp(null)} />}
      {editRow && <RowModal row={editRow} monthYm={monthYm} onClose={() => setEditRow(null)} />}
      <FinanceLoadingOverlay show={navPending} label="Loading month…" />
    </div>
  );
}

/* ── shared bits ───────────────────────────────────────────────────── */

/** Hidden fields every form carries so the action redirects back to the SAME
 *  working month + tab (otherwise the page snaps to the current month). */
function ReturnCtx({ monthYm, tab }: { monthYm: string; tab: "employees" | "month" }) {
  return (
    <>
      <input type="hidden" name="return_month" value={monthYm} />
      <input type="hidden" name="return_tab" value={tab} />
    </>
  );
}

/** Two-level Organization → Designation grouping shared by the Employees and
 *  record tabs. Blank org / designation sort last under NO_ORG / NO_DESIG. */
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

/* ── 👥 Employees ──────────────────────────────────────────────────── */

function EmployeesTab({ employees, isBoss, monthYm, onEdit }: { employees: SalaryEmployee[]; isBoss: boolean; monthYm: string; onEdit: (e: SalaryEmployee | "new") => void }) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // KPIs over ACTIVE employees.
  const activeEmps = employees.filter((e) => e.isActive);
  const monthlyCost = activeEmps.reduce((a, e) => a + (Number(e.monthlySalary) || 0), 0);
  const pfCount = activeEmps.filter((e) => e.pfEnabled).length;
  const esiCount = activeEmps.filter((e) => e.esiEnabled).length;
  const missingBank = activeEmps.filter((e) => !e.accountNumber).length;

  // In-memory search (name / phone / account / designation / organization),
  // then two-level grouping keyed to the Excel register's colours.
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? employees.filter((e) => [e.name, e.phone, e.accountNumber, e.designation, e.organization].some((v) => (v ?? "").toLowerCase().includes(needle)))
    : employees;
  const { orgGroups, showOrg } = groupByOrgDesig(filtered, (e) => e.organization, (e) => e.designation);

  return (
    <div>
      <KpiRow>
        <KpiCard label="Active headcount" value={String(activeEmps.length)} sub={`${employees.length} total on file`} tone="gold" icon="👥" />
        <KpiCard label="Total monthly cost" value={inr(monthlyCost)} sub="active salaries" tone="success" icon="💰" />
        <KpiCard label="PF / ESI" value={`${pfCount} / ${esiCount}`} sub="active employees enrolled" tone="neutral" icon="🏛" />
        <KpiCard label="Missing bank a/c" value={String(missingBank)} sub={missingBank > 0 ? "⚠ bank sheet will refuse" : "all active have a bank a/c"} tone={missingBank > 0 ? "danger" : "neutral"} icon="🏦" />
      </KpiRow>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, account, designation, site…" style={{ ...inp, flex: "1 1 240px", maxWidth: 380 }} />
        {q && <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} of {employees.length}</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
          <SalaryImportButton />
          <button type="button" onClick={() => onEdit("new")} style={btnPrimary}>＋ Add employee</button>
        </span>
      </div>

      {employees.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          No employees yet — ＋ Add employee to start.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "26px 20px", textAlign: "center", color: "var(--muted)" }}>No employee matches &ldquo;{q}&rdquo;.</div>
      ) : (
        <div style={SALARY_TABLE.wrap}>
          <div style={SALARY_TABLE.scroll}>
            <table style={{ ...SALARY_TABLE.table, minWidth: 880 }}>
              <thead><tr>
                <th style={SALARY_TABLE.th}>Employee</th><th style={SALARY_TABLE.th}>Monthly salary</th><th style={SALARY_TABLE.th}>Bank</th><th style={SALARY_TABLE.th}>PF / ESI</th><th style={SALARY_TABLE.th}>Status</th><th style={{ ...SALARY_TABLE.th, textAlign: "right" }}>Actions</th>
              </tr></thead>
              <tbody>
                {orgGroups.map((og) => {
                  const oc = designationColor(og.org);
                  return (
                  <Fragment key={og.org}>
                    {showOrg && (
                      <tr>
                        <td colSpan={6} style={{ padding: "9px 12px", fontSize: 12, fontWeight: 900, letterSpacing: "0.03em", color: oc.fg, background: oc.bg, borderTop: "2px solid var(--border)", borderLeft: `4px solid ${oc.fg}`, borderBottom: "1px solid var(--border)" }}>
                          🏢 {og.org} <span style={{ opacity: 0.7, fontWeight: 700 }}>· {og.count} employee{og.count === 1 ? "" : "s"}</span>
                        </td>
                      </tr>
                    )}
                    {og.desigGroups.map(([desig, emps]) => {
                      const dc = designationColor(desig);
                      return (
                      <Fragment key={desig}>
                        <tr>
                          <td colSpan={6} style={{ padding: "8px 12px", paddingLeft: showOrg ? 26 : 12, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: dc.fg, background: dc.bg, borderLeft: `3px solid ${dc.fg}`, borderBottom: "1px solid var(--border)" }}>
                            {desig} <span style={{ opacity: 0.7, fontWeight: 700 }}>· {emps.length}</span>
                          </td>
                        </tr>
                        {emps.map((e) => (
                      <tr key={e.id} style={{ opacity: e.isActive ? 1 : 0.55 }}>
                        <td style={SALARY_TABLE.td}>
                          <span style={{ fontWeight: 800, display: "block" }}>{e.name}</span>
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>{[e.designation, e.phone].filter(Boolean).join(" · ") || "—"}</span>
                        </td>
                        <td style={{ ...SALARY_TABLE.td, fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                          {inr(e.monthlySalary)}
                          <span style={{ display: "block", fontFamily: "inherit", fontSize: 10, fontWeight: 800, marginTop: 2, color: e.salaryType === "variable" ? "#b45309" : "var(--muted)" }}>{e.salaryType === "variable" ? "⏱ BY ATTENDANCE" : "FIXED"}</span>
                        </td>
                        <td style={SALARY_TABLE.td}>
                          {e.accountNumber ? (
                            <>
                              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, display: "block" }}>{e.accountNumber}</span>
                              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{[e.bankName, e.ifsc].filter(Boolean).join(" · ")}{e.beneficiaryName ? ` · ${e.beneficiaryName}` : ""}</span>
                            </>
                          ) : (
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>⚠ incomplete info — no bank a/c</span>
                          )}
                        </td>
                        <td style={SALARY_TABLE.td}>
                          <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
                            {e.pfEnabled && <Pill label={`PF ${e.pfPercent}%`} tone="success" />}
                            {e.esiEnabled && <Pill label={`ESI ${e.esiPercent}%`} tone="gold" />}
                            {!e.pfEnabled && !e.esiEnabled && <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
                          </span>
                          {e.uan && <span style={{ fontSize: 10.5, color: "var(--muted)", display: "block", marginTop: 3, fontFamily: "ui-monospace, monospace" }}>UAN {e.uan}</span>}
                        </td>
                        <td style={SALARY_TABLE.td}>
                          <Pill label={e.isActive ? "Active" : "Inactive"} tone={e.isActive ? "success" : "neutral"} />
                        </td>
                        <td style={{ ...SALARY_TABLE.td, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button type="button" onClick={() => onEdit(e)} style={{ ...btnGhost, padding: "6px 11px", marginRight: 6 }}>✎ Edit</button>
                          <form action={toggleSalaryEmployeeAction} style={{ display: "inline" }}>
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="active" value={e.isActive ? "0" : "1"} />
                            <ReturnCtx monthYm={monthYm} tab="employees" />
                            <FormPending label={e.isActive ? "Deactivating…" : "Activating…"} />
                            <button type="submit" style={{ ...btnGhost, padding: "6px 11px", marginRight: isBoss ? 6 : 0 }}>{e.isActive ? "⏸ Deactivate" : "▶ Activate"}</button>
                          </form>
                          {isBoss && (confirmDelete === e.id ? (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>Delete + all rows?</span>
                              <form action={deleteSalaryEmployeeAction} style={{ display: "inline" }}>
                                <input type="hidden" name="id" value={e.id} />
                                <ReturnCtx monthYm={monthYm} tab="employees" />
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
    </div>
  );
}

/* ── 💵 Pay month (batches) ────────────────────────────────────────── */

/** PF-register download with a designation picker: export everyone, or tick a
 *  subset. All ticked → no filter param (whole register); a subset → adds
 *  ?designations=CSV that the route filters on. (Daksh Jul 2026) */
function PfExportControl({ monthYm, rows }: { monthYm: string; rows: SalaryPaymentRow[] }) {
  const desigs = useMemo(
    () => [...new Set(rows.map((r) => (r.designation ?? "").trim() || NO_DESIG))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const [open, setOpen] = useState(false);
  // null = "all designations"; a Set = an explicit subset.
  const [sel, setSel] = useState<Set<string> | null>(null);

  const effective = sel === null ? desigs : desigs.filter((d) => sel.has(d));
  const allOn = effective.length === desigs.length;
  const noneOn = effective.length === 0;
  const disabled = rows.length === 0;
  const href = allOn
    ? `/api/salary/pf-export?month=${monthYm}`
    : `/api/salary/pf-export?month=${monthYm}&designations=${encodeURIComponent(effective.join(","))}`;
  const toggle = (d: string) => setSel((prev) => { const n = new Set(prev ?? desigs); n.has(d) ? n.delete(d) : n.add(d); return n; });

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Monthly Salary & PF register — the PF handler's format. Click to choose designations."
        style={{ ...btnPrimary, background: disabled ? "var(--border)" : "#6b4652", opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      >
        ⬇ PF register ▾
      </button>
      {open && !disabled && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 51, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.2)", padding: 12, width: 260, maxHeight: 360, overflowY: "auto" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 8 }}>Designations to export</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", fontWeight: 800, fontSize: 12.5, borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
              <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = !allOn && !noneOn; }} onChange={() => setSel(allOn ? new Set() : null)} />
              All ({desigs.length})
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
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { if (!noneOn) setOpen(false); }}
              style={{ ...btnPrimary, background: noneOn ? "var(--border)" : "#15803d", display: "block", textAlign: "center", marginTop: 10, textDecoration: "none", pointerEvents: noneOn ? "none" : "auto", opacity: noneOn ? 0.6 : 1 }}
            >
              ⬇ Download {allOn ? "all" : effective.length}
            </a>
          </div>
        </>
      )}
    </span>
  );
}

function MonthTab({ monthYm, rows, batches, employees, isBoss, onPickMonth, monthBusy, onEditRow }: {
  monthYm: string; rows: SalaryPaymentRow[]; batches: SalaryBatch[]; employees: SalaryEmployee[]; isBoss: boolean;
  onPickMonth: (ym: string) => void; monthBusy: boolean; onEditRow: (r: SalaryPaymentRow) => void;
}) {
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [confirmPaidBatch, setConfirmPaidBatch] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const draft = rows.filter((r) => r.status === "draft");
  const paid = rows.filter((r) => r.status === "paid");
  const draftNet = draft.reduce((a, r) => a + r.net, 0);
  const paidNet = paid.reduce((a, r) => a + r.net, 0);

  // Search filters the employee cards inside every batch.
  const needle = q.trim().toLowerCase();
  const match = (r: SalaryPaymentRow) => !needle || [r.employeeName, r.designation, r.organization].some((v) => (v ?? "").toLowerCase().includes(needle));

  const rowsOfBatch = (batchId: string | null) => rows.filter((r) => r.batchId === batchId);
  const unbatched = rowsOfBatch(null);
  // Employees already in this month (any batch / paid) — the prepare modal
  // shows them as "already done".
  const inMonthIds = useMemo(() => new Set(rows.map((r) => r.employeeId)), [rows]);

  return (
    <div>
      {/* Controls — month picker · prepare · PF register. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={lbl}>Salary month{monthBusy ? " · loading…" : ""}</span>
          <div style={{ display: "inline-flex", alignItems: "stretch", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden", background: "var(--bg)", opacity: monthBusy ? 0.6 : 1 }}>
            <button type="button" disabled={monthBusy} onClick={() => onPickMonth(shiftMonth(monthYm, -1))} title="Previous month" style={{ padding: "0 13px", fontSize: 18, fontWeight: 800, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: monthBusy ? "wait" : "pointer" }}>‹</button>
            <input type="month" value={monthYm} disabled={monthBusy} onChange={(e) => e.target.value && onPickMonth(e.target.value)} style={{ ...inp, width: 150, fontWeight: 700, border: "none", borderRadius: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }} />
            <button type="button" disabled={monthBusy} onClick={() => onPickMonth(shiftMonth(monthYm, 1))} title="Next month" style={{ padding: "0 13px", fontSize: 18, fontWeight: 800, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: monthBusy ? "wait" : "pointer" }}>›</button>
          </div>
        </label>
        <button type="button" onClick={() => setPrepareOpen(true)} style={{ ...btnPrimary, background: "var(--gold-dark)" }}>
          ＋ Prepare batch
        </button>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <PfExportControl monthYm={monthYm} rows={rows} />
        </span>
      </div>

      {/* Totals. Net-to-pay = DRAFT rows only (what the bank sheets carry). */}
      <KpiRow>
        <KpiCard label={`${monthLabel(monthYm)} · batches`} value={String(batches.length + (unbatched.length > 0 ? 1 : 0))} sub={`${rows.length} employee row${rows.length === 1 ? "" : "s"}`} tone="neutral" icon="🗂" />
        <KpiCard label="Net to pay (draft)" value={inr(draftNet)} sub={`${draft.length} draft row${draft.length === 1 ? "" : "s"}`} tone={draft.length > 0 ? "warn" : "neutral"} icon="💸" />
        <KpiCard label="Paid this month" value={inr(paidNet)} sub={`${paid.length} row${paid.length === 1 ? "" : "s"} paid`} tone="success" icon="✓" />
      </KpiRow>

      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, designation, site…" style={{ ...inp, flex: "1 1 240px", maxWidth: 380 }} />
        </div>
      )}

      {rows.length === 0 && batches.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          Nothing for {monthLabel(monthYm)} yet — hit <strong>＋ Prepare batch</strong> and choose which organization / designation / employees to pay.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {batches.map((b) => (
            <BatchCard
              key={b.id} batch={b} rows={rowsOfBatch(b.id).filter(match)} allRows={rowsOfBatch(b.id)}
              monthYm={monthYm} isBoss={isBoss} onEditRow={onEditRow}
              confirmPaid={confirmPaidBatch === b.id} setConfirmPaid={(on) => setConfirmPaidBatch(on ? b.id : null)}
            />
          ))}
          {unbatched.length > 0 && (
            <BatchCard
              batch={null} rows={unbatched.filter(match)} allRows={unbatched}
              monthYm={monthYm} isBoss={isBoss} onEditRow={onEditRow}
              confirmPaid={false} setConfirmPaid={() => undefined}
            />
          )}
        </div>
      )}

      {prepareOpen && (
        <PrepareBatchModal
          monthYm={monthYm} employees={employees} inMonthIds={inMonthIds}
          onClose={() => setPrepareOpen(false)}
        />
      )}
    </div>
  );
}

/** One payment batch — header, employee cards, HDFC sheet + mark-paid.
 *  `batch === null` renders the legacy "Earlier rows (no batch)" card. */
function BatchCard({ batch, rows, allRows, monthYm, isBoss, onEditRow, confirmPaid, setConfirmPaid }: {
  batch: SalaryBatch | null; rows: SalaryPaymentRow[]; allRows: SalaryPaymentRow[];
  monthYm: string; isBoss: boolean; onEditRow: (r: SalaryPaymentRow) => void;
  confirmPaid: boolean; setConfirmPaid: (on: boolean) => void;
}) {
  const draft = allRows.filter((r) => r.status === "draft");
  const paidRows = allRows.filter((r) => r.status === "paid");
  const netTotal = allRows.reduce((a, r) => a + r.net, 0);
  const missingBank = draft.filter((r) => !r.hasBank);
  const noAttendance = draft.filter((r) => r.salaryType === "variable" && r.attendanceDays == null);
  const isPaid = batch ? batch.status === "paid" : draft.length === 0 && paidRows.length > 0;
  const locked = !!batch?.hdfcGeneratedAt;
  const hdfcReady = !!batch && !isPaid && !locked && draft.length > 0 && missingBank.length === 0 && noAttendance.length === 0;
  const hdfcBlockReason =
    !batch ? "Group these rows into a batch first"
    : isPaid ? "Batch is already paid"
    : locked ? "Already in an HDFC file"
    : draft.length === 0 ? "No draft rows"
    : missingBank.length > 0 ? `Incomplete info: ${missingBank.map((r) => r.employeeName).join(", ")}`
    : noAttendance.length > 0 ? `Attendance needed: ${noAttendance.map((r) => r.employeeName).join(", ")}`
    : "";

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden", opacity: isPaid ? 0.92 : 1 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 14.5, fontWeight: 900 }}>{batch ? `🗂 ${batch.label}` : "🗂 Earlier rows (no batch)"}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{allRows.length} employee{allRows.length === 1 ? "" : "s"}</span>
        {isPaid ? <Pill label={`✓ PAID${batch?.paidAt ? ` · ${dayShort(batch.paidAt)}` : ""}`} tone="success" />
          : locked ? <Pill label="🔒 IN HDFC FILE" tone="gold" />
          : <Pill label="Draft" tone="warn" />}
        <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontWeight: 900, fontSize: 15, color: isPaid ? "#15803d" : "var(--text)" }}>{inr(netTotal)}</span>
      </div>

      {/* "IN HDFC FILE" strip — the batch is inside a bank file; no re-export. */}
      {locked && !isPaid && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 16px", background: "rgba(30,64,175,0.07)", borderBottom: "1px dashed rgba(30,64,175,0.4)", color: "#1e40af", fontSize: 12, fontWeight: 900, letterSpacing: "0.07em" }}>
          🔒 IN HDFC FILE
          <span style={{ fontWeight: 700, letterSpacing: 0, opacity: 0.8 }}>generated {dayShort(batch!.hdfcGeneratedAt)} — re-download blocked so this batch can&apos;t be paid twice</span>
          {isBoss && (
            <form action={unlockBatchHdfcAction} style={{ marginLeft: "auto" }}>
              <input type="hidden" name="batch_id" value={batch!.id} />
              <ReturnCtx monthYm={monthYm} tab="month" />
              <FormPending label="Re-allowing…" />
              <button type="submit" title="Owner only — allow generating the sheet again (file was lost)" style={{ ...btnGhost, padding: "4px 10px", fontSize: 11 }}>↺ Re-allow</button>
            </form>
          )}
        </div>
      )}

      {/* Employee cards */}
      <div style={{ padding: 14 }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 2px" }}>No employee matches the search in this batch.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))", gap: 10 }}>
            {rows.map((r) => {
              const isDraft = r.status === "draft";
              const issue = isDraft && !r.hasBank ? "bank" : isDraft && r.salaryType === "variable" && r.attendanceDays == null ? "attendance" : null;
              const border = issue === "bank" ? "#b91c1c" : issue === "attendance" ? "#b45309" : r.status === "paid" ? "rgba(21,128,61,0.45)" : "var(--border)";
              const bg = issue === "bank" ? "rgba(220,38,38,0.05)" : issue === "attendance" ? "rgba(217,119,6,0.06)" : r.status === "paid" ? "rgba(22,101,52,0.05)" : "var(--bg)";
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onEditRow(r)}
                  title={isDraft ? "Edit this row (attendance, OT, advance…)" : "Paid — open to view (owner can un-mark)"}
                  style={{ textAlign: "left", border: `1.5px solid ${border}`, background: bg, borderRadius: 11, padding: "10px 12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 5, color: "var(--text)" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.employeeName}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12.5 }}>{inr(r.net)}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <DesigChip name={r.designation} size="sm" />
                    {r.salaryType === "variable" && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#b45309" }}>⏱ {r.attendanceDays != null ? `${r.attendanceDays}d` : "BY ATTENDANCE"}</span>}
                  </span>
                  {issue === "bank" && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#b91c1c" }}>⚠ incomplete info — bank a/c missing</span>}
                  {issue === "attendance" && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#b45309" }}>⏱ attendance needed — tap to enter</span>}
                  {r.status === "paid" && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#15803d" }}>✓ paid{dayShort(r.paidAt) ? ` · ${dayShort(r.paidAt)}` : ""}</span>}
                  {!issue && isDraft && <span style={{ fontSize: 10.5, color: locked ? "#1e40af" : "var(--muted)", fontWeight: locked ? 800 : 400 }}>{locked ? "🔒 in HDFC file — locked" : "ready · tap to edit"}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Footer actions */}
        {(draft.length > 0 || !batch) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            {batch ? (
              <>
                <a
                  href={hdfcReady ? `/api/salary/hdfc-export?month=${monthYm}&batch=${batch.id}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => { if (!hdfcReady) e.preventDefault(); }}
                  aria-disabled={!hdfcReady}
                  title={hdfcReady ? "HDFC ENet Bulk Payment sheet for THIS batch — locks the batch after download" : hdfcBlockReason}
                  style={{ ...btnPrimary, background: hdfcReady ? "#15803d" : "var(--border)", color: hdfcReady ? "#fff" : "var(--muted)", textDecoration: "none", pointerEvents: hdfcReady ? "auto" : "none", opacity: hdfcReady ? 1 : 0.7 }}
                >
                  {locked ? "🔒 In HDFC file" : `⬇ HDFC bank sheet · ${draft.length}`}
                </a>
                {!hdfcReady && !locked && hdfcBlockReason && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: missingBank.length > 0 ? "#b91c1c" : "#b45309" }}>{hdfcBlockReason}</span>
                )}
                {draft.length > 0 && (confirmPaid ? (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>Paid from the bank — mark {draft.length} row{draft.length === 1 ? "" : "s"} PAID?</span>
                    <form action={markSalaryBatchPaidAction} style={{ display: "inline" }}>
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <ReturnCtx monthYm={monthYm} tab="month" />
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
                  <ReturnCtx monthYm={monthYm} tab="month" />
                  <FormPending label="Grouping…" />
                  <button type="submit" style={btnPrimary} title="Wrap these earlier rows into a batch so they can use the bank-sheet flow">
                    ⚙ Group into a batch · {draft.length}
                  </button>
                </form>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Prepare-batch modal: choose the scope (everyone / organization /
 *  designation / picked employees) and see exactly who will be included —
 *  people already in a batch this month show as "already done" and are
 *  skipped. */
function PrepareBatchModal({ monthYm, employees, inMonthIds, onClose }: {
  monthYm: string; employees: SalaryEmployee[]; inMonthIds: Set<string>; onClose: () => void;
}) {
  type Kind = "all" | "organization" | "designation" | "employees";
  const [kind, setKind] = useState<Kind>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [empQ, setEmpQ] = useState("");

  const orgs = useMemo(() => [...new Set(employees.map((e) => (e.organization ?? "").trim()))].sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)), [employees]);
  const desigs = useMemo(() => [...new Set(employees.map((e) => (e.designation ?? "").trim()))].sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)), [employees]);

  const options: string[] = kind === "organization" ? orgs : kind === "designation" ? desigs : [];
  const toggle = (v: string) => setPicked((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });

  // Live preview — who lands in the batch vs who's already done this month.
  const scoped = employees.filter((e) => {
    if (kind === "all") return true;
    if (kind === "organization") return picked.has((e.organization ?? "").trim());
    if (kind === "designation") return picked.has((e.designation ?? "").trim());
    return picked.has(e.id);
  });
  const fresh = scoped.filter((e) => !inMonthIds.has(e.id));
  const already = scoped.filter((e) => inMonthIds.has(e.id));
  const canSubmit = (kind === "all" || picked.size > 0) && fresh.length > 0;

  const empNeedle = empQ.trim().toLowerCase();
  const empList = empNeedle
    ? employees.filter((e) => [e.name, e.designation, e.organization].some((v) => (v ?? "").toLowerCase().includes(empNeedle)))
    : employees;

  const kindBtn = (k: Kind, label: string) => (
    <button key={k} type="button" onClick={() => { setKind(k); setPicked(new Set()); }} style={{ flex: 1, fontSize: 12.5, fontWeight: 800, padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: kind === k ? "var(--gold)" : "transparent", color: kind === k ? "#fff" : "var(--muted)", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );

  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(680px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>⚙ Prepare batch — {monthLabel(monthYm)}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 14px" }}>Choose who to pay in this batch. Anyone already in a batch this month is skipped automatically.</div>

        <span style={lbl}>Who to include</span>
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 12, flexWrap: "wrap" }}>
          {kindBtn("all", "Everyone")}
          {kindBtn("organization", "🏢 Organization")}
          {kindBtn("designation", "Designation")}
          {kindBtn("employees", "Pick employees")}
        </div>

        {(kind === "organization" || kind === "designation") && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {options.map((o) => {
              const on = picked.has(o);
              const dc = designationColor(o || (kind === "organization" ? NO_ORG : NO_DESIG));
              return (
                <button key={o || "(blank)"} type="button" onClick={() => toggle(o)} style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 14px", borderRadius: 999, cursor: "pointer", border: on ? `2px solid ${dc.fg}` : "1px solid var(--border)", background: on ? dc.bg : "var(--bg)", color: on ? dc.fg : "var(--text)" }}>
                  {on ? "✓ " : ""}{o || (kind === "organization" ? "(No organization)" : "(No designation)")}
                </button>
              );
            })}
            {options.length === 0 && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Nothing to pick yet.</span>}
          </div>
        )}

        {kind === "employees" && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
            <input value={empQ} onChange={(e) => setEmpQ(e.target.value)} placeholder="Search employees…" style={{ ...inp, border: "none", borderBottom: "1px solid var(--border)", borderRadius: 0 }} />
            <div style={{ maxHeight: 240, overflowY: "auto", padding: "6px 10px" }}>
              {empList.map((e) => {
                const done = inMonthIds.has(e.id);
                return (
                  <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", fontSize: 12.5, opacity: done ? 0.5 : 1, cursor: done ? "not-allowed" : "pointer" }}>
                    <input type="checkbox" disabled={done} checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                    <span style={{ fontWeight: 700 }}>{e.name}</span>
                    <DesigChip name={e.designation} size="sm" />
                    {done && <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>✓ already in a batch</span>}
                  </label>
                );
              })}
              {empList.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 0" }}>No employee matches.</div>}
            </div>
          </div>
        )}

        {/* Preview */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: "10px 13px", marginBottom: 14, fontSize: 12.5 }}>
          <span style={{ fontWeight: 900, color: fresh.length > 0 ? "#15803d" : "var(--muted)" }}>{fresh.length}</span> will be in this batch
          {already.length > 0 && (
            <span style={{ color: "var(--muted)" }}> · <span style={{ fontWeight: 800 }}>{already.length}</span> skipped (already in a batch / paid): {already.slice(0, 6).map((e) => e.name).join(", ")}{already.length > 6 ? "…" : ""}</span>
          )}
        </div>

        <form action={prepareSalaryBatchAction} style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <input type="hidden" name="month" value={monthYm} />
          <input type="hidden" name="scope_kind" value={kind} />
          <input type="hidden" name="scope_values" value={JSON.stringify([...picked])} />
          <ReturnCtx monthYm={monthYm} tab="month" />
          <FormPending label="Preparing batch…" />
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={!canSubmit} style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}>
            ⚙ Prepare {fresh.length} employee{fresh.length === 1 ? "" : "s"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── 📊 Salary paid ────────────────────────────────────────────────── */

function PaidTab({ employees, paidRows }: { employees: SalaryEmployee[]; paidRows: PaidRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const empOf = useMemo(() => new Map(employees.map((e) => [e.id, e] as const)), [employees]);

  // Group by month, newest first.
  const months = useMemo(() => {
    const m = new Map<string, PaidRow[]>();
    for (const r of paidRows) { const a = m.get(r.month) ?? []; a.push(r); m.set(r.month, a); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [paidRows]);
  const grandNet = paidRows.reduce((a, r) => a + r.net, 0);

  return (
    <div>
      <KpiRow>
        <KpiCard label="Salary paid till date" value={inr(grandNet)} sub={`${paidRows.length} payment${paidRows.length === 1 ? "" : "s"}`} tone="success" icon="💸" />
        <KpiCard label="Months with payments" value={String(months.length)} tone="neutral" icon="📅" />
      </KpiRow>
      {months.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          Nothing paid yet — appears once a batch is marked PAID.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {months.map(([month, rows]) => {
            const total = rows.reduce((a, r) => a + r.net, 0);
            const isOpen = open === month;
            const detail = rows
              .map((r) => ({ ...r, emp: empOf.get(r.employeeId) }))
              .sort((a, b) => (a.emp?.name ?? "—").localeCompare(b.emp?.name ?? "—"));
            return (
              <div key={month} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow)" }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : month)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                  <span style={{ fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--gold-dark)" }}>▶</span>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{monthShort(month)}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{rows.length} employee{rows.length === 1 ? "" : "s"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 900, fontFamily: "ui-monospace, monospace", color: "#15803d" }}>{inr(total)}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "6px 14px 14px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>
                        <th style={{ ...SALARY_TABLE.th, position: "static" }}>Employee</th>
                        <th style={{ ...SALARY_TABLE.th, position: "static", textAlign: "right" }}>Net paid</th>
                        <th style={{ ...SALARY_TABLE.th, position: "static", textAlign: "right" }}>PF −</th>
                        <th style={{ ...SALARY_TABLE.th, position: "static", textAlign: "right" }}>ESI −</th>
                        <th style={{ ...SALARY_TABLE.th, position: "static", textAlign: "right" }}>Paid on</th>
                      </tr></thead>
                      <tbody>
                        {detail.map((r, i) => (
                          <tr key={i}>
                            <td style={SALARY_TABLE.td}>
                              <span style={{ fontWeight: 800 }}>{r.emp?.name ?? "(removed employee)"}</span>
                              {r.emp && <span style={{ marginLeft: 8 }}><DesigChip name={r.emp.designation} size="sm" /></span>}
                            </td>
                            <td style={{ ...SALARY_TABLE.td, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{inr(r.net)}</td>
                            <td style={{ ...SALARY_TABLE.td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.pfAmount ? inr(r.pfAmount) : "—"}</td>
                            <td style={{ ...SALARY_TABLE.td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.esiAmount ? inr(r.esiAmount) : "—"}</td>
                            <td style={{ ...SALARY_TABLE.td, textAlign: "right", fontSize: 11.5, color: "var(--muted)" }}>{dayShort(r.paidAt) ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: "var(--bg)", fontWeight: 800 }}>
                          <td style={SALARY_TABLE.td}>TOTAL</td>
                          <td style={{ ...SALARY_TABLE.td, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{inr(total)}</td>
                          <td style={{ ...SALARY_TABLE.td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{inr(rows.reduce((a, r) => a + r.pfAmount, 0))}</td>
                          <td style={{ ...SALARY_TABLE.td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{inr(rows.reduce((a, r) => a + r.esiAmount, 0))}</td>
                          <td style={SALARY_TABLE.td}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 🏛 PF record · 🏥 ESI record (one component, two kinds) ─────────── */

function DeductionRecordTab({ kind, employees, paidRows }: { kind: "pf" | "esi"; employees: SalaryEmployee[]; paidRows: PaidRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const amountOf = (r: PaidRow) => (kind === "pf" ? r.pfAmount : r.esiAmount);
  const enabledOf = (e: SalaryEmployee) => (kind === "pf" ? e.pfEnabled : e.esiEnabled);
  const pctOf = (e: SalaryEmployee) => (kind === "pf" ? e.pfPercent : e.esiPercent);
  const numberOf = (e: SalaryEmployee) => (kind === "pf" ? e.uan : e.esiNumber);
  const NAME = kind === "pf" ? "PF" : "ESI";
  const NUM_LABEL = kind === "pf" ? "UAN" : "ESI no.";

  const rows = useMemo(() => paidRows.filter((r) => amountOf(r) > 0), [paidRows, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const byEmp = useMemo(() => {
    const m = new Map<string, PaidRow[]>();
    for (const r of rows) { const a = m.get(r.employeeId) ?? []; a.push(r); m.set(r.employeeId, a); }
    return m;
  }, [rows]);
  const withIt = employees.filter((e) => enabledOf(e) || byEmp.has(e.id));
  const grandTotal = rows.reduce((a, r) => a + amountOf(r), 0);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? withIt.filter((e) => [e.name, e.designation, e.organization, numberOf(e), e.accountNumber].some((v) => (v ?? "").toLowerCase().includes(needle)))
    : withIt;
  const { orgGroups, showOrg } = groupByOrgDesig(filtered, (e) => e.organization, (e) => e.designation);

  // One employee's collapsible card. Called inline (not <Card/>) so it never
  // remounts — grouping just wraps these.
  const card = (e: SalaryEmployee) => {
    const empRows = (byEmp.get(e.id) ?? []).slice().sort((a, b) => b.month.localeCompare(a.month));
    const total = empRows.reduce((a, r) => a + amountOf(r), 0);
    const isOpen = open === e.id;
    const dc = designationColor(e.designation);
    return (
      <div key={e.id} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${dc.fg}`, borderRadius: 12, overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow)" }}>
        <button type="button" onClick={() => setOpen(isOpen ? null : e.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
          <span style={{ fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s", color: dc.fg }}>▶</span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{e.name}</span>
          <DesigChip name={e.designation} size="sm" />
          {numberOf(e) && <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>{NUM_LABEL} {numberOf(e)}</span>}
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{enabledOf(e) ? `${NAME} ${pctOf(e)}%` : `${NAME} off now`} · {empRows.length} month{empRows.length !== 1 ? "s" : ""}</span>
          <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: "#15803d" }}>{inr(total)}</span>
        </button>
        {isOpen && (
          <div style={{ padding: "8px 14px 14px" }}>
            {empRows.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing deducted yet — appears once a month with {NAME} is marked paid.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 7 }}>
                {empRows.map((r) => (
                  <div key={r.month} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "7px 11px", background: "var(--bg)" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>{monthShort(r.month)}</div>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5 }}>{inr(amountOf(r))}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <KpiRow>
        <KpiCard label={`Employees with ${NAME}`} value={String(withIt.length)} tone="neutral" icon={kind === "pf" ? "🏛" : "🏥"} />
        <KpiCard label={`${NAME} deducted till date`} value={inr(grandTotal)} sub="employee share, from paid months" tone="success" icon="💰" />
      </KpiRow>
      {withIt.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search name, designation, site, ${NUM_LABEL}…`} style={{ ...inp, flex: "1 1 240px", maxWidth: 380 }} />
          {q && <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} of {withIt.length}</span>}
        </div>
      )}
      {withIt.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          No {NAME} yet — enable {NAME} on an employee (Employees tab → ✎ Edit) and pay a month; the record builds itself.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "26px 20px", textAlign: "center", color: "var(--muted)" }}>No employee matches &ldquo;{q}&rdquo;.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {orgGroups.map((og) => {
            const oc = designationColor(og.org);
            return (
              <div key={og.org} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {showOrg && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: oc.bg, color: oc.fg, borderLeft: `4px solid ${oc.fg}`, fontSize: 12, fontWeight: 900, letterSpacing: "0.03em" }}>
                    🏢 {og.org} <span style={{ opacity: 0.7, fontWeight: 700 }}>· {og.count} employee{og.count === 1 ? "" : "s"}</span>
                  </div>
                )}
                {og.desigGroups.map(([desig, emps]) => {
                  const dc = designationColor(desig);
                  return (
                    <div key={desig} style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: showOrg ? 12 : 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: dc.fg }}>{desig} <span style={{ opacity: 0.7 }}>· {emps.length}</span></div>
                      {emps.map(card)}
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

/* ── Modals ────────────────────────────────────────────────────────── */

/** Section wrapper for the employee form — bordered card with a bold header,
 *  so the big form reads in clear blocks (Daksh: "make it proper big info"). */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface)" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold-dark)", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function EmployeeModal({ emp, organizations, designations, monthYm, onClose }: { emp: SalaryEmployee | null; organizations: string[]; designations: string[]; monthYm: string; onClose: () => void }) {
  // New employees default to PF ON (Daksh); editing keeps the employee's own value.
  const [pfOn, setPfOn] = useState(emp ? emp.pfEnabled : true);
  const [esiOn, setEsiOn] = useState(emp ? emp.esiEnabled : false);
  const [organization, setOrganization] = useState(emp?.organization ?? "");
  const [designation, setDesignation] = useState(emp?.designation ?? "");
  // Salary type is an EXPLICIT toggle — fixed (default) or by attendance.
  const [salaryType, setSalaryType] = useState<"fixed" | "variable">(emp?.salaryType ?? "fixed");
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(920px, 100%)", background: "var(--bg, #fff)", borderRadius: 16, padding: "22px 26px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto" }}>
        <div style={{ fontSize: 19, fontWeight: 900, marginBottom: 4 }}>{emp ? `✎ ${emp.name}` : "＋ Add employee"}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>{emp ? "Update the employee's details — changes apply from the next prepared batch." : "Fill what you have — bank details are needed before the HDFC sheet can include them."}</div>
        <form action={upsertSalaryEmployeeAction} autoComplete="off" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {emp && <input type="hidden" name="id" value={emp.id} />}
          <ReturnCtx monthYm={monthYm} tab="employees" />
          <FormPending label={emp ? "Saving employee…" : "Adding employee…"} />

          <FormSection title="🪪 Basic details">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              <label><span style={lbl}>Name *</span><input name="name" required defaultValue={emp?.name ?? ""} style={inp} /></label>
              <label><span style={lbl}>Father / husband name</span><input name="father_name" defaultValue={emp?.fatherName ?? ""} style={inp} /></label>
              <label><span style={lbl}>Phone</span><input name="phone" defaultValue={emp?.phone ?? ""} style={inp} /></label>
              <label>
                <span style={lbl}>Organization / site</span>
                <Combobox value={organization} onChange={setOrganization} options={organizations} name="organization" placeholder="e.g. Main Office, Ram Mandir Site…" inputStyle={inp} />
              </label>
              <label>
                <span style={lbl}>Designation</span>
                <Combobox value={designation} onChange={setDesignation} options={designations} name="designation" placeholder="Pick or type a new one…" inputStyle={inp} />
              </label>
              <label><span style={lbl}>Aadhaar no.</span><input name="aadhaar" inputMode="numeric" maxLength={12} defaultValue={emp?.aadhaar ?? ""} placeholder="12 digits" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
              <label><span style={lbl}>Joined on</span><input type="date" name="joined_on" defaultValue={emp?.joinedOn ?? ""} style={inp} /></label>
            </div>
          </FormSection>

          <FormSection title="💰 Salary">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "end" }}>
              <label>
                <span style={lbl}>Monthly salary (₹) *</span>
                <input name="monthly_salary" required inputMode="decimal" defaultValue={emp?.monthlySalary ? String(emp.monthlySalary) : ""} style={inp} />
              </label>
              <div>
                <span style={lbl}>Salary type</span>
                <input type="hidden" name="salary_type" value={salaryType} />
                <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", width: "100%" }}>
                  {(["fixed", "variable"] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setSalaryType(t)} style={{ flex: 1, fontSize: 12.5, fontWeight: 800, padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: salaryType === t ? "var(--gold)" : "transparent", color: salaryType === t ? "#fff" : "var(--muted)" }}>
                      {t === "fixed" ? "Fixed" : "⏱ By attendance"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, marginTop: 10, padding: "9px 12px", borderRadius: 9, border: "1px solid var(--border)", background: salaryType === "variable" ? "rgba(217,119,6,0.08)" : "var(--bg)", color: "var(--muted)", lineHeight: 1.5 }}>
              {salaryType === "variable" ? (
                <><b style={{ color: "#b45309" }}>⏱ By attendance.</b> The salary above is for a full month; each month it&apos;s prorated by days present (e.g. 20 of 30 days → 20⁄30 of the salary). Attendance is entered on the Pay-month row.</>
              ) : (
                <><b style={{ color: "var(--gold-dark)" }}>Fixed.</b> The full amount is paid every month, whatever the attendance.</>
              )}
            </div>
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

          <FormSection title="🏛 PF & 🏥 ESI">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "end" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", cursor: "pointer" }}>
                <input type="checkbox" name="pf_enabled" value="1" checked={pfOn} onChange={(e) => setPfOn(e.target.checked)} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>PF applicable</span>
              </label>
              <label><span style={lbl}>UAN / PF number</span><input name="uan" defaultValue={emp?.uan ?? ""} disabled={!pfOn} style={{ ...inp, fontFamily: "ui-monospace, monospace", opacity: pfOn ? 1 : 0.5 }} /></label>
              <label><span style={lbl}>PF % (employee share)</span><input name="pf_percent" inputMode="decimal" defaultValue={String(emp?.pfPercent ?? 12)} disabled={!pfOn} style={{ ...inp, opacity: pfOn ? 1 : 0.5 }} /></label>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", margin: "6px 0 12px" }}>PF = pf% of min(earned salary, {inr(PF_WAGE_CEILING)}).</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "end" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", cursor: "pointer" }}>
                <input type="checkbox" name="esi_enabled" value="1" checked={esiOn} onChange={(e) => setEsiOn(e.target.checked)} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>ESI applicable</span>
              </label>
              <label><span style={lbl}>ESI number</span><input name="esi_number" defaultValue={emp?.esiNumber ?? ""} disabled={!esiOn} style={{ ...inp, fontFamily: "ui-monospace, monospace", opacity: esiOn ? 1 : 0.5 }} /></label>
              <label><span style={lbl}>ESI % (employee share)</span><input name="esi_percent" inputMode="decimal" defaultValue={String(emp?.esiPercent ?? 1)} disabled={!esiOn} style={{ ...inp, opacity: esiOn ? 1 : 0.5 }} /></label>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>ESI = esi% of the earned salary (default 1% — e.g. salary ₹10,000 → ESI ₹100).</div>
          </FormSection>

          <label style={{ display: "block" }}><span style={lbl}>Notes</span><input name="notes" defaultValue={emp?.notes ?? ""} style={inp} /></label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" style={btnPrimary}>{emp ? "✓ Save employee" : "＋ Add employee"}</button>
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
  // OT is hours × per-hour rate. The rate isn't stored separately — derive
  // it from the saved amount ÷ hours so re-opening the row shows it again.
  const [otRate, setOtRate] = useState(row.otHours && row.otAmount && Number(row.otHours) > 0 ? String(Math.round((row.otAmount / row.otHours) * 100) / 100) : "");
  const [advance, setAdvance] = useState(String(row.advance || ""));
  const [ded, setDed] = useState(String(row.otherDeduction || ""));
  const [add, setAdd] = useState(String(row.addition || ""));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const n = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const attendanceNum = attendance.trim() === "" ? null : n(attendance);
  // Gross + PF + ESI are DERIVED (the server recomputes them identically):
  //   fixed → full monthly salary; by attendance → salary × attendance ÷ days.
  const gross = earnedSalary({ monthlySalary: row.monthlySalary, salaryType: row.salaryType, attendanceDays: attendanceNum, monthKey: monthYm });
  const pf = computePf(gross, row.pfPercent, row.pfEnabled);
  const esi = computeEsi(gross, row.esiPercent, row.esiEnabled);
  // OT amount = total OT hours × per-hour rate (flows into net).
  const otAmount = Math.round(n(otHours) * n(otRate) * 100) / 100;
  const net = Math.round((gross - pf - esi + otAmount - n(advance) - n(ded) + n(add)) * 100) / 100;
  const readBox: React.CSSProperties = { ...inp, background: "var(--surface)", fontFamily: "ui-monospace, monospace", fontWeight: 800, display: "flex", alignItems: "center", minHeight: 38 };
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(600px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 2 }}>✎ {row.employeeName}
          {byAttendance
            ? <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", marginLeft: 8 }}>⏱ BY ATTENDANCE</span>
            : <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", marginLeft: 8 }}>FIXED</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14 }}>
          {byAttendance
            ? `${inr(row.monthlySalary)} for a full ${days}-day month, prorated by days present. Enter attendance; net recalculates live.`
            : "Fixed salary — the full amount is paid whatever the attendance. Adjust with OT / advance / deduction / addition if needed."}
        </div>
        <form action={updateSalaryPaymentAction}>
          <input type="hidden" name="id" value={row.id} />
          <ReturnCtx monthYm={monthYm} tab="month" />
          <FormPending label="Saving row…" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={lbl}>Earned salary (₹)</span>
              <div style={readBox}>{inr(gross)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>
                {byAttendance ? (attendanceNum == null ? "enter attendance →" : `${inr(row.monthlySalary)} × ${attendanceNum}⁄${days} days`) : "full fixed salary"}
              </span>
            </div>
            <label><span style={lbl}>Attendance days{byAttendance ? " *" : ""}</span><input name="attendance_days" inputMode="decimal" value={attendance} onChange={(e) => setAttendance(e.target.value)} placeholder={byAttendance ? `days present of ${days}` : "info only — doesn't change fixed pay"} style={inp} /></label>
            <div>
              <span style={lbl}>PF deduction − (₹)</span>
              <div style={readBox}>{inr(pf)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>
                {row.pfEnabled ? `${row.pfPercent}% of min(earned, ${inr(PF_WAGE_CEILING)})` : "PF not applicable"}
              </span>
            </div>
            <div>
              <span style={lbl}>ESI deduction − (₹)</span>
              <div style={readBox}>{inr(esi)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>
                {row.esiEnabled ? `${row.esiPercent}% of earned salary` : "ESI not applicable"}
              </span>
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
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6, textAlign: "right" }}>Earned − PF − ESI + OT − Advance − Deduction + Addition</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" style={btnPrimary}>✓ Save row</button>
          </div>
        </form>
        {/* Remove from the month — its own form (can't nest inside the one above). */}
        {row.status === "draft" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
            {confirmRemove ? (
              <>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>Remove {row.employeeName} from this month?</span>
                <form action={removeSalaryPaymentAction} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={row.id} />
                  <ReturnCtx monthYm={monthYm} tab="month" />
                  <FormPending label="Removing…" />
                  <button type="submit" style={{ ...btnGhost, padding: "6px 12px", color: "#fff", background: "#b91c1c", border: "none" }}>Yes, remove</button>
                </form>
                <button type="button" onClick={() => setConfirmRemove(false)} style={{ ...btnGhost, padding: "6px 12px" }}>No</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)} style={{ ...btnGhost, color: "#b91c1c" }}>✕ Remove from this month</button>
            )}
          </div>
        )}
        {/* Owner: revert a PAID row back to draft. */}
        {row.status === "paid" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
            <form action={unmarkSalaryPaymentPaidAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={row.id} />
              <ReturnCtx monthYm={monthYm} tab="month" />
              <FormPending label="Reverting…" />
              <button type="submit" title="Owner only — move back to draft" style={btnGhost}>↩ Un-mark paid (owner)</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
