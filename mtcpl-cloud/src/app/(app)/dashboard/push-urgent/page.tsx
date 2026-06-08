import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PushPanel } from "../push-panel";
import { PushToolbar } from "../push-toolbar";

export const dynamic = "force-dynamic";

// Same audience as the push/clear actions (owner + dev).
const ALLOWED = ["owner", "developer"];

// The open/planned backlog is huge (5000+ required sizes), so we never load
// it all at once. Instead the page loads one slice — a chosen temple, search
// matches, or the currently-flagged slabs — each small + fast.
const CAP = 400;

type SearchParams = Promise<{ pushed?: string; toast?: string; q?: string; temple?: string }>;

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
const SLAB_COLS = "id, label, temple, stone, status, priority, deadline, priority_note";

export default async function PushUrgentPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const q = (sp?.q ?? "").trim();
  const safeQ = q.replace(/[,()%*]/g, " ").trim();
  const temple = (sp?.temple ?? "").trim();

  // Temple list for the dropdown.
  const { data: tRows } = await admin
    .from("temples")
    .select("name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  const temples = ((tRows ?? []) as Array<{ name: string | null }>).map((t) => t.name ?? "").filter(Boolean);

  // Backlog size — one cheap head count (for the header line).
  const { count: backlogCount } = await admin
    .from("slab_requirements")
    .select("*", { count: "exact", head: true })
    .in("status", ["open", "planned"]);

  // Load just the relevant slice.
  let rows: Row[] = [];
  let capped = false;
  let mode: "temple" | "search" | "flagged" = "flagged";

  const base = () =>
    admin.from("slab_requirements").select(SLAB_COLS).in("status", ["open", "planned"]);

  if (temple && safeQ) {
    mode = "search";
    const { data } = await base()
      .eq("temple", temple)
      .or(`id.ilike.%${safeQ}%,label.ilike.%${safeQ}%,stone.ilike.%${safeQ}%`)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(CAP + 1);
    rows = (data ?? []) as Row[];
  } else if (safeQ) {
    mode = "search";
    const { data } = await base()
      .or(`id.ilike.%${safeQ}%,label.ilike.%${safeQ}%,temple.ilike.%${safeQ}%,stone.ilike.%${safeQ}%`)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(CAP + 1);
    rows = (data ?? []) as Row[];
  } else if (temple) {
    mode = "temple";
    const { data } = await base()
      .eq("temple", temple)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(CAP + 1);
    rows = (data ?? []) as Row[];
  } else {
    mode = "flagged";
    const { data } = await base()
      .eq("priority", true)
      .order("created_at", { ascending: false })
      .limit(CAP + 1);
    rows = (data ?? []) as Row[];
  }
  if (rows.length > CAP) {
    capped = true;
    rows = rows.slice(0, CAP);
  }

  // Which loaded slabs are in a LIVE outsource work order (+ vendor) — drives
  // the indigo row tint + "🤝 vendor" column + vendor filter.
  const assignedVendorBySlab = new Map<string, string>();
  if (rows.length > 0) {
    const { data: woItems } = await admin
      .from("carving_work_order_items")
      .select("slab_requirement_id, line_status, carving_work_orders(vendor_name, status)")
      .neq("line_status", "cancelled")
      .in("slab_requirement_id", rows.map((r) => r.id));
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
  }

  const pushList = rows.map((s) => ({
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

  const contextLine =
    mode === "search"
      ? <>Showing matches for <strong>“{q}”</strong>{temple ? <> in <strong>{temple}</strong></> : null}.</>
      : mode === "temple"
        ? <>Showing all open/planned slabs for <strong>{temple}</strong>.</>
        : <>Showing slabs already flagged urgent. <strong>Pick a temple</strong> above (or search) to push any slab.</>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32, maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/dashboard" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Back to dashboard</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🔔 Push Urgent Alert to Workers</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            <strong>{backlogCount ?? 0}</strong> open &amp; planned slabs in the backlog. {contextLine}
          </p>
        </div>
        <Link href="/dashboard" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}>← Dashboard</Link>
      </div>

      <PushToolbar temples={temples} temple={temple} q={q} />

      {sp?.toast && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e" }}>
          {sp.toast}
        </div>
      )}

      {capped && (
        <div style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.3)", borderRadius: 10, padding: "8px 14px", fontSize: 12, color: "#2563eb" }}>
          Showing the first {CAP}. Use the search box to narrow it down further.
        </div>
      )}

      {mode === "flagged" && pushList.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No slabs are currently flagged urgent. Pick a temple above (or search) to push one.
        </div>
      ) : (
        <PushPanel slabs={pushList} pushed={pushed} todayLabel={todayLabel} expandedByDefault hideSearch />
      )}
    </div>
  );
}
