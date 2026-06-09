import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { MachinesGrid, type Machine, type Group, type GroupOpt } from "./machines-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer"];
const IMG_BUCKET = "machine_images";

export default async function MaintenancePage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");

  const admin = createAdminSupabaseClient();
  const pub = (path: string | null) => (path ? admin.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl : null);

  const [{ data: groupRows }, { data: machineRows }, { data: locRows }] = await Promise.all([
    admin.from("machine_groups").select("id, name, image_path, parent_id").order("name", { ascending: true }),
    admin.from("company_machines").select("id, machine_code, name, group_id, image_path, status, location, notes, under_maintenance_since").order("created_at", { ascending: false }),
    admin.from("machine_locations").select("name").order("name", { ascending: true }),
  ]);

  type GroupRow = { id: string; name: string; image_path: string | null; parent_id: string | null };
  const grows = (groupRows ?? []) as GroupRow[];
  const byId = new Map<string, GroupRow>();
  for (const g of grows) byId.set(g.id, g);
  // Resolved group image: own photo, else the parent group's photo (one level).
  const resolvedImg = (id: string | null): string | null => {
    if (!id) return null;
    const g = byId.get(id);
    if (!g) return null;
    if (g.image_path) return pub(g.image_path);
    return g.parent_id ? resolvedImg(g.parent_id) : null;
  };

  type MachineRow = {
    id: string; machine_code: string | null; name: string; group_id: string | null;
    image_path: string | null; status: string; location: string | null; notes: string | null;
    under_maintenance_since: string | null;
  };
  const machines: Machine[] = ((machineRows ?? []) as MachineRow[]).map((m) => ({
    id: m.id, machine_code: m.machine_code, name: m.name, status: m.status,
    location: m.location, notes: m.notes, group_id: m.group_id,
    imageUrl: m.image_path ? pub(m.image_path) : resolvedImg(m.group_id),
    underMaintenanceSince: m.under_maintenance_since,
  }));
  const machinesOf = (gid: string) => machines.filter((m) => m.group_id === gid);

  const topGroups = grows.filter((g) => !g.parent_id);
  const subsOf = (gid: string) => grows.filter((g) => g.parent_id === gid);

  const tree: Group[] = topGroups.map((g) => ({
    id: g.id, name: g.name, parent_id: null, imageUrl: pub(g.image_path),
    machines: machinesOf(g.id),
    subgroups: subsOf(g.id).map((s) => ({
      id: s.id, name: s.name, parent_id: g.id, imageUrl: resolvedImg(s.id), machines: machinesOf(s.id),
    })),
  }));

  // Flat hierarchical options for the machine form (sub-groups shown as "Parent › Child").
  const groupOpts: GroupOpt[] = [];
  for (const g of topGroups) {
    groupOpts.push({ id: g.id, name: g.name });
    for (const s of subsOf(g.id)) groupOpts.push({ id: s.id, name: `${g.name} › ${s.name}` });
  }
  const topGroupOpts: GroupOpt[] = topGroups.map((g) => ({ id: g.id, name: g.name }));
  const locations = ((locRows ?? []) as Array<{ name: string }>).map((l) => l.name);
  const ungrouped = machines.filter((m) => !m.group_id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>🛠️ Maintenance — Machines</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 720 }}>
          Group your machines (CNC, Cranes, Vehicles…), nest sub-groups if needed (CNC → Mohit CNC). Mark each
          machine <strong>Working</strong> or <strong>Under maintenance</strong> from its page — the board shows
          what&apos;s running at a glance, and how long anything has been down.
        </p>
      </div>
      <MachinesGrid tree={tree} ungrouped={ungrouped} groupOpts={groupOpts} topGroupOpts={topGroupOpts} locations={locations} nowMs={Date.now()} />
    </div>
  );
}
