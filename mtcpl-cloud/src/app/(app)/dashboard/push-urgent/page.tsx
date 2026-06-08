import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PushPanel } from "../push-panel";

export const dynamic = "force-dynamic";

// Same audience as the push/clear actions (owner + dev).
const ALLOWED = ["owner", "developer"];

// How many slabs to load into the panel at once. The open/planned backlog
// is huge (5000+ required sizes); loading + shipping all of it made this
// page slow. Instead we load only the relevant working set (currently
// flagged slabs by default, or server-side search matches) — small + fast.
const LOAD_CAP = 100;

type SearchParams = Promise<{ pushed?: string; toast?: string; q?: string }>;

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
  // Strip characters that would break PostgREST's or()/ilike filter syntax.
  const safeQ = q.replace(/[,()%*]/g, " ").trim();

  // Backlog size — one cheap head count (for the header line).
  const { count: backlogCount } = await admin
    .from("slab_requirements")
    .select("*", { count: "exact", head: true })
    .in("status", ["open", "planned"]);

  // Load only the working set:
  //   • with a search → matches across the whole backlog (id/label/temple/stone)
  //   • without a search → slabs already flagged urgent (to view / clear)
  let rows: Row[] = [];
  let capped = false;
  if (safeQ) {
    const { data } = await admin
      .from("slab_requirements")
      .select(SLAB_COLS)
      .in("status", ["open", "planned"])
      .or(`id.ilike.%${safeQ}%,label.ilike.%${safeQ}%,temple.ilike.%${safeQ}%,stone.ilike.%${safeQ}%`)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(LOAD_CAP + 1);
    rows = (data ?? []) as Row[];
  } else {
    const { data } = await admin
      .from("slab_requirements")
      .select(SLAB_COLS)
      .in("status", ["open", "planned"])
      .eq("priority", true)
      .order("created_at", { ascending: false })
      .limit(LOAD_CAP + 1);
    rows = (data ?? []) as Row[];
  }
  if (rows.length > LOAD_CAP) {
    capped = true;
    rows = rows.slice(0, LOAD_CAP);
  }

  // Which loaded slabs are in a LIVE outsource work order (+ vendor).
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32, maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link href="/dashboard" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Back to dashboard</Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🔔 Push Urgent Alert to Workers</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            <strong>{backlogCount ?? 0}</strong> open &amp; planned slabs in the backlog.{" "}
            {q
              ? <>Showing matches for <strong>“{q}”</strong>.</>
              : <>Showing slabs already flagged urgent. <strong>Search a slab code / label below</strong> to push any slab.</>}
          </p>
        </div>
        <Link href="/dashboard" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}>← Dashboard</Link>
      </div>

      {/* Server-side search across the whole open/planned backlog. */}
      <form method="get" action="/dashboard/push-urgent" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search the full backlog by slab code, label, temple or stone…"
          style={{ flex: "1 1 320px", minWidth: 0, fontSize: 13, padding: "9px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
        />
        <button type="submit" style={{ padding: "9px 20px", fontSize: 13, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 8, cursor: "pointer" }}>Search</button>
        {q && (
          <Link href="/dashboard/push-urgent" style={{ padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none" }}>Clear</Link>
        )}
      </form>

      {sp?.toast && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e" }}>
          {sp.toast}
        </div>
      )}

      {capped && (
        <div style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.3)", borderRadius: 10, padding: "8px 14px", fontSize: 12, color: "#2563eb" }}>
          Showing the first {LOAD_CAP} matches — type a more specific code/label to narrow it down.
        </div>
      )}

      {!q && pushList.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          No slabs are currently flagged urgent. Search a slab code or label above to push one.
        </div>
      ) : (
        <PushPanel slabs={pushList} pushed={pushed} todayLabel={todayLabel} expandedByDefault hideSearch />
      )}
    </div>
  );
}
