"use client";

/**
 * Client-side wrapper for the two operator-aware actions on a
 * Pending Approval card:
 *
 *   • "Send to Cutting →" — opens the OperatorModal in approve mode.
 *     Picking an operator runs approveBlockWithOperatorAction;
 *     "Approve without operator" runs approveBlockSkipOperatorAction
 *     (same effect as the original approveBlockAction but reachable
 *     from inside the modal).
 *
 *   • "👷 Assign operator" — opens the modal in assign-only mode.
 *     No status change; operator_id is set or cleared.
 *
 * Renders only when the parent passes server actions, which only
 * happens for users where canManageOperators(profile) is true. For
 * everyone else, the parent keeps rendering the original form-submit
 * "Send to Cutting →" button untouched.
 */

import { useState, useTransition } from "react";
import { OperatorModal, type OperatorOption } from "./operator-modal";

type ApproveResult = { success?: boolean; error?: string };
type AssignResult = { success?: boolean; error?: string; operatorName?: string | null };
type AddOperatorResult = { id?: string; name?: string; error?: string };

export function PendingApprovalActions({
  sessionBlockId,
  sessionId,
  blockCode,
  initialOperatorId,
  initialOperatorName,
  operators,
  approveAction,
  approveSkipAction,
  assignAction,
  addOperatorAction,
}: {
  sessionBlockId: string;
  sessionId: string;
  blockCode: string;
  initialOperatorId: string | null;
  initialOperatorName: string | null;
  operators: OperatorOption[];
  approveAction: (
    sessionBlockId: string,
    sessionId: string,
    operatorId: string,
  ) => Promise<ApproveResult>;
  approveSkipAction: (
    sessionBlockId: string,
    sessionId: string,
  ) => Promise<ApproveResult>;
  assignAction: (
    sessionBlockId: string,
    operatorId: string | null,
  ) => Promise<AssignResult>;
  addOperatorAction: (rawName: string) => Promise<AddOperatorResult>;
}) {
  const [mode, setMode] = useState<"approve" | "assign-only" | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSkipOperator() {
    startTransition(async () => {
      await approveSkipAction(sessionBlockId, sessionId);
      setMode(null);
    });
  }

  return (
    <>
      <button
        type="button"
        className="primary-button"
        onClick={() => setMode("approve")}
        disabled={pending}
        style={{ fontSize: 13 }}
      >
        Send to Cutting →
      </button>
      <button
        type="button"
        onClick={() => setMode("assign-only")}
        disabled={pending}
        title={
          initialOperatorName
            ? `Currently assigned: ${initialOperatorName} (click to change)`
            : "Tag this block with an operator without changing its status"
        }
        style={{
          fontSize: 12,
          padding: "5px 12px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: initialOperatorName ? "rgba(232,197,114,0.18)" : "transparent",
          color: initialOperatorName ? "var(--gold-dark)" : "var(--muted)",
          fontWeight: 600,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        👷 {initialOperatorName ?? "Assign operator"}
      </button>

      <OperatorModal
        open={mode !== null}
        onClose={() => setMode(null)}
        mode={mode === "assign-only" ? "assign-only" : "approve"}
        blockCode={blockCode}
        sessionBlockId={sessionBlockId}
        sessionId={sessionId}
        initialOperatorId={initialOperatorId}
        operators={operators}
        approveAction={approveAction}
        assignAction={assignAction}
        addOperatorAction={addOperatorAction}
        onPlainApprove={mode === "approve" ? handleSkipOperator : undefined}
      />
    </>
  );
}
