import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export default async function VendorPortalPage() {
  const { profile } = await requireAuth(["vendor", "developer"]);
  const admin = createAdminSupabaseClient();

  // For developer testing: if no vendor_id, show all jobs
  // For real vendor users: scope to their vendor_id
  const isScoped = profile.role !== "developer" || !!profile.vendor_id;
  const vendorId = profile.vendor_id;

  let activeQuery = admin
    .from("carving_items")
    .select("id, slab_requirement_id, vendor_id, vendor_name, cnc_machine_id, status, due_at, assigned_at, progress_phase, note, review_notes, completed_at")
    .in("status", ["carving_assigned", "carving_in_progress"]);
  if (isScoped && vendorId) activeQuery = activeQuery.eq("vendor_id", vendorId);

  let reviewQuery = admin
    .from("carving_items")
    .select("id, slab_requirement_id, vendor_id, vendor_name, cnc_machine_id, status, due_at, completed_at")
    .not("completed_at", "is", null)
    .is("review_approved_at", null);
  if (isScoped && vendorId) reviewQuery = reviewQuery.eq("vendor_id", vendorId);

  let historyQuery = admin
    .from("carving_items")
    .select("id, slab_requirement_id, status, review_approved_at")
    .not("review_approved_at", "is", null)
    .order("review_approved_at", { ascending: false })
    .limit(20);
  if (isScoped && vendorId) historyQuery = historyQuery.eq("vendor_id", vendorId);

  const [{ data: activeJobs }, { data: reviewJobs }, { data: historyJobs }, { data: machines }] = await Promise.all([
    activeQuery,
    reviewQuery,
    historyQuery,
    vendorId
      ? admin.from("cnc_machines").select("id, machine_code").eq("vendor_id", vendorId).eq("is_active", true)
      : Promise.resolve({ data: [] }),
  ]);

  // Load slab info for display
  const slabIds = [
    ...new Set([
      ...(activeJobs ?? []).map((j) => j.slab_requirement_id),
      ...(reviewJobs ?? []).map((j) => j.slab_requirement_id),
    ]),
  ];
  type SlabRow = {
    id: string;
    label: string;
    temple: string;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
  };
  const { data: slabs } = slabIds.length > 0
    ? await admin.from("slab_requirements").select("id, label, temple, length_ft, width_ft, thickness_ft").in("id", slabIds)
    : { data: [] as SlabRow[] };
  const slabById = new Map<string, SlabRow>();
  for (const s of (slabs ?? []) as SlabRow[]) slabById.set(s.id, s);

  const machineCodeById = new Map<string, string>();
  for (const m of machines ?? []) machineCodeById.set(m.id, m.machine_code);

  // Group active jobs by machine if any CNC machines exist
  const hasMachines = machines && machines.length > 0;

  function daysUntil(iso: string | null) {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>My Carving Jobs</h1>
          <span className="role-pill" style={{ background: "var(--gold)", color: "#fff", fontWeight: 700, fontSize: 10 }}>
            DEV-ONLY
          </span>
        </div>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          {profile.vendor_name
            ? `Vendor portal for ${profile.vendor_name}`
            : profile.role === "developer"
            ? "Developer testing view — showing all vendor jobs"
            : "Your profile isn't linked to a vendor. Contact the team office."}
        </p>
      </div>

      {/* Active jobs */}
      <section className="page-card">
        <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>
          Active jobs ({(activeJobs ?? []).length})
        </h2>
        {(activeJobs ?? []).length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted-light)", fontSize: 13 }}>
            No active jobs right now.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {(activeJobs ?? []).map((j) => {
              const slab = slabById.get(j.slab_requirement_id);
              const days = daysUntil(j.due_at);
              const overdue = days !== null && days < 0;
              const wasRejected = !!j.review_notes;
              return (
                <Link
                  key={j.id}
                  href={`/vendor/${j.id}`}
                  style={{
                    textDecoration: "none",
                    padding: "14px 16px",
                    background: wasRejected ? "rgba(220,38,38,0.04)" : "var(--surface)",
                    border: `1px solid ${wasRejected ? "rgba(220,38,38,0.3)" : overdue ? "rgba(220,38,38,0.2)" : "var(--border)"}`,
                    borderRadius: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
                      {j.slab_requirement_id}
                    </span>
                    <span className="role-pill" style={{ fontSize: 9 }}>{j.status}</span>
                  </div>
                  {slab && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{slab.temple}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{slab.label}</div>
                      <div className="muted" style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
                        {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft}&Prime;
                      </div>
                    </>
                  )}
                  {j.cnc_machine_id && (
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>
                      Machine: {machineCodeById.get(j.cnc_machine_id) ?? "—"}
                    </div>
                  )}
                  {j.progress_phase && (
                    <div style={{ fontSize: 11, color: "#D97706", fontWeight: 600 }}>
                      Phase: {j.progress_phase}
                    </div>
                  )}
                  <div style={{
                    marginTop: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    color: overdue ? "#DC2626" : days !== null && days <= 2 ? "#D97706" : "#16A34A",
                  }}>
                    {days === null ? "No deadline" : overdue ? `⚠ Overdue by ${Math.abs(days)} days` : days === 0 ? "Due today" : `${days} days left`}
                  </div>
                  {wasRejected && (
                    <div style={{ marginTop: 6, padding: "6px 8px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 4, fontSize: 11, color: "#991b1b" }}>
                      <strong>Rework needed:</strong> {j.review_notes}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Awaiting review */}
      {(reviewJobs ?? []).length > 0 && (
        <section className="page-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>
            Awaiting team review ({(reviewJobs ?? []).length})
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {(reviewJobs ?? []).map((j) => {
              const slab = slabById.get(j.slab_requirement_id);
              return (
                <Link
                  key={j.id}
                  href={`/vendor/${j.id}`}
                  style={{
                    textDecoration: "none",
                    padding: "12px 14px",
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12 }}>
                    {j.slab_requirement_id}
                  </div>
                  {slab && <div style={{ fontSize: 11, color: "var(--muted)" }}>{slab.temple}</div>}
                  <div style={{ fontSize: 10, color: "#16A34A", marginTop: 4 }}>
                    Completed {j.completed_at ? new Date(j.completed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent history */}
      {(historyJobs ?? []).length > 0 && (
        <section className="page-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 15 }}>
            Recently approved ({(historyJobs ?? []).length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(historyJobs ?? []).map((j) => (
              <div key={j.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 10px", background: "var(--surface-alt)", borderRadius: 4 }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{j.slab_requirement_id}</span>
                <span className="muted">
                  {j.status === "dispatched" ? "🚚 Dispatched" : "✔ Approved"}
                  {j.review_approved_at && ` · ${new Date(j.review_approved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasMachines && (
        <section className="page-card">
          <h3 style={{ margin: "0 0 8px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
            My CNC machines
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {machines!.map((m) => (
              <span key={m.id} className="role-pill" style={{ fontSize: 11 }}>
                {m.machine_code}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
