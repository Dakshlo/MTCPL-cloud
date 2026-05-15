import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { EventTimeline } from "../event-timeline";
import { ConfirmButton } from "@/components/confirm-button";
import {
  approveCarvingJobAction,
  rejectCarvingJobAction,
  updateCarvingLocationAction,
  cancelCarvingJobAction,
  markCarvingStartedManuallyAction,
  markCarvingCompleteManuallyAction,
} from "../actions";
import { CarvingJobControls } from "./carving-job-controls";

export default async function CarvingJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  // We use select("*") rather than enumerating columns so a stale prod
  // schema (missing photo_urls / ready_to_dispatch_by / etc.) doesn't
  // make the whole query return null. Previously a single missing
  // column would silently 404 every job — now we either render with
  // whatever exists, or surface the real error message.
  const [{ data: job, error: jobErr }, { data: events }] = await Promise.all([
    admin.from("carving_items").select("*").eq("id", id).maybeSingle(),
    admin
      .from("carving_job_events")
      .select("id, event_type, message, created_at, user_id")
      .eq("carving_item_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (jobErr) {
    // Surface the real Supabase error rather than 404'ing — much easier
    // to diagnose schema drift / RLS / connection issues this way.
    throw new Error(
      `Carving job query failed: ${jobErr.message}` +
        (jobErr.code ? ` (code ${jobErr.code})` : ""),
    );
  }
  if (!job) notFound();

  // Re-type the row. select("*") gives us a generic object; cast to a
  // shape the JSX below can read. Fields that might not exist on prod
  // are marked optional so missing-column scenarios just render blank
  // instead of throwing.
  const jobRow = job as {
    id: string;
    slab_requirement_id: string;
    vendor_id: string;
    vendor_name: string;
    vendor_type: string;
    cnc_machine_id: string | null;
    note: string | null;
    status: string;
    due_at: string | null;
    assigned_by: string | null;
    assigned_at: string;
    completed_at: string | null;
    progress_phase?: string | null;
    review_approved_at?: string | null;
    review_notes?: string | null;
    photo_urls?: string[] | null;
    location?: string | null;
    ready_to_dispatch_at?: string | null;
    requires_machine_type?: string | null;
    received_at_vendor_at?: string | null;
    received_at_vendor_by?: string | null;
  };

  // .maybeSingle() — slab_requirement might have been deleted/merged.
  // Render gracefully when null instead of crashing the page.
  const [{ data: slab }, { data: machine }, { data: assignedByProfile }, { data: eventUserProfiles }, { data: transferVendors }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, source_block_id, stock_location")
      .eq("id", jobRow.slab_requirement_id)
      .maybeSingle(),
    jobRow.cnc_machine_id
      ? admin.from("cnc_machines").select("machine_code, operator_name").eq("id", jobRow.cnc_machine_id).maybeSingle()
      : Promise.resolve({ data: null }),
    jobRow.assigned_by
      ? admin.from("profiles").select("full_name").eq("id", jobRow.assigned_by).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set((events ?? []).map((e) => e.user_id).filter(Boolean) as string[])]),
    // Active CNC + Manual vendors for the transfer modal dropdown.
    admin
      .from("vendors")
      .select("id, name, vendor_type")
      .in("vendor_type", ["CNC", "Manual"])
      .eq("is_active", true)
      .order("name"),
  ]);

  const nameById = new Map<string, string>();
  for (const p of eventUserProfiles ?? []) nameById.set(p.id, p.full_name ?? "—");

  const eventsWithNames = (events ?? []).map((e) => ({
    ...e,
    user_name: e.user_id ? nameById.get(e.user_id) ?? null : null,
  }));

  const photoUrls = (jobRow.photo_urls ?? []) as string[];
  const daysUntilDeadline = jobRow.due_at ? Math.ceil((new Date(jobRow.due_at).getTime() - Date.now()) / 86400000) : null;
  const overdue = daysUntilDeadline !== null && daysUntilDeadline < 0;
  const inReview = !!jobRow.completed_at && !jobRow.review_approved_at;
  const approved = !!jobRow.review_approved_at;
  const readyToDispatch = !!jobRow.ready_to_dispatch_at;
  const dispatched = jobRow.status === "dispatched";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      <div>
        <Link href="/carving" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>
          ← Back to Carving
        </Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>
          Carving Job · <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--gold-dark)" }}>{jobRow.slab_requirement_id}</code>
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
                <span style={{ fontWeight: 600 }}>{jobRow.vendor_name} ({jobRow.vendor_type})</span>
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
                <span>{new Date(jobRow.assigned_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</span>
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
                  {jobRow.due_at
                    ? `${new Date(jobRow.due_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}${overdue ? ` (overdue by ${Math.abs(daysUntilDeadline!)}d)` : daysUntilDeadline !== null ? ` (${daysUntilDeadline}d)` : ""}`
                    : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Status</span>
                <span className="role-pill">{jobRow.status}</span>
              </div>
              {jobRow.progress_phase && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Current phase</span>
                  <span style={{ fontWeight: 600 }}>{jobRow.progress_phase}</span>
                </div>
              )}
              {jobRow.location && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Location</span>
                  <span style={{ fontWeight: 600 }}>📍 {jobRow.location}</span>
                </div>
              )}
              {/* While the slab is in transit (CNC, assigned but not
                  yet received at the vendor's shade), surface the
                  cutter-set stock_location so the team knows where
                  to fetch it from. Migration 020 set this; migration
                  023 added received_at_vendor_at. */}
              {jobRow.vendor_type === "CNC" &&
                jobRow.status === "carving_assigned" &&
                !jobRow.received_at_vendor_at &&
                (slab as { stock_location?: string | null } | null)?.stock_location && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">Currently at</span>
                    <span style={{ fontWeight: 600, color: "#7c2d12" }}>
                      📍 {(slab as { stock_location: string }).stock_location}
                    </span>
                  </div>
                )}
              {jobRow.note && (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "var(--surface-alt)", borderRadius: 6 }}>
                  <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Assignment note</div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{jobRow.note}</div>
                </div>
              )}
              {jobRow.review_notes && (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "#991b1b", fontWeight: 700 }}>Review notes</div>
                  <div style={{ fontSize: 12, marginTop: 2, color: "#991b1b" }}>{jobRow.review_notes}</div>
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

          {/* Phase 4 controls — receipt / tag / transfer.
              Hidden when the job is already completed / dispatched
              (the canShowTransfer logic gates this client-side too). */}
          {!dispatched && !approved && (
            <section className="page-card">
              <h3 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)" }}>
                Workflow
              </h3>
              <CarvingJobControls
                jobId={jobRow.id}
                currentVendorId={jobRow.vendor_id}
                currentVendorName={jobRow.vendor_name}
                vendorType={jobRow.vendor_type}
                status={jobRow.status}
                cncMachineId={jobRow.cnc_machine_id}
                requiresMachineType={jobRow.requires_machine_type ?? null}
                receivedAtVendorAt={jobRow.received_at_vendor_at ?? null}
                vendors={(transferVendors ?? []) as Array<{ id: string; name: string; vendor_type: string }>}
                canManage={["developer", "owner", "carving_head"].includes(profile.role)}
              />
              {/* Manual vendor lifecycle buttons — Mark started / complete.
                  Server-rendered (no client state). */}
              {jobRow.vendor_type === "Manual" && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {jobRow.status === "carving_assigned" && (
                    <form action={markCarvingStartedManuallyAction}>
                      <input type="hidden" name="carving_item_id" value={jobRow.id} />
                      <input type="hidden" name="redirect_to" value={`/carving/${jobRow.id}`} />
                      <button
                        type="submit"
                        className="primary-button"
                        style={{ fontSize: 13, padding: "10px 16px", fontWeight: 700, width: "100%" }}
                      >
                        ▶ Mark started manually
                      </button>
                    </form>
                  )}
                  {jobRow.status === "carving_in_progress" && !jobRow.completed_at && (
                    <form action={markCarvingCompleteManuallyAction} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input type="hidden" name="carving_item_id" value={jobRow.id} />
                      <input type="hidden" name="redirect_to" value={`/carving/${jobRow.id}`} />
                      <input
                        type="text"
                        name="temporary_location"
                        placeholder="Where will the finished piece sit? (e.g. Yard 3)"
                        style={{ fontSize: 12, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                      />
                      <button
                        type="submit"
                        className="primary-button"
                        style={{ fontSize: 13, padding: "10px 16px", fontWeight: 700, width: "100%" }}
                      >
                        🎯 Mark complete manually
                      </button>
                    </form>
                  )}
                </div>
              )}
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
                  <form action={approveCarvingJobAction} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <input type="hidden" name="job_id" value={jobRow.id} />
                    <input
                      type="text"
                      name="notes"
                      placeholder="Approval notes (optional)"
                      style={{ flex: 1, fontSize: 13, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                    />
                    <button
                      type="submit"
                      className="primary-button"
                      style={{ fontSize: 14, padding: "10px 22px", fontWeight: 700, whiteSpace: "nowrap" }}
                    >
                      ✔ Approve
                    </button>
                  </form>
                  <form action={rejectCarvingJobAction} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <input type="hidden" name="job_id" value={jobRow.id} />
                    <input
                      type="text"
                      name="notes"
                      required
                      placeholder="Rejection reason (required)"
                      style={{ flex: 1, fontSize: 13, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                    />
                    <button
                      type="submit"
                      className="ghost-button danger-ghost"
                      style={{ fontSize: 14, padding: "10px 22px", fontWeight: 700, whiteSpace: "nowrap" }}
                    >
                      ✗ Reject
                    </button>
                  </form>
                </>
              )}

              {/* Approved — auto-marked ready for dispatch. The slab
                  appears in the Dispatch Station Ready tab right away;
                  the carving head can still tweak the location text
                  here without affecting the dispatch flow. */}
              {(approved || readyToDispatch) && !dispatched && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ padding: "10px 14px", background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.2)", borderRadius: 6, fontSize: 12, color: "#15803d", fontWeight: 600 }}>
                    ✓ Approved & ready for dispatch — visible in{" "}
                    <Link href="/dispatch" style={{ color: "#15803d", textDecoration: "underline" }}>
                      Dispatch Station
                    </Link>
                    .
                  </div>
                  <form action={updateCarvingLocationAction} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="job_id" value={jobRow.id} />
                    <input
                      type="text"
                      name="location"
                      placeholder="Slab location"
                      defaultValue={jobRow.location ?? ""}
                      style={{ flex: 1, fontSize: 12, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                    />
                    <button type="submit" className="ghost-button" style={{ fontSize: 12, padding: "6px 14px" }}>
                      Update location
                    </button>
                  </form>
                </div>
              )}

              {dispatched && (
                <div style={{ padding: "10px 14px", background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.2)", borderRadius: 6, fontSize: 12, color: "#15803d", fontWeight: 600 }}>
                  ✓ This slab has been dispatched.
                </div>
              )}

              {!inReview && !approved && !dispatched && (
                <form action={cancelCarvingJobAction}>
                  <input type="hidden" name="job_id" value={jobRow.id} />
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
