import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { MachineFormModal, StatusChip, type Machine, type GroupOpt } from "../machines-client";
import { RaiseTicketButton, TicketList, type Ticket } from "../tickets-client";
import { MachineAdminControls } from "../machine-admin-controls";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer"];
const IMG_BUCKET = "machine_images";

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
  const pub = (path: string | null) => (path ? admin.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl : null);

  const [{ data: machineRow }, { data: ticketRows }, { data: groupRows }, { data: locRows }, profilesMap] = await Promise.all([
    admin.from("company_machines").select("id, machine_code, name, group_id, image_path, status, location, notes").eq("id", id).maybeSingle(),
    admin.from("machine_maintenance_tickets").select(TICKET_COLS).eq("machine_id", id).order("created_at", { ascending: false }),
    admin.from("machine_groups").select("id, name, image_path, parent_id").order("name", { ascending: true }),
    admin.from("machine_locations").select("name").order("name", { ascending: true }),
    getProfilesMap(),
  ]);

  if (!machineRow) redirect("/maintenance?toast=" + encodeURIComponent("Machine not found."));
  const mr = machineRow as { id: string; machine_code: string | null; name: string; group_id: string | null; image_path: string | null; status: string; location: string | null; notes: string | null };
  type GroupRow = { id: string; name: string; image_path: string | null; parent_id: string | null };
  const groupsTyped = (groupRows ?? []) as GroupRow[];
  const gById = new Map<string, GroupRow>();
  for (const g of groupsTyped) gById.set(g.id, g);
  // Hierarchical group options for the edit form ("Parent › Child").
  const groupOpts: GroupOpt[] = [];
  for (const g of groupsTyped.filter((x) => !x.parent_id)) {
    groupOpts.push({ id: g.id, name: g.name });
    for (const s of groupsTyped.filter((x) => x.parent_id === g.id)) groupOpts.push({ id: s.id, name: `${g.name} › ${s.name}` });
  }
  const locations = ((locRows ?? []) as Array<{ name: string }>).map((l) => l.name);
  const myGroup = mr.group_id ? gById.get(mr.group_id) ?? null : null;
  const resolveGroupImg = (g: GroupRow | null): string | null =>
    g ? (g.image_path ? pub(g.image_path) : (g.parent_id ? resolveGroupImg(gById.get(g.parent_id) ?? null) : null)) : null;
  const imageUrl = mr.image_path ? pub(mr.image_path) : resolveGroupImg(myGroup);

  const machine: Machine = {
    id: mr.id, machine_code: mr.machine_code, name: mr.name, status: mr.status,
    location: mr.location, notes: mr.notes, group_id: mr.group_id, imageUrl, openTickets: 0,
  };
  const tickets = ((ticketRows ?? []) as TicketRow[]).map((r) => toTicket(r, profilesMap));
  const back = `/maintenance/${id}`;
  const hasTickets = tickets.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 900 }}>
      <Link href="/maintenance" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← All machines</Link>

      {/* Machine header */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 16, padding: 18, flexWrap: "wrap" }}>
          {/* Photo */}
          <div style={{ width: 160, flexShrink: 0 }}>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 10, display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: 130, borderRadius: 10, background: "linear-gradient(135deg, rgba(63,143,134,0.12), rgba(63,143,134,0.04))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, color: "rgba(63,143,134,0.55)" }}>🛠️</div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--muted)" }}>{machine.machine_code}</code>
                <h1 style={{ margin: "2px 0 6px", fontSize: 22 }}>{machine.name}</h1>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <StatusChip status={machine.status} />
                  {myGroup && <span className="muted" style={{ fontSize: 12.5 }}>{myGroup.name}</span>}
                  {machine.location && <span className="muted" style={{ fontSize: 12.5 }}>· 📍 {machine.location}</span>}
                </div>
                {machine.notes && <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>{machine.notes}</p>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <RaiseTicketButton machineId={machine.id} back={back} />
                <MachineFormModal mode="edit" machine={machine} groups={groupOpts} locations={locations} back={back}
                  buttonLabel="Edit" buttonStyle={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer", color: "var(--text)" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Manual status controls — Retire + Delete ask for in-app confirmation */}
        <MachineAdminControls machineId={machine.id} status={machine.status} back={back} hasTickets={hasTickets} />
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
