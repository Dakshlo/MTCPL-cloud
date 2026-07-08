"use client";

/**
 * Salary / PF department client (mig 189, Daksh Jul 2026).
 *
 * Tabs: 👥 Employees · 💵 Pay month · 🏦 PF record.
 * Forms post straight to the server actions (redirect + ?toast=), matching the
 * house pattern; the MTCPL spinner shows while a form is in flight.
 */

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { Combobox } from "@/app/(app)/invoicing/_ui/combobox";
import { PF_WAGE_CEILING, computePf, earnedSalary, daysInSalaryMonth, isWorkerDesignation } from "@/lib/salary-permissions";
import { designationColor } from "@/lib/salary-designation-color";
import { SalaryImportButton } from "./salary-import";
import { KpiCard, KpiRow, DesigChip, SALARY_TABLE, segStyle, Pill, NO_DESIG, NO_ORG } from "./_ui/salary-ui";
import {
  upsertSalaryEmployeeAction, toggleSalaryEmployeeAction, deleteSalaryEmployeeAction,
  prepareSalaryMonthAction, updateSalaryPaymentAction, removeSalaryPaymentAction,
  markSalaryMonthPaidAction, unmarkSalaryPaymentPaidAction,
} from "./actions";

export type SalaryEmployee = {
  id: string; name: string; organization: string | null; designation: string | null; fatherName: string | null; phone: string | null; aadhaar: string | null;
  bankName: string | null; accountNumber: string | null; ifsc: string | null; beneficiaryName: string | null;
  monthlySalary: number; salaryType: "fixed" | "variable"; pfEnabled: boolean; uan: string | null; pfPercent: number;
  joinedOn: string | null; isActive: boolean; notes: string | null;
};
export type SalaryPaymentRow = {
  id: string; employeeId: string; employeeName: string; organization: string | null; designation: string | null; salaryType: "fixed" | "variable"; hasBank: boolean;
  /** Employee's full monthly salary + PF settings — for the RowModal's live
   *  gross/PF preview (a worker's gross is salary × attendance ÷ days-in-month). */
  monthlySalary: number; pfEnabled: boolean; pfPercent: number;
  gross: number; pfAmount: number; otAmount: number; otHours: number | null; advance: number; attendanceDays: number | null; remarks: string | null;
  otherDeduction: number; addition: number; net: number;
  note: string | null; status: "draft" | "paid"; paidAt: string | null;
};
export type PfRow = { employeeId: string; month: string; pfAmount: number };

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

export function SalaryClient({ me, employees, organizations, designations, monthYm, monthRows, pfRows, initialTab }: {
  me: { id: string; isBoss: boolean };
  employees: SalaryEmployee[];
  organizations: string[];
  designations: string[];
  monthYm: string;
  monthRows: SalaryPaymentRow[];
  pfRows: PfRow[];
  initialTab: "employees" | "month" | "pf";
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"employees" | "month" | "pf">(initialTab);
  const [editEmp, setEditEmp] = useState<SalaryEmployee | "new" | null>(null);
  const [editRow, setEditRow] = useState<SalaryPaymentRow | null>(null);
  // Month changes are a server round-trip — wrap in a transition so the overlay
  // shows IMMEDIATELY (was silent + felt frozen).
  const [navPending, startNav] = useTransition();
  const pickMonth = (ym: string) => startNav(() => router.push(`/salary?month=${ym}&tab=month`));

  const active = employees.filter((e) => e.isActive);

  return (
    <div>
      {/* Hero — Finance-grade: title + flow on the left, status pills on the right. */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>💵 Salary / PF</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)", maxWidth: 660 }}>
            Employee master → prepare the month → HDFC bulk-payment sheet → pay from the bank → mark paid. PF record builds itself from paid months.
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
        <button type="button" onClick={() => setTab("pf")} style={segStyle(tab === "pf")}>🏦 PF record</button>
      </div>

      {tab === "employees" && <EmployeesTab employees={employees} isBoss={me.isBoss} monthYm={monthYm} onEdit={setEditEmp} />}
      {tab === "month" && <MonthTab monthYm={monthYm} rows={monthRows} isBoss={me.isBoss} onPickMonth={pickMonth} monthBusy={navPending} onEditRow={setEditRow} activeCount={active.length} />}
      {tab === "pf" && <PfTab employees={employees} pfRows={pfRows} />}

      {editEmp && <EmployeeModal emp={editEmp === "new" ? null : editEmp} organizations={organizations} designations={designations} monthYm={monthYm} onClose={() => setEditEmp(null)} />}
      {editRow && <RowModal row={editRow} monthYm={monthYm} onClose={() => setEditRow(null)} />}
      <FinanceLoadingOverlay show={navPending} label="Loading month…" />
    </div>
  );
}

/* ── 👥 Employees ──────────────────────────────────────────────────── */

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
 *  PF-record tabs. Blank org / designation sort last under NO_ORG / NO_DESIG. */
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

function EmployeesTab({ employees, isBoss, monthYm, onEdit }: { employees: SalaryEmployee[]; isBoss: boolean; monthYm: string; onEdit: (e: SalaryEmployee | "new") => void }) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // KPIs over ACTIVE employees.
  const activeEmps = employees.filter((e) => e.isActive);
  const monthlyCost = activeEmps.reduce((a, e) => a + (Number(e.monthlySalary) || 0), 0);
  const pfCount = activeEmps.filter((e) => e.pfEnabled).length;
  const missingBank = activeEmps.filter((e) => !e.accountNumber).length;

  // In-memory search (name / phone / account / designation / organization),
  // then two-level grouping keyed to the Excel register's colours.
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? employees.filter((e) => [e.name, e.phone, e.accountNumber, e.designation, e.organization].some((v) => (v ?? "").toLowerCase().includes(needle)))
    : employees;
  // Two-level grouping: Organization / site → Designation → employees.
  const { orgGroups, showOrg } = groupByOrgDesig(filtered, (e) => e.organization, (e) => e.designation);

  return (
    <div>
      <KpiRow>
        <KpiCard label="Active headcount" value={String(activeEmps.length)} sub={`${employees.length} total on file`} tone="gold" icon="👥" />
        <KpiCard label="Total monthly cost" value={inr(monthlyCost)} sub="active fixed / typical salaries" tone="success" icon="💰" />
        <KpiCard label="On PF" value={String(pfCount)} sub={`${Math.max(0, activeEmps.length - pfCount)} without PF`} tone="neutral" icon="🏛" />
        <KpiCard label="Missing bank a/c" value={String(missingBank)} sub={missingBank > 0 ? "⚠ HDFC sheet will refuse" : "all active have a bank a/c"} tone={missingBank > 0 ? "danger" : "neutral"} icon="🏦" />
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
          No employees yet — ＋ Add employee to start (name, salary, bank a/c for the HDFC sheet, PF details).
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "26px 20px", textAlign: "center", color: "var(--muted)" }}>No employee matches &ldquo;{q}&rdquo;.</div>
      ) : (
        <div style={SALARY_TABLE.wrap}>
          <div style={SALARY_TABLE.scroll}>
            <table style={{ ...SALARY_TABLE.table, minWidth: 880 }}>
              <thead><tr>
                <th style={SALARY_TABLE.th}>Employee</th><th style={SALARY_TABLE.th}>Monthly salary</th><th style={SALARY_TABLE.th}>Bank</th><th style={SALARY_TABLE.th}>PF</th><th style={SALARY_TABLE.th}>Status</th><th style={{ ...SALARY_TABLE.th, textAlign: "right" }}>Actions</th>
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
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>⚠ no bank a/c — HDFC sheet will refuse</span>
                          )}
                        </td>
                        <td style={SALARY_TABLE.td}>
                          {e.pfEnabled ? (
                            <>
                              <Pill label={`PF ${e.pfPercent}%`} tone="success" />
                              {e.uan && <span style={{ fontSize: 10.5, color: "var(--muted)", display: "block", marginTop: 3, fontFamily: "ui-monospace, monospace" }}>UAN {e.uan}</span>}
                            </>
                          ) : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
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

/* ── 💵 Pay month ──────────────────────────────────────────────────── */

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

function MonthTab({ monthYm, rows, isBoss, onPickMonth, monthBusy, onEditRow, activeCount }: {
  monthYm: string; rows: SalaryPaymentRow[]; isBoss: boolean;
  onPickMonth: (ym: string) => void; monthBusy: boolean; onEditRow: (r: SalaryPaymentRow) => void; activeCount: number;
}) {
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const draft = rows.filter((r) => r.status === "draft");
  const paid = rows.filter((r) => r.status === "paid");
  const tot = rows.reduce((a, r) => ({ gross: a.gross + r.gross, pf: a.pf + r.pfAmount, net: a.net + r.net }), { gross: 0, pf: 0, net: 0 });
  // "Net to pay" must equal exactly what the HDFC sheet carries = DRAFT rows.
  const draftNet = draft.reduce((a, r) => a + r.net, 0);
  const paidNet = paid.reduce((a, r) => a + r.net, 0);
  const missingBank = draft.filter((r) => !r.hasBank);
  // A Worker with no attendance yet earns ₹0 — block the bank sheet until the
  // accountant records days present for EVERY worker in the month (Daksh).
  const workersNoAttendance = draft.filter((r) => r.salaryType === "variable" && r.attendanceDays == null);
  const hdfcReady = draft.length > 0 && workersNoAttendance.length === 0;
  // Search filters only the visible TABLE — the KPI cards + HDFC sheet stay over
  // the whole month (they're the payment source of truth).
  const needle = q.trim().toLowerCase();
  const shownRows = needle ? rows.filter((r) => [r.employeeName, r.designation, r.organization].some((v) => (v ?? "").toLowerCase().includes(needle))) : rows;
  const shownTot = shownRows.reduce((a, r) => ({ gross: a.gross + r.gross, pf: a.pf + r.pfAmount, net: a.net + r.net }), { gross: 0, pf: 0, net: 0 });
  // Group the table by Organization → Designation, each header showing its own
  // Net-to-pay total (same grouping as the Employees / PF tabs).
  const { orgGroups, showOrg } = groupByOrgDesig(shownRows, (r) => r.organization, (r) => r.designation);
  const groupNet = (emps: SalaryPaymentRow[]) => emps.reduce((a, r) => a + r.net, 0);

  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", background: "var(--bg)" };
  const thL: React.CSSProperties = { ...th, textAlign: "left" };
  const td: React.CSSProperties = { padding: "9px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
  const tdL: React.CSSProperties = { ...td, textAlign: "left", fontFamily: "inherit" };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={lbl}>Salary month{monthBusy ? " · loading…" : ""}</span>
          <div style={{ display: "inline-flex", alignItems: "stretch", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden", background: "var(--bg)", opacity: monthBusy ? 0.6 : 1 }}>
            <button type="button" disabled={monthBusy} onClick={() => onPickMonth(shiftMonth(monthYm, -1))} title="Previous month" style={{ padding: "0 13px", fontSize: 18, fontWeight: 800, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: monthBusy ? "wait" : "pointer" }}>‹</button>
            <input type="month" value={monthYm} disabled={monthBusy} onChange={(e) => e.target.value && onPickMonth(e.target.value)} style={{ ...inp, width: 150, fontWeight: 700, border: "none", borderRadius: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }} />
            <button type="button" disabled={monthBusy} onClick={() => onPickMonth(shiftMonth(monthYm, 1))} title="Next month" style={{ padding: "0 13px", fontSize: 18, fontWeight: 800, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: monthBusy ? "wait" : "pointer" }}>›</button>
          </div>
        </label>
        <form action={prepareSalaryMonthAction}>
          <input type="hidden" name="month" value={monthYm} />
          <ReturnCtx monthYm={monthYm} tab="month" />
          <FormPending label="Preparing month…" />
          <button type="submit" style={{ ...btnPrimary, background: "var(--gold-dark)" }} title="One draft row per active employee (skips employees already in the month)">⚙ Prepare month · {activeCount} active</button>
        </form>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href={hdfcReady ? `/api/salary/hdfc-export?month=${monthYm}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { if (!hdfcReady) e.preventDefault(); }}
            aria-disabled={!hdfcReady}
            style={{ ...btnPrimary, background: hdfcReady ? "#15803d" : "var(--border)", color: hdfcReady ? "#fff" : "var(--muted)", textDecoration: "none", pointerEvents: hdfcReady ? "auto" : "none", opacity: hdfcReady ? 1 : 0.7 }}
            title={workersNoAttendance.length > 0 ? `Add attendance for ${workersNoAttendance.length} worker${workersNoAttendance.length === 1 ? "" : "s"} first` : draft.length === 0 ? "No draft rows to pay" : "HDFC ENet Bulk Payment sheet — same format Finance uploads"}
          >
            ⬇ HDFC bank sheet · {draft.length}
          </a>
          <PfExportControl monthYm={monthYm} rows={rows} />
          {confirmPaid ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>Paid from the bank — mark {draft.length} row{draft.length !== 1 ? "s" : ""} PAID?</span>
              <form action={markSalaryMonthPaidAction} style={{ display: "inline" }}>
                <input type="hidden" name="month" value={monthYm} />
                <ReturnCtx monthYm={monthYm} tab="month" />
                <FormPending label="Marking paid…" />
                <button type="submit" style={{ ...btnPrimary, background: "#15803d" }}>Yes, mark paid</button>
              </form>
              <button type="button" onClick={() => setConfirmPaid(false)} style={btnGhost}>No</button>
            </span>
          ) : (
            <button type="button" disabled={draft.length === 0} onClick={() => setConfirmPaid(true)} style={{ ...btnGhost, opacity: draft.length ? 1 : 0.5 }}>✓ Mark month paid</button>
          )}
        </span>
      </div>

      {workersNoAttendance.length > 0 && (
        <div style={{ marginBottom: 12, border: "1px solid rgba(217,119,6,0.4)", borderRadius: 10, background: "rgba(217,119,6,0.08)", padding: "9px 13px", fontSize: 12, fontWeight: 700, color: "#b45309" }}>
          ⏱ Add attendance for {workersNoAttendance.length} worker{workersNoAttendance.length === 1 ? "" : "s"} before downloading the HDFC bank sheet: {workersNoAttendance.map((r) => r.employeeName).join(", ")} — open each row (✎) and enter days present.
        </div>
      )}

      {missingBank.length > 0 && (
        <div style={{ marginBottom: 12, border: "1px solid rgba(220,38,38,0.35)", borderRadius: 10, background: "rgba(220,38,38,0.06)", padding: "9px 13px", fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>
          ⚠ Missing bank details: {missingBank.map((r) => r.employeeName).join(", ")} — the HDFC sheet will refuse until filled (Employees tab → ✎ Edit).
        </div>
      )}

      {/* Totals — Finance-grade KPI row. Net-to-pay stays DRAFT-only (= HDFC sheet). */}
      <KpiRow>
        <KpiCard label={`${monthLabel(monthYm)} · rows`} value={String(rows.length)} sub={`${draft.length} draft · ${paid.length} paid`} tone="neutral" icon="📄" />
        <KpiCard label="Gross total" value={inr(tot.gross)} tone="gold" icon="💰" />
        <KpiCard label="PF deducted" value={inr(tot.pf)} tone="neutral" icon="🏛" />
        <KpiCard
          label="Net to pay (draft)"
          value={inr(draftNet)}
          sub={missingBank.length > 0 ? `⚠ ${missingBank.length} missing bank a/c` : paidNet > 0 ? `+ ${inr(paidNet)} already paid` : "= the HDFC bank sheet"}
          tone={missingBank.length > 0 ? "danger" : "success"}
          icon="💸"
        />
      </KpiRow>

      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, designation, site…" style={{ ...inp, flex: "1 1 240px", maxWidth: 380 }} />
          {q && <span style={{ fontSize: 12, color: "var(--muted)" }}>{shownRows.length} of {rows.length}</span>}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          No rows for {monthLabel(monthYm)} yet — hit <strong>⚙ Prepare month</strong> to draft one row per active employee.
        </div>
      ) : shownRows.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "26px 20px", textAlign: "center", color: "var(--muted)" }}>No row matches &ldquo;{q}&rdquo;.</div>
      ) : (
        <div style={SALARY_TABLE.wrap}>
          <div style={SALARY_TABLE.scroll}>
            <table style={{ ...SALARY_TABLE.table, minWidth: 900 }}>
              <thead><tr>
                <th style={thL}>Employee</th><th style={th}>Gross</th><th style={th}>PF −</th><th style={th}>Deduction −</th><th style={th}>Addition +</th><th style={th}>Net pay</th><th style={thL}>Status</th><th style={{ ...th }}>Actions</th>
              </tr></thead>
              <tbody>
                {orgGroups.map((og) => {
                  const oc = designationColor(og.org);
                  const orgNet = og.desigGroups.reduce((s, [, emps]) => s + groupNet(emps), 0);
                  return (
                  <Fragment key={og.org}>
                    {showOrg && (
                      <tr>
                        <td colSpan={8} style={{ padding: "9px 12px", background: oc.bg, color: oc.fg, borderTop: "2px solid var(--border)", borderLeft: `4px solid ${oc.fg}`, borderBottom: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.03em" }}>🏢 {og.org} <span style={{ opacity: 0.7, fontWeight: 700 }}>· {og.count} employee{og.count === 1 ? "" : "s"}</span></span>
                            <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>Net {inr(orgNet)}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {og.desigGroups.map(([desig, emps]) => {
                      const dc = designationColor(desig);
                      return (
                      <Fragment key={desig}>
                        <tr>
                          <td colSpan={8} style={{ padding: "7px 12px", paddingLeft: showOrg ? 26 : 12, background: dc.bg, color: dc.fg, borderLeft: `3px solid ${dc.fg}`, borderBottom: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{desig} <span style={{ opacity: 0.7 }}>· {emps.length}</span></span>
                              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>Net to pay {inr(groupNet(emps))}</span>
                            </div>
                          </td>
                        </tr>
                        {emps.map((r) => (
                  <tr key={r.id} style={{ background: r.status === "paid" ? "rgba(22,101,52,0.05)" : undefined }}>
                    <td style={tdL}>
                      <span style={{ fontWeight: 800 }}>{!r.hasBank && r.status === "draft" ? "⚠ " : ""}{r.employeeName}</span>
                      <span style={{ display: "block", marginTop: 4 }}><DesigChip name={r.designation} size="sm" /></span>
                      {r.note && <span style={{ fontSize: 11, color: "var(--muted)", display: "block", marginTop: 3 }}>📝 {r.note}</span>}
                    </td>
                    <td style={td}>{inr(r.gross)}</td>
                    <td style={td}>{r.pfAmount ? inr(r.pfAmount) : "—"}</td>
                    <td style={td}>{r.otherDeduction ? inr(r.otherDeduction) : "—"}</td>
                    <td style={td}>{r.addition ? inr(r.addition) : "—"}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{inr(r.net)}</td>
                    <td style={tdL}>
                      <Pill label={r.status === "paid" ? "✓ Paid" : "Draft"} tone={r.status === "paid" ? "success" : "warn"} />
                      {r.status === "paid" && dayShort(r.paidAt) && <span style={{ display: "block", fontSize: 10, color: "var(--muted)", marginTop: 3 }}>on {dayShort(r.paidAt)}</span>}
                    </td>
                    <td style={{ ...td, fontFamily: "inherit" }}>
                      {r.status === "draft" ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button type="button" onClick={() => onEditRow(r)} style={{ ...btnGhost, padding: "5px 10px" }}>✎</button>
                          {confirmRemove === r.id ? (
                            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                              <form action={removeSalaryPaymentAction} style={{ display: "inline" }}>
                                <input type="hidden" name="id" value={r.id} />
                                <ReturnCtx monthYm={monthYm} tab="month" />
                                <FormPending label="Removing…" />
                                <button type="submit" style={{ ...btnGhost, padding: "5px 10px", color: "#fff", background: "#b91c1c", border: "none" }}>Yes</button>
                              </form>
                              <button type="button" onClick={() => setConfirmRemove(null)} style={{ ...btnGhost, padding: "5px 10px" }}>No</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setConfirmRemove(r.id)} title="Skip this employee this month" style={{ ...btnGhost, padding: "5px 10px", color: "#b91c1c" }}>✕</button>
                          )}
                        </span>
                      ) : isBoss ? (
                        <form action={unmarkSalaryPaymentPaidAction} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={r.id} />
                          <ReturnCtx monthYm={monthYm} tab="month" />
                          <FormPending label="Reverting…" />
                          <button type="submit" title="Owner only — move back to draft" style={{ ...btnGhost, padding: "5px 10px" }}>↩</button>
                        </form>
                      ) : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>}
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
              <tfoot>
                <tr style={{ background: "var(--bg)", fontWeight: 800 }}>
                  <td style={tdL}>TOTAL — {shownRows.length}{needle ? ` of ${rows.length}` : ""} employee{shownRows.length !== 1 ? "s" : ""}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{inr(shownTot.gross)}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{inr(shownTot.pf)}</td>
                  <td style={td}></td><td style={td}></td>
                  <td style={{ ...td, fontWeight: 800 }}>{inr(shownTot.net)}</td>
                  <td style={tdL} colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 🏦 PF record ──────────────────────────────────────────────────── */

function PfTab({ employees, pfRows }: { employees: SalaryEmployee[]; pfRows: PfRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const byEmp = useMemo(() => {
    const m = new Map<string, PfRow[]>();
    for (const r of pfRows) { const a = m.get(r.employeeId) ?? []; a.push(r); m.set(r.employeeId, a); }
    return m;
  }, [pfRows]);
  const withPf = employees.filter((e) => e.pfEnabled || byEmp.has(e.id));
  const grandTotal = pfRows.reduce((a, r) => a + r.pfAmount, 0);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? withPf.filter((e) => [e.name, e.designation, e.organization, e.uan, e.accountNumber].some((v) => (v ?? "").toLowerCase().includes(needle)))
    : withPf;
  // Same Organization → Designation grouping as the Employees tab.
  const { orgGroups, showOrg } = groupByOrgDesig(filtered, (e) => e.organization, (e) => e.designation);

  // One employee's collapsible PF card. Called inline (not <Card/>) so it never
  // remounts — grouping just wraps these.
  const card = (e: SalaryEmployee) => {
    const rows = (byEmp.get(e.id) ?? []).slice().sort((a, b) => b.month.localeCompare(a.month));
    const total = rows.reduce((a, r) => a + r.pfAmount, 0);
    const isOpen = open === e.id;
    const dc = designationColor(e.designation);
    return (
      <div key={e.id} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${dc.fg}`, borderRadius: 12, overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow)" }}>
        <button type="button" onClick={() => setOpen(isOpen ? null : e.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
          <span style={{ fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s", color: dc.fg }}>▶</span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{e.name}</span>
          <DesigChip name={e.designation} size="sm" />
          {e.uan && <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>UAN {e.uan}</span>}
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{e.pfEnabled ? `PF ${e.pfPercent}%` : "PF off now"} · {rows.length} month{rows.length !== 1 ? "s" : ""}</span>
          <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: "#15803d" }}>{inr(total)}</span>
        </button>
        {isOpen && (
          <div style={{ padding: "8px 14px 14px" }}>
            {rows.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing deducted yet — appears once a month with PF is marked paid.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 7 }}>
                {rows.map((r) => (
                  <div key={r.month} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "7px 11px", background: "var(--bg)" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>{monthShort(r.month)}</div>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5 }}>{inr(r.pfAmount)}</div>
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
        <KpiCard label="Employees with PF" value={String(withPf.length)} tone="neutral" icon="🏛" />
        <KpiCard label="PF deducted till date" value={inr(grandTotal)} sub="employee share, from paid months" tone="success" icon="💰" />
      </KpiRow>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12 }}>
        The record below is the <strong>employee share deducted</strong> from paid salaries. The employer contributes an equal share on top when depositing to EPFO.
      </div>
      {withPf.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, designation, site, UAN…" style={{ ...inp, flex: "1 1 240px", maxWidth: 380 }} />
          {q && <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} of {withPf.length}</span>}
        </div>
      )}
      {withPf.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          No PF yet — enable PF on an employee (Employees tab → ✎ Edit) and pay a month; the record builds itself.
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

function EmployeeModal({ emp, organizations, designations, monthYm, onClose }: { emp: SalaryEmployee | null; organizations: string[]; designations: string[]; monthYm: string; onClose: () => void }) {
  // New employees default to PF ON (Daksh); editing keeps the employee's own value.
  const [pfOn, setPfOn] = useState(emp ? emp.pfEnabled : true);
  const [organization, setOrganization] = useState(emp?.organization ?? "");
  const [designation, setDesignation] = useState(emp?.designation ?? "");
  // Salary type is DERIVED from the designation now — no hand-set toggle.
  const employeeIsWorker = isWorkerDesignation(designation);
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto" }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 14 }}>{emp ? `✎ ${emp.name}` : "＋ Add employee"}</div>
        <form action={upsertSalaryEmployeeAction} autoComplete="off">
          {emp && <input type="hidden" name="id" value={emp.id} />}
          <ReturnCtx monthYm={monthYm} tab="employees" />
          <FormPending label={emp ? "Saving employee…" : "Adding employee…"} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <label><span style={lbl}>Name *</span><input name="name" required defaultValue={emp?.name ?? ""} style={inp} /></label>
            <label><span style={lbl}>Father / husband name</span><input name="father_name" defaultValue={emp?.fatherName ?? ""} style={inp} /></label>
            <label>
              <span style={lbl}>Organization / site</span>
              <Combobox value={organization} onChange={setOrganization} options={organizations} name="organization" placeholder="e.g. Main Office, Ram Mandir Site…" inputStyle={inp} />
            </label>
            <label>
              <span style={lbl}>Designation</span>
              <Combobox value={designation} onChange={setDesignation} options={designations} name="designation" placeholder="Pick or type a new one…" inputStyle={inp} />
            </label>
            <label><span style={lbl}>Phone</span><input name="phone" defaultValue={emp?.phone ?? ""} style={inp} /></label>
            <label><span style={lbl}>Aadhaar no.</span><input name="aadhaar" inputMode="numeric" maxLength={12} defaultValue={emp?.aadhaar ?? ""} placeholder="12 digits" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
            <label><span style={lbl}>Joined on</span><input type="date" name="joined_on" defaultValue={emp?.joinedOn ?? ""} style={inp} /></label>
          </div>

          <div style={{ margin: "16px 0 8px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold-dark)" }}>💰 Salary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, alignItems: "end" }}>
            <label>
              <span style={lbl}>Monthly salary (₹) *</span>
              <input name="monthly_salary" required inputMode="decimal" defaultValue={emp?.monthlySalary ? String(emp.monthlySalary) : ""} style={inp} />
            </label>
          </div>
          <div style={{ fontSize: 11, marginTop: 8, padding: "9px 12px", borderRadius: 9, border: "1px solid var(--border)", background: employeeIsWorker ? "rgba(217,119,6,0.08)" : "var(--bg)", color: "var(--muted)", lineHeight: 1.5 }}>
            {employeeIsWorker ? (
              <><b style={{ color: "#b45309" }}>⏱ Worker — paid by attendance.</b> The full-month salary above is prorated by days present each month (e.g. 20 of 30 days → 20⁄30 of the salary). Enter attendance on the Pay-month row.</>
            ) : (
              <><b style={{ color: "var(--gold-dark)" }}>Fixed salary.</b> The full amount is paid every month, whatever the attendance. Set the designation to <b>Worker</b> to pay by attendance instead.</>
            )}
          </div>

          <div style={{ margin: "16px 0 8px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold-dark)" }}>🏦 Bank — for the HDFC sheet</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <label><span style={lbl}>Bank name</span><input name="bank_name" defaultValue={emp?.bankName ?? ""} style={inp} /></label>
            <label><span style={lbl}>Account number</span><input name="account_number" defaultValue={emp?.accountNumber ?? ""} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
            <label><span style={lbl}>IFSC</span><input name="ifsc" defaultValue={emp?.ifsc ?? ""} style={{ ...inp, textTransform: "uppercase", fontFamily: "ui-monospace, monospace" }} /></label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span style={lbl}>Beneficiary name (bank sheet)</span>
              <input name="beneficiary_name" defaultValue={emp?.beneficiaryName ?? ""} placeholder="Auto from name if left blank" style={{ ...inp, textTransform: "uppercase" }} />
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Max 20 chars, A–Z 0–9 space period — must match the bank&apos;s beneficiary registration.</span>
            </label>
          </div>

          <div style={{ margin: "16px 0 8px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold-dark)" }}>🏛 PF</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, alignItems: "end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", cursor: "pointer" }}>
              <input type="checkbox" name="pf_enabled" value="1" checked={pfOn} onChange={(e) => setPfOn(e.target.checked)} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>PF applicable</span>
            </label>
            <label><span style={lbl}>UAN / PF number</span><input name="uan" defaultValue={emp?.uan ?? ""} disabled={!pfOn} style={{ ...inp, fontFamily: "ui-monospace, monospace", opacity: pfOn ? 1 : 0.5 }} /></label>
            <label><span style={lbl}>PF % (employee share)</span><input name="pf_percent" inputMode="decimal" defaultValue={String(emp?.pfPercent ?? 12)} disabled={!pfOn} style={{ ...inp, opacity: pfOn ? 1 : 0.5 }} /></label>
          </div>

          <label style={{ display: "block", marginTop: 12 }}><span style={lbl}>Notes</span><input name="notes" defaultValue={emp?.notes ?? ""} style={inp} /></label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" style={btnPrimary}>{emp ? "✓ Save employee" : "＋ Add employee"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RowModal({ row, monthYm, onClose }: { row: SalaryPaymentRow; monthYm: string; onClose: () => void }) {
  const isWorker = row.salaryType === "variable";
  const days = daysInSalaryMonth(monthYm);
  const [attendance, setAttendance] = useState(row.attendanceDays != null ? String(row.attendanceDays) : "");
  const [otHours, setOtHours] = useState(row.otHours != null ? String(row.otHours) : "");
  // OT is now hours × per-hour rate. The rate isn't stored separately — derive
  // it from the saved amount ÷ hours so re-opening the row shows it again.
  const [otRate, setOtRate] = useState(row.otHours && row.otAmount && Number(row.otHours) > 0 ? String(Math.round((row.otAmount / row.otHours) * 100) / 100) : "");
  const [advance, setAdvance] = useState(String(row.advance || ""));
  const [ded, setDed] = useState(String(row.otherDeduction || ""));
  const [add, setAdd] = useState(String(row.addition || ""));
  const n = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const attendanceNum = attendance.trim() === "" ? null : n(attendance);
  // Gross + PF are DERIVED (the server recomputes them identically on save):
  //   fixed  → full monthly salary; worker → salary × attendance ÷ days-in-month.
  const gross = earnedSalary({ monthlySalary: row.monthlySalary, salaryType: row.salaryType, attendanceDays: attendanceNum, monthKey: monthYm });
  const pf = computePf(gross, row.pfPercent, row.pfEnabled);
  // OT amount = total OT hours × per-hour rate (flows into net).
  const otAmount = Math.round(n(otHours) * n(otRate) * 100) / 100;
  const net = Math.round((gross - pf + otAmount - n(advance) - n(ded) + n(add)) * 100) / 100;
  const readBox: React.CSSProperties = { ...inp, background: "var(--surface)", fontFamily: "ui-monospace, monospace", fontWeight: 800, display: "flex", alignItems: "center", minHeight: 38 };
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 2 }}>✎ {row.employeeName}
          {isWorker
            ? <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", marginLeft: 8 }}>⏱ BY ATTENDANCE</span>
            : <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", marginLeft: 8 }}>FIXED</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14 }}>
          {isWorker
            ? `Worker — ${inr(row.monthlySalary)} for a full ${days}-day month, prorated by days present. Enter attendance; net recalculates live.`
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
                {isWorker ? (attendanceNum == null ? "enter attendance →" : `${inr(row.monthlySalary)} × ${attendanceNum}⁄${days} days`) : "full fixed salary"}
              </span>
            </div>
            <div>
              <span style={lbl}>PF deduction − (₹)</span>
              <div style={readBox}>{inr(pf)}</div>
              <span style={{ fontSize: 10, color: "var(--muted)", display: "block", marginTop: 3 }}>
                {row.pfEnabled ? `${row.pfPercent}% of min(earned, ${inr(PF_WAGE_CEILING)})` : "PF not applicable"}
              </span>
            </div>
            <label><span style={lbl}>Attendance days{isWorker ? " *" : ""}</span><input name="attendance_days" inputMode="decimal" value={attendance} onChange={(e) => setAttendance(e.target.value)} placeholder={isWorker ? `days present of ${days}` : "info only — doesn't change fixed pay"} style={inp} /></label>
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
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6, textAlign: "right" }}>Earned − PF + OT − Advance − Deduction + Addition</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" style={btnPrimary}>✓ Save row</button>
          </div>
        </form>
      </div>
    </div>
  );
}

