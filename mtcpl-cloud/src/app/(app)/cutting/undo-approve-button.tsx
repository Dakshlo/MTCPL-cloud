"use client";

export function UndoApproveButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Undo approval? This will move the block back to Pending Approval.")) e.preventDefault();
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
      ↩ Undo Approve
    </button>
  );
}
