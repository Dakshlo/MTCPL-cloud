import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PushPanel } from "../push-panel";

export const dynamic = "force-dynamic";

// Same audience as the push/clear actions (owner + dev).
const ALLOWED = ["owner", "developer"];

type SearchParams = Promise<{ pushed?: string; toast?: string }>;

export default async function PushUrgentPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  // All open + planned slabs (paginated past PostgREST's 1000-row cap).
  type Row = {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    status: string;
    priority: boolean | null;
    deadline: string | null;
    priority_note: string | null;
  };
  const slabRows: Row[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("id, label, temple, stone, status, priority, deadline, priority_note")
      .in("status", ["open", "planned"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .range(off, off + 999);
    if (error || !data || data.length === 0) break;
    slabRows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // Which slabs are already in a LIVE outsource work order, and the vendor.
  // (Skip cancelled lines + cancelled/rejected work orders.) UI-only — no writes.
  const assignedVendorBySlab = new Map<string, string>();
  const { data: woItems } = await admin
    .from("carving_work_order_items")
    .select("slab_requirement_id, line_status, carving_work_orders(vendor_name, status)")
    .neq("line_status", "cancelled")
    .not("slab_requirement_id", "is", null);
  for (const r of (woItems ?? []) as Array<{
    slab_requirement_id: string | null;
    carving_work_orders:
      | { vendor_name: string | null; status: string | null }
      | { vendor_name: string | null; status: string | null }[]
      | null;
  }>) {
    const sid = r.slab_requirement_id;
    if (!sid) continue;
    const wo = Array.isArray(r.carving_work_orders) ? r.carving_work_orders[0] : r.carving_work_orders;
    if (!wo || wo.status === "cancelled" || wo.status === "rejected") continue;
    if (wo.vendor_name && !assignedVendorBySlab.has(sid)) assignedVendorBySlab.set(sid, wo.vendor_name);
  }

  const pushList = slabRows.map((s) => ({
    id: s.id,
    label: s.label ?? "",
    temple: s.temple,
    stone: s.stone,
    status: s.status,
    priority: s.priority ?? false,
    deadline: s.deadline,
    priority_note: s.priority_note,
    assignedVendor: assignedVendorBySlab.get(s.id) ?? null,
  }));

  const pushed = sp?.pushed === "1";
  const todayLabel = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32, maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/dashboard" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Back to dashboard</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🔔 Push Urgent Alert to Workers</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            All open &amp; planned slabs. Slabs already in an outsource work order are tinted and tagged with the vendor — filter to <strong>“Not in any work order”</strong> to see what&apos;s still free for a new work order.
          </p>
        </div>
        <Link href="/dashboard" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}>← Dashboard</Link>
      </div>

      {sp?.toast && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e" }}>
          {sp.toast}
        </div>
      )}

      <PushPanel slabs={pushList} pushed={pushed} todayLabel={todayLabel} expandedByDefault={false} />
    </div>
  );
}
