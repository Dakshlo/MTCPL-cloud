import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { MachineFormModal, StatusChip, MaintTimer, type Machine, type GroupOpt } from "../machines-client";
import { MachineAdminControls } from "../machine-admin-controls";

export const dynamic = "force-dynamic";

// Mirror the board's access. crosscheck (= "Manager") can open a machine
// and mark it Working / Under-maintenance, but not edit/retire/delete.
const ALLOWED = ["owner", "developer", "crosscheck"];
const MANAGE_ROLES = ["owner", "developer"];
const IMG_BUCKET = "machine_images";

export default async function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");
  const canManage = MANAGE_ROLES.includes(profile.role);
  const { id } = await params;
  const admin = createAdminSupabaseClient();
  const pub = (path: string | null) => (path ? admin.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl : null);

  const [{ data: machineRow }, { data: groupRows }, { data: locRows }] = await Promise.all([
    admin.from("company_machines").select("id, machine_code, name, group_id, image_path, status, location, notes, under_maintenance_since").eq("id", id).maybeSingle(),
    admin.from("machine_groups").select("id, name, image_path, parent_id").order("name", { ascending: true }),
    admin.from("machine_locations").select("name").order("name", { ascending: true }),
  ]);

  if (!machineRow) redirect("/maintenance?toast=" + encodeURIComponent("Machine not found."));
  const mr = machineRow as { id: string; machine_code: string | null; name: string; group_id: string | null; image_path: string | null; status: string; location: string | null; notes: string | null; under_maintenance_since: string | null };
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
    location: mr.location, notes: mr.notes, group_id: mr.group_id, imageUrl,
    underMaintenanceSince: mr.under_maintenance_since,
  };
  const back = `/maintenance/${id}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 900 }}>
      <Link href="/maintenance" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← All machines</Link>

      {/* Machine header */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 16, padding: 18, flexWrap: "wrap" }}>
          {/* Photo */}
          <div style={{ width: 140, flexShrink: 0 }}>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 10, display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: 110, borderRadius: 10, background: "linear-gradient(135deg, rgba(63,143,134,0.12), rgba(63,143,134,0.04))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, color: "rgba(63,143,134,0.55)" }}>🛠️</div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--muted)" }}>{machine.machine_code}</code>
                <h1 style={{ margin: "2px 0 6px", fontSize: 22 }}>{machine.name}</h1>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <StatusChip status={machine.status} />
                  {machine.status === "under_maintenance" && machine.underMaintenanceSince && (
                    <MaintTimer since={machine.underMaintenanceSince} nowMs={Date.now()} style={{ fontSize: 12, fontWeight: 800, color: "#9a3412" }} />
                  )}
                  {myGroup && <span className="muted" style={{ fontSize: 12.5 }}>{myGroup.name}</span>}
                  {machine.location && <span className="muted" style={{ fontSize: 12.5 }}>· 📍 {machine.location}</span>}
                </div>
                {machine.notes && <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>{machine.notes}</p>}
              </div>
              {canManage && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <MachineFormModal mode="edit" machine={machine} groups={groupOpts} locations={locations} back={back}
                    buttonLabel="Edit" buttonStyle={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer", color: "var(--text)" }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Manual status controls — Working / Under maintenance are instant;
            Retire + Delete (manage-only) ask for in-app confirmation. */}
        <MachineAdminControls machineId={machine.id} status={machine.status} back={back} canManage={canManage} />
      </div>
    </div>
  );
}
