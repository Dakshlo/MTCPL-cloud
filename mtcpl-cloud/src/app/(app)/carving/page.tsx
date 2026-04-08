import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function setCarvingStatusAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "dispatch", "vendor"]);
  const supabase = await createServerSupabaseClient();
  const carvingItemId = String(formData.get("carving_item_id") || "");
  const slabId = String(formData.get("slab_id") || "");
  const status = String(formData.get("status") || "");

  const { data: carvingItem, error: itemError } = await supabase
    .from("carving_items")
    .select("id, vendor_id")
    .eq("id", carvingItemId)
    .single();

  if (itemError || !carvingItem) {
    throw new Error(itemError?.message || "Carving item not found.");
  }

  if (profile.role === "vendor" && profile.vendor_id !== carvingItem.vendor_id) {
    throw new Error("You can only update your own carving jobs.");
  }

  const completedAt = status === "completed" ? new Date().toISOString() : null;

  const { error: carvingUpdateError } = await supabase
    .from("carving_items")
    .update({
      status,
      completed_at: completedAt
    })
    .eq("id", carvingItemId);

  if (carvingUpdateError) {
    throw new Error(carvingUpdateError.message);
  }

  const slabStatus = status === "completed" ? "completed" : status === "carving_in_progress" ? "carving_in_progress" : "carving_assigned";
  const { error: slabUpdateError } = await supabase
    .from("slab_requirements")
    .update({
      status: slabStatus,
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId);

  if (slabUpdateError) {
    throw new Error(slabUpdateError.message);
  }

  revalidatePath("/carving");
  revalidatePath("/dashboard");
}

async function dispatchAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "dispatch"]);
  const supabase = await createServerSupabaseClient();

  const carvingItemId = String(formData.get("carving_item_id") || "");
  const slabId = String(formData.get("slab_id") || "");
  const note = String(formData.get("dispatch_note") || "").trim();

  const { error: logError } = await supabase.from("dispatch_logs").upsert({
    carving_item_id: carvingItemId,
    slab_requirement_id: slabId,
    dispatched_by: profile.id,
    dispatch_note: note,
    dispatched_at: new Date().toISOString()
  });

  if (logError) {
    throw new Error(logError.message);
  }

  const { error: carvingUpdateError } = await supabase
    .from("carving_items")
    .update({
      status: "dispatched"
    })
    .eq("id", carvingItemId);

  if (carvingUpdateError) {
    throw new Error(carvingUpdateError.message);
  }

  const { error: slabUpdateError } = await supabase
    .from("slab_requirements")
    .update({
      status: "dispatched",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId);

  if (slabUpdateError) {
    throw new Error(slabUpdateError.message);
  }

  revalidatePath("/carving");
  revalidatePath("/dashboard");
}

export default async function CarvingPage() {
  const { profile } = await requireAuth(["owner", "dispatch", "vendor"]);
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("carving_items")
    .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, note, assigned_at, completed_at")
    .order("assigned_at", { ascending: false });

  if (profile.role === "vendor" && profile.vendor_id) {
    query = query.eq("vendor_id", profile.vendor_id);
  }

  const { data: carvingItems } = await query.limit(100);

  const groups = new Map<string, typeof carvingItems>();
  (carvingItems ?? []).forEach((item) => {
    const key = item.vendor_name;
    const current = groups.get(key) || [];
    current.push(item);
    groups.set(key, current);
  });

  return (
    <section className="page-card">
      <h1>Carving</h1>
      <p className="muted">
        Vendors update their own work here. Dispatch and owner can review completed items and mark them dispatched.
      </p>

      {profile.role === "vendor" && !profile.vendor_id ? (
        <div className="banner" style={{ marginTop: 16 }}>
          This vendor account is not linked to a vendor record yet. Please update <code>profiles.vendor_id</code> in Supabase.
        </div>
      ) : null}

      <div className="records-stack carving-board" style={{ marginTop: 18 }}>
        {Array.from(groups.entries()).map(([vendorName, items]) => (
          <article className="record-card carving-vendor-card" key={vendorName}>
            <div className="record-head">
              <div>
                <strong className="vendor-title">{vendorName}</strong>
                <p className="muted">
                  {items?.[0]?.vendor_type || "-"} | {items?.length || 0} slabs
                </p>
              </div>
              <div className="carving-summary">
                <span className="role-pill summary-pill done-pill">
                  Done: {(items ?? []).filter((item) => item.status === "completed").length}
                </span>
                <span className="role-pill summary-pill active-pill">
                  Active: {(items ?? []).filter((item) => item.status === "carving_in_progress").length}
                </span>
                <span className="role-pill summary-pill pending-pill">
                  Pending: {(items ?? []).filter((item) => item.status === "carving_assigned").length}
                </span>
              </div>
            </div>

            <div className="carving-items-grid">
              {(items ?? []).map((item) => (
                <div className="plan-card carving-item-card" key={item.id}>
                  <div className="record-head">
                    <div>
                      <strong className="slab-card-id">{item.slab_requirement_id}</strong>
                      <p className="muted">
                        Assigned {new Date(item.assigned_at).toLocaleString()}
                        {item.note ? ` | ${item.note}` : ""}
                      </p>
                    </div>
                    <span className="role-pill status-pill">{item.status.replaceAll("_", " ")}</span>
                  </div>

                  <div className="record-actions carving-status-actions">
                    {item.status !== "dispatched" ? (
                      <>
                        <form action={setCarvingStatusAction}>
                          <input name="carving_item_id" type="hidden" value={item.id} />
                          <input name="slab_id" type="hidden" value={item.slab_requirement_id} />
                          <input name="status" type="hidden" value="carving_assigned" />
                          <button className="ghost-button status-button" type="submit">
                            Not Started
                          </button>
                        </form>

                        <form action={setCarvingStatusAction}>
                          <input name="carving_item_id" type="hidden" value={item.id} />
                          <input name="slab_id" type="hidden" value={item.slab_requirement_id} />
                          <input name="status" type="hidden" value="carving_in_progress" />
                          <button className="secondary-button status-button" type="submit">
                            In Progress
                          </button>
                        </form>

                        <form action={setCarvingStatusAction}>
                          <input name="carving_item_id" type="hidden" value={item.id} />
                          <input name="slab_id" type="hidden" value={item.slab_requirement_id} />
                          <input name="status" type="hidden" value="completed" />
                          <button className="primary-button status-button" type="submit">
                            Completed
                          </button>
                        </form>
                      </>
                    ) : null}
                  </div>

                  {item.status === "completed" && (profile.role === "owner" || profile.role === "dispatch") ? (
                    <form action={dispatchAction} className="form-grid compact-grid dispatch-form" style={{ marginTop: 14 }}>
                      <input name="carving_item_id" type="hidden" value={item.id} />
                      <input name="slab_id" type="hidden" value={item.slab_requirement_id} />

                      <label className="stack" style={{ gridColumn: "span 2" }}>
                        <span>Dispatch note</span>
                        <textarea defaultValue="" name="dispatch_note" placeholder="Vehicle, date, remarks" />
                      </label>

                      <div className="record-actions" style={{ alignItems: "end" }}>
                        <button className="primary-button" type="submit">
                          Dispatch
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {item.status === "dispatched" ? (
                    <p className="muted" style={{ marginTop: 12 }}>
                      Dispatched successfully.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      {!(carvingItems ?? []).length ? (
        <div className="banner" style={{ marginTop: 18 }}>
          No carving work is currently assigned.
        </div>
      ) : null}
    </section>
  );
}
