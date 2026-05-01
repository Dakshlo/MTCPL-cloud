"use client";

/**
 * Operator pick modal — center-peek surface used in two flows:
 *
 *   1. "Send to Cutting" on a Pending Approval block — primary CTA
 *      runs approveBlockWithOperatorAction (assign + flip to
 *      pending_cut). Tag: mode="approve".
 *
 *   2. "Assign operator" on a Pending Approval block (no status
 *      change) — primary CTA runs assignOperatorOnlyAction.
 *      Tag: mode="assign-only".
 *
 * Both modes share the same picker UI: a list of active operators,
 * an inline "+ Add operator" form, an optional initial selection
 * (current assignment if any), and an "Approve without operator"
 * fallback (only in mode="approve") that calls the original
 * operator-less approveBlockAction.
 *
 * Gated to developer only via the parent — when the parent doesn't
 * pass approveAction / assignAction the buttons that open the modal
 * never render.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

export type OperatorOption = {
  id: string;
  name: string;
};

type Mode = "approve" | "assign-only";

type ApproveResult = { success?: boolean; error?: string };
type AssignResult = { success?: boolean; error?: string; operatorName?: string | null };
type AddOperatorResult = { id?: string; name?: string; error?: string };

export function OperatorModal({
  open,
  onClose,
  mode,
  blockCode,
  sessionBlockId,
  sessionId,
  initialOperatorId,
  operators,
  approveAction,
  assignAction,
  addOperatorAction,
  onPlainApprove,
}: {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  /** Human-readable block id (e.g. MT-B-064) shown in the header. */
  blockCode: string;
  sessionBlockId: string;
  sessionId: string;
  initialOperatorId?: string | null;
  operators: OperatorOption[];
  approveAction?: (
    sessionBlockId: string,
    sessionId: string,
    operatorId: string,
  ) => Promise<ApproveResult>;
  assignAction?: (
    sessionBlockId: string,
    operatorId: string | null,
  ) => Promise<AssignResult>;
  addOperatorAction: (rawName: string) => Promise<AddOperatorResult>;
  /** Optional fallback for "approve without operator" — the original
   *  approveBlockAction wired through the parent. Only relevant in
   *  mode='approve'. */
  onPlainApprove?: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialOperatorId ?? null);
  const [newName, setNewName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [localOps, setLocalOps] = useState<OperatorOption[]>(operators);

  // Reset local state every time the modal opens. Prevents stale
  // selection from leaking between blocks when the parent reuses one
  // modal instance for many cards.
  useEffect(() => {
    if (open) {
      setSelectedId(initialOperatorId ?? null);
      setNewName("");
      setErrorMsg(null);
      setLocalOps(operators);
    }
  }, [open, initialOperatorId, operators]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sortedOps = useMemo(
    () => [...localOps].sort((a, b) => a.name.localeCompare(b.name)),
    [localOps],
  );

  function handleAddOperator() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setErrorMsg("Enter a name first.");
      return;
    }
    setErrorMsg(null);
    startTransition(async () => {
      const result = await addOperatorAction(trimmed);
      if (result.error) {
        setErrorMsg(result.error);
        return;
      }
      if (result.id && result.name) {
        // Add to local list (if not already there) and select it.
        setLocalOps((prev) =>
          prev.find((o) => o.id === result.id) ? prev : [...prev, { id: result.id!, name: result.name! }],
        );
        setSelectedId(result.id);
        setNewName("");
      }
    });
  }

  function handleApprove() {
    if (!selectedId) {
      setErrorMsg("Pick an operator first, or use 'Approve without operator' below.");
      return;
    }
    if (!approveAction) {
      setErrorMsg("Approve action not available.");
      return;
    }
    setErrorMsg(null);
    startTransition(async () => {
      const result = await approveAction(sessionBlockId, sessionId, selectedId);
      if (result.error) {
        setErrorMsg(result.error);
        return;
      }
      onClose();
    });
  }

  function handleAssignOnly() {
    if (!assignAction) {
      setErrorMsg("Assign action not available.");
      return;
    }
    setErrorMsg(null);
    startTransition(async () => {
      const result = await assignAction(sessionBlockId, selectedId);
      if (result.error) {
        setErrorMsg(result.error);
        return;
      }
      onClose();
    });
  }

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 12, 6, 0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: 560,
          maxHeight: "78vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>
              {mode === "approve" ? "👷 Pick operator & send to cutting" : "👷 Assign operator"}
            </h2>
            <kbd
              style={{
                fontSize: 10,
                padding: "2px 6px",
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--muted)",
                fontFamily: "ui-monospace, monospace",
              }}
              title="Close"
            >
              Esc
            </kbd>
          </div>
          <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
            Block <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--gold-dark)" }}>{blockCode}</strong>
            {mode === "approve"
              ? " — picking an operator will send the block to Waiting to Cut."
              : " — assigning won't change the block's status (stays Pending Approval)."}
          </p>
        </div>

        {/* Operator list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
          {sortedOps.length === 0 ? (
            <div style={{ padding: "24px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No operators yet. Add one below to get started.
            </div>
          ) : (
            sortedOps.map((op) => {
              const isSelected = op.id === selectedId;
              return (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setSelectedId(op.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 18px",
                    background: isSelected ? "rgba(232,197,114,0.18)" : "transparent",
                    border: "none",
                    borderLeft: isSelected ? "3px solid var(--gold-dark)" : "3px solid transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 14,
                    color: "var(--text)",
                    transition: "background 0.08s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "var(--surface-alt)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `2px solid ${isSelected ? "var(--gold-dark)" : "var(--border)"}`,
                    background: isSelected ? "var(--gold-dark)" : "transparent",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontWeight: isSelected ? 700 : 500 }}>{op.name}</span>
                </button>
              );
            })
          )}
          {/* Clear selection (only in assign-only mode) */}
          {mode === "assign-only" && selectedId && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 18px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "#b91c1c",
                marginTop: 4,
              }}
            >
              ✕ Clear current assignment
            </button>
          )}
        </div>

        {/* Add operator inline */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border-light)", background: "var(--bg)" }}>
          <p className="muted" style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            ➕ Add new operator
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddOperator();
                }
              }}
              placeholder="Operator name (e.g. Ramesh)"
              maxLength={80}
              disabled={pending}
              style={{
                flex: 1,
                fontSize: 13,
                padding: "7px 10px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
                color: "var(--text)",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={handleAddOperator}
              disabled={pending || !newName.trim()}
              style={{
                fontSize: 12,
                padding: "7px 14px",
                background: "var(--gold)",
                color: "#1a1a1a",
                border: "1px solid var(--gold-dark)",
                borderRadius: 6,
                fontWeight: 700,
                cursor: pending || !newName.trim() ? "not-allowed" : "pointer",
                opacity: pending || !newName.trim() ? 0.5 : 1,
              }}
            >
              Add & select
            </button>
          </div>
        </div>

        {errorMsg && (
          <div style={{
            padding: "8px 18px",
            background: "rgba(220,38,38,0.08)",
            color: "#b91c1c",
            fontSize: 12,
            borderTop: "1px solid rgba(220,38,38,0.25)",
          }}>
            ⚠ {errorMsg}
          </div>
        )}

        {/* Action footer */}
        <div style={{
          padding: "12px 18px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="ghost-button"
            style={{ fontSize: 13 }}
          >
            Cancel
          </button>
          {mode === "approve" && onPlainApprove && (
            <button
              type="button"
              onClick={() => { onPlainApprove(); onClose(); }}
              disabled={pending}
              className="ghost-button"
              style={{ fontSize: 12 }}
              title="Approve without picking an operator (block goes to Waiting to Cut, no operator tag)"
            >
              Approve without operator
            </button>
          )}
          <button
            type="button"
            onClick={mode === "approve" ? handleApprove : handleAssignOnly}
            disabled={pending || (mode === "approve" && !selectedId)}
            className="primary-button"
            style={{ fontSize: 13 }}
          >
            {pending
              ? "Working…"
              : mode === "approve"
                ? "Approve & send to cutting →"
                : "Save assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}
