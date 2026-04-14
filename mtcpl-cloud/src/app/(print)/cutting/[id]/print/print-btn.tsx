"use client";

export function PrintBtn() {
  return (
    <button
      className="print-action-btn"
      onClick={() => window.print()}
      type="button"
    >
      🖨 Print
    </button>
  );
}
