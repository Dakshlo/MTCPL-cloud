"use client";

// Print trigger for the invoice detail page. window.print() needs a
// client component because Server Components don't run in the browser.
// Extracted so the rest of the page can stay a Server Component +
// stream data from Supabase directly.

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.print();
      }}
      style={{
        padding: "8px 16px",
        fontSize: 12,
        fontWeight: 700,
        background: "var(--gold)",
        color: "#fff",
        border: "1px solid var(--gold-dark)",
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      🖨 Print invoice
    </button>
  );
}
