import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabSizedPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { SLAB_STATUS_LABELS, SLAB_STATUS_ORDER, colorFromGroupName, daysUntil, formatNeedLabel } from "@/lib/slab";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SlabStatus } from "@/lib/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function moveToReadyAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "office"]);
  const supabase = await createServerSupabaseClient();
  const slabId = String(formData.get("slab_id") || "");

  if (!slabId) {
    redirect("/slab-viewer?toast=Slab+ID+missing");
  }

  const { error } = await supabase
    .from("slabs")
    .update({
      status: "ready_for_assignment",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId)
    .eq("status", "entered");

  if (error) {
    redirect(`/slab-viewer?toast=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/slab-viewer");
  revalidatePath("/carving-assign");
  revalidatePath("/dashboard");
  redirect("/slab-viewer?toast=Slab+marked+ready+for+assignment");
}

export default async function SlabViewerPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAuth(["owner", "office", "assigner", "dispatch"]);
  const params = await searchParams;
  const templeId = firstValue(params.temple_id) || "";
  const status = firstValue(params.status) || "";
  const group = firstValue(params.group_name) || "";
  const priority = firstValue(params.priority) || "";

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("slabs")
    .select("id, slab_code, temple_id, temple_name, component, group_name, group_color, stone_type, length_decimal_ft, width_decimal_ft, thickness_decimal_ft, cubic_ft, priority, needed_by, status, assigned_vendor_name")
    .order("temple_name")
    .order("created_at", { ascending: false });

  if (templeId) query = query.eq("temple_id", templeId);
  if (status) query = query.eq("status", status);
  if (group) query = query.ilike("group_name", `%${group}%`);
  if (priority) query = query.eq("priority", priority);

  const [{ data: slabs, error }, { data: temples }] = await Promise.all([
    query,
    supabase.from("temples").select("id, name").eq("is_active", true).order("display_order")
  ]);

  if (error) throw new Error(error.message);

  const grouped = (slabs ?? []).reduce<Record<string, NonNullable<typeof slabs>>>((acc, slab) => {
    const key = slab.temple_name || "Unknown Temple";
    if (!acc[key]) acc[key] = [];
    acc[key].push(slab);
    return acc;
  }, {});

  return (
    <>
      <section className="page-card dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-chip">Operations Viewer</div>
          <h1>Slab Viewer</h1>
          <p className="muted">This is the working overview. Entered slabs stay visually strong here until the office marks them ready for assignment.</p>
        </div>

        <form className="dashboard-export-form" method="get">
          <label className="stack">
            <span>Temple</span>
            <select defaultValue={templeId} name="temple_id">
              <option value="">All temples</option>
              {(temples ?? []).map((temple) => (
                <option key={temple.id} value={temple.id}>
                  {temple.name}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span>Status</span>
            <select defaultValue={status} name="status">
              <option value="">All statuses</option>
              {SLAB_STATUS_ORDER.map((item) => (
                <option key={item} value={item}>
                  {SLAB_STATUS_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span>Priority</span>
            <select defaultValue={priority} name="priority">
              <option value="">All priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </label>
          <label className="stack">
            <span>Group</span>
            <input defaultValue={group} name="group_name" placeholder="Layer A / border set" />
          </label>
          <div className="record-actions" style={{ alignItems: "end" }}>
            <button className="primary-button" type="submit">Filter View</button>
          </div>
        </form>
      </section>

      <section className="records-stack" style={{ marginTop: 16 }}>
        {Object.entries(grouped).map(([templeName, items]) => (
          <section className="page-card dashboard-panel" key={templeName}>
            <div className="section-heading">
              <h2 style={{ margin: 0 }}>{templeName}</h2>
              <p className="muted">{items.length} slabs visible in this temple stream.</p>
            </div>

            <div className="slab-card-grid" style={{ marginTop: 16 }}>
              {items
                .slice()
                .sort((a, b) => {
                  const stageDiff = SLAB_STATUS_ORDER.indexOf(a.status as SlabStatus) - SLAB_STATUS_ORDER.indexOf(b.status as SlabStatus);
                  if (stageDiff !== 0) return stageDiff;
                  const priorityOrder = ["Critical", "High", "Medium", "Low"];
                  return priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
                })
                .map((slab) => {
                  const accent = slab.group_color || colorFromGroupName(slab.group_name);
                  const dueDays = daysUntil(slab.needed_by);
                  const isEntered = slab.status === "entered";

                  return (
                    <article
                      className={`record-card slab-view-card ${isEntered ? "slab-view-card-entered" : "slab-view-card-muted"}`}
                      key={slab.id}
                      style={{ borderTop: `4px solid ${isEntered ? accent : "rgba(95, 70, 40, 0.16)"}` }}
                    >
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
                            <strong>{slab.slab_code}</strong>
                            <p className="muted">{slab.component}</p>
                          </div>
                        </div>
                        <span className="role-pill">{slab.priority}</span>
                      </div>

                      <div className="inventory-chip-row">
                        <span className="role-pill">{slab.group_name || "No group"}</span>
                        <span className="role-pill">{SLAB_STATUS_LABELS[slab.status as SlabStatus]}</span>
                        <span className="role-pill">{slab.stone_type}</span>
                        {slab.assigned_vendor_name ? <span className="role-pill">Vendor {slab.assigned_vendor_name}</span> : null}
                      </div>

                      <p className="muted" style={{ marginTop: 10 }}>
                        {Number(slab.length_decimal_ft).toFixed(2)} x {Number(slab.width_decimal_ft).toFixed(2)} x {Number(slab.thickness_decimal_ft).toFixed(2)} ft · {Number(slab.cubic_ft).toFixed(3)} cft
                      </p>

                      {slab.needed_by ? (
                        <div className="deadline-strip" style={{ marginTop: 10 }}>
                          <div
                            className="deadline-strip-fill"
                            style={{
                              width: "100%",
                              background:
                                dueDays !== null && dueDays <= 2 ? "#bd5b52" : dueDays !== null && dueDays <= 7 ? "#d3a74b" : "#5d8e68"
                            }}
                          />
                          <span className="muted">{formatNeedLabel(slab.needed_by)}</span>
                        </div>
                      ) : null}

                      {slab.status === "entered" ? (
                        <form action={moveToReadyAction} className="record-actions" style={{ marginTop: 14 }}>
                          <input name="slab_id" type="hidden" value={slab.id} />
                          <button className="secondary-button" type="submit">Mark Ready for Assignment</button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </section>
    </>
  );
}
