"use client";

export function PrintButton() {
  return (
    <button className="secondary-button" onClick={() => window.print()} type="button">
      Print Cutting Sheet
    </button>
  );
}
