import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabMiniPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const TEMPLES = ["Umia Mata", "Agroha Dham", "Balaknath", "Shrinathji", "Other"] as const;
const STONES = ["", "PinkStone", "WhiteStone"] as const;
const STATUSES = [
  "open",
  "planned",
  "cutting",
  "cut_done",
  "carving_assigned",
  "carving_in_progress",
  "completed",
  "dispatched",
  "rejected"
] as const;
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
  const totalArea = slabList.reduce((sum, slab) => sum + Number(slab.length_ft) * Number(slab.width_ft), 0);
  const priorityCount = slabList.filter((slab) => slab.priority).length;
  const templeCount = new Set(slabList.map((slab) => slab.temple)).size;
  const pinkstoneCount = slabList.filter((slab) => slab.stone === "PinkStone").length;

  return (
    <div className="records-stack">
      <section className="page-card">
        <div className="page-heading">
          <div>
            <h1>Slabs</h1>
            <p className="muted">Capture slab demand with the reduced cut-focused lifecycle and updated stone palette.</p>
          </div>
        </div>

        <div className="inventory-hero-panel">
          <div className="inventory-hero-art">
            <SlabMiniPreview accent="#C09282" stone="PinkStone" className="hero-block-art" />
            <div>
              <strong>Open Demand Snapshot</strong>
              <p className="muted">
                {priorityCount} priority slabs · {templeCount} temple groups · {pinkstoneCount} already tagged PinkStone.
              </p>
            </div>
          </div>
          <div className="inventory-mini-bars">
            <div className="inventory-mini-bar">
              <div className="inventory-mini-bar-head">
                <span>Total queue</span>
                <strong>{slabList.length}</strong>
              </div>
              <div className="bar-track">
                <div className="bar-fill inventory-fill-cool" style={{ width: "100%" }} />
              </div>
            </div>
            <div className="inventory-mini-bar">
              <div className="inventory-mini-bar-head">
                <span>Priority share</span>
                <strong>{priorityCount}</strong>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill inventory-fill-warn"
                  style={{ width: `${slabList.length ? (priorityCount / slabList.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="metrics-grid inventory-metrics-row">
        <div className="metric-card inventory-metric">
          <span>Open Slabs</span>
          <strong>{slabList.length}</strong>
        </div>
        <div className="metric-card inventory-metric">
          <span>Total Area</span>
          <strong>{totalArea.toFixed(1)}</strong>
          <small>ft2 requested</small>
        </div>
        <div className="metric-card inventory-metric">
          <span>Priority Items</span>
          <strong>{priorityCount}</strong>
        </div>
        <div className="metric-card inventory-metric">
          <span>Temple Groups</span>
          <strong>{templeCount}</strong>
        </div>
      </section>

      {canEdit ? (
        <form action={addSlabAction} className="page-card compact-create-card inventory-create-shell inventory-studio" style={{ marginTop: 18, padding: 18 }}>
          <div className="inventory-studio-main">
            <div className="section-heading">
              <div>
                <h2 style={{ margin: 0 }}>Add New Slab Requirement</h2>
                <p className="muted">Premium queue entry with automatic IDs, temple grouping, and PinkStone as the default selection.</p>
              </div>
            </div>

            <div className="inventory-row inventory-row-create">
              <label className="stack">
                <span>ID</span>
                <input defaultValue={suggestedId} name="id" placeholder={suggestedId} />
              </label>

              <label className="stack">
                <span>Label</span>
                <input defaultValue="" name="label" placeholder="Main panel" required />
              </label>

              <label className="stack">
                <span>Temple</span>
                <select defaultValue="Umia Mata" name="temple">
                  {TEMPLES.map((temple) => (
                    <option key={temple} value={temple}>
                      {temple}
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack">
                <span>Stone</span>
                <select defaultValue="PinkStone" name="stone">
                  <option value="">Auto / not fixed yet</option>
                  {STONES.filter(Boolean).map((stone) => (
                    <option key={stone} value={stone}>
                      {stone}
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack">
                <span>Priority</span>
                <select defaultValue="false" name="priority">
                  <option value="false">Normal</option>
                  <option value="true">⚡ Priority</option>
                </select>
              </label>

              <input name="status" type="hidden" value="open" />
            </div>

            <div className="inventory-row inventory-row-create" style={{ marginTop: 12 }}>
              <label className="stack">
                <span>Length ft</span>
                <input defaultValue="3" min="0" name="length_ft" step="0.1" type="number" />
              </label>

              <label className="stack">
                <span>Width ft</span>
                <input defaultValue="2" min="0" name="width_ft" step="0.1" type="number" />
              </label>

              <label className="stack">
                <span>Thickness ft</span>
                <input defaultValue="0.5" min="0" name="thickness_ft" step="0.05" type="number" />
              </label>

              <label className="stack">
                <span>Source block</span>
                <select defaultValue="" name="source_block_id">
                  <option value="">Not linked yet</option>
                  {(blocks ?? []).map((block) => (
                    <option key={block.id} value={block.id}>
                      {block.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="create-footer" style={{ marginTop: 16 }}>
              <button className="primary-button" type="submit">
                Add Slab
              </button>
            </div>
          </div>

          <aside className="inventory-studio-side">
            <div className="inventory-preview-card">
              <SlabMiniPreview accent="#C09282" stone="PinkStone" className="inventory-preview-art" />
              <strong>Queue Builder</strong>
              <p className="muted">
                Keep slab demand organized by temple, flag critical pieces with priority, and link source blocks when known.
              </p>
              <div className="inventory-preview-stats">
                <div>
                  <span className="muted">Suggested code</span>
                  <strong>{suggestedId}</strong>
                </div>
                <div>
                  <span className="muted">Default stone</span>
                  <strong>PinkStone</strong>
                </div>
              </div>
            </div>
          </aside>
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

              <div className="record-head">
                <div>
                  <div className="record-title-row">
                    <SlabMiniPreview accent={slab.stone === "PinkStone" ? "#C87A60" : "#B8B6AC"} stone={slab.stone} />
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
