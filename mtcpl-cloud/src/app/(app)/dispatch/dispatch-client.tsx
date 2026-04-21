"use client";

/**
 * Dispatch station client — the page around the three tabs:
 *
 *   Ready             slabs grouped by temple, checkboxes, Dispatch button
 *   Out for delivery  open dispatches with Print & Mark delivered actions
 *   Delivered         archive of completed dispatches
 *
 * Selection state for the Ready tab is scoped per temple — picking a
 * slab from Aasta doesn't affect picks in Umiya Mataji.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DispatchModal } from "./dispatch-modal";
import { DeliverModal } from "./deliver-modal";
import { undoDispatchAction } from "./actions";

type Tab = "ready" | "out_for_delivery" | "delivered";

export type ReadySlab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  quality: string | null;
  dimensions: string;
  cft: number;
  priority: boolean;
  isMarble: boolean;
};

export type OutForDeliveryRow = {
  id: string;
  temple: string;
  vehicle_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  dispatched_at: string;
  expected_delivery_date: string | null;
  dispatcher: string | null;
  notes: string | null;
  slabCount: number;
  slabCftTotal: number;
};

export type DeliveredRow = OutForDeliveryRow & {
  delivered_at: string;
  delivered_by_name: string | null;
  receiver_name: string | null;
  delivery_note: string | null;
};

export type LegacyDispatch = {
  slab_id: string;
  dispatched_at: string;
  dispatched_by_name: string | null;
  note: string | null;
};

export function DispatchClient({
  readySlabs,
  outForDelivery,
  delivered,
  legacyDispatches,
  initialTab,
  toast,
  error,
}: {
  readySlabs: ReadySlab[];
  outForDelivery: OutForDeliveryRow[];
  delivered: DeliveredRow[];
  legacyDispatches: LegacyDispatch[];
  initialTab: Tab;
  toast: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = initialTab;

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dispatch_toast");
    params.delete("dispatch_error");
    if (next === "ready") params.delete("tab");
    else params.set("tab", next);
    const q = params.toString();
    router.replace(q ? `/dispatch?${q}` : "/dispatch");
  }

  const counts = {
    ready: readySlabs.length,
    out_for_delivery: outForDelivery.length,
    delivered: delivered.length,
  };

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            🚚 Dispatch Station
            <span
              className="role-pill"
              style={{ background: "var(--gold)", color: "#fff", fontWeight: 700, fontSize: 10 }}
            >
              DEV-ONLY
            </span>
          </h1>
          <p className="muted">
            Slabs with carving approved are ready to ship. Pick a temple, add truck + driver info, print the
            delivery challan, and mark delivered once the site engineer confirms receipt.
          </p>
        </div>
      </div>

      {/* Toast / error banners */}
      {toast && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "rgba(22,101,52,0.08)",
            border: "1px solid rgba(22,101,52,0.3)",
            borderRadius: 8,
            color: "#15803d",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {toast}
        </div>
      )}
      {error && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "rgba(185,28,28,0.08)",
            border: "1px solid rgba(185,28,28,0.3)",
            borderRadius: 8,
            color: "#b91c1c",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          margin: "20px 0 18px",
          borderBottom: "2px solid var(--border)",
        }}
      >
        {(
          [
            { key: "ready", label: "Ready to dispatch", count: counts.ready, color: "#b87333" },
            { key: "out_for_delivery", label: "Out for delivery", count: counts.out_for_delivery, color: "#2563EB" },
            { key: "delivered", label: "Delivered", count: counts.delivered, color: "#16A34A" },
          ] as const
        ).map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                background: "transparent",
                border: "none",
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? t.color : "var(--muted)",
                borderBottom: active ? `2px solid ${t.color}` : "2px solid transparent",
                marginBottom: -2,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              {t.label}
              <span
                style={{
                  background: active ? t.color : "var(--border)",
                  color: active ? "#fff" : "var(--muted)",
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 7px",
                  minWidth: 20,
                  textAlign: "center",
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "ready" && <ReadyTab slabs={readySlabs} />}
      {tab === "out_for_delivery" && <OutForDeliveryTab rows={outForDelivery} />}
      {tab === "delivered" && <DeliveredTab rows={delivered} legacy={legacyDispatches} />}
    </section>
  );
}

// ─── Ready tab ───────────────────────────────────────────────────────────

type TempleGroupKey = string; // "temple::category" — marble + sandstone stay separate

function ReadyTab({ slabs }: { slabs: ReadySlab[] }) {
  // Per-group selection: key = templeGroupKey, value = Set of slab ids
  const [selectionByGroup, setSelectionByGroup] = useState<Map<TempleGroupKey, Set<string>>>(new Map());
  const [openModal, setOpenModal] = useState<{ templeKey: TempleGroupKey; temple: string } | null>(null);

  const groups = useMemo(() => {
    // Group by `${temple}::${isMarble ? "marble" : "sandstone"}`
    const map = new Map<TempleGroupKey, { temple: string; isMarble: boolean; slabs: ReadySlab[] }>();
    for (const s of slabs) {
      const key = `${s.temple}::${s.isMarble ? "marble" : "sandstone"}`;
      if (!map.has(key)) map.set(key, { temple: s.temple, isMarble: s.isMarble, slabs: [] });
      map.get(key)!.slabs.push(s);
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.temple.localeCompare(b.temple) || (a.isMarble ? 1 : -1));
  }, [slabs]);

  function toggleSlab(groupKey: TempleGroupKey, slabId: string) {
    setSelectionByGroup((prev) => {
      const next = new Map(prev);
      const s = new Set(next.get(groupKey) ?? []);
      if (s.has(slabId)) s.delete(slabId);
      else s.add(slabId);
      next.set(groupKey, s);
      return next;
    });
  }

  function selectAll(groupKey: TempleGroupKey, slabIds: string[]) {
    setSelectionByGroup((prev) => {
      const next = new Map(prev);
      const curr = next.get(groupKey) ?? new Set<string>();
      const allSelected = slabIds.every((id) => curr.has(id));
      next.set(groupKey, allSelected ? new Set() : new Set(slabIds));
      return next;
    });
  }

  if (slabs.length === 0) {
    return (
      <div
        style={{
          padding: "32px 20px",
          textAlign: "center",
          color: "var(--muted)",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 10,
        }}
      >
        🎉 Nothing to dispatch right now. When carving jobs are approved, their slabs will queue up here.
      </div>
    );
  }

  return (
    <>
      {groups.map(({ key, temple, isMarble, slabs }) => {
        const selected = selectionByGroup.get(key) ?? new Set<string>();
        const allSlabIds = slabs.map((s) => s.id);
        const allSelected = allSlabIds.length > 0 && allSlabIds.every((id) => selected.has(id));
        const selectedSlabs = slabs
          .filter((s) => selected.has(s.id))
          .map((s) => ({
            id: s.id,
            label: s.label,
            dimensions: s.dimensions,
            cft: s.cft,
          }));
        const totalCft = slabs.reduce((sum, s) => sum + s.cft, 0);

        return (
          <div
            key={key}
            style={{
              marginBottom: 14,
              background: "var(--surface)",
              border: `1px solid ${isMarble ? "rgba(180,83,9,0.3)" : "var(--border)"}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {/* Group header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 14px",
                background: isMarble ? "rgba(180,83,9,0.05)" : "var(--bg)",
                borderBottom: "1px solid var(--border)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                  {isMarble ? "🗿" : "🏛"} {temple}
                </span>
                {isMarble && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#b45309",
                      background: "rgba(180,83,9,0.12)",
                      padding: "2px 8px",
                      borderRadius: 4,
                      letterSpacing: "0.04em",
                    }}
                  >
                    MARBLE
                  </span>
                )}
                <span className="muted" style={{ fontSize: 12 }}>
                  {slabs.length} slab{slabs.length !== 1 ? "s" : ""} · {totalCft.toFixed(2)} CFT
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => selectAll(key, allSlabIds)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11,
                    color: "var(--muted)",
                    cursor: "pointer",
                  }}
                >
                  {allSelected ? "Clear all" : "Select all"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenModal({ templeKey: key, temple })}
                  disabled={selected.size === 0}
                  style={{
                    background: selected.size === 0 ? "var(--border)" : "var(--gold)",
                    color: selected.size === 0 ? "var(--muted)" : "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: selected.size === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  🚚 Dispatch selected ({selected.size})
                </button>
              </div>
            </div>

            {/* Slab checklist */}
            <div style={{ padding: "8px 14px" }}>
              {slabs.map((s) => {
                const checked = selected.has(s.id);
                return (
                  <label
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 4px",
                      borderBottom: "1px dashed var(--border)",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSlab(key, s.id)}
                      style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#b87333" }}
                    />
                    <code style={{ fontSize: 12, fontWeight: 700, minWidth: 85 }}>{s.id}</code>
                    {s.label && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        {s.label}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
                      {s.stone ?? "—"} · {s.dimensions} · {s.cft.toFixed(2)} CFT
                    </span>
                    {s.quality && (
                      <span
                        className={`role-pill ${s.quality === "A" ? "badge-available" : "badge-reserved"}`}
                        style={{ fontSize: 9 }}
                      >
                        {s.quality}
                      </span>
                    )}
                    {s.priority && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#dc2626",
                          background: "rgba(220,38,38,0.1)",
                          padding: "1px 6px",
                          borderRadius: 3,
                          marginLeft: "auto",
                        }}
                      >
                        ⚡ URGENT
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      {openModal && (
        <DispatchModal
          temple={openModal.temple}
          selectedSlabs={
            groups
              .find((g) => g.key === openModal.templeKey)!
              .slabs.filter((s) => (selectionByGroup.get(openModal.templeKey) ?? new Set()).has(s.id))
              .map((s) => ({ id: s.id, label: s.label, dimensions: s.dimensions, cft: s.cft }))
          }
          onClose={() => setOpenModal(null)}
        />
      )}
    </>
  );
}

// ─── Out for delivery tab ────────────────────────────────────────────────

function OutForDeliveryTab({ rows }: { rows: OutForDeliveryRow[] }) {
  const [deliverRow, setDeliverRow] = useState<OutForDeliveryRow | null>(null);

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: "32px 20px",
          textAlign: "center",
          color: "var(--muted)",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 10,
        }}
      >
        🛣 No dispatches are currently on the road.
      </div>
    );
  }

  return (
    <>
      {rows.map((r) => (
        <DispatchRow key={r.id} row={r} onMarkDelivered={() => setDeliverRow(r)} />
      ))}
      {deliverRow && (
        <DeliverModal
          dispatchId={deliverRow.id}
          temple={deliverRow.temple}
          vehicleNo={deliverRow.vehicle_no}
          onClose={() => setDeliverRow(null)}
        />
      )}
    </>
  );
}

function DispatchRow({
  row,
  onMarkDelivered,
}: {
  row: OutForDeliveryRow;
  onMarkDelivered: () => void;
}) {
  const shortId = row.id.slice(0, 8).toUpperCase();
  const dispatchedAt = new Date(row.dispatched_at);
  const expected = row.expected_delivery_date
    ? new Date(row.expected_delivery_date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div
      style={{
        padding: "12px 16px",
        marginBottom: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        alignItems: "flex-start",
        justifyContent: "space-between",
      }}
    >
      <div style={{ flex: "1 1 300px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--muted)" }}>
            DISP-{shortId}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>🏛 {row.temple}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            · {row.slabCount} slab{row.slabCount !== 1 ? "s" : ""} · {row.slabCftTotal.toFixed(2)} CFT
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
          {row.vehicle_no && (
            <>
              Vehicle <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{row.vehicle_no}</strong>
            </>
          )}
          {row.driver_name && (
            <>
              {" · "}
              Driver <strong style={{ color: "var(--text)" }}>{row.driver_name}</strong>
              {row.driver_phone ? ` (${row.driver_phone})` : ""}
            </>
          )}
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: "var(--muted)" }}>
          Dispatched {dispatchedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}{" "}
          at {dispatchedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          {row.dispatcher ? ` by ${row.dispatcher}` : ""}
          {expected && ` · Expected delivery ${expected}`}
        </div>
        {row.notes && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
            “{row.notes}”
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <Link
          href={`/dispatch/${row.id}/print`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            textDecoration: "none",
            fontSize: 12,
            padding: "6px 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          🖨 Print challan
        </Link>
        <button
          type="button"
          onClick={onMarkDelivered}
          style={{
            background: "#16A34A",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ✓ Mark delivered
        </button>
        <form
          action={undoDispatchAction}
          onSubmit={(e) => {
            if (!confirm(`Undo this dispatch to ${row.temple}? Slabs will return to Ready queue.`)) {
              e.preventDefault();
            }
          }}
          style={{ display: "inline" }}
        >
          <input type="hidden" name="dispatch_id" value={row.id} />
          <button
            type="submit"
            className="ghost-button danger-ghost"
            style={{ fontSize: 11, padding: "5px 10px" }}
            title="Revert this dispatch — slabs go back to Ready"
          >
            Undo
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Delivered tab ───────────────────────────────────────────────────────

function DeliveredTab({ rows, legacy }: { rows: DeliveredRow[]; legacy: LegacyDispatch[] }) {
  if (rows.length === 0 && legacy.length === 0) {
    return (
      <div
        style={{
          padding: "32px 20px",
          textAlign: "center",
          color: "var(--muted)",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 10,
        }}
      >
        📭 No deliveries have been recorded yet.
      </div>
    );
  }

  return (
    <>
      {rows.map((r) => {
        const shortId = r.id.slice(0, 8).toUpperCase();
        const dispatchedAt = new Date(r.dispatched_at);
        const deliveredAt = new Date(r.delivered_at);
        return (
          <div
            key={r.id}
            style={{
              padding: "10px 16px",
              marginBottom: 8,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "flex-start",
              justifyContent: "space-between",
            }}
          >
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--muted)" }}>
                  DISP-{shortId}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>🏛 {r.temple}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  · {r.slabCount} slab{r.slabCount !== 1 ? "s" : ""} · {r.slabCftTotal.toFixed(2)} CFT
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#15803d",
                    background: "rgba(22,101,52,0.12)",
                    padding: "1px 8px",
                    borderRadius: 4,
                    letterSpacing: "0.04em",
                  }}
                >
                  ✓ DELIVERED
                </span>
              </div>
              <div style={{ marginTop: 3, fontSize: 11, color: "var(--muted)" }}>
                Dispatched {dispatchedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                {" · "}Delivered{" "}
                {deliveredAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                {r.delivered_by_name ? ` · confirmed by ${r.delivered_by_name}` : ""}
                {r.receiver_name ? ` · received by ${r.receiver_name}` : ""}
              </div>
              {r.delivery_note && (
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
                  “{r.delivery_note}”
                </div>
              )}
            </div>
            <Link
              href={`/dispatch/${r.id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: "none",
                fontSize: 11,
                padding: "4px 10px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--muted)",
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              🖨 Print challan
            </Link>
          </div>
        );
      })}

      {legacy.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--muted)",
              padding: "8px 4px",
              userSelect: "none",
              borderTop: "1px dashed var(--border)",
              listStyle: "none",
            }}
          >
            ▸ {legacy.length} legacy single-slab dispatch{legacy.length !== 1 ? "es" : ""} (from before the
            station was built)
          </summary>
          <div style={{ marginTop: 8 }}>
            {legacy.map((l, idx) => (
              <div
                key={idx}
                style={{
                  padding: "6px 12px",
                  marginBottom: 4,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                <strong>{l.slab_id}</strong> · Dispatched{" "}
                {new Date(l.dispatched_at).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                {l.dispatched_by_name ? ` by ${l.dispatched_by_name}` : ""}
                {l.note ? ` · ${l.note}` : ""}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
