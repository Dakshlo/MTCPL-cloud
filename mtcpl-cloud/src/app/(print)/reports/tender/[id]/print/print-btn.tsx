"use client";

export function PrintBtn() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ fontSize: 12, fontWeight: 800, padding: "7px 16px", borderRadius: 8, border: "none", background: "#fff", color: "#1a1a1a", cursor: "pointer" }}
    >
      🖨 Print / Save PDF
    </button>
  );
}
