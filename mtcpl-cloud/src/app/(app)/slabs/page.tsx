import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabMiniPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const TEMPLES = ["Umia Mata", "Agroha Dham", "Balaknath", "Shrinathji", "Other"] as const;
const STONES = ["", "PinkStone", "WhiteStone"] as const;
const STATUSES = ["open", "planned", "cutting", "cut_done", "rejected"] as const;
const BLOCK_DELETE_CODE = process.env.BLOCK_DELETE_CODE || "1255";
const LEGACY_DELETE_CODES = ["1255", "MTCPL-DELETE"];

function nextCode(ids: string[]) {
  const max = ids.reduce((highest, id) => {
    const match = String(id || "").match(/(\d+)/);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, 200);

  return `S${String(max + 1).padStart(3, "0")}`;
}

function textValue(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function numValue(formData: FormData, key: string, fallback = 0) {
  const parsed = Number(formData.get(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function redirectWithToast(path: string, message: string) {
  redirect(`${path}?toast=${encodeURIComponent(message)}`);
}

async function addSlabAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();
  const { data: existingRows } = await supabase.from("slab_requirements").select("id");
  const existingIds = (existingRows ?? []).map((row) => row.id);
  const requestedId = textValue(formData, "id");

  const payload = {
    label: textValue(formData, "label"),
    temple: textValue(formData, "temple") || "Umia Mata",
    stone: textValue(formData, "stone") || "PinkStone",
    length_ft: numValue(formData, "length_ft", 0),
    width_ft: numValue(formData, "width_ft", 0),
    thickness_ft: numValue(formData, "thickness_ft", 0),
    source_block_id: textValue(formData, "source_block_id") || null,
    status: textValue(formData, "status") || "open",
    priority: String(formData.get("priority") || "false") === "true",
    created_by: profile.id,
    updated_by: profile.id
  };

  if (!payload.label) {
    throw new Error("Slab label is required.");
  }

  const { error } = await supabase.from("slab_requirements").insert({
    ...payload,
    id: !requestedId || existingIds.includes(requestedId) ? nextCode(existingIds) : requestedId
  });

  if (error) throw new Error(error.message);
  revalidatePath("/slabs");
  revalidatePath("/dashboard");
  redirectWithToast("/slabs", "Slab added successfully");
}

async function updateSlabAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();
  const originalId = textValue(formData, "original_id");
  const nextId = textValue(formData, "id");

  const payload = {
    id: nextId,
    label: textValue(formData, "label"),
    temple: textValue(formData, "temple") || "Umia Mata",
    stone: textValue(formData, "stone") || null,
    length_ft: numValue(formData, "length_ft", 0),
    width_ft: numValue(formData, "width_ft", 0),
    thickness_ft: numValue(formData, "thickness_ft", 0),
    source_block_id: textValue(formData, "source_block_id") || null,
    status: textValue(formData, "status") || "open",
    priority: String(formData.get("priority") || "false") === "true",
    updated_by: profile.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("slab_requirements").update(payload).eq("id", originalId);
  if (error) throw new Error(error.message);

  revalidatePath("/slabs");
  revalidatePath("/dashboard");
  redirectWithToast("/slabs", "Slab updated");
}

async function deleteSlabAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();
  const id = textValue(formData, "delete_target_id");
  const deleteCode = textValue(formData, "delete_code");

  if (![BLOCK_DELETE_CODE, ...LEGACY_DELETE_CODES].includes(deleteCode)) {
    redirectWithToast("/slabs", "Delete code is incorrect. Slab was not deleted.");
  }

  const { error } = await supabase.from("slab_requirements").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      const archive = await supabase
        .from("slab_requirements")
        .update({
          status: "rejected",
          updated_by: profile.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);
      if (archive.error) throw new Error(archive.error.message);
      revalidatePath("/slabs");
      revalidatePath("/dashboard");
      redirectWithToast("/slabs", "Slab was referenced and has been archived");
    }
    throw new Error(error.message);
  }

  revalidatePath("/slabs");
  revalidatePath("/dashboard");
  redirectWithToast("/slabs", "Slab deleted");
}

export default async function SlabsPage() {
  await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: slabs, error }, { data: blocks }, { data: allIds }] = await Promise.all([
    supabase
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, source_block_id, status, priority, created_at")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("blocks").select("id").eq("status", "available").order("id", { ascending: true }),
    supabase.from("slab_requirements").select("id")
  ]);

  if (error) throw new Error(error.message);

  const slabList = slabs ?? [];

  return (
    <div className="records-stack">
      <section className="page-card">
        <div className="page-heading">
          <div>
            <h1>Slabs</h1>
            <p className="muted">Capture slab demand with the reduced cut-focused lifecycle and updated stone palette.</p>
          </div>
        </div>

        <form action={addSlabAction} className="form-row">
          <label className="stack form-col-2">
            <span>Slab Code</span>
            <input defaultValue={nextCode((allIds ?? []).map((row) => row.id))} name="id" />
          </label>
          <label className="stack form-col-3">
            <span>Label</span>
            <input name="label" placeholder="Temple panel / riser / tread" required />
          </label>
          <label className="stack form-col-2">
            <span>Temple</span>
            <select defaultValue="Umia Mata" name="temple">
              {TEMPLES.map((temple) => <option key={temple} value={temple}>{temple}</option>)}
            </select>
          </label>
          <label className="stack form-col-2">
            <span>Stone</span>
            <select defaultValue="PinkStone" name="stone">
              {STONES.map((stone) => <option key={stone} value={stone}>{stone || "Any"}</option>)}
            </select>
          </label>
          <label className="stack form-col-1">
            <span>L ft</span>
            <input defaultValue="4" name="length_ft" step="0.01" type="number" />
          </label>
          <label className="stack form-col-1">
            <span>W ft</span>
            <input defaultValue="2" name="width_ft" step="0.01" type="number" />
          </label>
          <label className="stack form-col-1">
            <span>T ft</span>
            <input defaultValue="0.2" name="thickness_ft" step="0.01" type="number" />
          </label>
          <label className="stack form-col-2">
            <span>Source Block</span>
            <select defaultValue="" name="source_block_id">
              <option value="">Not linked</option>
              {(blocks ?? []).map((block) => <option key={block.id} value={block.id}>{block.id}</option>)}
            </select>
          </label>
          <label className="stack form-col-2">
            <span>Status</span>
            <select defaultValue="open" name="status">
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="stack form-col-2">
            <span>Priority</span>
            <select defaultValue="false" name="priority">
              <option value="false">Standard</option>
              <option value="true">Priority</option>
            </select>
          </label>
          <div className="form-col-2">
            <button className="primary-button" style={{ width: "100%" }} type="submit">
              Add Slab
            </button>
          </div>
        </form>
      </section>

      <section className="page-card">
        <div className="section-heading">
          <div>
            <h2>Demand Queue</h2>
            <p className="muted">{slabList.length} slabs tracked across open and in-process work.</p>
          </div>
        </div>

        <div className="records-stack">
          {slabList.map((slab, index) => (
            <form action={updateSlabAction} className="record-card" key={slab.id} style={{ background: index % 2 ? "var(--surface-alt)" : "var(--surface)" }}>
              <input name="original_id" type="hidden" value={slab.id} />
              <div className="record-head" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <SlabMiniPreview accent={slab.stone === "PinkStone" ? "#D4927A" : "#B8B6AC"} stone={slab.stone} />
                  <div>
                    <strong>{slab.id}</strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>{slab.label}</p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {slab.stone ? <span className="stone-badge">{slab.stone}</span> : null}
                  <span className={`status-badge status-${slab.status}`}>{slab.status}</span>
                  {slab.priority ? <span className="role-pill">Priority</span> : null}
                </div>
              </div>

              <div className="form-row">
                <label className="stack form-col-2">
                  <span>Slab Code</span>
                  <input defaultValue={slab.id} name="id" required />
                </label>
                <label className="stack form-col-3">
                  <span>Label</span>
                  <input defaultValue={slab.label} name="label" required />
                </label>
                <label className="stack form-col-2">
                  <span>Temple</span>
                  <select defaultValue={slab.temple} name="temple">
                    {TEMPLES.map((temple) => <option key={temple} value={temple}>{temple}</option>)}
                  </select>
                </label>
                <label className="stack form-col-2">
                  <span>Stone</span>
                  <select defaultValue={slab.stone ?? ""} name="stone">
                    {STONES.map((stone) => <option key={stone} value={stone}>{stone || "Any"}</option>)}
                  </select>
                </label>
                <label className="stack form-col-1">
                  <span>L ft</span>
                  <input defaultValue={String(slab.length_ft)} name="length_ft" step="0.01" type="number" />
                </label>
                <label className="stack form-col-1">
                  <span>W ft</span>
                  <input defaultValue={String(slab.width_ft)} name="width_ft" step="0.01" type="number" />
                </label>
                <label className="stack form-col-1">
                  <span>T ft</span>
                  <input defaultValue={String(slab.thickness_ft)} name="thickness_ft" step="0.01" type="number" />
                </label>
                <label className="stack form-col-2">
                  <span>Source Block</span>
                  <select defaultValue={slab.source_block_id ?? ""} name="source_block_id">
                    <option value="">Not linked</option>
                    {(blocks ?? []).map((block) => <option key={block.id} value={block.id}>{block.id}</option>)}
                  </select>
                </label>
                <label className="stack form-col-2">
                  <span>Status</span>
                  <select defaultValue={slab.status} name="status">
                    {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                <label className="stack form-col-2">
                  <span>Priority</span>
                  <select defaultValue={String(Boolean(slab.priority))} name="priority">
                    <option value="false">Standard</option>
                    <option value="true">Priority</option>
                  </select>
                </label>
                <label className="stack form-col-4">
                  <span>Delete code</span>
                  <input name="delete_code" placeholder="Enter delete code" />
                </label>
                <div className="form-col-4 record-actions">
                  <button className="btn-danger" formAction={deleteSlabAction} formNoValidate name="delete_target_id" type="submit" value={slab.id}>
                    Delete
                  </button>
                  <button className="secondary-button" type="submit">
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
