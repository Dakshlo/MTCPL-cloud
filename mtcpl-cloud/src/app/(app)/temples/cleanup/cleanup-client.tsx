"use client";

/**
 * Uncategorized-open-slab cleanup — client (Daksh June 2026).
 *
 * Per temple: download the Excel record, then soft-archive (status
 * 'rejected') every open slab with no Category 1 / Category 2. The Excel
 * download is forced before the Remove button unlocks, so there's always a
 * record + a re-import source.
 */

import { useState, useTransition } from "react";
import { archiveUncategorizedOpenSlabsAction } from "../../slabs/actions";

export type TempleCount = { temple: string; count: number };

const btn = {
  base: { fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "8px 14px", cursor: "pointer", whiteSpace: "nowrap" as const, border: "1px solid var(--border)" },
} as const;

function exportUrl(temple: string) {
  return `/api/slabs/uncategorized-export?temple=${encodeURIComponent(temple)}`;
}

export function CleanupClient({ temples }: { temples: TempleCount[] }) {
  const [counts] = useState<Record<string, number>>(() => Object.fromEntries(temples.map((t) => [t.temple, t.count])));
  const [removed, setRemoved] = useState<Record<string, number>>({});
  const [modalTemple, setModalTemple] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  function openModal(temple: string) {
    setModalTemple(temple);
    setDownloaded(false);
    setError("");
  }
  function closeModal() {
    if (busy) return;
    setModalTemple(null);
  }

  function downloadExcel(temple: string) {
    const a = document.createElement("a");
    a.href = exportUrl(temple);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setDownloaded(true);
  }

  function doRemove(temple: string) {
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.set("temple", temple);
    startTransition(async () => {
      const res = await archiveUncategorizedOpenSlabsAction(fd);
      if (res.ok) {
        setRemoved((m) => ({ ...m, [temple]: res.count }));
        setBusy(false);
        setModalTemple(null);
      } else {
        setBusy(false);
        setError(res.error);
      }
    });
  }

  const th = { fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left" as const, padding: "8px 10px", whiteSpace: "nowrap" as const };
  const td = { padding: "8px 10px", fontSize: 13, verticalAlign: "middle" as const } as const;
  const modalCount = modalTemple ? (counts[modalTemple] ?? 0) : 0;

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={th}>Temple</th>
            <th style={{ ...th, textAlign: "right" }}>Open · uncategorized</th>
            <th style={{ ...th, width: 260 }}></th>
          </tr>
        </thead>
        <tbody>
          {temples.map((t) => {
            const done = removed[t.temple];
            return (
              <tr key={t.temple} style={{ borderBottom: "1px solid var(--border)", opacity: done != null ? 0.65 : 1 }}>
                <td style={{ ...td, fontWeight: 600 }}>{t.temple}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                  {(counts[t.temple] ?? 0).toLocaleString("en-IN")}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  {done != null ? (
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#15803d" }}>✓ Removed {done.toLocaleString("en-IN")} · archived</span>
                  ) : (
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <a href={exportUrl(t.temple)} style={{ ...btn.base, color: "var(--gold-dark)", background: "transparent", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>⬇ Excel</a>
                      <button type="button" onClick={() => openModal(t.temple)} style={{ ...btn.base, color: "#991b1b", background: "rgba(220,38,38,0.06)", borderColor: "rgba(220,38,38,0.35)" }}>🗑 Remove</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {modalTemple && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }} style={{ position: "fixed", inset: 0, left: "var(--content-left)", background: "rgba(15,12,6,0.55)", backdropFilter: "blur(2px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.45)", width: "100%", maxWidth: 480, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Remove {modalCount.toLocaleString("en-IN")} slab{modalCount === 1 ? "" : "s"} from {modalTemple}?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
              These are <strong>open</strong> slabs with <strong>no Category 1 and no Category 2</strong>. They&apos;ll be <strong>soft-archived</strong> (status → rejected): gone from Temple View, but recoverable. <strong>Download the Excel first</strong> — it&apos;s your only record of what was removed.
            </div>

            <button type="button" onClick={() => downloadExcel(modalTemple)} style={{ ...btn.base, color: downloaded ? "#15803d" : "#fff", background: downloaded ? "rgba(22,163,74,0.1)" : "var(--gold-dark)", borderColor: downloaded ? "rgba(22,163,74,0.4)" : "var(--gold-dark)", textAlign: "center" }}>
              {downloaded ? "✓ Excel downloaded — download again" : `⬇ Download Excel of these ${modalCount.toLocaleString("en-IN")} slabs`}
            </button>

            {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              <button type="button" disabled={busy} onClick={closeModal} className="ghost-button">Cancel</button>
              <button
                type="button"
                disabled={busy || !downloaded}
                onClick={() => doRemove(modalTemple)}
                title={!downloaded ? "Download the Excel first" : undefined}
                style={{ ...btn.base, color: "#fff", background: busy || !downloaded ? "var(--border)" : "#b91c1c", borderColor: "transparent", cursor: busy || !downloaded ? "not-allowed" : "pointer" }}
              >
                {busy ? "Removing…" : `🗑 Remove ${modalCount.toLocaleString("en-IN")}`}
              </button>
            </div>
            {!downloaded && <div style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "right" }}>Download the Excel to unlock Remove.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
