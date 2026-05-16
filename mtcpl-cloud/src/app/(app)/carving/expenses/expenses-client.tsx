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

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

export type CncVendorOption = {
  id: string;
  name: string;
};

export type ExpenseCategory =
  | "tools"
  | "electricity"
  | "labor"
  | "office"
  | "maintenance"
  | "other";

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

const CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: "tools",       label: "Tools",        icon: "🛠" },
  { value: "electricity", label: "Electricity",  icon: "⚡" },
  { value: "labor",       label: "Labor",        icon: "👷" },
  { value: "office",      label: "Office",       icon: "📎" },
  { value: "maintenance", label: "Maintenance",  icon: "🔧" },
  { value: "other",       label: "Other",        icon: "•" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function categoryLabel(c: ExpenseCategory): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

function categoryIcon(c: ExpenseCategory): string {
  return CATEGORIES.find((x) => x.value === c)?.icon ?? "•";
}

export function CncExpensesClient({
  monthLabel,
  year,
  month,
  vendors,
  expenses,
  prevHref,
  nextHref,
  addAction,
  editAction,
  cancelAction,
}: {
  monthLabel: string;
  year: number;
  month: number;
  vendors: CncVendorOption[];
  expenses: CncExpenseRow[];
  prevHref: string;
  nextHref: string;
  addAction: (formData: FormData) => Promise<ActionResult>;
  editAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
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
  const today = new Date();
  const years = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  return (
    <section style={{ paddingBottom: 96 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 14,
          padding: "16px 18px",
          marginBottom: 16,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            CNC Operational Expenses
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {monthLabel}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Enter each expense as a line item · sums flow into the carving monthly report
          </div>
        </div>
        <form
          method="get"
          action="/carving/expenses"
          style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}
        >
          <select
            name="month"
            defaultValue={month}
            style={selectStyle()}
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            name="year"
            defaultValue={year}
            style={selectStyle()}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            type="submit"
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              background: "var(--gold)",
              color: "#fff",
              border: "1px solid var(--gold-dark)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            View
          </button>
        </form>
      </header>

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
              rows={rows}
              total={total}
              addAction={addAction}
              editAction={editAction}
              cancelAction={cancelAction}
            />
          );
        })}
      </div>

      {/* Sticky grand-total footer with prev/next month nav.
          Mig 054 follow-on (Daksh): the bar was originally
          position: fixed; left: 0 — that overlapped the 240px
          sidebar. Now it uses `left: var(--content-left)` so the
          bar starts where the content area starts (the same
          variable the topbar + main-shell use). At <900px (mobile)
          the sidebar collapses and the variable resolves to 0,
          letting the bar span the full width again. */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: "var(--content-left, 240px)",
          right: 0,
          background: "rgba(26, 26, 26, 0.94)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "#fff",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          zIndex: 50,
        }}
      >
        <Link
          href={prevHref}
          style={{
            color: "rgba(255, 255, 255, 0.85)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 12px",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            borderRadius: 7,
          }}
        >
          ← Prev month
        </Link>
        <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
            {monthLabel} · grand total
          </span>
          <strong style={{ fontSize: 22, fontFamily: "ui-monospace, monospace", color: "#facc15" }}>
            {fmtINR(grandTotal)}
          </strong>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            across {vendors.length} CNC operator{vendors.length === 1 ? "" : "s"}
          </span>
        </div>
        <Link
          href={nextHref}
          style={{
            color: "rgba(255, 255, 255, 0.85)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 12px",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            borderRadius: 7,
          }}
        >
          Next month →
        </Link>
      </div>
    </section>
  );
}

function VendorCard({
  vendor,
  year,
  month,
  rows,
  total,
  addAction,
  editAction,
  cancelAction,
}: {
  vendor: CncVendorOption;
  year: number;
  month: number;
  rows: CncExpenseRow[];
  total: number;
  addAction: (formData: FormData) => Promise<ActionResult>;
  editAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

        {/* Add form */}
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
