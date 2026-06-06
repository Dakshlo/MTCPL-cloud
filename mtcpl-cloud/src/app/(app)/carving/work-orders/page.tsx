import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { approveWorkOrderAction, rejectWorkOrderAction } from "../actions";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

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

// Mig 098 — six statuses now (pending_approval + rejected are new).
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

type WO = {
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

type LineCounts = { total: number; planned: number; sent: number; received: number; approved: number };

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.open;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: m.fg,
        background: m.bg,
        borderRadius: 999,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {m.emoji} {m.label}
    </span>
  );
}

export default async function WorkOrdersListPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const isOwner = profile.role === "owner" || profile.role === "developer";
  const admin = createAdminSupabaseClient();

  const { data: woRows } = await admin
    .from("carving_work_orders")
    .select("id, wo_number, vendor_name, title, temple, status, jobwork_rate, jobwork_unit, reject_reason, cancel_reason, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  const wos = (woRows ?? []) as WO[];

  // Line counts per WO.
  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("work_order_id, line_status");
  const counts = new Map<string, LineCounts>();
  for (const r of (lineRows ?? []) as Array<{ work_order_id: string; line_status: string }>) {
    const c = counts.get(r.work_order_id) ?? { total: 0, planned: 0, sent: 0, received: 0, approved: 0 };
    if (r.line_status === "cancelled") {
      counts.set(r.work_order_id, c);
      continue;
    }
    c.total += 1;
    if (r.line_status === "planned") c.planned += 1;
    if (r.line_status === "sent") c.sent += 1;
    if (r.line_status === "received") c.received += 1;
    if (r.line_status === "approved") c.approved += 1;
    counts.set(r.work_order_id, c);
  }

  // Group by vendor; vendors with pending approvals float to the top.
  const byVendor = new Map<string, WO[]>();
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

  const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 960 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/carving?mode=outsource" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Carving Jobs</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🏭 Work orders</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>The only way to give outsource vendors work. Every order needs owner price approval before slabs can be sent.</p>
        </div>
        <Link href="/carving/work-orders/new" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: "#92400e", borderRadius: 8, textDecoration: "none" }}>+ New work order</Link>
      </div>

      {/* Owner heads-up banner */}
      {isOwner && pendingCount > 0 && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 12, padding: "12px 16px", color: "#92400e", fontSize: 13, fontWeight: 700 }}>
          ⏳ {pendingCount} work order{pendingCount === 1 ? "" : "s"} waiting for your price approval.
        </div>
      )}

      {wos.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, color: "var(--muted)" }}>
          No work orders yet. Create one to hand work to an outsource vendor.
        </div>
      ) : (
        vendorEntries.map(([vendor, list]) => {
          const tally = list.reduce<Record<string, number>>((m, w) => {
            m[w.status] = (m[w.status] ?? 0) + 1;
            return m;
          }, {});
          return (
            <div key={vendor}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>🧑‍🏭 {vendor}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(tally)
                    .sort((a, b) => (STATUS_ORDER[a[0]] ?? 9) - (STATUS_ORDER[b[0]] ?? 9))
                    .map(([s, n]) => (
                      <span key={s}>{(STATUS_META[s] ?? STATUS_META.open).emoji} {n} {(STATUS_META[s] ?? STATUS_META.open).label.toLowerCase()}</span>
                    ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {list.map((w) => {
                  const c = counts.get(w.id) ?? { total: 0, planned: 0, sent: 0, received: 0, approved: 0 };
                  const assigned = c.sent + c.received + c.approved;
                  const isPending = w.status === "pending_approval";
                  return (
                    <div
                      key={w.id}
                      style={{
                        background: "var(--surface)",
                        border: isPending ? "1px solid rgba(217,119,6,0.45)" : "1px solid var(--border)",
                        borderRadius: 12,
                        overflow: "hidden",
                        boxShadow: isPending ? "0 1px 0 rgba(217,119,6,0.15)" : "none",
                      }}
                    >
                      {/* Header — click to open detail */}
                      <Link href={`/carving/work-orders/${w.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", textDecoration: "none", color: "inherit" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{w.wo_number}</span>
                            <StatusBadge status={w.status} />
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                            {w.title ? `${w.title} · ` : ""}{w.temple ? `${w.temple} · ` : ""}{fmtRate(w.jobwork_rate, w.jobwork_unit)} · {fmtDate(w.created_at)}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ fontWeight: 700, color: "var(--fg)" }}>{assigned}/{c.total} sent</div>
                          <div style={{ fontSize: 11 }}>
                            {c.planned > 0 ? `${c.planned} waiting` : "all assigned"}
                            {c.approved > 0 ? ` · ${c.approved} ✓` : ""}
                          </div>
                        </div>
                      </Link>

                      {/* Rejected / cancelled reason */}
                      {(w.status === "rejected" || w.status === "cancelled") && (w.reject_reason || w.cancel_reason) && (
                        <div style={{ padding: "0 16px 10px", fontSize: 12, color: "#991b1b" }}>
                          Reason: {w.reject_reason || w.cancel_reason}
                        </div>
                      )}

                      {/* Owner approval controls (pending only) */}
                      {isPending && isOwner && (
                        <div style={{ borderTop: "1px solid var(--border)", background: "rgba(217,119,6,0.05)", padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
                          <form action={approveWorkOrderAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <input type="hidden" name="work_order_id" value={w.id} />
                            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={lbl}>Price (edit if needed)</span>
                              <input
                                name="jobwork_rate"
                                type="number"
                                min="0"
                                step="0.01"
                                defaultValue={w.jobwork_rate != null ? String(Number(w.jobwork_rate)) : ""}
                                style={{ width: 110, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }}
                              />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={lbl}>Unit</span>
                              <select name="jobwork_unit" defaultValue={w.jobwork_unit === "sft" ? "sft" : "cft"} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }}>
                                <option value="cft">cft</option>
                                <option value="sft">sft</option>
                              </select>
                            </label>
                            <button type="submit" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: "#15803d", border: "none", borderRadius: 8, cursor: "pointer" }}>✓ Approve</button>
                          </form>
                          <form action={rejectWorkOrderAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <input type="hidden" name="work_order_id" value={w.id} />
                            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={lbl}>Reject reason</span>
                              <input name="reason" placeholder="optional" style={{ width: 150, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
                            </label>
                            <button type="submit" style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, color: "#991b1b", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, cursor: "pointer" }}>✕ Reject</button>
                          </form>
                        </div>
                      )}

                      {/* Non-owner waiting note */}
                      {isPending && !isOwner && (
                        <div style={{ borderTop: "1px solid var(--border)", padding: "8px 16px", fontSize: 12, color: "#b45309", background: "rgba(217,119,6,0.05)" }}>
                          ⏳ Waiting for owner to approve the price before slabs can be sent.
                        </div>
                      )}
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
