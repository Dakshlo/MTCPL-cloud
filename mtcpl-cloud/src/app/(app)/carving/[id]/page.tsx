import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { EventTimeline } from "../event-timeline";
import { ConfirmButton } from "@/components/confirm-button";
import {
  approveCarvingJobAction,
  rejectCarvingJobAction,
  dispatchCarvingJobAction,
  cancelCarvingJobAction,
} from "../actions";

export default async function CarvingJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth(["developer"]);
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const [{ data: job }, { data: events }] = await Promise.all([
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, cnc_machine_id, note, status, deadline_days, due_at, assigned_by, assigned_at, completed_at, progress_phase, review_approved_at, review_approved_by, review_notes, photo_urls")
      .eq("id", id)
      .single(),
    admin
      .from("carving_job_events")
      .select("id, event_type, message, created_at, user_id")
      .eq("carving_item_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!job) notFound();

  const [{ data: slab }, { data: machine }, { data: assignedByProfile }, { data: eventUserProfiles }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, source_block_id")
      .eq("id", job.slab_requirement_id)
      .single(),
    job.cnc_machine_id
      ? admin.from("cnc_machines").select("machine_code, operator_name").eq("id", job.cnc_machine_id).single()
      : Promise.resolve({ data: null }),
    job.assigned_by
      ? admin.from("profiles").select("full_name").eq("id", job.assigned_by).single()
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
  const inReview = !!job.completed_at && !job.review_approved_at;
  const approved = !!job.review_approved_at;
  const dispatched = job.status === "dispatched";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      <div>
        <Link href="/carving" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>
          ← Back to Carving
        </Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>
          Carving Job · <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--gold-dark)" }}>{job.slab_requirement_id}</code>
        </h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        {/* LEFT — slab + vendor + photos */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="page-card">
            <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
              Slab
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
                  {slab.source_block_id && <span className="role-pill">from {slab.source_block_id}</span>}
                </div>
              </div>
            )}
          </section>

          <section className="page-card">
            <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
              Assignment
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Vendor</span>
                <span style={{ fontWeight: 600 }}>{job.vendor_name} ({job.vendor_type})</span>
              </div>
              {machine && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Machine</span>
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>
                    {machine.machine_code}{machine.operator_name ? ` · ${machine.operator_name}` : ""}
                  </span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Assigned</span>
                <span>{new Date(job.assigned_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              {assignedByProfile && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">By</span>
                  <span>{assignedByProfile.full_name}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Deadline</span>
                <span style={{ fontWeight: 700, color: overdue ? "#DC2626" : daysUntilDeadline !== null && daysUntilDeadline <= 2 ? "#D97706" : "var(--text)" }}>
                  {job.due_at
                    ? `${new Date(job.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${overdue ? ` (overdue by ${Math.abs(daysUntilDeadline!)}d)` : daysUntilDeadline !== null ? ` (${daysUntilDeadline}d)` : ""}`
                    : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Status</span>
                <span className="role-pill">{job.status}</span>
              </div>
              {job.progress_phase && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Current phase</span>
                  <span style={{ fontWeight: 600 }}>{job.progress_phase}</span>
                </div>
              )}
              {job.note && (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "var(--surface-alt)", borderRadius: 6 }}>
                  <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Assignment note</div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{job.note}</div>
                </div>
              )}
              {job.review_notes && (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "#991b1b", fontWeight: 700 }}>Review notes</div>
                  <div style={{ fontSize: 12, marginTop: 2, color: "#991b1b" }}>{job.review_notes}</div>
                </div>
              )}
            </div>
          </section>

          {photoUrls.length > 0 && (
            <section className="page-card">
              <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
                Photos ({photoUrls.length})
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {photoUrls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, color: "#7c3aed", textDecoration: "underline", wordBreak: "break-all" }}
                  >
                    📷 {url}
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Actions */}
          <section className="page-card">
            <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
              Team actions
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {inReview && (
                <>
                  <form action={approveCarvingJobAction} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input
                      type="text"
                      name="notes"
                      placeholder="Approval notes (optional)"
                      style={{ flex: 1, fontSize: 12, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                    />
                    <button type="submit" className="primary-button" style={{ fontSize: 12, padding: "6px 14px" }}>
                      ✔ Approve
                    </button>
                  </form>
                  <form action={rejectCarvingJobAction} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input
                      type="text"
                      name="notes"
                      required
                      placeholder="Rejection reason (required)"
                      style={{ flex: 1, fontSize: 12, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                    />
                    <button type="submit" className="ghost-button danger-ghost" style={{ fontSize: 12, padding: "6px 14px" }}>
                      Reject
                    </button>
                  </form>
                </>
              )}

              {approved && !dispatched && (
                <form action={dispatchCarvingJobAction} style={{ display: "flex", gap: 6 }}>
                  <input type="hidden" name="job_id" value={job.id} />
                  <input
                    type="text"
                    name="note"
                    placeholder="Dispatch note (optional)"
                    style={{ flex: 1, fontSize: 12, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                  />
                  <button type="submit" className="primary-button" style={{ fontSize: 12, padding: "6px 14px" }}>
                    🚚 Mark Dispatched
                  </button>
                </form>
              )}

              {dispatched && (
                <div style={{ padding: "10px 14px", background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.2)", borderRadius: 6, fontSize: 12, color: "#15803d", fontWeight: 600 }}>
                  ✓ This slab has been dispatched.
                </div>
              )}

              {!inReview && !approved && !dispatched && (
                <form action={cancelCarvingJobAction}>
                  <input type="hidden" name="job_id" value={job.id} />
                  <ConfirmButton
                    message="Cancel this assignment? Slab returns to cut_done."
                    className="ghost-button danger-ghost"
                    style={{ fontSize: 12 }}
                  >
                    Cancel assignment
                  </ConfirmButton>
                </form>
              )}
            </div>
          </section>
        </div>

        {/* RIGHT — event timeline */}
        <section className="page-card">
          <h3 style={{ margin: "0 0 12px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
            Event timeline
          </h3>
          <EventTimeline events={eventsWithNames} />
        </section>
      </div>
    </div>
  );
}
