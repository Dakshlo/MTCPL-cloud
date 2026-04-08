import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function assignVendorAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "carving_assigner"]);
  const supabase = await createServerSupabaseClient();

  const slabId = String(formData.get("slab_id") || "");
  const vendorId = String(formData.get("vendor_id") || "");
  const note = String(formData.get("note") || "").trim();
  const deadlineDays = Number(formData.get("deadline_days") || 10);

  if (!slabId || !vendorId) {
    throw new Error("Slab and vendor are required.");
  }

  const safeDeadlineDays = Number.isFinite(deadlineDays) ? Math.min(60, Math.max(1, Math.round(deadlineDays))) : 10;
  const dueAt = new Date(Date.now() + safeDeadlineDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("id, name, vendor_type")
    .eq("id", vendorId)
    .single();

  if (vendorError || !vendor) {
    throw new Error(vendorError?.message || "Vendor not found.");
  }

  const { data: slab, error: slabReadError } = await supabase
    .from("slab_requirements")
    .select("id, status")
    .eq("id", slabId)
    .single();

  if (slabReadError || !slab) {
    throw new Error(slabReadError?.message || "Slab not found.");
  }

  if (slab.status !== "cut_done" && slab.status !== "carving_assigned") {
    throw new Error(`Slab ${slabId} is no longer ready for carving assignment. Refresh and try again.`);
  }

  const { error: carvingInsertError } = await supabase.from("carving_items").upsert(
    {
      slab_requirement_id: slabId,
      vendor_id: vendor.id,
      vendor_name: vendor.name,
      vendor_type: vendor.vendor_type,
      note,
      status: "carving_assigned",
      deadline_days: safeDeadlineDays,
      due_at: dueAt,
      assigned_by: profile.id,
      assigned_at: new Date().toISOString(),
      completed_at: null
    },
    { onConflict: "slab_requirement_id" }
  );

  if (carvingInsertError) {
    throw new Error(carvingInsertError.message);
  }

  const { error: slabUpdateError } = await supabase
    .from("slab_requirements")
    .update({
      status: "carving_assigned",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId);

  if (slabUpdateError) {
    throw new Error(slabUpdateError.message);
  }

  revalidatePath("/carving-assign");
  revalidatePath("/carving");
  revalidatePath("/dashboard");
  redirect("/carving-assign?toast=Assigned+to+carving+successfully");
}

export default async function CarvingAssignPage() {
  await requireAuth(["owner", "carving_assigner"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: queue }, { data: vendors }] = await Promise.all([
    supabase
      .from("slab_requirements")
      .select("id, label, temple, stone, status, source_block_id")
      .eq("status", "cut_done")
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase.from("vendors").select("id, name, vendor_type").eq("is_active", true).order("name", { ascending: true })
  ]);

  return (
    <section className="page-card">
      <h1>Carving Assign</h1>
      <p className="muted">Assign cut slabs to in-house or outside vendors and move them into the carving board.</p>

      <div className="records-stack" style={{ marginTop: 18 }}>
        {(queue ?? []).map((item) => (
          <form action={assignVendorAction} className="record-card" key={item.id}>
            <input name="slab_id" type="hidden" value={item.id} />

            <div className="record-head">
              <div>
                <strong>{item.id}</strong>
                <p className="muted">
                  {item.label} | {item.temple} | {item.stone || "Stone not fixed"} | From {item.source_block_id || "-"}
                </p>
              </div>
              <span className="role-pill">{item.status}</span>
            </div>

            <div className="form-grid compact-grid">
              <label className="stack">
                <span>Vendor</span>
                <select defaultValue="" name="vendor_id" required>
                  <option value="">Select vendor</option>
                  {(vendors ?? []).map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name} ({vendor.vendor_type})
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack">
                <span>Deadline</span>
                <select defaultValue="10" name="deadline_days">
                  <option value="3">3 days</option>
                  <option value="5">5 days</option>
                  <option value="7">7 days</option>
                  <option value="10">10 days</option>
                  <option value="14">14 days</option>
                  <option value="21">21 days</option>
                </select>
              </label>

              <label className="stack" style={{ gridColumn: "span 2" }}>
                <span>Notes / file reference</span>
                <textarea defaultValue="" name="note" placeholder="Design notes, file links, carving instructions" />
              </label>
            </div>

            <div className="record-actions" style={{ marginTop: 14 }}>
              <button className="primary-button" type="submit">
                Confirm and Send to Carving
              </button>
            </div>
          </form>
        ))}
      </div>

      {!(queue ?? []).length ? (
        <div className="banner" style={{ marginTop: 18 }}>
          No slabs are waiting for carving assignment right now.
        </div>
      ) : null}
    </section>
  );
}
