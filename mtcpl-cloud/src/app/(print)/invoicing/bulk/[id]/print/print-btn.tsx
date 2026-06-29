"use client";

export function PrintBtn() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ fontSize: 12, fontWeight: 700, padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer" }}
    >
      🖨 Print
    </button>
  );
}
