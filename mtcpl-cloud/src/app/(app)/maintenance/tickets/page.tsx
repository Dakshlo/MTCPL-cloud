import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { TicketList, type Ticket } from "../tickets-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer"];

type TicketRow = {
  id: string; ticket_no: string | null; machine_id: string; machine_name: string;
  section: string | null; problem: string; priority: string; status: string;
  resolution_kind: string | null; inspection_notes: string | null;
  problem_photo_path: string | null; done_photo_path: string | null;
  quote_amount: number | string | null; quote_vendor: string | null; quote_scope: string | null;
  quote_expected_days: number | null; rejection_reason: string | null;
  repair_started_at: string | null; repair_expected_at: string | null; repair_completed_at: string | null;
  raised_by: string | null; raised_at: string | null;
};
const TICKET_COLS =
  "id, ticket_no, machine_id, machine_name, section, problem, priority, status, resolution_kind, inspection_notes, problem_photo_path, done_photo_path, quote_amount, quote_vendor, quote_scope, quote_expected_days, rejection_reason, repair_started_at, repair_expected_at, repair_completed_at, raised_by, raised_at, created_at";

function toTicket(r: TicketRow, names: Record<string, string>): Ticket {
  return {
    id: r.id, ticket_no: r.ticket_no, machine_id: r.machine_id, machine_name: r.machine_name,
    section: r.section, problem: r.problem, priority: r.priority, status: r.status,
    resolution_kind: r.resolution_kind, inspection_notes: r.inspection_notes,
    has_problem_photo: !!r.problem_photo_path, has_done_photo: !!r.done_photo_path,
    quote_amount: r.quote_amount == null ? null : Number(r.quote_amount),
    quote_vendor: r.quote_vendor, quote_scope: r.quote_scope, quote_expected_days: r.quote_expected_days,
    rejection_reason: r.rejection_reason, repair_started_at: r.repair_started_at,
    repair_expected_at: r.repair_expected_at, repair_completed_at: r.repair_completed_at,
    raised_by_name: r.raised_by ? (names[r.raised_by] ?? null) : null, raised_at: r.raised_at,
  };
}

const SECTIONS: Array<{ key: string; title: string; statuses: string[] }> = [
  { key: "approval", title: "⏳ Awaiting owner approval", statuses: ["awaiting_approval"] },
  { key: "repair", title: "🔧 In repair", statuses: ["in_repair"] },
  { key: "new", title: "🆕 New / inspecting", statuses: ["raised", "inspecting"] },
  { key: "rejected", title: "↩️ Rejected — needs re-quote", statuses: ["rejected"] },
];

export default async function MaintenanceTicketsPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const admin = createAdminSupabaseClient();

  // Paginated fetch of all tickets, newest first.
  const rows: TicketRow[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data } = await admin
      .from("machine_maintenance_tickets")
      .select(TICKET_COLS)
      .order("created_at", { ascending: false })
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    rows.push(...(data as TicketRow[]));
    if (data.length < 1000) break;
  }
  const profilesMap = await getProfilesMap();
  const tickets = rows.map((r) => toTicket(r, profilesMap));
  const back = "/maintenance/tickets";

  const byStatus = (statuses: string[]) => tickets.filter((t) => statuses.includes(t.status));
  const history = tickets.filter((t) => t.status === "completed" || t.status === "cancelled").slice(0, 60);
  const activeCount = tickets.filter((t) => !["completed", "cancelled"].includes(t.status)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 32, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <Link href="/maintenance" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Machines</Link>
          <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>🧾 Repair Tickets</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>{activeCount} active ticket(s).</p>
        </div>
      </div>

      {SECTIONS.map((sec) => {
        const list = byStatus(sec.statuses);
        if (list.length === 0) return null;
        return (
          <div key={sec.key}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>
              {sec.title} <span className="muted" style={{ fontWeight: 600 }}>({list.length})</span>
            </div>
            <TicketList tickets={list} back={back} showMachine />
          </div>
        );
      })}

      {tickets.length === 0 && (
        <div className="banner">No tickets yet. Open a machine and tap <strong>＋ Raise ticket</strong>.</div>
      )}

      {history.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>
            ✅ Completed / cancelled <span className="muted" style={{ fontWeight: 600 }}>({history.length})</span>
          </summary>
          <div style={{ marginTop: 10 }}>
            <TicketList tickets={history} back={back} showMachine />
          </div>
        </details>
      )}
    </div>
  );
}
