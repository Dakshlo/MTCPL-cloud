import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { MachinesGrid, type Machine, type Group } from "./machines-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer"];
const OPEN_STATUSES = ["raised", "inspecting", "awaiting_approval", "in_repair"];
const IMG_BUCKET = "machine_images";

export default async function MaintenancePage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");

  const admin = createAdminSupabaseClient();
  const pub = (path: string | null) =>
    path ? admin.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl : null;

  const [{ data: groupRows }, { data: machineRows }, { data: openTickets }] = await Promise.all([
    admin.from("machine_groups").select("id, name, image_path").order("name", { ascending: true }),
    admin.from("company_machines").select("id, machine_code, name, group_id, image_path, status, location, notes").order("created_at", { ascending: false }),
    admin.from("machine_maintenance_tickets").select("machine_id").in("status", OPEN_STATUSES),
  ]);

  const openCount = new Map<string, number>();
  for (const r of (openTickets ?? []) as Array<{ machine_id: string }>) {
    openCount.set(r.machine_id, (openCount.get(r.machine_id) ?? 0) + 1);
  }

  type GroupRow = { id: string; name: string; image_path: string | null };
  const groupRowsTyped = (groupRows ?? []) as GroupRow[];
  const groupImg = new Map<string, string | null>();
  for (const g of groupRowsTyped) groupImg.set(g.id, pub(g.image_path));

  type MachineRow = {
    id: string; machine_code: string | null; name: string; group_id: string | null;
    image_path: string | null; status: string; location: string | null; notes: string | null;
  };
  const machines: Machine[] = ((machineRows ?? []) as MachineRow[]).map((m) => ({
    id: m.id, machine_code: m.machine_code, name: m.name, status: m.status,
    location: m.location, notes: m.notes, group_id: m.group_id,
    imageUrl: m.image_path ? pub(m.image_path) : (m.group_id ? groupImg.get(m.group_id) ?? null : null),
    openTickets: openCount.get(m.id) ?? 0,
  }));

  const groups: Group[] = groupRowsTyped.map((g) => ({
    id: g.id, name: g.name, imageUrl: groupImg.get(g.id) ?? null,
    machines: machines.filter((m) => m.group_id === g.id),
  }));
  const ungrouped = machines.filter((m) => !m.group_id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>🛠️ Maintenance — Machines</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 720 }}>
          Group your machines (Cranes, CNCs, Vehicles…), each group shares a photo. Add machines into a group,
          then raise a repair ticket from a machine&apos;s page.
        </p>
      </div>
      <MachinesGrid groups={groups} ungrouped={ungrouped} />
    </div>
  );
}
