"use client";

export function UndoApproveButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        e.preventDefault();
        const step1 = confirm(
          "⚠ Cancel Cutting?\n\nAfter this action, the block and its slabs will go back to Pending Approval. The cutting progress will be lost."
        );
        if (!step1) return;
        const step2 = confirm(
          "Are you sure you want to cancel cutting?\n\nThis cannot be undone — the operator will need to re-approve the block to resume."
        );
        if (!step2) return;
        (e.target as HTMLButtonElement).form?.requestSubmit();
      }}
      style={{
        fontSize: 12,
        padding: "5px 14px",
        borderRadius: 6,
        cursor: "pointer",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        color: "var(--muted)",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      ✕ Cancel Cutting
    </button>
  );
}
