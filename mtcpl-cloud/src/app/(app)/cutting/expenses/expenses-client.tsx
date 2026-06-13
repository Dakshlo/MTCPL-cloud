"use client";

/**
 * Mig 060 — Cutter expenses client UI.
 *
 * Three-zone layout:
 *   1. Header strip — month picker + label
 *   2. Book value snapshot panel (collapsed by default; expandable
 *      "Set new value" form for dev/owner; latest entry shown
 *      always so non-editors can see what drives depreciation).
 *   3. Expenses card — add form on top, current month's line
 *      items below, edit/cancel inline.
 *   4. Sticky footer — month total + prev/next nav.
 *
 * Everything wraps in FinanceLoadingOverlay so save UX matches
 * the rest of the app's gold-spinner pattern.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { ExpenseMonthBar } from "@/components/expense-month-bar";

export type CutterCategory =
  | "electricity"
  | "manpower"
  | "repair_maintenance"
  | "other";

export type CutterExpenseRow = {
  id: string;
  year: number;
  month: number;
  category: CutterCategory;
  amount: number;
  note: string | null;
  enteredByName: string | null;
  enteredAt: string;
  updatedAt: string;
  updatedByName: string | null;
};

export type CutterBookValueRow = {
  id: string;
  bookValue: number;
  usefulLifeYears: number;
  /** Mig 063 — annual WDV depreciation rate (e.g. 15 for 15%). */
  depreciationRatePct: number;
  /** Floor — current value never depreciates below this. */
  salvageValue: number;
  effectiveFrom: string;
  note: string | null;
  enteredByName: string | null;
  enteredAt: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };

const CATEGORIES: { value: CutterCategory; label: string; icon: string }[] = [
  { value: "electricity",        label: "Electricity",        icon: "⚡" },
  { value: "manpower",           label: "Manpower",           icon: "👷" },
  { value: "repair_maintenance", label: "Repair / Maintenance", icon: "🔧" },
  { value: "other",              label: "Other",              icon: "•" },
];

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function categoryLabel(c: CutterCategory): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

function categoryIcon(c: CutterCategory): string {
  return CATEGORIES.find((x) => x.value === c)?.icon ?? "•";
}

export function CutterExpensesClient({
  monthLabel,
  year,
  month,
  currentYear,
  currentMonth,
  expenses,
  bookValues,
  canEditBookValue,
  addAction,
  editAction,
  cancelAction,
  setBookValueAction,
  cancelBookValueAction,
}: {
  monthLabel: string;
  year: number;
  month: number;
  currentYear: number;
  currentMonth: number;
  expenses: CutterExpenseRow[];
  bookValues: CutterBookValueRow[];
  canEditBookValue: boolean;
  addAction: (formData: FormData) => Promise<ActionResult>;
  editAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
  setBookValueAction: (formData: FormData) => Promise<ActionResult>;
  cancelBookValueAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const grandTotal = expenses.reduce((s, e) => s + e.amount, 0);

  // Group expenses by category for category-tiles row
  const totalsByCat = new Map<CutterCategory, number>();
  for (const e of expenses) {
    totalsByCat.set(e.category, (totalsByCat.get(e.category) ?? 0) + e.amount);
  }

  const latestBv = bookValues[0] ?? null;
  // Mig 063 — WDV depreciated value at today's date.
  //   yearsElapsed     = floor((today - effective_from) / 365.25d)
  //   currentValue     = max(salvage, book × (1 - rate)^yearsElapsed)
  //   monthlyDep       = currentValue × rate / 12
  // Matches the math the cost report runs server-side.
  const wdv = (() => {
    if (!latestBv) {
      return { yearsElapsed: 0, currentValue: 0, monthlyDep: 0 };
    }
    const rate = Math.max(0, Math.min(1, latestBv.depreciationRatePct / 100));
    const salvage = Math.max(0, latestBv.salvageValue);
    const eff = new Date(latestBv.effectiveFrom + "T00:00:00");
    const ageDays = (Date.now() - eff.getTime()) / 86_400_000;
    const yearsElapsed = Math.max(0, Math.floor(ageDays / 365.25));
    const currentValue = Math.max(
      salvage,
      latestBv.bookValue * Math.pow(1 - rate, yearsElapsed),
    );
    const monthlyDep = (currentValue * rate) / 12;
    return { yearsElapsed, currentValue, monthlyDep };
  })();

  return (
    <section style={{ paddingBottom: 28 }}>
      <ExpenseMonthBar
        basePath="/cutting/expenses"
        kicker="Cutter Operational Expenses"
        year={year}
        month={month}
        currentYear={currentYear}
        currentMonth={currentMonth}
        total={grandTotal}
        totalCaption="feeds the Cutter report"
        backHref="/reports/various-costing/cutter"
        backLabel="Cutter Costing"
      />

      <BookValuePanel
        latest={latestBv}
        history={bookValues}
        wdv={wdv}
        canEdit={canEditBookValue}
        setAction={setBookValueAction}
        cancelAction={cancelBookValueAction}
      />

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Line Items
            </div>
            <div style={{ fontSize: 14, color: "var(--text)" }}>
              {expenses.length === 0 ? "No expenses entered for this month yet" : `${expenses.length} entries`}
            </div>
          </div>
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 18,
              fontWeight: 800,
              color: "var(--text)",
            }}
          >
            {fmtINR(grandTotal)}
          </div>
        </div>

        {/* Category totals chips — at-a-glance per-category sum */}
        {expenses.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {CATEGORIES.map((c) => {
              const t = totalsByCat.get(c.value) ?? 0;
              if (t === 0) return null;
              return (
                <span
                  key={c.value}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                    {fmtINR(t)}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        <AddExpenseRow
          year={year}
          month={month}
          monthLabel={monthLabel}
          addAction={addAction}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {expenses.map((e) => (
            <ExpenseRow
              key={e.id}
              row={e}
              editAction={editAction}
              cancelAction={cancelAction}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────
// Book value panel
// ───────────────────────────────────────────────────────────────────

function BookValuePanel({
  latest,
  history,
  wdv,
  canEdit,
  setAction,
  cancelAction,
}: {
  latest: CutterBookValueRow | null;
  history: CutterBookValueRow[];
  /** Mig 063 — WDV-derived numbers at today's date. Passed in
   *  from the parent so server & client agree on the year boundary. */
  wdv: { yearsElapsed: number; currentValue: number; monthlyDep: number };
  canEdit: boolean;
  setAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 18,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Cutter Machines · Book Value
          </div>
          {latest ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 22, fontWeight: 800 }}>
                  {fmtINR(wdv.currentValue)}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  current depreciated value
                  {wdv.yearsElapsed > 0 && (
                    <span> · year {wdv.yearsElapsed + 1} of {latest.usefulLifeYears}</span>
                  )}
                </div>
              </div>
              {/* Mig 063 — extra context line so the user can see what
                  the original entry was vs. what we're depreciating
                  on now, plus the rate driving the WDV math. */}
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Original ₹{latest.bookValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                {" · "}
                {latest.depreciationRatePct}% / year (declining)
                {" · "}
                this year monthly dep{" "}
                <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{fmtINR(wdv.monthlyDep)}</strong>
                {" · effective " + latest.effectiveFrom}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#b45309", marginTop: 2 }}>
              No book value set yet — depreciation will be ₹0 on the report.
            </div>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              background: open ? "var(--bg)" : "var(--gold)",
              color: open ? "var(--text)" : "#fff",
              border: open ? "1px solid var(--border)" : "1px solid var(--gold-dark)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {open ? "Close" : latest ? "Set new value" : "Enter book value"}
          </button>
        )}
      </div>

      {open && canEdit && (
        <SetBookValueForm setAction={setAction} onDone={() => setOpen(false)} />
      )}

      {history.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            style={{
              padding: 0,
              fontSize: 11,
              fontWeight: 700,
              background: "transparent",
              color: "var(--muted)",
              border: "none",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {showHistory ? "▾" : "▸"} History ({history.length})
          </button>
          {showHistory && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map((h, i) => (
                <div
                  key={h.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 10px",
                    background: i === 0 ? "var(--bg)" : "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    fontSize: 12,
                  }}
                >
                  <span style={{ minWidth: 100, color: "var(--muted)" }}>{h.effectiveFrom}</span>
                  <strong style={{ fontFamily: "ui-monospace, monospace", minWidth: 120 }}>{fmtINR(h.bookValue)}</strong>
                  <span style={{ color: "var(--muted)" }}>{h.depreciationRatePct}% / year</span>
                  <span style={{ color: "var(--muted)" }}>{h.usefulLifeYears}y life</span>
                  {h.note && <span style={{ color: "var(--muted)", fontStyle: "italic" }}>· {h.note}</span>}
                  {canEdit && (
                    <form
                      action={async (fd) => { await cancelAction(fd); }}
                      onSubmit={(e) => {
                        if (!confirm(`Cancel this book-value entry (${fmtINR(h.bookValue)}, from ${h.effectiveFrom})? It stays in audit history.`)) {
                          e.preventDefault();
                        }
                      }}
                      style={{ marginLeft: "auto" }}
                    >
                      <input type="hidden" name="id" value={h.id} />
                      <button
                        type="submit"
                        title="Soft-cancel this entry"
                        style={{
                          padding: "3px 8px",
                          fontSize: 11,
                          background: "transparent",
                          color: "#b91c1c",
                          border: "1px solid #b91c1c",
                          borderRadius: 5,
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SetBookValueForm({
  setAction,
  onDone,
}: {
  setAction: (formData: FormData) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Saving book value…" />
      <form
        action={(fd) => {
          setError(null);
          start(async () => {
            const r = await setAction(fd);
            if (r.ok) {
              router.refresh();
              onDone();
            } else {
              setError(r.error);
            }
          });
        }}
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "180px 140px 140px 160px 1fr auto",
          gap: 10,
          alignItems: "end",
          padding: 14,
          background: "var(--bg)",
          border: "1px dashed var(--border)",
          borderRadius: 10,
        }}
      >
        <Field label="Book value (₹)">
          <input
            type="number"
            name="book_value"
            min={0}
            step="0.01"
            required
            placeholder="e.g. 4500000"
            style={inputStyle()}
          />
        </Field>
        <Field label="Dep. rate (% / year)">
          {/* Mig 063 — annual WDV rate. 15% is the same default the
              CNC report uses; matches the Indian tax convention. */}
          <input
            type="number"
            name="depreciation_rate_pct"
            min={0}
            max={100}
            step="0.01"
            defaultValue={15}
            required
            style={inputStyle()}
          />
        </Field>
        <Field label="Useful life (yrs)">
          <input
            type="number"
            name="useful_life_years"
            min={1}
            max={50}
            defaultValue={10}
            required
            style={inputStyle()}
          />
        </Field>
        <Field label="Effective from">
          <input
            type="date"
            name="effective_from"
            style={inputStyle()}
          />
        </Field>
        <Field label="Note (optional)">
          <input
            type="text"
            name="note"
            placeholder="e.g. After Bridge II commissioning"
            style={inputStyle()}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 8,
            cursor: pending ? "wait" : "pointer",
          }}
        >
          Save
        </button>
        {error && (
          <div role="alert" style={{ gridColumn: "1 / -1", fontSize: 12, color: "#b91c1c" }}>
            {error}
          </div>
        )}
      </form>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// Expense rows
// ───────────────────────────────────────────────────────────────────

function AddExpenseRow({
  year,
  month,
  monthLabel,
  addAction,
}: {
  year: number;
  month: number;
  monthLabel: string;
  addAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Adding expense…" />
      {/* Caption restates the target month right at the entry point. */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        ＋ Add expense to{" "}
        <span style={{ color: "var(--gold-dark)", fontWeight: 800 }}>
          {monthLabel}
        </span>
      </div>
      {added && (
        <div role="status" style={{ marginBottom: 6, padding: "8px 12px", background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.4)", color: "#15803d", fontSize: 12.5, fontWeight: 700, borderRadius: 7 }}>
          ✓ Expense added.
        </div>
      )}
      <form
        action={(fd) => {
          setError(null);
          start(async () => {
            const r = await addAction(fd);
            if (r.ok) {
              setAdded(true);
              setTimeout(() => setAdded(false), 2600);
              router.refresh();
              (document.getElementById("cutter-add-form") as HTMLFormElement | null)?.reset();
            } else {
              setError(r.error);
            }
          });
        }}
        id="cutter-add-form"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(160px, 1fr) 140px minmax(180px, 2fr) auto",
          gap: 8,
          padding: 10,
          background: "var(--bg)",
          border: "1px dashed var(--border)",
          borderRadius: 8,
          alignItems: "center",
        }}
      >
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="month" value={month} />
        <select name="category" required defaultValue="" style={selectStyle()}>
          <option value="" disabled>Pick category…</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.icon}  {c.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          name="amount"
          min={0}
          step="0.01"
          required
          placeholder="₹ Amount"
          style={inputStyle()}
        />
        <input
          type="text"
          name="note"
          placeholder="Note (optional)"
          style={inputStyle()}
        />
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 8,
            cursor: pending ? "wait" : "pointer",
          }}
        >
          Add
        </button>
        {error && (
          <div role="alert" style={{ gridColumn: "1 / -1", fontSize: 12, color: "#b91c1c" }}>
            {error}
          </div>
        )}
      </form>
    </>
  );
}

function ExpenseRow({
  row,
  editAction,
  cancelAction,
}: {
  row: CutterExpenseRow;
  editAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    if (!confirm("Cancel this expense entry? It will stay in audit history but won't count toward totals.")) return;
    start(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      const r = await cancelAction(fd);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  if (editing) {
    return (
      <>
        <FinanceLoadingOverlay show={pending} label="Saving expense…" />
        <form
          action={(fd) => {
            setError(null);
            start(async () => {
              const r = await editAction(fd);
              if (r.ok) {
                router.refresh();
                setEditing(false);
              } else {
                setError(r.error);
              }
            });
          }}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(160px, 1fr) 140px minmax(180px, 2fr) auto auto",
            gap: 8,
            padding: 10,
            background: "#fffbeb",
            border: "1px solid var(--gold)",
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <input type="hidden" name="id" value={row.id} />
          <select name="category" defaultValue={row.category} required style={selectStyle()}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.icon}  {c.label}</option>
            ))}
          </select>
          <input
            type="number"
            name="amount"
            min={0}
            step="0.01"
            defaultValue={row.amount}
            required
            style={inputStyle()}
          />
          <input
            type="text"
            name="note"
            defaultValue={row.note ?? ""}
            placeholder="Note (optional)"
            style={inputStyle()}
          />
          <button
            type="submit"
            disabled={pending}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              background: "var(--gold)",
              color: "#fff",
              border: "1px solid var(--gold-dark)",
              borderRadius: 7,
              cursor: pending ? "wait" : "pointer",
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setError(null); }}
            disabled={pending}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: "transparent",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          {error && (
            <div role="alert" style={{ gridColumn: "1 / -1", fontSize: 11, color: "#b91c1c" }}>{error}</div>
          )}
        </form>
      </>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(160px, 1fr) 140px minmax(180px, 2fr) auto",
        gap: 8,
        padding: "8px 12px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <span>{categoryIcon(row.category)}</span>
        <strong style={{ fontWeight: 600 }}>{categoryLabel(row.category)}</strong>
      </div>
      <div
        style={{
          fontFamily: "ui-monospace, monospace",
          fontWeight: 700,
          textAlign: "right",
          fontSize: 14,
        }}
      >
        {fmtINR(row.amount)}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.note ?? "—"}
        {row.enteredByName && (
          <span style={{ marginLeft: 8, fontSize: 10 }}>by {row.enteredByName}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => setEditing(true)} title="Edit" style={iconBtn()}>✎</button>
        <button type="button" onClick={handleCancel} disabled={pending} title="Cancel (soft-delete)" style={iconBtn("#b91c1c")}>✕</button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Tiny shared bits
// ───────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function selectStyle(): React.CSSProperties {
  return {
    padding: "7px 10px",
    fontSize: 13,
    background: "#fff",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 7,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "7px 10px",
    fontSize: 13,
    background: "#fff",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    minWidth: 0,
  };
}

function iconBtn(color = "var(--muted)"): React.CSSProperties {
  return {
    padding: "4px 8px",
    fontSize: 13,
    background: "transparent",
    color,
    border: `1px solid ${color === "var(--muted)" ? "var(--border)" : color}`,
    borderRadius: 6,
    cursor: "pointer",
  };
}
