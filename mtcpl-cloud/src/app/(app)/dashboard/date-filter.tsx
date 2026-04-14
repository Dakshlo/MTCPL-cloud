"use client";

export function DateFilter({ value }: { value: string }) {
  return (
    <input
      type="date"
      defaultValue={value}
      max={new Date().toISOString().split("T")[0]}
      onChange={(e) => {
        if (e.target.value) {
          window.location.href = `/dashboard?date=${e.target.value}`;
        }
      }}
      style={{
        fontSize: 12,
        padding: "5px 8px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--surface)",
        color: "var(--text)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    />
  );
}
