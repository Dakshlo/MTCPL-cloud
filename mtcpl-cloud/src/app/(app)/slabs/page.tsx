import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { SlabMiniPreview } from "@/components/stone-previews";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const TEMPLES = ["Umia Mata", "Agroha Dham", "Balaknath", "Shrinathji", "Other"] as const;
const STONES = ["", "Makrana", "Pinkstone"] as const;
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

function nextCode(ids: string[], prefix: string, start: number) {
  const max = ids.reduce((highest, id) => {
    const match = String(id || "").match(/(\d+)/);
    if (!match) return highest;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, start);

  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function numValue(formData: FormData, key: string, fallback = 0) {
  const raw = formData.get(key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
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
    stone: textValue(formData, "stone") || "Pinkstone",
    length_ft: numValue(formData, "length_ft", 0),
    width_ft: numValue(formData, "width_ft", 0),
    thickness_ft: numValue(formData, "thickness_ft", 0),
    source_block_id: textValue(formData, "source_block_id") || null,
    status: textValue(formData, "status") || "open",
    priority: formData.get("priority") === "true",
    created_by: profile.id,
    updated_by: profile.id
  };

  if (!payload.label) {
    throw new Error("Slab ID and label are required.");
  }

  let attempt = 0;
  let nextId = requestedId;
  let lastError: string | null = null;

  while (attempt < 5) {
    if (!nextId || existingIds.includes(nextId)) {
      nextId = nextCode(existingIds, "S", 200);
    }

    const { error } = await supabase.from("slab_requirements").insert({
      ...payload,
      id: nextId
    });

    if (!error) {
      revalidatePath("/slabs");
      revalidatePath("/dashboard");
      redirect("/slabs?toast=Slab+added+successfully");
    }

    lastError = error.message;
    if (error.code !== "23505") {
      throw new Error(error.message);
    }

    existingIds.push(nextId);
    nextId = "";
    attempt += 1;
  }

  throw new Error(lastError || "Unable to generate a unique slab ID. Please try again.");
}

async function updateSlabAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();

  const originalId = textValue(formData, "original_id");
  const nextId = textValue(formData, "id");

  if (!originalId || !nextId) {
    throw new Error("Slab ID is required.");
  }

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
    priority: formData.get("priority") === "true",
    updated_by: profile.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("slab_requirements").update(payload).eq("id", originalId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/slabs");
  revalidatePath("/dashboard");
  redirect("/slabs?toast=Slab+updated");
}

async function deleteSlabAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();
  const id = textValue(formData, "delete_target_id") || textValue(formData, "id");
  const deleteCode = textValue(formData, "delete_code");

  if (!id) {
    redirectWithToast("/slabs", "Slab ID is missing");
  }

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

      if (archive.error) {
        redirectWithToast("/slabs", archive.error.message);
      }

      revalidatePath("/slabs");
      revalidatePath("/dashboard");
      redirectWithToast("/slabs", "Slab was referenced and has been archived");
    }

    redirectWithToast("/slabs", error.message);
  }

  revalidatePath("/slabs");
  revalidatePath("/dashboard");
  redirectWithToast("/slabs", "Slab deleted");
}

export default async function SlabsPage() {
  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: slabs, error }, { data: blocks }, { data: allIds }] = await Promise.all([
    supabase
      .from("slab_requirements")
      .select(
        "id, label, temple, stone, length_ft, width_ft, thickness_ft, source_block_id, status, priority, created_at"
      )
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("temple", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("blocks").select("id").eq("status", "available").order("id", { ascending: true }),
    supabase.from("slab_requirements").select("id")
  ]);

  if (error) {
    throw new Error(error.message);
  }

  const canEdit = ["owner", "planner", "slab_entry"].includes(profile.role);
  const suggestedId = nextCode(
    (allIds ?? []).map((row) => row.id),
    "S",
    200
  );
  const slabList = slabs ?? [];
  const totalArea = slabList.reduce((sum, slab) => sum + Number(slab.length_ft) * Number(slab.width_ft), 0);
  const priorityCount = slabList.filter((slab) => slab.priority).length;
  const templeCount = new Set(slabList.map((slab) => slab.temple)).size;
  const pinkstoneCount = slabList.filter((slab) => slab.stone === "Pinkstone").length;

  return (
    <>
      <section className="page-card inventory-hero inventory-hero-slabs">
        <div className="inventory-hero-copy">
          <div className="dashboard-chip">Demand Pipeline</div>
          <h1>Slab Requirements</h1>
          <p className="muted">
            Capture upcoming temple demand with more clarity around labels, priorities, source blocks, and stone preference.
          </p>
          <div className="inventory-chip-row">
            <span className="role-pill">Editable by owner, planner, slab entry</span>
            <span className="role-pill">Priority aware</span>
            <span className="role-pill">Temple grouped</span>
          </div>
        </div>

        <div className="inventory-hero-panel">
          <div className="inventory-hero-art">
            <SlabMiniPreview accent="#C09282" stone="Pinkstone" className="hero-block-art" />
            <div>
              <strong>Open Demand Snapshot</strong>
              <p className="muted">
                {priorityCount} priority slabs · {templeCount} temple groups · {pinkstoneCount} already tagged Pinkstone.
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
                <p className="muted">Premium queue entry with automatic IDs, temple grouping, and Pinkstone as the default selection.</p>
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
                <select defaultValue="Pinkstone" name="stone">
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
              <SlabMiniPreview accent="#C09282" stone="Pinkstone" className="inventory-preview-art" />
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
                  <strong>Pinkstone</strong>
                </div>
              </div>
            </div>
          </aside>
        </form>
      ) : null}

      <div className="section-heading inventory-list-header" style={{ marginTop: 22 }}>
        <div>
          <h2 style={{ margin: 0 }}>Current Slab Queue</h2>
          <p className="muted">
            {slabs?.length ?? 0} open slab requirements. Planned and processed slabs are hidden from this entry screen.
          </p>
        </div>
      </div>

      {(() => {
        const allSlabs = slabs ?? [];
        const prioritySlabs = allSlabs.filter((s) => s.priority);
        const normalSlabs = allSlabs.filter((s) => !s.priority);

        const normalByTemple = normalSlabs.reduce<Record<string, typeof normalSlabs>>((acc, slab) => {
          if (!acc[slab.temple]) acc[slab.temple] = [];
          acc[slab.temple].push(slab);
          return acc;
        }, {});
        const templeKeys = Object.keys(normalByTemple).sort();

        function renderSlabForm(slab: typeof allSlabs[number]) {
          return (
            <form action={updateSlabAction} className={`record-card compact-record inventory-card slab-card${slab.priority ? " slab-priority-card" : ""}`} key={slab.id}>
              <input name="original_id" type="hidden" value={slab.id} />

              <div className="record-head">
                <div>
                  <div className="record-title-row">
                    <SlabMiniPreview accent={slab.stone === "Pinkstone" ? "#C09282" : "#C8BFB0"} stone={slab.stone} />
                    <strong>{slab.id}</strong>
                    {slab.priority ? <span className="priority-badge">⚡ Priority</span> : null}
                    <span className="role-pill">{slab.temple}</span>
                    {slab.stone ? <span className="role-pill">{slab.stone}</span> : null}
                  </div>
                  <p className="muted">
                    {slab.label} | {slab.length_ft} x {slab.width_ft} x {slab.thickness_ft} ft
                  </p>
                </div>
                <div className="record-actions compact-actions">
                  <button className="secondary-button" type="submit">
                    Update
                  </button>
                  <button className="ghost-button" formAction={deleteSlabAction} formNoValidate name="delete_target_id" type="submit" value={slab.id}>
                    Delete
                  </button>
                </div>
              </div>

              <div className="inventory-row">
                <label className="stack">
                  <span>ID</span>
                  <input defaultValue={slab.id} name="id" required />
                </label>

                <label className="stack">
                  <span>Label</span>
                  <input defaultValue={slab.label} name="label" required />
                </label>

                <label className="stack">
                  <span>Temple</span>
                  <select defaultValue={slab.temple} name="temple">
                    {TEMPLES.map((temple) => (
                      <option key={temple} value={temple}>
                        {temple}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="stack">
                  <span>Stone</span>
                  <select defaultValue={slab.stone ?? ""} name="stone">
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
                  <select defaultValue={String(slab.priority ?? false)} name="priority">
                    <option value="false">Normal</option>
                    <option value="true">⚡ Priority</option>
                  </select>
                </label>

                <label className="stack">
                  <span>Status</span>
                  <select defaultValue={slab.status} name="status">
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="stack">
                  <span>Delete code</span>
                  <input name="delete_code" placeholder="Enter code to delete" />
                </label>

                <label className="stack">
                  <span>Length</span>
                  <input defaultValue={String(slab.length_ft)} min="0" name="length_ft" step="0.01" type="number" />
                </label>

                <label className="stack">
                  <span>Width</span>
                  <input defaultValue={String(slab.width_ft)} min="0" name="width_ft" step="0.01" type="number" />
                </label>

                <label className="stack">
                  <span>Thickness</span>
                  <input
                    defaultValue={String(slab.thickness_ft)}
                    min="0"
                    name="thickness_ft"
                    step="0.01"
                    type="number"
                  />
                </label>

                <label className="stack">
                  <span>Source block</span>
                  <select defaultValue={slab.source_block_id ?? ""} name="source_block_id">
                    <option value="">Not linked yet</option>
                    {(blocks ?? []).map((block) => (
                      <option key={block.id} value={block.id}>
                        {block.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </form>
          );
        }

        return (
          <div className="records-stack">
            {prioritySlabs.length > 0 ? (
              <>
                <div className="temple-group-header inventory-cluster-header">
                  <span>⚡ Priority</span>
                  <strong>{prioritySlabs.length} items</strong>
                </div>
                {prioritySlabs.map(renderSlabForm)}
              </>
            ) : null}
            {templeKeys.map((temple) => (
              <div className="inventory-cluster" key={temple}>
                <div className="temple-group-header inventory-cluster-header">
                  <span>{temple}</span>
                  <strong>{normalByTemple[temple].length} slabs</strong>
                </div>
                {normalByTemple[temple].map(renderSlabForm)}
              </div>
            ))}
          </div>
        );
      })()}

      {!slabs?.length ? (
        <div className="banner" style={{ marginTop: 16 }}>
          No slab requirements found yet. Add your first slab requirement above.
        </div>
      ) : null}
    </>
  );
}
