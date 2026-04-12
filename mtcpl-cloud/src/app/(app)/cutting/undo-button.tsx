"use client";

export function UndoButton({ label = "↩ Undo", message }: { label?: string; message: string }) {
  return (
    <button
      className="ghost-button"
      type="submit"
      style={{ fontSize: 12 }}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {label}
    </button>
  );
}
