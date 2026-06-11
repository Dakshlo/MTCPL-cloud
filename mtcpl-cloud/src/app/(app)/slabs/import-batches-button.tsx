"use client";

// Mig 122 — "Batches" button on Required Sizes. Shows every import batch
// (pending / approved / rejected, newest first) in a center-peek modal:
// status, temple, counts, who submitted/reviewed, a row-preview table and
// a download link for the stored Excel audit copy. Read-only here —
// approval happens on /tasks/slab-imports.

import { useState } from "react";
import { getSlabImportFileUrlAction } from "./actions";

export type ImportBatchRowPreview = {
  label: string;
  description: string | null;
  length: number;
  width: number;
  height: number;
  quantity: number;
  quality: string | null;
  priority: boolean;
};

export type ImportBatch = {
  id: string;
  temple: string;
  stone: string;
  rows: ImportBatchRowPreview[];
  rowCount: number;
  slabCount: number;
  fileName: string | null;
  status: "pending" | "approved" | "rejected";
  submittedByName: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

const STATUS_META: Record<ImportBatch["status"], { label: string; fg: string; bg: string; icon: string }> = {
  pending: { label: "Waiting approval", fg: "#854d0e", bg: "rgba(234,179,8,0.18)", icon: "⏳" },
  approved: { label: "Approved", fg: "#166534", bg: "rgba(22,163,74,0.15)", icon: "✅" },
  rejected: { label: "Rejected", fg: "#991b1b", bg: "rgba(220,38,38,0.12)", icon: "✕" },
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function ImportBatchesButton({ batches }: { batches: ImportBatch[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const pendingCount = batches.filter((b) => b.status === "pending").length;

  async function downloadExcel(batchId: string) {
    if (downloading) return;
    setDownloading(batchId);
    try {
      const res = await getSlabImportFileUrlAction(batchId);
      if (res.ok) window.open(res.url, "_blank", "noopener");
      else alert(res.error);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="secondary-button" style={{ position: "relative" }}>
        🗂 Batches
        {pendingCount > 0 && (
          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#854d0e", background: "rgba(234,179,8,0.25)", borderRadius: 999, padding: "1px 8px" }}>
            {pendingCount} waiting
          </span>
        )}
      </button>

      {open && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,12,6,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
          <div role="dialog" aria-modal="true" style={{ width: "100%", maxWidth: 860, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>🗂 Import batches</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Every Excel import, newest first. Slabs are created only after a batch is approved.
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }}>×</button>
            </div>

            <div style={{ maxHeight: "68vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {batches.length === 0 ? (
                <div className="muted" style={{ padding: 24, fontSize: 13 }}>No import batches yet — use 📥 Import from Excel to create the first one.</div>
              ) : (
                batches.map((b) => {
                  const meta = STATUS_META[b.status];
                  const isOpen = expanded === b.id;
                  return (
                    <div key={b.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: meta.fg, background: meta.bg, borderRadius: 999, padding: "3px 11px", whiteSpace: "nowrap" }}>
                          {meta.icon} {meta.label}
                        </span>
                        <span style={{ fontWeight: 800, fontSize: 14 }}>{b.temple}</span>
                        <span className="muted" style={{ fontSize: 12.5 }}>{b.stone} · {b.rowCount} row{b.rowCount === 1 ? "" : "s"} → <strong>{b.slabCount} slab{b.slabCount === 1 ? "" : "s"}</strong></span>
                        <span style={{ flex: 1 }} />
                        <button type="button" onClick={() => setExpanded(isOpen ? null : b.id)} style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>
                          {isOpen ? "Hide preview" : "Preview"}
                        </button>
                        <button type="button" disabled={downloading === b.id} onClick={() => downloadExcel(b.id)} style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 11px", cursor: downloading === b.id ? "wait" : "pointer" }}>
                          {downloading === b.id ? "…" : "⬇ Excel"}
                        </button>
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        Sent by <strong>{b.submittedByName ?? "—"}</strong> · {fmtWhen(b.submittedAt)}
                        {b.status !== "pending" && (
                          <> · {b.status === "approved" ? "Approved" : "Rejected"} by <strong>{b.reviewedByName ?? "—"}</strong> · {fmtWhen(b.reviewedAt)}</>
                        )}
                        {b.fileName && <> · 📄 {b.fileName}</>}
                      </div>
                      {b.status === "rejected" && b.reviewNote && (
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#991b1b" }}>Reason: {b.reviewNote}</div>
                      )}
                      {isOpen && (
                        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, marginTop: 4 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.03))" }}>
                                {["#", "Label", "Description", "L (in)", "W (in)", "H (in)", "Qty", "Quality", "⚡"].map((h) => (
                                  <th key={h} style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {b.rows.map((r, i) => (
                                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                                  <td style={{ padding: "5px 8px", fontSize: 11.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12.5, fontWeight: 600 }}>{r.label}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12 }}>{r.description ?? "—"}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12.5 }}>{r.length}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12.5 }}>{r.width}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12.5 }}>{r.height}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12.5, fontWeight: 700 }}>{r.quantity}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12 }}>{r.quality || "Both"}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12 }}>{r.priority ? "⚡" : ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
