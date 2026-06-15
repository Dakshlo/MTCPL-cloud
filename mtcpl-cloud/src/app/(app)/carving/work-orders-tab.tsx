"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { approveWorkOrderAction, rejectWorkOrderAction, handoverWorkOrderAction, dismissWorkOrderAction } from "./actions";

/**
 * Work Orders tab (Daksh June 2026) — renders inside /carving in Outsource
 * mode, alongside Active / Carving Done Approval / Carving Done / Still
 * Pending Work. Outsource is Work-Order-only, so this is the entry point:
 * create an order → owner approves the price → slabs can be sent.
 *
 * Client component so it can offer a search box (WO no. / slab no. / dims /
 * label / description). The owner Approve/Reject controls are still server
 * actions used in <form action={...}> (works from a client component).
 * Each card lists its slab codes, colour-coded by stage.
 */

export type WorkOrderRow = {
  id: string;
  wo_number: string;
  vendor_name: string;
  title: string | null;
  temple: string | null;
  status: string;
  jobwork_rate: number | string | null;
  jobwork_unit: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  created_at: string;
};

export type WorkOrderLineCounts = {
  total: number;
  planned: number;
  sent: number;
  received: number;
  approved: number;
};

/** One slab/line chip on a work-order card. */
export type WorkOrderLineChip = {
  /** Slab code, or the future-need description when no slab is bound. */
  code: string;
  /** line_status: planned | sent | received | approved */
  status: string;
  isFuture: boolean;
  /** Lowercased haystack for the search box (code + label + desc + dims). */
  search: string;
};

export type WorkOrderTabRow = WorkOrderRow & {
  lines: WorkOrderLineChip[];
  counts: WorkOrderLineCounts;
  /** Mig 100 — approved + handed over to the vendor (then sends unlock). */
  handedOver: boolean;
  /** Sum of all (non-cancelled) slabs' CFT / SFT in the order. */
  totalCft: number;
  totalSft: number;
  /** Tentative total cost from the agreed rate (null until owner sets a price). */
  tentativeCost: number | null;
  /** Planned lines whose slab is cut-done = ready to send to the vendor. */
  readyToSend: number;
};

const STATUS_META: Record<string, { label: string; emoji: string; bg: string; fg: string }> = {
  pending_approval: { label: "Pending approval", emoji: "⏳", bg: "rgba(217,119,6,0.14)", fg: "#b45309" },
  open: { label: "Ready to assign", emoji: "✅", bg: "rgba(22,163,74,0.14)", fg: "#15803d" },
  in_progress: { label: "In progress", emoji: "🚚", bg: "rgba(37,99,235,0.12)", fg: "#1d4ed8" },
  completed: { label: "Done", emoji: "✓", bg: "rgba(15,23,42,0.08)", fg: "#334155" },
  rejected: { label: "Rejected", emoji: "✕", bg: "rgba(220,38,38,0.12)", fg: "#991b1b" },
  cancelled: { label: "Cancelled", emoji: "⊘", bg: "rgba(100,116,139,0.14)", fg: "#475569" },
};
const STATUS_ORDER: Record<string, number> = {
  pending_approval: 0,
  open: 1,
  in_progress: 2,
  completed: 3,
  rejected: 4,
  cancelled: 5,
};

// Per-slab stage tints (line_status). "In" = received back in-house.
const LINE_TONE: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  planned: { bg: "rgba(217,119,6,0.12)", fg: "#b45309", border: "rgba(217,119,6,0.35)", label: "Pending (not sent)" },
  sent: { bg: "rgba(37,99,235,0.12)", fg: "#1d4ed8", border: "rgba(37,99,235,0.35)", label: "Sent to vendor" },
  received: { bg: "rgba(13,148,136,0.14)", fg: "#0f766e", border: "rgba(13,148,136,0.4)", label: "In (received back)" },
  approved: { bg: "rgba(22,163,74,0.14)", fg: "#15803d", border: "rgba(22,163,74,0.4)", label: "Approved" },
};
const LEGEND: Array<{ key: string; label: string }> = [
  { key: "planned", label: "Pending" },
  { key: "sent", label: "Sent" },
  { key: "received", label: "In" },
  { key: "approved", label: "Approved" },
];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch {
    return d;
  }
}
function fmtRate(rate: number | string | null, unit: string | null): string {
  if (rate == null) return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  const u = unit === "job" ? "slab" : unit === "sft" ? "sft" : "cft";
  return `₹${n.toLocaleString("en-IN")}/${u}`;
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.open;
  return (
    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: m.fg, background: m.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {m.emoji} {m.label}
    </span>
  );
}

const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" };

export function WorkOrdersTab({ wos, isOwner }: { wos: WorkOrderTabRow[]; isOwner: boolean }) {
  const [q, setQ] = useState("");
  // Collapse state — vendor groups (default open) + individual work-order
  // cards (default open only when they need attention). Keyed by name / id.
  const [vendorOpen, setVendorOpen] = useState<Record<string, boolean>>({});
  const [woOpen, setWoOpen] = useState<Record<string, boolean>>({});
  const query = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return wos;
    return wos.filter(
      (w) =>
        w.wo_number.toLowerCase().includes(query) ||
        w.vendor_name.toLowerCase().includes(query) ||
        (w.title ?? "").toLowerCase().includes(query) ||
        (w.temple ?? "").toLowerCase().includes(query) ||
        w.lines.some((l) => l.search.includes(query)),
    );
  }, [wos, query]);

  // Group by vendor; vendors with pending approvals float to the top.
  const vendorEntries = useMemo(() => {
    const byVendor = new Map<string, WorkOrderTabRow[]>();
    for (const w of filtered) {
      const arr = byVendor.get(w.vendor_name) ?? [];
      arr.push(w);
      byVendor.set(w.vendor_name, arr);
    }
    for (const arr of byVendor.values()) {
      arr.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.created_at.localeCompare(a.created_at));
    }
    return [...byVendor.entries()].sort((a, b) => {
      const aPend = a[1].some((w) => w.status === "pending_approval");
      const bPend = b[1].some((w) => w.status === "pending_approval");
      if (aPend !== bPend) return aPend ? -1 : 1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  const pendingCount = wos.filter((w) => w.status === "pending_approval").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`
        @keyframes woCardPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); }
          50% { box-shadow: 0 0 0 4px rgba(22,163,74,0.35); }
        }
        .wo-card-blink { animation: woCardPulse 1.5s ease-in-out infinite; border-color: rgba(22,163,74,0.6) !important; }
      `}</style>
      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          The only way to give outsource vendors work. Every order needs owner price approval before slabs can be sent.
        </p>
        <Link href="/carving/work-orders/new" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: "#92400e", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}>
          + New work order
        </Link>
      </div>

      {/* Search + legend */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 320px", maxWidth: 460 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--muted)" }}>🔎</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search WO no., slab no., dimensions, label, description…"
            style={{ width: "100%", padding: "9px 12px 9px 34px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 9, background: "var(--surface)", color: "var(--text)" }}
          />
          {q && (
            <button type="button" onClick={() => setQ("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, fontWeight: 700, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>
              ✕
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {LEGEND.map((l) => {
            const t = LINE_TONE[l.key];
            return (
              <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: t.bg, border: `1px solid ${t.border}` }} />
                {l.label}
              </span>
            );
          })}
        </div>
      </div>

      {isOwner && pendingCount > 0 && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 12, padding: "12px 16px", color: "#92400e", fontSize: 13, fontWeight: 700 }}>
          ⏳ {pendingCount} work order{pendingCount === 1 ? "" : "s"} waiting for your price approval.
        </div>
      )}

      {wos.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
          No work orders yet. Tap <strong>+ New work order</strong> to hand work to an outsource vendor.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
          Nothing matches “{q}”. Try a work-order number, slab code, dimension, label, or description.
        </div>
      ) : (
        vendorEntries.map(([vendor, list]) => {
          const tally = list.reduce<Record<string, number>>((m, w) => {
            m[w.status] = (m[w.status] ?? 0) + 1;
            return m;
          }, {});
          const vOpen = vendorOpen[vendor] ?? true;
          const vendorReady = list.reduce((s, w) => s + w.readyToSend, 0);
          return (
            <div key={vendor}>
              {/* Vendor section header — click to collapse / expand. */}
              <button
                type="button"
                onClick={() => setVendorOpen((o) => ({ ...o, [vendor]: !vOpen }))}
                style={{
                  position: "relative",
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  background: "linear-gradient(135deg, rgba(201,161,74,0.14) 0%, rgba(201,161,74,0.04) 100%)",
                  border: "1px solid var(--border)",
                  borderLeft: "5px solid var(--gold)",
                  borderRadius: vOpen ? "12px 12px 0 0" : "12px",
                  padding: "14px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <span aria-hidden style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>🧑‍🏭</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {vendor}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <span>
                      <strong style={{ color: "var(--text)", fontWeight: 700 }}>{list.length}</strong> order{list.length !== 1 ? "s" : ""}
                    </span>
                    {Object.entries(tally)
                      .sort((a, b) => (STATUS_ORDER[a[0]] ?? 9) - (STATUS_ORDER[b[0]] ?? 9))
                      .map(([s, n]) => {
                        const m = STATUS_META[s] ?? STATUS_META.open;
                        return (
                          <span key={s} style={{ color: m.fg, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: m.bg }}>
                            {m.emoji} {n}
                          </span>
                        );
                      })}
                    {vendorReady > 0 && (
                      <span style={{ color: "#15803d", fontWeight: 800, padding: "1px 8px", borderRadius: 999, background: "rgba(22,163,74,0.12)" }}>
                        🟢 {vendorReady} ready
                      </span>
                    )}
                  </div>
                </div>
                <span aria-hidden style={{ fontSize: 16, color: "var(--muted)", flexShrink: 0, transition: "transform .15s ease", transform: vOpen ? "rotate(90deg)" : "none" }}>▶</span>
              </button>

              {/* Cards */}
              {vOpen && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderTop: "none",
                  borderRadius: "0 0 12px 12px",
                  padding: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: 12,
                  background: "var(--bg)",
                }}
              >
                {list.map((w) => {
                  const c = w.counts;
                  const assigned = c.sent + c.received + c.approved;
                  const isPending = w.status === "pending_approval";
                  // Mig 100 — approved but not yet handed over: blur the card
                  // and show one centred Handover action.
                  const handoverPending = (w.status === "open" || w.status === "in_progress") && !w.handedOver;
                  // Blink the whole card when there's cut-done work ready to
                  // send (and the order is actionable — approved + handed over).
                  const blink = w.readyToSend > 0 && !isPending && !handoverPending;
                  // Collapsible (not while the handover overlay is up). Default
                  // open only when the card needs attention; collapsed → summary.
                  const collapsible = !handoverPending;
                  const defaultOpen = isPending || w.readyToSend > 0;
                  const open = !collapsible || (woOpen[w.id] ?? defaultOpen);
                  return (
                    <div
                      key={w.id}
                      className={blink ? "wo-card-blink" : undefined}
                      style={{
                        position: "relative",
                        padding: 12,
                        background: "var(--surface)",
                        border: isPending
                          ? "1.5px solid rgba(217,119,6,0.5)"
                          : handoverPending
                            ? "1.5px solid rgba(22,163,74,0.5)"
                            : "1px solid var(--border)",
                        borderRadius: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          ...(handoverPending ? { filter: "blur(3px)", pointerEvents: "none" as const, userSelect: "none" as const } : {}),
                        }}
                      >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{w.wo_number}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <StatusBadge status={w.status} />
                          {collapsible && (
                            <button type="button" onClick={() => setWoOpen((o) => ({ ...o, [w.id]: !open }))} title={open ? "Collapse" : "Expand"} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", color: "var(--muted)", fontSize: 11, fontWeight: 800, padding: "2px 7px", lineHeight: 1 }}>
                              {open ? "▾" : "▸"}
                            </button>
                          )}
                        </div>
                      </div>

                      {open ? (
                      <>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {w.title ? `${w.title} · ` : ""}{w.temple ? `${w.temple} · ` : ""}{fmtDate(w.created_at)}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#7c2d12", background: "rgba(180,115,51,0.10)", border: "1px solid rgba(180,115,51,0.25)", borderRadius: 6, padding: "2px 8px" }}>
                          {fmtRate(w.jobwork_rate, w.jobwork_unit)}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>
                          <strong style={{ color: "var(--text)" }}>{assigned}/{c.total}</strong> sent
                          {c.planned > 0 ? ` · ${c.planned} waiting` : ""}
                          {c.approved > 0 ? ` · ${c.approved} ✓` : ""}
                        </span>
                      </div>

                      {/* Ready to assign (cut-done, not yet sent) — so you know
                          there's work to send without opening the order. */}
                      {w.readyToSend > 0 && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#15803d", background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.3)", borderRadius: 7, padding: "5px 9px", alignSelf: "flex-start" }}>
                          🟢 {w.readyToSend} ready to assign
                        </div>
                      )}

                      {/* Order totals — CFT in the order + tentative cost at the agreed rate. */}
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        📦 <strong style={{ color: "var(--text)" }}>{w.totalCft.toFixed(2)} cft</strong>
                        {w.totalSft > 0 ? ` · ${w.totalSft.toFixed(2)} sft` : ""}
                        {" · "}
                        {w.tentativeCost != null ? (
                          <>💰 Tentative <strong style={{ color: "var(--text)" }}>₹{w.tentativeCost.toLocaleString("en-IN")}</strong></>
                        ) : (
                          <span style={{ fontStyle: "italic" }}>💰 cost after price approval</span>
                        )}
                      </div>

                      {/* Slab chips — see which slabs are in the order + their
                          stage, without opening it. */}
                      {w.lines.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {w.lines.map((l, i) => {
                            const t = LINE_TONE[l.status] ?? LINE_TONE.planned;
                            return (
                              <span
                                key={i}
                                title={`${l.code} — ${t.label}`}
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  fontFamily: "ui-monospace, monospace",
                                  color: t.fg,
                                  background: t.bg,
                                  border: `1px solid ${t.border}`,
                                  borderRadius: 6,
                                  padding: "2px 7px",
                                  maxWidth: 150,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {l.isFuture ? "📝 " : ""}{l.code}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {(w.status === "rejected" || w.status === "cancelled") && (w.reject_reason || w.cancel_reason) && (
                        <div style={{ fontSize: 12, color: "#991b1b" }}>Reason: {w.reject_reason || w.cancel_reason}</div>
                      )}

                      {/* Owner approval controls (pending only) */}
                      {isPending && isOwner ? (
                        <div style={{ borderTop: "1px solid var(--border)", background: "rgba(217,119,6,0.05)", margin: "2px -12px -12px", padding: "10px 12px", borderRadius: "0 0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                          <form action={approveWorkOrderAction} style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <input type="hidden" name="work_order_id" value={w.id} />
                            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={lbl}>Price (required)</span>
                              <input name="jobwork_rate" type="number" min="0" step="0.01" required defaultValue={w.jobwork_rate != null ? String(Number(w.jobwork_rate)) : ""} style={{ width: 84, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={lbl}>Unit</span>
                              <select name="jobwork_unit" defaultValue={w.jobwork_unit === "sft" ? "sft" : w.jobwork_unit === "job" ? "job" : "cft"} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }}>
                                <option value="cft">/cft</option>
                                <option value="sft">/sft</option>
                                <option value="job">/slab (job)</option>
                              </select>
                            </label>
                            <button type="submit" style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#15803d", border: "none", borderRadius: 8, cursor: "pointer" }}>✓ Approve</button>
                          </form>
                          <form action={rejectWorkOrderAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input type="hidden" name="work_order_id" value={w.id} />
                            <input name="reason" placeholder="Reject reason (optional)" style={{ flex: 1, minWidth: 120, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12.5 }} />
                            <button type="submit" style={{ padding: "7px 12px", fontSize: 12.5, fontWeight: 700, color: "#991b1b", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, cursor: "pointer" }}>✕ Reject</button>
                          </form>
                        </div>
                      ) : isPending && !isOwner ? (
                        <div style={{ fontSize: 12, color: "#b45309", fontWeight: 600 }}>⏳ Waiting for owner price approval.</div>
                      ) : null}

                        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <Link href={`/carving/work-orders/${w.id}`} style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: "#92400e", textDecoration: "none" }}>
                            Open order →
                          </Link>
                          {/* Mig 135 — clear a dead order off the list. */}
                          {isOwner && (w.status === "cancelled" || w.status === "rejected") && (
                            <form action={dismissWorkOrderAction}>
                              <input type="hidden" name="work_order_id" value={w.id} />
                              <button type="submit" style={{ fontSize: 11.5, fontWeight: 700, color: "#991b1b", background: "none", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 7, padding: "4px 10px", cursor: "pointer" }}>🗑 Remove from list</button>
                            </form>
                          )}
                        </div>
                      </>
                      ) : (
                      <div onClick={() => setWoOpen((o) => ({ ...o, [w.id]: true }))} style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{w.title ? `${w.title} · ` : ""}{w.temple ? `${w.temple} · ` : ""}{fmtDate(w.created_at)}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                          <span style={{ fontWeight: 700, color: "#7c2d12", background: "rgba(180,115,51,0.10)", border: "1px solid rgba(180,115,51,0.25)", borderRadius: 6, padding: "1px 7px" }}>{fmtRate(w.jobwork_rate, w.jobwork_unit)}</span>
                          <span style={{ color: "var(--muted)" }}><strong style={{ color: "var(--text)" }}>{assigned}/{c.total}</strong> sent{c.planned > 0 ? ` · ${c.planned} waiting` : ""}{c.approved > 0 ? ` · ${c.approved} ✓` : ""}</span>
                        </div>
                        {w.readyToSend > 0 && <span style={{ alignSelf: "flex-start", fontSize: 11.5, fontWeight: 800, color: "#15803d", background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.3)", borderRadius: 7, padding: "3px 8px" }}>🟢 {w.readyToSend} ready to assign</span>}
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>📦 {w.totalCft.toFixed(2)} cft{w.tentativeCost != null ? ` · 💰 ₹${w.tentativeCost.toLocaleString("en-IN")}` : ""} · {w.lines.length} slab{w.lines.length === 1 ? "" : "s"} · <span style={{ color: "#92400e", fontWeight: 700 }}>tap to expand ▸</span></div>
                      </div>
                      )}
                      </div>

                      {/* Mig 100 — first approval: blur the card + one centred
                          Handover action. Pressing it opens the work order for
                          print (new tab) AND records the handover; the card
                          then shows the normal way. Re-download later from
                          "Open order". */}
                      {handoverPending && (
                        <div style={{ position: "absolute", inset: 0, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, background: "rgba(247,243,237,0.6)" }}>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#15803d", textAlign: "center" }}>✅ Approved — hand the work order to {vendor} to start.</div>
                          <form action={handoverWorkOrderAction}>
                            <input type="hidden" name="work_order_id" value={w.id} />
                            <input type="hidden" name="redirect_to" value="/carving?mode=outsource&tab=workorders" />
                            <button
                              type="submit"
                              onClick={() => {
                                if (typeof window !== "undefined") window.open(`/api/carving/work-order-pdf/${w.id}?print=1`, "_blank");
                              }}
                              style={{ padding: "11px 22px", fontSize: 14, fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 10, cursor: "pointer", boxShadow: "0 3px 10px rgba(21,128,61,0.35)" }}
                            >
                              🤝 Handover to vendor
                            </button>
                          </form>
                          <div style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center" }}>Opens the work order to print.</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
