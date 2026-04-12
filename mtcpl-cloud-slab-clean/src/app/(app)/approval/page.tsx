import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabSizedPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { colorFromGroupName, daysUntil, formatNeedLabel, textValue } from "@/lib/slab";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function reviewAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "office"]);
  const supabase = await createServerSupabaseClient();
  const slabId = textValue(formData, "slab_id");
  const decision = textValue(formData, "decision");
  const reviewNote = textValue(formData, "review_note") || null;

  if (!slabId || !decision) {
    redirect("/approval?toast=Review+details+are+missing");
  }

  const nextStatus = decision === "approved" ? "approved_ready_to_ship" : "denied_rework";

  const [{ error: reviewError }, { error: slabError }] = await Promise.all([
    supabase.from("approval_reviews").insert({
      slab_id: slabId,
      decision,
      review_note: reviewNote,
      reviewed_by: profile.id
    }),
    supabase
      .from("slabs")
      .update({
        status: nextStatus,
        updated_by: profile.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", slabId)
      .eq("status", "completed_pending_approval")
  ]);

  if (reviewError || slabError) {
    redirect(`/approval?toast=${encodeURIComponent(reviewError?.message || slabError?.message || "Approval failed")}`);
  }

  revalidatePath("/approval");
  revalidatePath("/carving");
  revalidatePath("/dispatch");
  revalidatePath("/dashboard");
  redirect(`/approval?toast=${encodeURIComponent(decision === "approved" ? "Slab approved for dispatch" : "Slab returned for rework")}`);
}

export default async function ApprovalPage() {
  await requireAuth(["owner", "office"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: slabs, error }, { data: photos }] = await Promise.all([
    supabase
      .from("slabs")
      .select("id, slab_code, temple_name, component, group_name, group_color, stone_type, length_decimal_ft, width_decimal_ft, thickness_decimal_ft, cubic_ft, priority, needed_by, assigned_vendor_name, notes")
      .eq("status", "completed_pending_approval")
      .order("needed_by", { ascending: true }),
    supabase.from("vendor_completion_photos").select("id, slab_id, file_url").order("uploaded_at", { ascending: false })
  ]);

  if (error) {
    throw new Error(error.message);
  }

  const photosBySlab = (photos ?? []).reduce<Record<string, { id: string; slab_id: string; file_url: string }[]>>((acc, photo) => {
    if (!acc[photo.slab_id]) acc[photo.slab_id] = [];
    acc[photo.slab_id].push(photo);
    return acc;
  }, {});

  const urgentCount = (slabs ?? []).filter((slab) => {
    const days = daysUntil(slab.needed_by);
    return days !== null && days <= 7;
  }).length;

  return (
    <>
      <section className="page-card dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-chip">Management Review</div>
          <h1>Approval Queue</h1>
          <p className="muted">
            Review vendor completion photos, approve ready slabs for dispatch, or send them back with a clear rework note.
          </p>
        </div>

        <div className="dashboard-spotlight">
          <span className="muted">Pending approval slabs</span>
          <strong>{slabs?.length ?? 0}</strong>
          <p className="muted" style={{ margin: 0 }}>
            {urgentCount} of these are due within the next 7 days.
          </p>
        </div>
      </section>

      <div className="records-stack" style={{ marginTop: 16 }}>
        {(slabs ?? []).map((slab) => {
          const accent = slab.group_color || colorFromGroupName(slab.group_name);
          const slabPhotos = photosBySlab[slab.id] ?? [];

          return (
            <article className="record-card" key={slab.id}>
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
                      <span className="role-pill vendor-name-pill">{slab.assigned_vendor_name || "Vendor pending"}</span>
                    </div>
                    <p className="muted">{slab.temple_name} · {slab.component} · {slab.group_name || "No group"}</p>
                  </div>
                </div>
                <span className="role-pill">Pending approval</span>
              </div>

              <div className="inventory-chip-row">
                <span className="role-pill">{slab.priority}</span>
                <span className="role-pill">{Number(slab.cubic_ft).toFixed(3)} cft</span>
                {formatNeedLabel(slab.needed_by) ? <span className="role-pill">{formatNeedLabel(slab.needed_by)}</span> : null}
              </div>

              <p className="muted" style={{ marginTop: 10 }}>
                {Number(slab.length_decimal_ft).toFixed(2)} x {Number(slab.width_decimal_ft).toFixed(2)} x {Number(slab.thickness_decimal_ft).toFixed(2)} ft
              </p>
              {slab.notes ? <p className="muted">{slab.notes}</p> : null}

              <div className="approval-photo-grid" style={{ marginTop: 14 }}>
                {slabPhotos.map((photo) => (
                  <a className="approval-photo-tile" href={photo.file_url} key={photo.id} rel="noreferrer" target="_blank">
                    <img alt={`${slab.slab_code} completion`} src={photo.file_url} />
                    <span>Open image</span>
                  </a>
                ))}
              </div>

              <form action={reviewAction} className="stack" style={{ marginTop: 14 }}>
                <input name="slab_id" type="hidden" value={slab.id} />
                <label className="stack">
                  <span>Review note</span>
                  <textarea name="review_note" placeholder="Quality check, finishing note, packing issue, rework reason..." />
                </label>
                <div className="record-actions">
                  <button className="primary-button" name="decision" type="submit" value="approved">
                    Approve for Dispatch
                  </button>
                  <button className="secondary-button" name="decision" type="submit" value="denied">
                    Return to Vendor
                  </button>
                </div>
              </form>
            </article>
          );
        })}
      </div>

      {!(slabs ?? []).length ? (
        <div className="banner" style={{ marginTop: 16 }}>
          Nothing is waiting in the approval queue right now.
        </div>
      ) : null}
    </>
  );
}
