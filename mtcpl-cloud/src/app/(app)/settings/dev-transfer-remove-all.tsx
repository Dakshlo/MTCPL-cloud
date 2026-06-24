"use client";

// "Remove all" for one basket — confirms before wiping every file in it.

import { deleteAllDevTransferAction } from "./actions";

export function DevTransferRemoveAll({ paths, label }: { paths: string[]; label: string }) {
  return (
    <form
      action={deleteAllDevTransferAction}
      onSubmit={(e) => {
        if (!window.confirm(`Remove all ${paths.length} file${paths.length !== 1 ? "s" : ""} in ${label}'s basket? This can't be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="paths" value={JSON.stringify(paths)} />
      <button
        type="submit"
        style={{ fontSize: 12, fontWeight: 800, color: "#b91c1c", background: "none", border: "1px solid rgba(185,28,28,0.4)", borderRadius: 7, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        🗑 Remove all
      </button>
    </form>
  );
}
