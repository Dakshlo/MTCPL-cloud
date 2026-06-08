import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { MachineFormModal, StatusChip, type Machine } from "../machines-client";
import { RaiseTicketButton, TicketList, type Ticket } from "../tickets-client";
import { setMachineStatusAction, deleteMachineAction } from "../actions";

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
  "id, ticket_no, machine_id, machine_name, section, problem, priority, status, resolution_kind, inspection_notes, problem_photo_path, done_photo_path, quote_amount, quote_vendor, quote_scope, quote_expected_days, rejection_reason, repair_started_at, repair_expected_at, repair_completed_at, raised_by, raised_at";

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

export default async function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const [{ data: machineRow }, { data: ticketRows }, { data: catRows }, { data: secRows }, profilesMap] = await Promise.all([
    admin.from("company_machines").select("id, machine_code, name, category, section, status, location, notes").eq("id", id).maybeSingle(),
    admin.from("machine_maintenance_tickets").select(TICKET_COLS).eq("machine_id", id).order("created_at", { ascending: false }),
    admin.from("machine_categories").select("name").order("name"),
    admin.from("machine_sections").select("name").order("name"),
    getProfilesMap(),
  ]);

  if (!machineRow) redirect("/maintenance?toast=" + encodeURIComponent("Machine not found."));
  const machine = { ...(machineRow as Omit<Machine, "openTickets">), openTickets: 0 } as Machine;
  const tickets = ((ticketRows ?? []) as TicketRow[]).map((r) => toTicket(r, profilesMap));
  const categories = ((catRows ?? []) as Array<{ name: string }>).map((c) => c.name);
  const sections = ((secRows ?? []) as Array<{ name: string }>).map((s) => s.name);
  const back = `/maintenance/${id}`;
  const hasTickets = tickets.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 900 }}>
      <Link href="/maintenance" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← All machines</Link>

      {/* Machine header */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--muted)" }}>{machine.machine_code}</code>
            <h1 style={{ margin: "2px 0 6px", fontSize: 22 }}>{machine.name}</h1>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusChip status={machine.status} />
              {machine.category && <span className="muted" style={{ fontSize: 12.5 }}>{machine.category}</span>}
              {machine.section && <span className="muted" style={{ fontSize: 12.5 }}>· {machine.section}</span>}
              {machine.location && <span className="muted" style={{ fontSize: 12.5 }}>· 📍 {machine.location}</span>}
            </div>
            {machine.notes && <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>{machine.notes}</p>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <RaiseTicketButton machineId={machine.id} back={back} />
            <MachineFormModal mode="edit" machine={machine} categories={categories} sections={sections} back={back}
              buttonLabel="Edit" buttonStyle={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer", color: "var(--text)" }} />
          </div>
        </div>

        {/* Manual status controls */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--border)", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Set status</span>
          {(["working", "under_maintenance", "retired"] as const).filter((s) => s !== machine.status).map((s) => (
            <form key={s} action={setMachineStatusAction}>
              <input type="hidden" name="id" value={machine.id} /><input type="hidden" name="status" value={s} /><input type="hidden" name="back" value={back} />
              <button type="submit" style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", color: "var(--text)" }}>
                {s === "working" ? "Working" : s === "under_maintenance" ? "Under maintenance" : "Retire"}
              </button>
            </form>
          ))}
          {!hasTickets && (
            <form action={deleteMachineAction} style={{ marginLeft: "auto" }}>
              <input type="hidden" name="id" value={machine.id} /><input type="hidden" name="back" value="/maintenance" />
              <button type="submit" style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "#b91c1c", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, cursor: "pointer" }}>
                Delete machine
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Ticket history */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>
          Maintenance tickets <span className="muted" style={{ fontWeight: 600 }}>({tickets.length})</span>
        </div>
        <TicketList tickets={tickets} back={back} showMachine={false} />
      </div>
    </div>
  );
}
