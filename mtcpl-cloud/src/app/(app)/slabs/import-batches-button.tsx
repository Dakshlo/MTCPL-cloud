"use client";

// Mig 122 — "Batches" button on Required Sizes. Shows every import batch
// (pending / approved / rejected, newest first) in a center-peek modal:
// status, temple, counts, who submitted/reviewed, a row-preview table and
// a download link for the stored Excel audit copy. Read-only here —
// approval happens on /tasks/slab-imports.

import { useMemo, useState } from "react";
import { getSlabImportFileUrlAction, loadMoreImportBatchesAction, getImportBatchSlabsAction } from "./actions";

export type ImportBatchRowPreview = {
  label: string;
  description: string | null;
  length: number;
  width: number;
  height: number;
  quantity: number;
  quality: string | null;
  priority: boolean;
  componentSection?: string | null;
  componentElement?: string | null;
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
  /** The slab-group id stamped on every slab this batch created (mig 122).
   *  Present once approved — lets "🔢 Codes" list the real slabs + status. */
  slabBatchId: string | null;
};

/** One created slab of an approved batch (for the "🔢 Codes" view). */
export type BatchSlab = {
  id: string;
  label: string | null;
  description: string | null;
  length: number;
  width: number;
  height: number;
  status: string;
};

const STATUS_META: Record<ImportBatch["status"], { label: string; fg: string; bg: string; icon: string }> = {
  pending: { label: "Waiting approval", fg: "#854d0e", bg: "rgba(234,179,8,0.18)", icon: "⏳" },
  approved: { label: "Approved", fg: "#166534", bg: "rgba(22,163,74,0.15)", icon: "✅" },
  rejected: { label: "Rejected", fg: "#991b1b", bg: "rgba(220,38,38,0.12)", icon: "✕" },
};

// Friendly label + colour for a slab's CURRENT status, so the "🔢 Codes" view
// tells the team where each created slab actually is now.
const SLAB_STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  open: { label: "Required (open)", fg: "#1d4ed8", bg: "rgba(37,99,235,0.12)" },
  planned: { label: "Planned", fg: "#7c3aed", bg: "rgba(124,58,237,0.12)" },
  cut_done: { label: "Cut · at carving", fg: "#b45309", bg: "rgba(180,83,9,0.14)" },
  carving_assigned: { label: "Carving assigned", fg: "#b45309", bg: "rgba(180,83,9,0.14)" },
  carving_in_progress: { label: "Carving WIP", fg: "#b45309", bg: "rgba(180,83,9,0.14)" },
  carving_on_hold: { label: "Carving on hold", fg: "#92400e", bg: "rgba(146,64,14,0.16)" },
  completed: { label: "Ready to dispatch", fg: "#0f766e", bg: "rgba(15,118,110,0.13)" },
  dispatched: { label: "Dispatched", fg: "#166534", bg: "rgba(22,101,52,0.14)" },
  delivered: { label: "Delivered", fg: "#166534", bg: "rgba(22,101,52,0.14)" },
  rejected: { label: "Rejected", fg: "#991b1b", bg: "rgba(220,38,38,0.12)" },
  cancelled: { label: "Cancelled", fg: "#991b1b", bg: "rgba(220,38,38,0.12)" },
};
function slabStatusMeta(s: string) {
  return SLAB_STATUS_META[s] ?? { label: s.replace(/_/g, " "), fg: "#475569", bg: "rgba(71,85,105,0.12)" };
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function ImportBatchesButton({ batches, totalCount }: { batches: ImportBatch[]; totalCount?: number }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // "Load more" — older batches fetched on demand, appended + deduped so the
  // team can scroll all the way back (e.g. to verify a 30-Jun import).
  const [extra, setExtra] = useState<ImportBatch[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  // "🔢 Codes" — the real slabs an approved batch created (code + current
  // status), fetched on demand + cached per batch.
  const [codesFor, setCodesFor] = useState<string | null>(null);
  const [codesData, setCodesData] = useState<Record<string, BatchSlab[]>>({});
  const [codesLoading, setCodesLoading] = useState<string | null>(null);
  const [codesErr, setCodesErr] = useState<string | null>(null);

  async function toggleCodes(b: ImportBatch) {
    if (codesFor === b.id) { setCodesFor(null); return; }
    setCodesFor(b.id);
    setCodesErr(null);
    if (!codesData[b.id] && b.slabBatchId) {
      setCodesLoading(b.id);
      const res = await getImportBatchSlabsAction(b.slabBatchId);
      setCodesLoading(null);
      if (res.ok) setCodesData((m) => ({ ...m, [b.id]: res.slabs }));
      else setCodesErr(res.error);
    }
  }

  const allBatches = useMemo(() => {
    const seen = new Set<string>();
    const out: ImportBatch[] = [];
    for (const b of [...batches, ...extra]) {
      if (!seen.has(b.id)) { seen.add(b.id); out.push(b); }
    }
    return out;
  }, [batches, extra]);
  const pendingCount = allBatches.filter((b) => b.status === "pending").length;
  const total = totalCount ?? allBatches.length;
  const hasMore = !done && allBatches.length < total;

  async function loadMore() {
    if (loadingMore || done) return;
    setLoadingMore(true);
    try {
      const res = await loadMoreImportBatchesAction(allBatches.length);
      setExtra((prev) => [...prev, ...res.batches]);
      if (res.done || res.batches.length === 0) setDone(true);
    } catch {
      /* leave the button so the user can retry */
    } finally {
      setLoadingMore(false);
    }
  }

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
                  {total > 0 && <> · Showing <strong>{allBatches.length}</strong> of <strong>{total}</strong></>}
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }}>×</button>
            </div>

            <div style={{ maxHeight: "68vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {allBatches.length === 0 ? (
                <div className="muted" style={{ padding: 24, fontSize: 13 }}>No import batches yet — use 📥 Import from Excel to create the first one.</div>
              ) : (
                allBatches.map((b) => {
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
                        {b.status === "approved" && b.slabBatchId && (
                          <button type="button" onClick={() => toggleCodes(b)} style={{ fontSize: 12, fontWeight: 700, color: "#0f766e", background: codesFor === b.id ? "rgba(15,118,110,0.1)" : "none", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>
                            {codesFor === b.id ? "Hide codes" : "🔢 Codes & status"}
                          </button>
                        )}
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
                                {["#", "Cat 1", "Cat 2", "Label", "Description", "L (in)", "W (in)", "H (in)", "Qty", "Quality", "⚡"].map((h) => (
                                  <th key={h} style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {b.rows.map((r, i) => (
                                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                                  <td style={{ padding: "5px 8px", fontSize: 11.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12.5, fontWeight: 600 }}>{r.componentSection || "—"}</td>
                                  <td style={{ padding: "5px 8px", fontSize: 12 }}>{r.componentElement || "—"}</td>
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
                      {codesFor === b.id && (
                        <div style={{ marginTop: 4, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                          {codesLoading === b.id ? (
                            <div className="muted" style={{ padding: 14, fontSize: 12.5 }}>Loading slab codes…</div>
                          ) : codesErr ? (
                            <div style={{ padding: 14, fontSize: 12.5, color: "#991b1b" }}>⚠ {codesErr}</div>
                          ) : (codesData[b.id] ?? []).length === 0 ? (
                            <div className="muted" style={{ padding: 14, fontSize: 12.5 }}>No slabs found for this batch — they may have been deleted since.</div>
                          ) : (
                            <>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "9px 12px", background: "var(--surface-alt, rgba(0,0,0,0.03))", borderBottom: "1px solid var(--border)" }}>
                                <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>{(codesData[b.id] ?? []).length} slab{(codesData[b.id] ?? []).length === 1 ? "" : "s"} · where they are now:</span>
                                {[...(codesData[b.id] ?? []).reduce((m, s) => m.set(s.status, (m.get(s.status) ?? 0) + 1), new Map<string, number>()).entries()]
                                  .sort((a, z) => z[1] - a[1])
                                  .map(([st, n]) => {
                                    const m = slabStatusMeta(st);
                                    return <span key={st} style={{ fontSize: 11, fontWeight: 800, color: m.fg, background: m.bg, borderRadius: 999, padding: "2px 9px" }}>{n} {m.label}</span>;
                                  })}
                              </div>
                              <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                                  <thead>
                                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)", position: "sticky", top: 0 }}>
                                      {["#", "Slab code", "Item", "Size (in)", "Status now"].map((h) => (
                                        <th key={h} style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left", padding: "6px 10px", whiteSpace: "nowrap" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(codesData[b.id] ?? []).map((s, i) => {
                                      const m = slabStatusMeta(s.status);
                                      return (
                                        <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                          <td style={{ padding: "5px 10px", fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                                          <td style={{ padding: "5px 10px", fontSize: 12.5, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{s.id}</td>
                                          <td style={{ padding: "5px 10px", fontSize: 12 }}>{[s.label, s.description].filter(Boolean).join(" · ") || "—"}</td>
                                          <td style={{ padding: "5px 10px", fontSize: 12, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{s.length}×{s.width}×{s.height}</td>
                                          <td style={{ padding: "5px 10px" }}><span style={{ fontSize: 11, fontWeight: 800, color: m.fg, background: m.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{m.label}</span></td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Load more — older batches, so the team can scroll all the way
                  back (e.g. to check a 30-Jun import). */}
              {allBatches.length > 0 && (
                <div style={{ padding: "14px 18px", textAlign: "center" }}>
                  {hasMore ? (
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="secondary-button"
                      style={{ minWidth: 180, cursor: loadingMore ? "wait" : "pointer" }}
                    >
                      {loadingMore ? "Loading…" : `⬇ Load older batches (${Math.max(0, total - allBatches.length)} more)`}
                    </button>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>— all {allBatches.length} batches loaded —</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
