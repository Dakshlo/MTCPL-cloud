import Link from "next/link";
import { approveWorkOrderAction, rejectWorkOrderAction } from "./actions";

/**
 * Work Orders tab (Daksh June 2026) — renders inside /carving in Outsource
 * mode, alongside Active / Carving Done Approval / Carving Done / Still
 * Pending Work. Outsource is Work-Order-only, so this is the entry point:
 * create an order → owner approves the price → slabs can be sent.
 *
 * Server component: the owner Approve/Reject controls are plain
 * server-action forms (no client JS). Vendor-grouped to match the Active
 * tab's section chrome.
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
  return `₹${n.toLocaleString("en-IN")}/${unit === "sft" ? "sft" : "cft"}`;
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

export function WorkOrdersTab({
  wos,
  counts,
  isOwner,
}: {
  wos: WorkOrderRow[];
  counts: Map<string, WorkOrderLineCounts>;
  isOwner: boolean;
}) {
  // Group by vendor; vendors with pending approvals float to the top.
  const byVendor = new Map<string, WorkOrderRow[]>();
  for (const w of wos) {
    const arr = byVendor.get(w.vendor_name) ?? [];
    arr.push(w);
    byVendor.set(w.vendor_name, arr);
  }
  for (const arr of byVendor.values()) {
    arr.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.created_at.localeCompare(a.created_at));
  }
  const vendorEntries = [...byVendor.entries()].sort((a, b) => {
    const aPend = a[1].some((w) => w.status === "pending_approval");
    const bPend = b[1].some((w) => w.status === "pending_approval");
    if (aPend !== bPend) return aPend ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });
  const pendingCount = wos.filter((w) => w.status === "pending_approval").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          The only way to give outsource vendors work. Every order needs owner price approval before slabs can be sent.
        </p>
        <Link href="/carving/work-orders/new" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: "#92400e", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}>
          + New work order
        </Link>
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
      ) : (
        vendorEntries.map(([vendor, list]) => {
          const tally = list.reduce<Record<string, number>>((m, w) => {
            m[w.status] = (m[w.status] ?? 0) + 1;
            return m;
          }, {});
          return (
            <div key={vendor}>
              {/* Vendor section header — matches the Active tab's gold
                  gradient bar + worker emoji + summary chips. */}
              <div
                style={{
                  position: "relative",
                  background: "linear-gradient(135deg, rgba(201,161,74,0.14) 0%, rgba(201,161,74,0.04) 100%)",
                  border: "1px solid var(--border)",
                  borderLeft: "5px solid var(--gold)",
                  borderRadius: "12px 12px 0 0",
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
                  </div>
                </div>
              </div>

              {/* Cards */}
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderTop: "none",
                  borderRadius: "0 0 12px 12px",
                  padding: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(264px, 1fr))",
                  gap: 12,
                  background: "var(--bg)",
                }}
              >
                {list.map((w) => {
                  const c = counts.get(w.id) ?? { total: 0, planned: 0, sent: 0, received: 0, approved: 0 };
                  const assigned = c.sent + c.received + c.approved;
                  const isPending = w.status === "pending_approval";
                  return (
                    <div
                      key={w.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        padding: 12,
                        background: "var(--surface)",
                        border: isPending ? "1.5px solid rgba(217,119,6,0.5)" : "1px solid var(--border)",
                        borderRadius: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{w.wo_number}</span>
                        <StatusBadge status={w.status} />
                      </div>

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

                      {(w.status === "rejected" || w.status === "cancelled") && (w.reject_reason || w.cancel_reason) && (
                        <div style={{ fontSize: 12, color: "#991b1b" }}>Reason: {w.reject_reason || w.cancel_reason}</div>
                      )}

                      {/* Owner approval controls (pending only) */}
                      {isPending && isOwner ? (
                        <div style={{ borderTop: "1px solid var(--border)", background: "rgba(217,119,6,0.05)", margin: "2px -12px -12px", padding: "10px 12px", borderRadius: "0 0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                          <form action={approveWorkOrderAction} style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <input type="hidden" name="work_order_id" value={w.id} />
                            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={lbl}>Price</span>
                              <input name="jobwork_rate" type="number" min="0" step="0.01" defaultValue={w.jobwork_rate != null ? String(Number(w.jobwork_rate)) : ""} style={{ width: 84, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={lbl}>Unit</span>
                              <select name="jobwork_unit" defaultValue={w.jobwork_unit === "sft" ? "sft" : "cft"} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }}>
                                <option value="cft">cft</option>
                                <option value="sft">sft</option>
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

                      <Link href={`/carving/work-orders/${w.id}`} style={{ marginTop: "auto", alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: "#92400e", textDecoration: "none" }}>
                        Open order →
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
