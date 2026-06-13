"use client";

/**
 * Migration 054 — CNC operational expenses client UI.
 *
 * Top strip: year/month picker (GET form). Below: one card per
 * CNC vendor with inline add/edit/cancel for that month's
 * expense line items. Sticky footer with grand total + prev/next
 * month nav.
 *
 * Server-action calls wrap in the existing FinanceLoadingOverlay
 * so the UX matches the rest of the app (gold spinning logo).
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { ExpenseMonthBar } from "@/components/expense-month-bar";

export type CncVendorOption = {
  id: string;
  name: string;
};

// Daksh May 2026 (mig 071) — "electricity" stays in this union so
// historical rows (entered before the global move) still render
// correctly in the per-vendor list, but it's NO LONGER offered as
// an option in the per-vendor category dropdown (see CATEGORIES
// below). All new electricity entries go through the plant-wide
// PlantElectricityPanel below.
export type ExpenseCategory =
  | "tools"
  | "electricity"
  | "labor"
  | "office"
  | "maintenance"
  | "other";

export type PlantElectricityRow = {
  id: string;
  year: number;
  month: number;
  unitsKwh: number | null;
  amount: number;
  note: string | null;
  enteredByName: string | null;
  enteredAt: string;
  updatedAt: string;
  updatedByName: string | null;
};

export type CncExpenseRow = {
  id: string;
  vendorId: string;
  year: number;
  month: number;
  category: ExpenseCategory;
  amount: number;
  note: string | null;
  enteredByName: string | null;
  enteredAt: string;
  updatedAt: string;
  updatedByName: string | null;
};

type ActionResult = { ok: true } | { ok: false; error: string };

// Per-vendor add/edit dropdown — electricity removed mig 071. Goes
// to the plant-wide entry panel instead.
const CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: "tools",       label: "Tools",        icon: "🛠" },
  { value: "labor",       label: "Labor",        icon: "👷" },
  { value: "office",      label: "Office",       icon: "📎" },
  { value: "maintenance", label: "Maintenance",  icon: "🔧" },
  { value: "other",       label: "Other",        icon: "•" },
];
// Full list (incl. electricity) so legacy rows still render with
// the right icon + label.
const ALL_CATEGORIES_DISPLAY: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: "tools",       label: "Tools",        icon: "🛠" },
  { value: "electricity", label: "Electricity",  icon: "⚡" },
  { value: "labor",       label: "Labor",        icon: "👷" },
  { value: "office",      label: "Office",       icon: "📎" },
  { value: "maintenance", label: "Maintenance",  icon: "🔧" },
  { value: "other",       label: "Other",        icon: "•" },
];

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function categoryLabel(c: ExpenseCategory): string {
  return ALL_CATEGORIES_DISPLAY.find((x) => x.value === c)?.label ?? c;
}

function categoryIcon(c: ExpenseCategory): string {
  return ALL_CATEGORIES_DISPLAY.find((x) => x.value === c)?.icon ?? "•";
}

export function CncExpensesClient({
  monthLabel,
  year,
  month,
  currentYear,
  currentMonth,
  vendors,
  expenses,
  plantElectricity,
  addAction,
  editAction,
  cancelAction,
  addPlantElectricityAction,
  cancelPlantElectricityAction,
}: {
  monthLabel: string;
  year: number;
  month: number;
  currentYear: number;
  currentMonth: number;
  vendors: CncVendorOption[];
  expenses: CncExpenseRow[];
  plantElectricity: PlantElectricityRow | null;
  addAction: (formData: FormData) => Promise<ActionResult>;
  editAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
  addPlantElectricityAction: (formData: FormData) => Promise<ActionResult>;
  cancelPlantElectricityAction: (formData: FormData) => Promise<ActionResult>;
}) {
  // Group by vendor for the per-vendor cards.
  const expensesByVendor = useMemo(() => {
    const m = new Map<string, CncExpenseRow[]>();
    for (const e of expenses) {
      const list = m.get(e.vendorId) ?? [];
      list.push(e);
      m.set(e.vendorId, list);
    }
    return m;
  }, [expenses]);

  const grandTotal = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <section style={{ paddingBottom: 28 }}>
      <ExpenseMonthBar
        basePath="/carving/expenses"
        kicker="CNC Operational Expenses"
        year={year}
        month={month}
        currentYear={currentYear}
        currentMonth={currentMonth}
        total={grandTotal}
        totalCaption={`across ${vendors.length} CNC operator${
          vendors.length === 1 ? "" : "s"
        }`}
        backHref="/reports/various-costing/cnc"
        backLabel="CNC Costing"
      />

      {vendors.length === 0 && (
        <div
          style={{
            padding: 28,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            textAlign: "center",
            color: "var(--muted)",
          }}
        >
          No CNC vendors configured. Ask a developer to add CNC operators under
          <strong> /carving/vendors</strong> first.
        </div>
      )}

      {/* Daksh May 2026 (mig 071) — plant-wide electricity panel.
          Pinned above the vendor cards because it covers ALL
          vendors and only takes one entry per month. */}
      <PlantElectricityPanel
        year={year}
        month={month}
        monthLabel={monthLabel}
        row={plantElectricity}
        addAction={addPlantElectricityAction}
        cancelAction={cancelPlantElectricityAction}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {vendors.map((v) => {
          const rows = expensesByVendor.get(v.id) ?? [];
          const total = rows.reduce((s, e) => s + e.amount, 0);
          return (
            <VendorCard
              key={v.id}
              vendor={v}
              year={year}
              month={month}
              monthLabel={monthLabel}
              rows={rows}
              total={total}
              addAction={addAction}
              editAction={editAction}
              cancelAction={cancelAction}
            />
          );
        })}
      </div>
    </section>
  );
}

function VendorCard({
  vendor,
  year,
  month,
  monthLabel,
  rows,
  total,
  addAction,
  editAction,
  cancelAction,
}: {
  vendor: CncVendorOption;
  year: number;
  month: number;
  monthLabel: string;
  rows: CncExpenseRow[];
  total: number;
  addAction: (formData: FormData) => Promise<ActionResult>;
  editAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form state
  const [addCategory, setAddCategory] = useState<ExpenseCategory>("tools");
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const amount = Number(addAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      return setError("Amount must be a positive number.");
    }
    const fd = new FormData();
    fd.set("vendor_id", vendor.id);
    fd.set("year", String(year));
    fd.set("month", String(month));
    fd.set("category", addCategory);
    fd.set("amount", String(amount));
    fd.set("note", addNote.trim());
    startTransition(async () => {
      const r = await addAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAdded(`✓ ${fmtINR(amount)} added to ${vendor.name}`);
      setTimeout(() => setAdded(null), 2600);
      setAddAmount("");
      setAddNote("");
      setAddCategory("tools");
      router.refresh();
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Saving expense…" />
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              CNC Operator
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {vendor.name}
            </div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Month total
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: total > 0 ? "var(--gold-dark)" : "var(--muted)",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {fmtINR(total)}
            </div>
          </div>
        </div>

        {/* Add form — caption restates the target month right where
            the amount is typed, so nobody adds into the wrong month. */}
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          ＋ Add expense to{" "}
          <span style={{ color: "var(--gold-dark)", fontWeight: 800 }}>
            {monthLabel}
          </span>
        </div>
        <form
          onSubmit={handleAdd}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, 1fr) minmax(120px, 130px) minmax(180px, 2fr) auto",
            gap: 8,
            padding: 10,
            background: "var(--bg)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <select
            value={addCategory}
            onChange={(e) => setAddCategory(e.target.value as ExpenseCategory)}
            style={selectStyle()}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={addAmount}
            onChange={(e) => setAddAmount(e.target.value)}
            placeholder="Amount ₹"
            style={{ ...inputStyle(), fontFamily: "ui-monospace, monospace", textAlign: "right" }}
          />
          <input
            type="text"
            value={addNote}
            onChange={(e) => setAddNote(e.target.value.slice(0, 500))}
            placeholder="Note (optional)"
            style={inputStyle()}
          />
          <button
            type="submit"
            disabled={pending || !addAmount}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 700,
              background: "var(--gold)",
              color: "#fff",
              border: "1px solid var(--gold-dark)",
              borderRadius: 8,
              cursor: pending ? "wait" : "pointer",
              opacity: pending || !addAmount ? 0.55 : 1,
            }}
          >
            + Add
          </button>
        </form>

        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 12px",
              background: "rgba(185, 28, 28, 0.08)",
              border: "1px solid rgba(185, 28, 28, 0.3)",
              color: "#b91c1c",
              fontSize: 12,
              borderRadius: 7,
            }}
          >
            {error}
          </div>
        )}
        {added && (
          <div
            role="status"
            style={{
              padding: "8px 12px",
              background: "rgba(22,163,74,0.1)",
              border: "1px solid rgba(22,163,74,0.4)",
              color: "#15803d",
              fontSize: 12.5,
              fontWeight: 700,
              borderRadius: 7,
            }}
          >
            {added}
          </div>
        )}

        {/* Existing line items */}
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
            No expenses recorded yet for this month.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r) => (
              <ExpenseLine
                key={r.id}
                row={r}
                isEditing={editingId === r.id}
                onEditStart={() => setEditingId(r.id)}
                onEditCancel={() => setEditingId(null)}
                editAction={editAction}
                cancelAction={cancelAction}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ExpenseLine({
  row,
  isEditing,
  onEditStart,
  onEditCancel,
  editAction,
  cancelAction,
}: {
  row: CncExpenseRow;
  isEditing: boolean;
  onEditStart: () => void;
  onEditCancel: () => void;
  editAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Edit form state (local to this line's edit mode)
  const [category, setCategory] = useState<ExpenseCategory>(row.category);
  const [amount, setAmount] = useState(String(row.amount));
  const [note, setNote] = useState(row.note ?? "");

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const a = Number(amount);
    if (!Number.isFinite(a) || a < 0) {
      return setError("Amount must be a positive number.");
    }
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("category", category);
    fd.set("amount", String(a));
    fd.set("note", note.trim());
    startTransition(async () => {
      const r = await editAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onEditCancel();
      router.refresh();
    });
  }

  function handleCancel() {
    if (!window.confirm("Cancel (soft-delete) this expense? It stays in audit history.")) return;
    const reason = window.prompt("Reason (optional)") ?? "";
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("reason", reason.trim());
    startTransition(async () => {
      const r = await cancelAction(fd);
      if (!r.ok) {
        alert(r.error);
        return;
      }
      router.refresh();
    });
  }

  if (isEditing) {
    return (
      <>
        <FinanceLoadingOverlay show={pending} label="Updating expense…" />
        <form
          onSubmit={handleSave}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, 1fr) minmax(120px, 130px) minmax(180px, 2fr) auto auto",
            gap: 8,
            padding: 10,
            background: "rgba(201, 161, 74, 0.06)",
            border: "1px solid var(--gold)",
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            style={selectStyle()}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ ...inputStyle(), fontFamily: "ui-monospace, monospace", textAlign: "right" }}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="Note"
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
            onClick={onEditCancel}
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
            <div
              role="alert"
              style={{
                gridColumn: "1 / -1",
                fontSize: 11,
                color: "#b91c1c",
              }}
            >
              {error}
            </div>
          )}
        </form>
      </>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, 1fr) 130px minmax(180px, 2fr) auto",
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
          <span style={{ marginLeft: 8, fontSize: 10 }}>
            by {row.enteredByName}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={onEditStart}
          title="Edit"
          style={iconBtn()}
        >
          ✎
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          title="Cancel (soft-delete)"
          style={iconBtn("#b91c1c")}
        >
          ✕
        </button>
      </div>
    </div>
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

// ──────────────────────────────────────────────────────────────────
// Plant Electricity panel (mig 071, Daksh May 2026)
// ──────────────────────────────────────────────────────────────────
// One entry per (year, month) plant-wide. When a row already exists
// for this month, show its values; clicking Edit replaces the row
// (server soft-cancels old + inserts new — preserves audit).
// ──────────────────────────────────────────────────────────────────
function PlantElectricityPanel({
  year,
  month,
  monthLabel,
  row,
  addAction,
  cancelAction,
}: {
  year: number;
  month: number;
  monthLabel: string;
  row: PlantElectricityRow | null;
  addAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [editing, setEditing] = useState<boolean>(!row);
  const [amount, setAmount] = useState<string>(
    row ? String(row.amount) : "",
  );
  const [units, setUnits] = useState<string>(
    row?.unitsKwh != null ? String(row.unitsKwh) : "",
  );
  const [note, setNote] = useState<string>(row?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setAmount(row ? String(row.amount) : "");
    setUnits(row?.unitsKwh != null ? String(row.unitsKwh) : "");
    setNote(row?.note ?? "");
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("year", String(year));
      fd.set("month", String(month));
      fd.set("amount", amount);
      fd.set("units_kwh", units);
      fd.set("note", note);
      const res = await addAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
    });
  }

  function onCancel() {
    if (!row) return;
    const reason = window.prompt(
      `Cancel the plant electricity entry for ${monthLabel}?\n\nOptional reason:`,
    );
    if (reason === null) return; // user hit cancel on the prompt
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      fd.set("reason", reason);
      const res = await cancelAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(true);
      setAmount("");
      setUnits("");
      setNote("");
    });
  }

  const inrFmt = (n: number) =>
    `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const rate =
    row && row.unitsKwh && row.unitsKwh > 0
      ? row.amount / row.unitsKwh
      : null;

  return (
    <section
      style={{
        background:
          "linear-gradient(180deg, rgba(217,119,6,0.10) 0%, rgba(217,119,6,0.02) 100%)",
        border: "1.5px solid rgba(217,119,6,0.40)",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "#92400e",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            ⚡ Plant Electricity · plant-wide
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
            {monthLabel}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            Single monthly bill for the whole CNC plant. Per-vendor
            split is no longer captured — the meter sits at the
            plant gate. Units (kWh) are optional.
          </div>
        </div>
        {!editing && row && (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={iconBtn("#92400e")}
            >
              ✎ Replace
            </button>
            <button
              type="button"
              onClick={onCancel}
              style={iconBtn("#b91c1c")}
              disabled={pending}
            >
              ✕ Cancel
            </button>
          </div>
        )}
      </div>

      {!editing && row ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <Tile label="Bill amount" value={inrFmt(row.amount)} accent="#b45309" />
          <Tile
            label="Units (kWh)"
            value={
              row.unitsKwh != null
                ? row.unitsKwh.toLocaleString("en-IN", {
                    maximumFractionDigits: 2,
                  })
                : "—"
            }
          />
          <Tile
            label="₹/kWh"
            value={rate != null ? rate.toFixed(2) : "—"}
            hint="Derived"
          />
          <Tile
            label="Entered by"
            value={row.enteredByName ?? "—"}
            hint={new Date(row.enteredAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
          {row.note && (
            <div
              style={{
                gridColumn: "1 / -1",
                fontSize: 12,
                color: "var(--text)",
                background: "rgba(255,255,255,0.6)",
                border: "1px solid rgba(217,119,6,0.25)",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              <strong style={{ color: "#92400e" }}>Note:</strong> {row.note}
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={submit}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
            background: "rgba(255,255,255,0.55)",
            padding: 10,
            borderRadius: 10,
            border: "1px dashed rgba(217,119,6,0.35)",
          }}
        >
          <label
            style={{ display: "flex", flexDirection: "column", gap: 4 }}
          >
            <span style={fieldLabelStyle}>Bill amount (₹) *</span>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 84500"
              style={inputStyleLocal()}
            />
          </label>
          <label
            style={{ display: "flex", flexDirection: "column", gap: 4 }}
          >
            <span style={fieldLabelStyle}>Units (kWh)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="optional"
              style={inputStyleLocal()}
            />
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              gridColumn: "1 / -1",
            }}
          >
            <span style={fieldLabelStyle}>Note</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional — e.g. ATD bill no, meter reading"
              maxLength={500}
              style={inputStyleLocal()}
            />
          </label>
          {error && (
            <div
              role="alert"
              style={{
                gridColumn: "1 / -1",
                padding: "8px 10px",
                background: "rgba(220,38,38,0.08)",
                color: "#b91c1c",
                border: "1px solid rgba(220,38,38,0.3)",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            {row && (
              <button
                type="button"
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
                style={iconBtn("var(--muted)")}
                disabled={pending}
              >
                ✕ Cancel edit
              </button>
            )}
            <button
              type="submit"
              disabled={pending || !amount}
              className="primary-button"
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {pending
                ? "Saving…"
                : row
                  ? "✓ Replace entry"
                  : "✓ Save monthly bill"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(255,255,255,0.7)",
        border: "1px solid rgba(217,119,6,0.25)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: "#92400e",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: accent ?? "var(--text)",
          marginTop: 2,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

function inputStyleLocal(): React.CSSProperties {
  return {
    padding: "8px 10px",
    fontSize: 13,
    background: "#fff",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    minWidth: 0,
  };
}
