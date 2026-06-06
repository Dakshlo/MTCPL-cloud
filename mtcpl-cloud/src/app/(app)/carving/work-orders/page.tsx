import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

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

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  open: { bg: "rgba(180,115,51,0.12)", fg: "#92400e" },
  in_progress: { bg: "rgba(22,163,74,0.12)", fg: "#15803d" },
  completed: { bg: "rgba(15,23,42,0.08)", fg: "#334155" },
  cancelled: { bg: "rgba(220,38,38,0.1)", fg: "#991b1b" },
};

export default async function WorkOrdersListPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving?mode=outsource");
  const admin = createAdminSupabaseClient();

  const { data: woRows } = await admin
    .from("carving_work_orders")
    .select("id, wo_number, vendor_name, title, temple, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const wos = ((woRows ?? []) as Array<{
    id: string;
    wo_number: string;
    vendor_name: string;
    title: string | null;
    temple: string | null;
    status: string;
    created_at: string;
  }>);

  // Line counts per WO.
  const { data: lineRows } = await admin
    .from("carving_work_order_items")
    .select("work_order_id, line_status");
  const counts = new Map<string, { total: number; sent: number; planned: number }>();
  for (const r of (lineRows ?? []) as Array<{ work_order_id: string; line_status: string }>) {
    const c = counts.get(r.work_order_id) ?? { total: 0, sent: 0, planned: 0 };
    if (r.line_status !== "cancelled") c.total += 1;
    if (r.line_status === "sent" || r.line_status === "received" || r.line_status === "approved") c.sent += 1;
    if (r.line_status === "planned") c.planned += 1;
    counts.set(r.work_order_id, c);
  }

  // Group by vendor.
  const byVendor = new Map<string, typeof wos>();
  for (const w of wos) {
    const arr = byVendor.get(w.vendor_name) ?? [];
    arr.push(w);
    byVendor.set(w.vendor_name, arr);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 920 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/carving?mode=outsource" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Carving Jobs</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🏭 Work orders</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Give outsource vendors future work — even before slabs are cut.</p>
        </div>
        <Link href="/carving/work-orders/new" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: "#92400e", borderRadius: 8, textDecoration: "none" }}>+ New work order</Link>
      </div>

      {wos.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, color: "var(--muted)" }}>
          No work orders yet. Create one to hand future work to an outsource vendor.
        </div>
      ) : (
        [...byVendor.entries()].map(([vendor, list]) => (
          <div key={vendor}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{vendor}</div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              {list.map((w) => {
                const c = counts.get(w.id) ?? { total: 0, sent: 0, planned: 0 };
                const tone = STATUS_TONE[w.status] ?? STATUS_TONE.open;
                return (
                  <Link key={w.id} href={`/carving/work-orders/${w.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--border)", textDecoration: "none", color: "inherit" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                        {w.wo_number}
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: tone.fg, background: tone.bg, borderRadius: 999, padding: "2px 8px" }}>{w.status.replace("_", " ")}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {w.title ? `${w.title} · ` : ""}{w.temple ? `${w.temple} · ` : ""}{fmtDate(w.created_at)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>
                      {c.total} line{c.total === 1 ? "" : "s"}<br />
                      <span style={{ color: "#15803d" }}>{c.sent} sent</span> · <span>{c.planned} planned</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
