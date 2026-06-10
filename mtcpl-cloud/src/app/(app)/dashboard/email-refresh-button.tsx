"use client";

// Manual "Refresh now" for the owner email snapshot (owner/dev only —
// the server route re-checks the role). POSTs to the same run endpoint
// the 5am/2pm crons call, then reloads the dashboard data.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EmailRefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/email-snapshot/run", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setErr(json.error ?? "Refresh failed.");
        return;
      }
      router.refresh();
    } catch {
      setErr("Refresh failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.7 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "⏳ Reading inbox…" : "↻ Refresh now"}
      </button>
      {err && <span style={{ fontSize: 11.5, color: "#b91c1c", fontWeight: 600 }}>⚠ {err}</span>}
    </span>
  );
}
