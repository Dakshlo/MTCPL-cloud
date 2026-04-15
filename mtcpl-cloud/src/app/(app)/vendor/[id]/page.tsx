import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { EventTimeline } from "../../carving/event-timeline";
import {
  startCarvingJobAction,
  updateCarvingProgressAction,
  addCarvingPhotoAction,
  markCarvingCompleteAction,
} from "../actions";

export default async function VendorJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth(["vendor", "developer"]);
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const [{ data: job }, { data: events }] = await Promise.all([
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_id, vendor_name, cnc_machine_id, note, status, due_at, assigned_at, progress_phase, completed_at, review_notes, review_approved_at, photo_urls")
      .eq("id", id)
      .single(),
    admin
      .from("carving_job_events")
      .select("id, event_type, message, created_at, user_id")
      .eq("carving_item_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!job) notFound();

  // Scope: non-developer vendors can only see their own jobs
  if (profile.role !== "developer" && profile.vendor_id && job.vendor_id !== profile.vendor_id) {
    redirect("/vendor?toast=Not+your+job");
  }

  const [{ data: slab }, { data: machine }, { data: eventUserProfiles }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft")
      .eq("id", job.slab_requirement_id)
      .single(),
    job.cnc_machine_id
      ? admin.from("cnc_machines").select("machine_code, operator_name").eq("id", job.cnc_machine_id).single()
      : Promise.resolve({ data: null }),
    admin
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set((events ?? []).map((e) => e.user_id).filter(Boolean) as string[])]),
  ]);

  const nameById = new Map<string, string>();
  for (const p of eventUserProfiles ?? []) nameById.set(p.id, p.full_name ?? "—");
  const eventsWithNames = (events ?? []).map((e) => ({
    ...e,
    user_name: e.user_id ? nameById.get(e.user_id) ?? null : null,
  }));

  const photoUrls = (job.photo_urls ?? []) as string[];
  const daysUntilDeadline = job.due_at ? Math.ceil((new Date(job.due_at).getTime() - Date.now()) / 86400000) : null;
  const overdue = daysUntilDeadline !== null && daysUntilDeadline < 0;
  const notStarted = job.status === "carving_assigned";
  const inProgress = job.status === "carving_in_progress";
  const awaitingReview = !!job.completed_at && !job.review_approved_at;
  const done = !!job.review_approved_at;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      <div>
        <Link href="/vendor" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>
          ← Back to My Jobs
        </Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>
          Job · <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--gold-dark)" }}>{job.slab_requirement_id}</code>
        </h1>
      </div>

      {job.review_notes && inProgress && (
        <div style={{
          padding: "12px 16px",
          background: "rgba(220,38,38,0.08)",
          border: "2px solid rgba(220,38,38,0.3)",
          borderRadius: 8,
        }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#991b1b" }}>⚠ Rework needed</div>
          <div style={{ fontSize: 12, color: "#991b1b", marginTop: 4 }}>{job.review_notes}</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="page-card">
            <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
              Slab details
            </h3>
            {slab && (
              <div style={{ fontSize: 13 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{slab.temple}</div>
                <div className="muted" style={{ fontSize: 12 }}>{slab.label}</div>
                <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {slab.stone && <span className="role-pill">{slab.stone}</span>}
                  <span className="role-pill">
                    {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft}&Prime;
                  </span>
                </div>
                {job.note && (
                  <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--surface-alt)", borderRadius: 6 }}>
                    <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Instructions from team</div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>{job.note}</div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="page-card">
            <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
              Deadline
            </h3>
            <div style={{ fontSize: 20, fontWeight: 800, color: overdue ? "#DC2626" : daysUntilDeadline !== null && daysUntilDeadline <= 2 ? "#D97706" : "#16A34A" }}>
              {daysUntilDeadline === null
                ? "No deadline set"
                : overdue
                ? `⚠ Overdue by ${Math.abs(daysUntilDeadline)} days`
                : daysUntilDeadline === 0
                ? "Due today"
                : `${daysUntilDeadline} days remaining`}
            </div>
            {job.due_at && (
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Target: {new Date(job.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
              </div>
            )}
            {machine && (
              <div style={{ marginTop: 10, padding: "6px 10px", background: "var(--surface-alt)", borderRadius: 4 }}>
                <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Machine: </span>
                <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{machine.machine_code}</span>
              </div>
            )}
          </section>

          {/* Actions */}
          {!done && (
            <section className="page-card">
              <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
                Your actions
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {notStarted && (
                  <form action={startCarvingJobAction}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <button type="submit" className="primary-button" style={{ width: "100%" }}>
                      ▶ Start Work
                    </button>
                  </form>
                )}

                {(inProgress || notStarted) && (
                  <>
                    <form action={updateCarvingProgressAction} style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                      <input type="hidden" name="job_id" value={job.id} />
                      <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Update progress phase
                        </span>
                        <select
                          name="progress_phase"
                          required
                          style={{ padding: "7px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                        >
                          <option value="">— pick phase —</option>
                          <option value="rough_cut">Rough Cut</option>
                          <option value="detailing">Detailing</option>
                          <option value="polishing">Polishing</option>
                          <option value="final_touches">Final Touches</option>
                        </select>
                      </label>
                      <input
                        type="text"
                        name="note"
                        placeholder="Note (optional)"
                        style={{ padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                      />
                      <button type="submit" className="ghost-button" style={{ fontSize: 12 }}>
                        Save progress
                      </button>
                    </form>

                    <form action={addCarvingPhotoAction} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="job_id" value={job.id} />
                      <input
                        type="url"
                        name="url"
                        required
                        placeholder="Photo URL (WhatsApp / Drive link)"
                        style={{ flex: 1, padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                      />
                      <button type="submit" className="ghost-button" style={{ fontSize: 12 }}>
                        + Photo
                      </button>
                    </form>
                  </>
                )}

                {inProgress && (
                  <form
                    action={markCarvingCompleteAction}
                    onSubmit={(e) => { if (!confirm("Mark this job as complete? Team will inspect and approve.")) e.preventDefault(); }}
                  >
                    <input type="hidden" name="job_id" value={job.id} />
                    <button type="submit" className="primary-button" style={{ width: "100%", background: "#16A34A", borderColor: "#16A34A" }}>
                      ✅ Mark Complete
                    </button>
                  </form>
                )}

                {awaitingReview && (
                  <div style={{ padding: "10px 14px", background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.25)", borderRadius: 6, fontSize: 12, color: "#92400e", fontWeight: 600 }}>
                    ⏳ Waiting for team to inspect and approve.
                  </div>
                )}
              </div>
            </section>
          )}

          {photoUrls.length > 0 && (
            <section className="page-card">
              <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
                Photos ({photoUrls.length})
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {photoUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#7c3aed", textDecoration: "underline", wordBreak: "break-all" }}>
                    📷 {url}
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="page-card">
          <h3 style={{ margin: "0 0 12px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
            Timeline
          </h3>
          <EventTimeline events={eventsWithNames} />
        </section>
      </div>
    </div>
  );
}
