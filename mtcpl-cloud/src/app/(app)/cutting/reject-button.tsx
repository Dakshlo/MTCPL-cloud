"use client";

export function RejectButton() {
  return (
    <button
      className="ghost-button"
      type="submit"
      onClick={(e) => {
        if (!confirm("Are you sure?")) e.preventDefault();
      }}
    >
      Reject
    </button>
  );
}
