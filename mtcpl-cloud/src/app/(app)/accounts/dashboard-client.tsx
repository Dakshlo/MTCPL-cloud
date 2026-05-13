"use client";

/**
 * Due-bills multi-select + propose-pay-today.
 *
 * Accountant picks rows → adjusts per-row "propose amount" (defaults
 * to outstanding) → submits as a batch. The server creates one
 * proposal_batch_id and one bill_payments row per bill at status
 * 'proposed'. Owner takes over from the /accounts/pay-today screen.
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type DueBillRow = {
  id: string;
  token: string;
  vendorId: string;
  vendorName: string;
  vendorBillNo: string;
  billDate: string;
  description: string;
  costHead: string | null;
  amountTotal: number;
  amountPaid: number;
  amountOutstanding: number;
  ageBucket: "0_30" | "31_60" | "61_90" | "90_plus";
  hasOpenPayment: boolean;
};

type ProposeResult =
  | { ok: true; batchId: string; rowsCreated: number; skipped: string[] }
  | { ok: false; error: string };

export function DueBillsClient({
  rows,
  canPropose,
  proposeAction,
}: {
  rows: DueBillRow[];
  canPropose: boolean;
  proposeAction: (formData: FormData) => Promise<ProposeResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amountOverrides, setAmountOverrides] = useState<Record<string, string>>({});

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );
  const selectedTotal = selectedRows.reduce(
    (s, r) => s + (Number(amountOverrides[r.id]) || r.amountOutstanding),
    0,
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    const next = new Set(selected);
    for (const r of rows) {
      if (!r.hasOpenPayment) next.add(r.id);
    }
    setSelected(next);
  }

  function clearAll() {
    setSelected(new Set());
    setAmountOverrides({});
  }

  function handlePropose() {
    setError(null);
    setSuccess(null);
    if (selectedRows.length === 0) {
      setError("Pick at least one bill.");
      return;
    }
    const proposedAmounts: Record<string, number> = {};
    for (const r of selectedRows) {
      const override = Number(amountOverrides[r.id]);
      const amount = Number.isFinite(override) && override > 0
        ? Math.min(override, r.amountOutstanding)
        : r.amountOutstanding;
      proposedAmounts[r.id] = amount;
    }
    const fd = new FormData();
    fd.set("bill_ids", JSON.stringify(selectedRows.map((r) => r.id)));
    fd.set("proposed_amounts", JSON.stringify(proposedAmounts));
    startTransition(async () => {
      const result = await proposeAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
      setAmountOverrides({});
      setSuccess(
        `Proposed ${result.rowsCreated} bill${result.rowsCreated === 1 ? "" : "s"}${
          result.skipped.length > 0 ? ` · skipped ${result.skipped.length}` : ""
        }. Owner will review on Pay Today.`,
      );
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="banner" style={{ marginTop: 8 }}>
        No bills due right now. New ones land here as soon as the owner
        approves them.
      </div>
    );
  }

  return (
    <div>
      {/* Action bar */}
      {canPropose && (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 10,
            padding: "10px 14px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <button
            type="button"
            onClick={selectAllVisible}
            style={{
              fontSize: 12,
              padding: "5px 12px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            Select all visible
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={selected.size === 0}
            style={{
              fontSize: 12,
              padding: "5px 12px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: selected.size === 0 ? "not-allowed" : "pointer",
              color: "var(--muted)",
              opacity: selected.size === 0 ? 0.5 : 1,
            }}
          >
            Clear
          </button>
          <div
            style={{
              flex: 1,
              fontSize: 13,
              color: "var(--muted)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {selected.size > 0 ? (
              <>
                <strong style={{ color: "var(--text)" }}>{selected.size}</strong> selected ·{" "}
                <strong style={{ color: "var(--gold-dark)" }}>
                  ₹{selectedTotal.toLocaleString("en-IN")}
                </strong>{" "}
                will be proposed
              </>
            ) : (
              "Tick the bills you want to propose for today's payment run."
            )}
          </div>
          <button
            type="button"
            onClick={handlePropose}
            disabled={pending || selected.size === 0}
            className="primary-button"
            style={{
              fontSize: 13,
              padding: "8px 18px",
              fontWeight: 700,
              opacity: selected.size === 0 ? 0.6 : 1,
            }}
          >
            {pending ? "Proposing…" : `💸 Propose ${selected.size} for pay-today`}
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: "10px 12px",
            background: "rgba(220,38,38,0.08)",
            border: "1.5px solid #dc2626",
            borderRadius: 6,
            color: "#7f1d1d",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            marginBottom: 10,
            padding: "10px 12px",
            background: "rgba(22,101,52,0.10)",
            border: "1px solid #86efac",
            borderRadius: 6,
            color: "#15803d",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {success}{" "}
          <Link href="/accounts/pay-today" style={{ textDecoration: "underline" }}>
            Open Pay Today →
          </Link>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              {canPropose && <th style={thStyle}>&nbsp;</th>}
              <th style={thStyle}>Token</th>
              <th style={thStyle}>Vendor</th>
              <th style={thStyle}>Bill date</th>
              <th style={thStyle}>Bill no</th>
              <th style={thStyle}>Cost head</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Outstanding</th>
              <th style={thStyle}>Age</th>
              {canPropose && <th style={thStyle}>Propose ₹</th>}
              <th style={thStyle}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = selected.has(r.id);
              const displayAmount =
                amountOverrides[r.id] != null
                  ? amountOverrides[r.id]
                  : String(r.amountOutstanding);
              return (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: isSelected ? "rgba(232,197,114,0.10)" : undefined,
                    opacity: r.hasOpenPayment ? 0.55 : 1,
                  }}
                >
                  {canPropose && (
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={r.hasOpenPayment}
                        onChange={() => toggle(r.id)}
                        title={
                          r.hasOpenPayment
                            ? "A payment is already in flight for this bill."
                            : undefined
                        }
                      />
                    </td>
                  )}
                  <td style={tdStyle}>
                    <code style={{ fontWeight: 700 }}>{r.token}</code>
                  </td>
                  <td style={tdStyle}>{r.vendorName}</td>
                  <td style={tdStyle}>
                    {new Date(r.billDate).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 12 }}>{r.vendorBillNo}</code>
                  </td>
                  <td style={tdStyle}>
                    {r.costHead ? (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "rgba(184,115,51,0.10)",
                          color: "#b45309",
                          fontWeight: 600,
                        }}
                      >
                        {r.costHead}
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>
                        —
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    ₹{r.amountTotal.toLocaleString("en-IN")}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    <strong style={{ color: "#b45309" }}>
                      ₹{r.amountOutstanding.toLocaleString("en-IN")}
                    </strong>
                  </td>
                  <td style={tdStyle}>
                    <AgeBadge bucket={r.ageBucket} />
                  </td>
                  {canPropose && (
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={r.amountOutstanding}
                        value={displayAmount}
                        disabled={!isSelected || r.hasOpenPayment}
                        onChange={(e) =>
                          setAmountOverrides((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        style={{
                          width: 110,
                          padding: "5px 8px",
                          fontSize: 12,
                          fontFamily: "ui-monospace, monospace",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          color: "var(--text)",
                          opacity: isSelected ? 1 : 0.45,
                        }}
                      />
                    </td>
                  )}
                  <td style={tdStyle}>
                    <Link
                      href={`/accounts/bills/${r.id}`}
                      style={{
                        textDecoration: "none",
                        fontSize: 12,
                        padding: "4px 10px",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        color: "var(--text)",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgeBadge({ bucket }: { bucket: DueBillRow["ageBucket"] }) {
  const map: Record<DueBillRow["ageBucket"], { label: string; color: string; bg: string }> = {
    "0_30": { label: "0–30d", color: "#15803d", bg: "rgba(22,101,52,0.12)" },
    "31_60": { label: "31–60", color: "#b45309", bg: "rgba(180,83,9,0.12)" },
    "61_90": { label: "61–90", color: "#dc2626", bg: "rgba(220,38,38,0.10)" },
    "90_plus": { label: "90+", color: "#7f1d1d", bg: "rgba(127,29,29,0.14)" },
  };
  const t = map[bucket];
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        padding: "2px 8px",
        borderRadius: 4,
        color: t.color,
        background: t.bg,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {t.label}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const tdStyle: React.CSSProperties = {
  padding: "10px 10px",
  verticalAlign: "middle",
};
