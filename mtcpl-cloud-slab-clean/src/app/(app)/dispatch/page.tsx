import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabSizedPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { colorFromGroupName, daysUntil, formatNeedLabel, textValue } from "@/lib/slab";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function dispatchSlabAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "dispatch"]);
  const supabase = await createServerSupabaseClient();
  const slabId = textValue(formData, "slab_id");
  const truckNo = textValue(formData, "truck_no") || null;
  const siteName = textValue(formData, "site_name") || null;
  const dispatchNote = textValue(formData, "dispatch_note") || null;

  if (!slabId) {
    redirect("/dispatch?toast=Slab+ID+missing");
  }

  const { error: recordError } = await supabase.from("dispatch_records").upsert(
    {
      slab_id: slabId,
      truck_no: truckNo,
      site_name: siteName,
      dispatch_note: dispatchNote,
      dispatched_by: profile.id,
      loaded_at: new Date().toISOString()
    },
    { onConflict: "slab_id" }
  );

  if (recordError) {
    redirect(`/dispatch?toast=${encodeURIComponent(recordError.message)}`);
  }

  const { error: slabError } = await supabase
    .from("slabs")
    .update({
      status: "dispatched",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId)
    .eq("status", "approved_ready_to_ship");

  if (slabError) {
    redirect(`/dispatch?toast=${encodeURIComponent(slabError.message)}`);
  }

  revalidatePath("/dispatch");
  revalidatePath("/slab-viewer");
  revalidatePath("/dashboard");
  redirect("/dispatch?toast=Slab+marked+dispatched");
}

export default async function DispatchPage() {
  await requireAuth(["owner", "dispatch"]);
  const supabase = await createServerSupabaseClient();
  const { data: slabs, error } = await supabase
    .from("slabs")
    .select("id, slab_code, temple_name, component, group_name, group_color, stone_type, length_decimal_ft, width_decimal_ft, thickness_decimal_ft, cubic_ft, priority, needed_by, assigned_vendor_name")
    .eq("status", "approved_ready_to_ship")
    .order("needed_by", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const urgentCount = (slabs ?? []).filter((slab) => {
    const days = daysUntil(slab.needed_by);
    return days !== null && days <= 5;
  }).length;

  return (
    <>
      <section className="page-card dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-chip">Dispatch Desk</div>
          <h1>Dispatch Station</h1>
          <p className="muted">
            This board only shows approved slabs. Add truck details, loading notes, and move the slab out of the ready-to-ship queue.
          </p>
        </div>

        <div className="dashboard-spotlight">
          <span className="muted">Ready to ship</span>
          <strong>{slabs?.length ?? 0}</strong>
          <p className="muted" style={{ margin: 0 }}>
            {urgentCount} slabs here need dispatch within the next 5 days.
          </p>
        </div>
      </section>

      <div className="records-stack" style={{ marginTop: 16 }}>
        {(slabs ?? []).map((slab) => (
          <form action={dispatchSlabAction} className="record-card" key={slab.id}>
            <input name="slab_id" type="hidden" value={slab.id} />

            <div className="record-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <SlabSizedPreview
                  accent={slab.group_color || colorFromGroupName(slab.group_name)}
                  lengthFt={Number(slab.length_decimal_ft)}
                  stone={slab.stone_type}
                  thicknessFt={Number(slab.thickness_decimal_ft)}
                  widthFt={Number(slab.width_decimal_ft)}
                />
                <div>
                  <div className="record-title-row">
                    <strong className="slab-card-id">{slab.slab_code}</strong>
                    {slab.assigned_vendor_name ? <span className="role-pill vendor-name-pill">{slab.assigned_vendor_name}</span> : null}
                  </div>
                  <p className="muted">{slab.temple_name} · {slab.component} · {slab.group_name || "No group"}</p>
                </div>
              </div>
              <span className="role-pill">{slab.priority}</span>
            </div>

            <div className="inventory-chip-row">
              <span className="role-pill">{Number(slab.cubic_ft).toFixed(3)} cft</span>
              {formatNeedLabel(slab.needed_by) ? <span className="role-pill">{formatNeedLabel(slab.needed_by)}</span> : null}
            </div>

            <p className="muted" style={{ marginTop: 10 }}>
              {Number(slab.length_decimal_ft).toFixed(2)} x {Number(slab.width_decimal_ft).toFixed(2)} x {Number(slab.thickness_decimal_ft).toFixed(2)} ft
            </p>

            <div className="slab-entry-grid slab-entry-grid-three" style={{ marginTop: 14 }}>
              <label className="stack">
                <span>Truck number</span>
                <input name="truck_no" placeholder="RJ14 XX 1234" />
              </label>

              <label className="stack">
                <span>Site / destination</span>
                <input name="site_name" placeholder={slab.temple_name} />
              </label>

              <label className="stack">
                <span>Dispatch note</span>
                <input name="dispatch_note" placeholder="Route, challan, loading remark..." />
              </label>
            </div>

            <div className="record-actions" style={{ marginTop: 14 }}>
              <button className="primary-button" type="submit">
                Mark Dispatched
              </button>
            </div>
          </form>
        ))}
      </div>

      {!(slabs ?? []).length ? (
        <div className="banner" style={{ marginTop: 16 }}>
          No approved slabs are waiting for dispatch right now.
        </div>
      ) : null}
    </>
  );
}
