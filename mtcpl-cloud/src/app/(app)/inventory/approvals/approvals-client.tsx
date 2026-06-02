"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveBatchAction,
  rejectBatchAction,
} from "../actions";
import { ComponentIcon } from "../_components/component-icon";
import { INV_THEME, primaryButton, secondaryButton } from "../_components/theme";
import type { MovementRow, ScaffoldingComponent, Site } from "../_components/stock";

type Batch = {
  batch_id: string;
  rows: MovementRow[];
  proposed_at: string;
  proposed_by: string;
  movement_type: MovementRow["movement_type"];
  from_site_id: string | null;
  to_site_id: string | null;
  batch_note: string | null;
};

export function ApprovalsClient({
  batches,
  sites,
  components,
  profilesMap,
}: {
  batches: Batch[];
  sites: Pick<Site, "id" | "code" | "name" | "is_plant">[];
  components: ScaffoldingComponent[];
  profilesMap: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const siteById = new Map(sites.map((s) => [s.id, s]));
  const componentById = new Map(components.map((c) => [c.id, c]));

  function siteLabel(id: string | null): string {
    if (!id) return "—";
    const s = siteById.get(id);
    if (!s) return "(unknown site)";
    return s.is_plant ? "Plant" : `${s.name} · ${s.code}`;
  }

  async function approve(batchId: string) {
    setError(null);
    setBusy(batchId);
    const res = await approveBatchAction(batchId);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function reject(batchId: string) {
    setError(null);
    if (!rejectNote.trim()) {
      setError("Add a note so the storekeeper knows what to fix.");
      return;
    }
    setBusy(batchId);
    const res = await rejectBatchAction(batchId, rejectNote.trim());
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRejectingId(null);
    setRejectNote("");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "rgba(193, 68, 46, 0.1)",
            color: INV_THEME.stockOut,
            fontSize: 13,
            fontWeight: 600,
            border: `1px solid ${INV_THEME.stockOut}`,
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}
      {batches.map((b) => {
        const totalQty = b.rows.reduce((s, r) => s + Number(r.qty ?? 0), 0);
        const proposerName = profilesMap[b.proposed_by] ?? "(unknown)";
        const isRejecting = rejectingId === b.batch_id;
        return (
          <article
            key={b.batch_id}
            style={{
              background: INV_THEME.paper,
              border: `1px solid ${INV_THEME.parchment}`,
              borderRadius: 12,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              boxShadow: "0 1px 0 rgba(28, 52, 69, 0.04)",
            }}
          >
            {/* Header */}
            <header
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                flexWrap: "wrap",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 800,
                      background: INV_THEME.steel,
                      color: "#fff",
                      borderRadius: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {b.movement_type}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: INV_THEME.steel,
                    }}
                  >
                    {siteLabel(b.from_site_id)} → {siteLabel(b.to_site_id)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: INV_THEME.steelLight,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>👤 {proposerName}</span>
                  <span>•</span>
                  <span>
                    {new Date(b.proposed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>•</span>
                  <span>
                    {b.rows.length} item{b.rows.length === 1 ? "" : "s"} ·{" "}
                    {totalQty.toLocaleString("en-IN")} pcs total
                  </span>
                </div>
                {b.batch_note && (
                  <div
                    style={{
                      fontSize: 12,
                      color: INV_THEME.steel,
                      background: INV_THEME.cream,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${INV_THEME.parchment}`,
                      marginTop: 4,
                      maxWidth: 600,
                    }}
                  >
                    📝 {b.batch_note}
                  </div>
                )}
              </div>

              {/* Actions */}
              {!isRejecting && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => approve(b.batch_id)}
                    style={{
                      ...primaryButton,
                      background: INV_THEME.stockHealthy,
                      borderColor: "#4a7040",
                    }}
                    disabled={busy === b.batch_id}
                  >
                    {busy === b.batch_id ? "Approving…" : "✓ Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectingId(b.batch_id);
                      setRejectNote("");
                      setError(null);
                    }}
                    style={{
                      ...secondaryButton,
                      color: INV_THEME.stockOut,
                      borderColor: "rgba(193, 68, 46, 0.3)",
                    }}
                    disabled={busy === b.batch_id}
                  >
                    Send back…
                  </button>
                </div>
              )}
            </header>

            {/* Items */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 8,
              }}
            >
              {b.rows.map((r) => {
                const c = componentById.get(r.component_id);
                return (
                  <div
                    key={r.id}
                    style={{
                      background: INV_THEME.cream,
                      border: `1px solid ${INV_THEME.parchment}`,
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: INV_THEME.steel }}>
                      <ComponentIcon
                        type={(c?.component_type ?? "other") as never}
                        size={32}
                        imageDataUrl={c?.image_data_url ?? undefined}
                      />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: INV_THEME.steel,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {c?.name ?? "(unknown)"}
                      </div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: INV_THEME.steel,
                          fontFeatureSettings: '"tnum"',
                          marginTop: 2,
                        }}
                      >
                        {/* Mig 083 — integer pcs display only. */}
                        {Math.round(Number(r.qty)).toLocaleString("en-IN")}{" "}
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: INV_THEME.steelLight,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                          }}
                        >
                          {c?.unit ?? "pcs"}
                        </span>
                      </div>
                      {r.proposed_note && (
                        <div
                          style={{
                            fontSize: 10,
                            color: INV_THEME.steelLight,
                            marginTop: 2,
                            fontStyle: "italic",
                          }}
                        >
                          “{r.proposed_note}”
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reject form */}
            {isRejecting && (
              <div
                style={{
                  background: "rgba(193, 68, 46, 0.05)",
                  border: `1px dashed ${INV_THEME.stockOut}`,
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: INV_THEME.stockOut,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Send back to storekeeper — what needs fixing?
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={2}
                  placeholder="Example: Qty looks too high for Standard 2.5m — recount at the yard before resubmitting."
                  style={{
                    padding: "8px 10px",
                    fontSize: 13,
                    border: `1px solid ${INV_THEME.parchment}`,
                    borderRadius: 6,
                    background: "#fff",
                    color: INV_THEME.steel,
                    resize: "vertical",
                  }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectingId(null);
                      setRejectNote("");
                      setError(null);
                    }}
                    style={secondaryButton}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(b.batch_id)}
                    style={{
                      ...primaryButton,
                      background: INV_THEME.stockOut,
                      borderColor: INV_THEME.stockOut,
                    }}
                    disabled={busy === b.batch_id}
                  >
                    {busy === b.batch_id ? "Sending back…" : "Send back"}
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
