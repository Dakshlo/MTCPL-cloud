"use client";

/**
 * Salary / PF department client (mig 189, Daksh Jul 2026).
 *
 * Tabs: 👥 Employees · 💵 Pay month · 🏦 PF record.
 * Forms post straight to the server actions (redirect + ?toast=), matching the
 * house pattern; the MTCPL spinner shows while a form is in flight.
 */

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { Combobox } from "@/app/(app)/invoicing/_ui/combobox";
import { PF_WAGE_CEILING } from "@/lib/salary-permissions";
import {
  upsertSalaryEmployeeAction, toggleSalaryEmployeeAction, deleteSalaryEmployeeAction,
  prepareSalaryMonthAction, updateSalaryPaymentAction, removeSalaryPaymentAction,
  markSalaryMonthPaidAction, unmarkSalaryPaymentPaidAction,
} from "./actions";

export type SalaryEmployee = {
  id: string; name: string; designation: string | null; fatherName: string | null; phone: string | null; aadhaar: string | null;
  bankName: string | null; accountNumber: string | null; ifsc: string | null; beneficiaryName: string | null;
  monthlySalary: number; salaryType: "fixed" | "variable"; pfEnabled: boolean; uan: string | null; pfPercent: number;
  joinedOn: string | null; isActive: boolean; notes: string | null;
};
export type SalaryPaymentRow = {
  id: string; employeeId: string; employeeName: string; designation: string | null; salaryType: "fixed" | "variable"; hasBank: boolean;
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

const inp: React.CSSProperties = { padding: "9px 11px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)", width: "100%" };
const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", display: "block", marginBottom: 4 };
const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#0f172a", cursor: "pointer", whiteSpace: "nowrap" };
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" };

function FormPending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label={label} />;
}

export function SalaryClient({ me, employees, designations, monthYm, monthRows, pfRows, initialTab }: {
  me: { id: string; isBoss: boolean };
  employees: SalaryEmployee[];
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

  const active = employees.filter((e) => e.isActive);
  const seg = (a: boolean): React.CSSProperties => ({ fontSize: 13, fontWeight: 800, padding: "9px 16px", borderRadius: 10, cursor: "pointer", border: "none", background: a ? "var(--gold)" : "transparent", color: a ? "#fff" : "var(--muted)" });

  return (
    <div>
      {/* Hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>💵 Salary / PF</h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", padding: "3px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999 }}>
          {active.length} active employee{active.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--muted)" }}>
        Employee master → prepare the month → download the HDFC bulk-payment sheet (same format as Finance) → pay from the bank → mark paid. PF record builds itself from paid months.
      </p>

      <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setTab("employees")} style={seg(tab === "employees")}>👥 Employees · {employees.length}</button>
        <button type="button" onClick={() => setTab("month")} style={seg(tab === "month")}>💵 Pay month · {monthRows.length}</button>
        <button type="button" onClick={() => setTab("pf")} style={seg(tab === "pf")}>🏦 PF record</button>
      </div>

      {tab === "employees" && <EmployeesTab employees={employees} isBoss={me.isBoss} monthYm={monthYm} onEdit={setEditEmp} />}
      {tab === "month" && <MonthTab monthYm={monthYm} rows={monthRows} isBoss={me.isBoss} onPickMonth={(ym) => router.push(`/salary?month=${ym}&tab=month`)} onEditRow={setEditRow} activeCount={active.length} />}
      {tab === "pf" && <PfTab employees={employees} pfRows={pfRows} />}

      {editEmp && <EmployeeModal emp={editEmp === "new" ? null : editEmp} designations={designations} monthYm={monthYm} onClose={() => setEditEmp(null)} />}
      {editRow && <RowModal row={editRow} monthYm={monthYm} onClose={() => setEditRow(null)} />}
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

function EmployeesTab({ employees, isBoss, monthYm, onEdit }: { employees: SalaryEmployee[]; isBoss: boolean; monthYm: string; onEdit: (e: SalaryEmployee | "new") => void }) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", background: "var(--bg)" };
  const td: React.CSSProperties = { padding: "10px", fontSize: 12.5, borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
  // Group by designation (Daksh) — sorted, "No designation" last.
  const groups = useMemo(() => {
    const m = new Map<string, SalaryEmployee[]>();
    for (const e of employees) { const k = (e.designation ?? "").trim() || "— No designation"; const a = m.get(k) ?? []; a.push(e); m.set(k, a); }
    return [...m.entries()].sort((a, b) => (a[0].startsWith("—") ? 1 : 0) - (b[0].startsWith("—") ? 1 : 0) || a[0].localeCompare(b[0]));
  }, [employees]);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button type="button" onClick={() => onEdit("new")} style={{ ...btnPrimary, background: "var(--gold-dark)" }}>＋ Add employee</button>
      </div>
      {employees.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          No employees yet — ＋ Add employee to start (name, salary, bank a/c for the HDFC sheet, PF details).
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
              <thead><tr>
                <th style={th}>Employee</th><th style={th}>Monthly salary</th><th style={th}>Bank</th><th style={th}>PF</th><th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr></thead>
              <tbody>
                {groups.map(([desig, emps]) => (
                  <Fragment key={desig}>
                    <tr>
                      <td colSpan={6} style={{ padding: "7px 12px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold-dark)", background: "rgba(201,161,74,0.08)", borderBottom: "1px solid var(--border)" }}>
                        {desig} <span style={{ color: "var(--muted)", fontWeight: 700 }}>· {emps.length}</span>
                      </td>
                    </tr>
                    {emps.map((e) => (
                  <tr key={e.id} style={{ opacity: e.isActive ? 1 : 0.55 }}>
                    <td style={td}>
                      <span style={{ fontWeight: 800, display: "block" }}>{e.name}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{[e.designation, e.phone].filter(Boolean).join(" · ") || "—"}</span>
                    </td>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>
                      {inr(e.monthlySalary)}
                      <span style={{ display: "block", fontFamily: "inherit", fontSize: 10, fontWeight: 800, marginTop: 2, color: e.salaryType === "variable" ? "#b45309" : "var(--muted)" }}>{e.salaryType === "variable" ? "↕ VARIABLE" : "FIXED"}</span>
                    </td>
                    <td style={td}>
                      {e.accountNumber ? (
                        <>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, display: "block" }}>{e.accountNumber}</span>
                          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{[e.bankName, e.ifsc].filter(Boolean).join(" · ")}{e.beneficiaryName ? ` · ${e.beneficiaryName}` : ""}</span>
                        </>
                      ) : (
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>⚠ no bank a/c — HDFC sheet will refuse</span>
                      )}
                    </td>
                    <td style={td}>
                      {e.pfEnabled ? (
                        <>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.1)", borderRadius: 999, padding: "2px 9px" }}>PF {e.pfPercent}%</span>
                          {e.uan && <span style={{ fontSize: 10.5, color: "var(--muted)", display: "block", marginTop: 3, fontFamily: "ui-monospace, monospace" }}>UAN {e.uan}</span>}
                        </>
                      ) : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: e.isActive ? "#15803d" : "var(--muted)", background: e.isActive ? "rgba(22,101,52,0.1)" : "var(--bg)", borderRadius: 999, padding: "2px 9px" }}>{e.isActive ? "Active" : "Inactive"}</span>
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 💵 Pay month ──────────────────────────────────────────────────── */

function MonthTab({ monthYm, rows, isBoss, onPickMonth, onEditRow, activeCount }: {
  monthYm: string; rows: SalaryPaymentRow[]; isBoss: boolean;
  onPickMonth: (ym: string) => void; onEditRow: (r: SalaryPaymentRow) => void; activeCount: number;
}) {
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const draft = rows.filter((r) => r.status === "draft");
  const paid = rows.filter((r) => r.status === "paid");
  const tot = rows.reduce((a, r) => ({ gross: a.gross + r.gross, pf: a.pf + r.pfAmount, net: a.net + r.net }), { gross: 0, pf: 0, net: 0 });
  // "Net to pay" must equal exactly what the HDFC sheet carries = DRAFT rows.
  const draftNet = draft.reduce((a, r) => a + r.net, 0);
  const paidNet = paid.reduce((a, r) => a + r.net, 0);
  const missingBank = draft.filter((r) => !r.hasBank);

  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", background: "var(--bg)" };
  const thL: React.CSSProperties = { ...th, textAlign: "left" };
  const td: React.CSSProperties = { padding: "9px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
  const tdL: React.CSSProperties = { ...td, textAlign: "left", fontFamily: "inherit" };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={lbl}>Salary month</span>
          <input type="month" value={monthYm} onChange={(e) => e.target.value && onPickMonth(e.target.value)} style={{ ...inp, width: 170, fontWeight: 700 }} />
        </label>
        <form action={prepareSalaryMonthAction}>
          <input type="hidden" name="month" value={monthYm} />
          <ReturnCtx monthYm={monthYm} tab="month" />
          <FormPending label="Preparing month…" />
          <button type="submit" style={{ ...btnPrimary, background: "var(--gold-dark)" }} title="One draft row per active employee (skips employees already in the month)">⚙ Prepare month · {activeCount} active</button>
        </form>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href={`/api/salary/hdfc-export?month=${monthYm}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btnPrimary, background: draft.length ? "#15803d" : "var(--border)", textDecoration: "none", pointerEvents: draft.length ? "auto" : "none" }}
            title="HDFC ENet Bulk Payment sheet — same format Finance uploads"
          >
            ⬇ HDFC bank sheet · {draft.length}
          </a>
          <a
            href={`/api/salary/pf-export?month=${monthYm}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btnPrimary, background: rows.length ? "#6b4652" : "var(--border)", textDecoration: "none", pointerEvents: rows.length ? "auto" : "none" }}
            title="Monthly Salary & PF register — the PF handler's format"
          >
            ⬇ PF register
          </a>
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

      {missingBank.length > 0 && (
        <div style={{ marginBottom: 12, border: "1px solid rgba(220,38,38,0.35)", borderRadius: 10, background: "rgba(220,38,38,0.06)", padding: "9px 13px", fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>
          ⚠ Missing bank details: {missingBank.map((r) => r.employeeName).join(", ")} — the HDFC sheet will refuse until filled (Employees tab → ✎ Edit).
        </div>
      )}

      {/* Totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Tile label={`${monthLabel(monthYm)} — rows`} value={`${rows.length}`} sub={`${draft.length} draft · ${paid.length} paid`} />
        <Tile label="Gross total" value={inr(tot.gross)} />
        <Tile label="PF deducted" value={inr(tot.pf)} />
        {/* Matches the HDFC sheet exactly — DRAFT rows only. */}
        <Tile label="Net to pay (draft)" value={inr(draftNet)} sub={paidNet > 0 ? `+ ${inr(paidNet)} already paid` : undefined} strong />
      </div>

      {rows.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          No rows for {monthLabel(monthYm)} yet — hit <strong>⚙ Prepare month</strong> to draft one row per active employee.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead><tr>
                <th style={thL}>Employee</th><th style={th}>Gross</th><th style={th}>PF −</th><th style={th}>Deduction −</th><th style={th}>Addition +</th><th style={th}>Net pay</th><th style={thL}>Status</th><th style={{ ...th }}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ background: r.status === "paid" ? "rgba(22,101,52,0.05)" : undefined }}>
                    <td style={tdL}>
                      <span style={{ fontWeight: 800 }}>{!r.hasBank && r.status === "draft" ? "⚠ " : ""}{r.employeeName}</span>
                      {r.note && <span style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>📝 {r.note}</span>}
                    </td>
                    <td style={td}>{inr(r.gross)}</td>
                    <td style={td}>{r.pfAmount ? inr(r.pfAmount) : "—"}</td>
                    <td style={td}>{r.otherDeduction ? inr(r.otherDeduction) : "—"}</td>
                    <td style={td}>{r.addition ? inr(r.addition) : "—"}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{inr(r.net)}</td>
                    <td style={tdL}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: r.status === "paid" ? "#15803d" : "#b45309", background: r.status === "paid" ? "rgba(22,101,52,0.1)" : "rgba(217,119,6,0.12)", borderRadius: 999, padding: "2px 9px" }}>
                        {r.status === "paid" ? "✓ Paid" : "Draft"}
                      </span>
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
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--bg)", fontWeight: 800 }}>
                  <td style={tdL}>TOTAL — {rows.length} employee{rows.length !== 1 ? "s" : ""}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{inr(tot.gross)}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{inr(tot.pf)}</td>
                  <td style={td}></td><td style={td}></td>
                  <td style={{ ...td, fontWeight: 800 }}>{inr(tot.net)}</td>
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
  const byEmp = useMemo(() => {
    const m = new Map<string, PfRow[]>();
    for (const r of pfRows) { const a = m.get(r.employeeId) ?? []; a.push(r); m.set(r.employeeId, a); }
    return m;
  }, [pfRows]);
  const withPf = employees.filter((e) => e.pfEnabled || byEmp.has(e.id));
  const grandTotal = pfRows.reduce((a, r) => a + r.pfAmount, 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Tile label="Employees with PF" value={String(withPf.length)} />
        <Tile label="PF deducted till date" value={inr(grandTotal)} strong sub="employee share, from paid months" />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12 }}>
        The record below is the <strong>employee share deducted</strong> from paid salaries. The employer contributes an equal share on top when depositing to EPFO.
      </div>
      {withPf.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
          No PF yet — enable PF on an employee (Employees tab → ✎ Edit) and pay a month; the record builds itself.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {withPf.map((e) => {
            const rows = (byEmp.get(e.id) ?? []).slice().sort((a, b) => b.month.localeCompare(a.month));
            const total = rows.reduce((a, r) => a + r.pfAmount, 0);
            const isOpen = open === e.id;
            return (
              <div key={e.id} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : e.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: "var(--bg)", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                  <span style={{ fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--gold-dark)" }}>▶</span>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{e.name}</span>
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
          })}
        </div>
      )}
    </div>
  );
}

/* ── Modals ────────────────────────────────────────────────────────── */

function EmployeeModal({ emp, designations, monthYm, onClose }: { emp: SalaryEmployee | null; designations: string[]; monthYm: string; onClose: () => void }) {
  const [pfOn, setPfOn] = useState(emp?.pfEnabled ?? false);
  const [designation, setDesignation] = useState(emp?.designation ?? "");
  const [salaryType, setSalaryType] = useState<"fixed" | "variable">(emp?.salaryType ?? "fixed");
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
              <span style={lbl}>Designation</span>
              <Combobox value={designation} onChange={setDesignation} options={designations} name="designation" placeholder="Pick or type a new one…" inputStyle={inp} />
            </label>
            <label><span style={lbl}>Phone</span><input name="phone" defaultValue={emp?.phone ?? ""} style={inp} /></label>
            <label><span style={lbl}>Aadhaar no.</span><input name="aadhaar" inputMode="numeric" maxLength={12} defaultValue={emp?.aadhaar ?? ""} placeholder="12 digits" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
            <label><span style={lbl}>Joined on</span><input type="date" name="joined_on" defaultValue={emp?.joinedOn ?? ""} style={inp} /></label>
          </div>

          <div style={{ margin: "16px 0 8px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gold-dark)" }}>💰 Salary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, alignItems: "end" }}>
            <div>
              <span style={lbl}>Salary type</span>
              <input type="hidden" name="salary_type" value={salaryType} />
              <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", width: "100%" }}>
                {(["fixed", "variable"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setSalaryType(t)} style={{ flex: 1, fontSize: 12.5, fontWeight: 800, padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: salaryType === t ? "var(--gold)" : "transparent", color: salaryType === t ? "#fff" : "var(--muted)" }}>
                    {t === "fixed" ? "Fixed" : "↕ Variable"}
                  </button>
                ))}
              </div>
            </div>
            <label>
              <span style={lbl}>{salaryType === "variable" ? "Typical salary (₹)" : "Monthly salary (₹) *"}</span>
              <input name="monthly_salary" required={salaryType === "fixed"} inputMode="decimal" defaultValue={emp?.monthlySalary ? String(emp.monthlySalary) : ""} style={inp} />
            </label>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
            {salaryType === "variable"
              ? "Variable — Prepare month drafts a ₹0 row; you type the actual amount for the month before paying."
              : "Fixed — Prepare month drafts this amount automatically every month."}
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
  const [gross, setGross] = useState(String(row.gross || ""));
  const [pf, setPf] = useState(String(row.pfAmount || ""));
  const [ot, setOt] = useState(String(row.otAmount || ""));
  const [advance, setAdvance] = useState(String(row.advance || ""));
  const [ded, setDed] = useState(String(row.otherDeduction || ""));
  const [add, setAdd] = useState(String(row.addition || ""));
  const n = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const net = Math.round((n(gross) - n(pf) + n(ot) - n(advance) - n(ded) + n(add)) * 100) / 100;
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 24px", boxShadow: "0 26px 60px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 2 }}>✎ {row.employeeName}{row.salaryType === "variable" && <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", marginLeft: 8 }}>↕ VARIABLE</span>}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14 }}>This month&apos;s amounts — net recalculates live. Attendance &amp; OT hours feed the PF register.</div>
        <form action={updateSalaryPaymentAction}>
          <input type="hidden" name="id" value={row.id} />
          <ReturnCtx monthYm={monthYm} tab="month" />
          <FormPending label="Saving row…" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label><span style={lbl}>Gross (₹){row.salaryType === "variable" ? " *" : ""}</span><input name="gross" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} style={inp} /></label>
            <label><span style={lbl}>PF deduction − (₹)</span><input name="pf_amount" inputMode="decimal" value={pf} onChange={(e) => setPf(e.target.value)} style={inp} /></label>
            <label><span style={lbl}>Attendance days</span><input name="attendance_days" inputMode="decimal" defaultValue={row.attendanceDays != null ? String(row.attendanceDays) : ""} style={inp} /></label>
            <label><span style={lbl}>OT hours</span><input name="ot_hours" inputMode="decimal" defaultValue={row.otHours != null ? String(row.otHours) : ""} style={inp} /></label>
            <label><span style={lbl}>OT amount + (₹)</span><input name="ot_amount" inputMode="decimal" value={ot} onChange={(e) => setOt(e.target.value)} style={inp} /></label>
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
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6, textAlign: "right" }}>Gross − PF + OT − Advance − Deduction + Addition</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" style={btnPrimary}>✓ Save row</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", background: strong ? "rgba(22,101,52,0.06)" : "var(--surface)" }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginTop: 2, color: strong ? "#15803d" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
