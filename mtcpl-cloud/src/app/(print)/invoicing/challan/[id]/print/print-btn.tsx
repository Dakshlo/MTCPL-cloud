"use client";

export function PrintBtn() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ background: "#b87333", color: "#fff", border: "none", padding: "8px 22px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" }}
    >
      🖨 Print
    </button>
  );
}
