import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { MachinesGrid, type Machine } from "./machines-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer"];
const OPEN_STATUSES = ["raised", "inspecting", "awaiting_approval", "in_repair"];

export default async function MaintenancePage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");

  const admin = createAdminSupabaseClient();

  const [{ data: machineRows }, { data: catRows }, { data: secRows }, { data: openTickets }] = await Promise.all([
    admin
      .from("company_machines")
      .select("id, machine_code, name, category, section, status, location, notes")
      .order("created_at", { ascending: false }),
    admin.from("machine_categories").select("name").order("name"),
    admin.from("machine_sections").select("name").order("name"),
    admin.from("machine_maintenance_tickets").select("machine_id").in("status", OPEN_STATUSES),
  ]);

  const openCount = new Map<string, number>();
  for (const r of (openTickets ?? []) as Array<{ machine_id: string }>) {
    openCount.set(r.machine_id, (openCount.get(r.machine_id) ?? 0) + 1);
  }

  const machines: Machine[] = ((machineRows ?? []) as Array<Omit<Machine, "openTickets">>).map((m) => ({
    ...m,
    openTickets: openCount.get(m.id) ?? 0,
  }));
  const categories = ((catRows ?? []) as Array<{ name: string }>).map((c) => c.name);
  const sections = ((secRows ?? []) as Array<{ name: string }>).map((s) => s.name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>🛠️ Maintenance — Machines</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 720 }}>
          Every company machine &amp; vehicle, its working status, and its repair tickets. Add a machine, then
          raise a repair ticket from the machine&apos;s page.
        </p>
      </div>
      <MachinesGrid machines={machines} categories={categories} sections={sections} />
    </div>
  );
}
