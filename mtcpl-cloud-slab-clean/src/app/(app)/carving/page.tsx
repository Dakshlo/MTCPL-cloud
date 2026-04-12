import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabSizedPreview } from "@/components/stone-previews";
import { VendorPhotoUploader } from "@/components/vendor-photo-uploader";
import { requireAuth } from "@/lib/auth";
import { colorFromGroupName, daysUntil, formatNeedLabel, statusTone, textValue } from "@/lib/slab";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ACTIVE_VENDOR_STATUSES = ["assigned", "in_progress", "denied_rework", "completed_pending_approval"] as const;

async function setVendorStatusAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "vendor"]);
  const supabase = await createServerSupabaseClient();
  const slabId = textValue(formData, "slab_id");
  const nextStatus = textValue(formData, "status");

  if (!slabId || !nextStatus) {
    redirect("/carving?toast=Slab+status+details+are+missing");
  }

  const allowed =
    nextStatus === "assigned" ||
    nextStatus === "in_progress" ||
    nextStatus === "completed_pending_approval";

  if (!allowed) {
    redirect("/carving?toast=Unsupported+status+change");
  }

  let query = supabase
    .from("slabs")
    .update({
      status: nextStatus,
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId);

  if (profile.role === "vendor" && profile.vendor_id) {
    query = query.eq("assigned_vendor_id", profile.vendor_id);
  }

  const { error } = await query;
  if (error) {
    redirect(`/carving?toast=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/carving");
  revalidatePath("/approval");
  revalidatePath("/dashboard");
  redirect("/carving?toast=Vendor+status+updated");
}

async function requestApprovalAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "vendor"]);
  const supabase = await createServerSupabaseClient();
  const slabId = textValue(formData, "slab_id");

  if (!slabId) {
    redirect("/carving?toast=Slab+ID+missing");
  }

  const { count, error: countError } = await supabase
    .from("vendor_completion_photos")
    .select("*", { count: "exact", head: true })
    .eq("slab_id", slabId);

  if (countError) {
    redirect(`/carving?toast=${encodeURIComponent(countError.message)}`);
  }

  if (!count) {
    redirect("/carving?toast=Upload+at+least+one+completion+image+before+approval");
  }

  let query = supabase
    .from("slabs")
    .update({
      status: "completed_pending_approval",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId);

  if (profile.role === "vendor" && profile.vendor_id) {
    query = query.eq("assigned_vendor_id", profile.vendor_id);
  }

  const { error } = await query;
  if (error) {
    redirect(`/carving?toast=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/carving");
  revalidatePath("/approval");
  revalidatePath("/dashboard");
  redirect("/carving?toast=Approval+requested");
}

export default async function VendorWorkPage() {
  const { profile } = await requireAuth(["owner", "vendor"]);
  const supabase = await createServerSupabaseClient();

  let slabsQuery = supabase
    .from("slabs")
    .select("id, slab_code, temple_name, component, group_name, group_color, stone_type, length_decimal_ft, width_decimal_ft, thickness_decimal_ft, cubic_ft, priority, needed_by, status, assigned_vendor_id, assigned_vendor_name, outside_price, notes")
    .in("status", [...ACTIVE_VENDOR_STATUSES])
    .order("assigned_vendor_name", { ascending: true })
    .order("needed_by", { ascending: true });

  if (profile.role === "vendor" && profile.vendor_id) {
    slabsQuery = slabsQuery.eq("assigned_vendor_id", profile.vendor_id);
  }

  const [{ data: slabs, error }, { data: photos }, { data: reviews }] = await Promise.all([
    slabsQuery,
    supabase.from("vendor_completion_photos").select("id, slab_id, file_url").order("uploaded_at", { ascending: false }),
    supabase
      .from("approval_reviews")
      .select("id, slab_id, decision, review_note, reviewed_at")
      .order("reviewed_at", { ascending: false })
  ]);

  if (error) {
    throw new Error(error.message);
  }

  const photosBySlab = (photos ?? []).reduce<Record<string, { id: string; slab_id: string; file_url: string }[]>>((acc, photo) => {
    if (!acc[photo.slab_id]) acc[photo.slab_id] = [];
    acc[photo.slab_id].push(photo);
    return acc;
  }, {});

  const latestReviewBySlab = (reviews ?? []).reduce<Record<string, { decision: string; review_note: string | null; reviewed_at: string }>>((acc, review) => {
    if (!acc[review.slab_id]) {
      acc[review.slab_id] = {
        decision: review.decision,
        review_note: review.review_note,
        reviewed_at: review.reviewed_at
      };
    }
    return acc;
  }, {});

  const groupedSlabs = (slabs ?? []).reduce<Record<string, NonNullable<typeof slabs>>>((acc, slab) => {
    const key = slab.assigned_vendor_name || "Unassigned vendor";
    if (!acc[key]) acc[key] = [];
    acc[key].push(slab);
    return acc;
  }, {});

  const boardEntries =
    profile.role === "vendor"
      ? [[profile.vendor_name || "My queue", slabs ?? []] as const]
      : Object.entries(groupedSlabs);

  return (
    <>
      <section className="page-card dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-chip">Carving Operations</div>
          <h1>Vendor Work</h1>
          <p className="muted">
            Vendors only handle their own slab queue here. The office can monitor every vendor board in one place without mixing assignment and approval.
          </p>
        </div>

        <div className="dashboard-spotlight">
          <span className="muted">Current workspace</span>
          <strong>{profile.role === "vendor" ? profile.vendor_name || "Vendor" : "Office monitoring"}</strong>
          <p className="muted" style={{ margin: 0 }}>
            {profile.role === "vendor"
              ? "Only your assigned slabs are shown here."
              : "Grouped by vendor so the team can instantly see queue pressure."}
          </p>
        </div>
      </section>

      <div className="records-stack carving-board" style={{ marginTop: 16 }}>
        {boardEntries.map(([vendorName, vendorSlabs]) => {
          const inProgress = vendorSlabs.filter((slab) => slab.status === "in_progress").length;
          const waiting = vendorSlabs.filter((slab) => slab.status === "assigned" || slab.status === "denied_rework").length;
          const pendingApproval = vendorSlabs.filter((slab) => slab.status === "completed_pending_approval").length;

          return (
            <section className="page-card carving-vendor-card" key={vendorName}>
              <div className="record-head">
                <div>
                  <div className="record-title-row">
                    <h2 className="vendor-title" style={{ margin: 0 }}>{vendorName}</h2>
                    <span className="role-pill vendor-name-pill">{vendorSlabs.length} slabs</span>
                  </div>
                  <p className="muted" style={{ marginTop: 6 }}>
                    Working {inProgress} · Queue {waiting} · Pending approval {pendingApproval}
                  </p>
                </div>

                <div className="carving-summary">
                  <span className="role-pill summary-pill active-pill">In Progress {inProgress}</span>
                  <span className="role-pill summary-pill pending-pill">Queue {waiting}</span>
                  <span className="role-pill summary-pill done-pill">Approval {pendingApproval}</span>
                </div>
              </div>

              <div className="carving-items-grid" style={{ marginTop: 16 }}>
                {vendorSlabs.map((slab) => {
                  const accent = slab.group_color || colorFromGroupName(slab.group_name);
                  const slabPhotos = photosBySlab[slab.id] ?? [];
                  const review = latestReviewBySlab[slab.id];
                  const dueDays = daysUntil(slab.needed_by);
                  const tone = statusTone(slab.status);
                  const fillWidth = dueDays === null ? 100 : Math.max(8, Math.min(100, ((Math.max(dueDays, 0) + 1) / 30) * 100));

                  return (
                    <article className="carving-item-card" key={slab.id}>
                      <div className="record-head">
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <SlabSizedPreview
                            accent={accent}
                            lengthFt={Number(slab.length_decimal_ft)}
                            stone={slab.stone_type}
                            thicknessFt={Number(slab.thickness_decimal_ft)}
                            widthFt={Number(slab.width_decimal_ft)}
                          />
                          <div>
                            <div className="record-title-row">
                              <strong className="slab-card-id">{slab.slab_code}</strong>
                              <span className="role-pill vendor-name-pill">{vendorName}</span>
                            </div>
                            <p className="muted">{slab.temple_name} · {slab.component} · {slab.group_name || "No group"}</p>
                          </div>
                        </div>
                        <span className="role-pill status-pill" style={{ background: tone.bg, color: tone.text }}>
                          {slab.status.replaceAll("_", " ")}
                        </span>
                      </div>

                      <div className="inventory-chip-row">
                        <span className="role-pill">{slab.priority}</span>
                        <span className="role-pill">{Number(slab.cubic_ft).toFixed(3)} cft</span>
                        {slab.outside_price ? <span className="role-pill">Price {Number(slab.outside_price).toFixed(2)}</span> : null}
                        {formatNeedLabel(slab.needed_by) ? <span className="role-pill">{formatNeedLabel(slab.needed_by)}</span> : null}
                      </div>

                      <p className="muted" style={{ marginTop: 10 }}>
                        {Number(slab.length_decimal_ft).toFixed(2)} x {Number(slab.width_decimal_ft).toFixed(2)} x {Number(slab.thickness_decimal_ft).toFixed(2)} ft
                      </p>

                      {slab.notes ? <p className="muted">{slab.notes}</p> : null}

                      <div className="deadline-block">
                        <div className="deadline-label-row">
                          <span className="muted">Deadline health</span>
                          <strong className={`role-pill ${dueDays !== null && dueDays <= 3 ? "pending-pill" : ""}`}>
                            {formatNeedLabel(slab.needed_by) || "No date"}
                          </strong>
                        </div>
                        <div className="deadline-track">
                          <div
                            className={`deadline-fill ${
                              slab.status === "completed_pending_approval"
                                ? "deadline-done"
                                : dueDays !== null && dueDays <= 3
                                  ? "deadline-danger"
                                  : dueDays !== null && dueDays <= 7
                                    ? "deadline-warn"
                                    : "deadline-safe"
                            }`}
                            style={{ width: `${fillWidth}%` }}
                          />
                        </div>
                      </div>

                      <div className="record-actions carving-status-actions" style={{ marginTop: 12 }}>
                        <form action={setVendorStatusAction}>
                          <input name="slab_id" type="hidden" value={slab.id} />
                          <input name="status" type="hidden" value="assigned" />
                          <button className={slab.status === "assigned" || slab.status === "denied_rework" ? "status-segment status-segment-active" : "status-segment"} type="submit">
                            Working Queue
                          </button>
                        </form>

                        <form action={setVendorStatusAction}>
                          <input name="slab_id" type="hidden" value={slab.id} />
                          <input name="status" type="hidden" value="in_progress" />
                          <button className={slab.status === "in_progress" ? "status-segment status-segment-active" : "status-segment"} type="submit">
                            In Progress
                          </button>
                        </form>

                        <form action={setVendorStatusAction}>
                          <input name="slab_id" type="hidden" value={slab.id} />
                          <input name="status" type="hidden" value="completed_pending_approval" />
                          <button className={slab.status === "completed_pending_approval" ? "status-segment status-segment-active" : "status-segment"} type="submit">
                            Completed
                          </button>
                        </form>
                      </div>

                      {review?.decision === "denied" && review.review_note ? (
                        <div className="banner" style={{ marginTop: 14 }}>
                          <strong>Rework note:</strong> {review.review_note}
                        </div>
                      ) : null}

                      <div className="stack" style={{ marginTop: 14 }}>
                        <strong style={{ fontSize: 14 }}>Completion images</strong>
                        <VendorPhotoUploader slabId={slab.id} />
                        {slabPhotos.length ? (
                          <div className="inventory-chip-row">
                            {slabPhotos.map((photo) => (
                              <a className="role-pill" href={photo.file_url} key={photo.id} rel="noreferrer" target="_blank">
                                View image
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">No images uploaded yet.</span>
                        )}
                      </div>

                      <form action={requestApprovalAction} className="record-actions" style={{ marginTop: 14 }}>
                        <input name="slab_id" type="hidden" value={slab.id} />
                        <button className="primary-button" disabled={!slabPhotos.length} type="submit">
                          Ask for Approval
                        </button>
                      </form>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {!boardEntries.length || (boardEntries.length === 1 && boardEntries[0][1].length === 0) ? (
        <div className="banner" style={{ marginTop: 16 }}>
          No vendor work is active right now.
        </div>
      ) : null}
    </>
  );
}
