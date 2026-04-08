import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ExportBlocksButton } from "@/components/export-button";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const STONES = ["Makrana", "Pinkstone"] as const;
const CATEGORIES = ["Fresh", "Reused"] as const;
const STATUSES = ["available", "reserved", "consumed", "discarded"] as const;
const YARDS = [1, 2, 3] as const;
const BLOCK_DELETE_CODE = process.env.BLOCK_DELETE_CODE || "MTCPL-DELETE";

function nextCode(ids: string[], prefix: string, start: number) {
  const max = ids.reduce((highest, id) => {
    const match = String(id || "").match(/(\d+)/);
    if (!match) return highest;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, start);

  return `${prefix}${String(max + 1).padStart(4, "0")}`;
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

async function addBlockAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();
  const { data: existingRows } = await supabase.from("blocks").select("id");
  const existingIds = (existingRows ?? []).map((row) => row.id);
  let nextId = textValue(formData, "id");
  if (!nextId || existingIds.includes(nextId)) {
    nextId = nextCode(existingIds, "BLK-", 1000);
  }

  const payload = {
    id: nextId,
    stone: textValue(formData, "stone") || "Makrana",
    yard: numValue(formData, "yard", 1),
    category: textValue(formData, "category") || "Fresh",
    length_ft: numValue(formData, "length_ft", 0),
    width_ft: numValue(formData, "width_ft", 0),
    height_ft: numValue(formData, "height_ft", 0),
    trim_left_ft: numValue(formData, "trim_left_ft", 0),
    trim_right_ft: numValue(formData, "trim_right_ft", 0),
    trim_near_ft: numValue(formData, "trim_near_ft", 0),
    trim_far_ft: numValue(formData, "trim_far_ft", 0),
    status: textValue(formData, "status") || "available",
    created_by: profile.id,
    updated_by: profile.id
  };

  if (!payload.id) {
    throw new Error("Block ID is required.");
  }

  const { error } = await supabase.from("blocks").insert(payload);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirect("/blocks?toast=Block+added+successfully");
}

async function updateBlockAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();

  const originalId = textValue(formData, "original_id");
  const nextId = textValue(formData, "id");

  if (!originalId || !nextId) {
    throw new Error("Block ID is required.");
  }

  const payload = {
    id: nextId,
    stone: textValue(formData, "stone") || "Makrana",
    yard: numValue(formData, "yard", 1),
    category: textValue(formData, "category") || "Fresh",
    length_ft: numValue(formData, "length_ft", 0),
    width_ft: numValue(formData, "width_ft", 0),
    height_ft: numValue(formData, "height_ft", 0),
    trim_left_ft: numValue(formData, "trim_left_ft", 0),
    trim_right_ft: numValue(formData, "trim_right_ft", 0),
    trim_near_ft: numValue(formData, "trim_near_ft", 0),
    trim_far_ft: numValue(formData, "trim_far_ft", 0),
    status: textValue(formData, "status") || "available",
    updated_by: profile.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("blocks").update(payload).eq("id", originalId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirect("/blocks?toast=Block+updated");
}

async function deleteBlockAction(formData: FormData) {
  "use server";

  await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();
  const id = textValue(formData, "id");
  const deleteCode = textValue(formData, "delete_code");

  if (!id) {
    throw new Error("Block ID is required.");
  }

  if (deleteCode !== BLOCK_DELETE_CODE) {
    throw new Error("Delete code is incorrect. Block was not deleted.");
  }

  const { error } = await supabase.from("blocks").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirect("/blocks?toast=Block+deleted");
}

export default async function BlocksPage() {
  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: blocks, error }, { data: allBlocks }, { data: allIds }] = await Promise.all([
    supabase
      .from("blocks")
      .select(
        "id, stone, yard, category, length_ft, width_ft, height_ft, trim_left_ft, trim_right_ft, trim_near_ft, trim_far_ft, status, created_at"
      )
      .eq("status", "available")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("blocks")
      .select(
        "id, stone, yard, category, length_ft, width_ft, height_ft, trim_left_ft, trim_right_ft, trim_near_ft, trim_far_ft, status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("blocks").select("id")
  ]);

  if (error) {
    throw new Error(error.message);
  }

  const canEdit = ["owner", "planner", "block_entry"].includes(profile.role);
  const suggestedId = nextCode(
    (allIds ?? []).map((row) => row.id),
    "BLK-",
    1000
  );

  return (
    <section className="page-card">
      <div className="topbar" style={{ marginBottom: 0 }}>
        <div>
          <h1>Blocks</h1>
          <p className="muted">
            Create, update, and maintain stone block stock in the shared cloud database.
          </p>
        </div>
        <span className="role-pill">Editable by: owner, planner, block entry</span>
      </div>

      {canEdit ? (
        <form action={addBlockAction} className="page-card compact-create-card inventory-create-shell" style={{ marginTop: 18, padding: 18 }}>
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Add New Block</h2>
            <p className="muted">ID is generated automatically first. You can still change it if needed.</p>
          </div>

          <div className="inventory-row inventory-row-create">
            <label className="stack">
              <span>ID</span>
              <input defaultValue={suggestedId} name="id" placeholder={suggestedId} />
            </label>

            <label className="stack">
              <span>Stone</span>
              <select defaultValue="Makrana" name="stone">
                {STONES.map((stone) => (
                  <option key={stone} value={stone}>
                    {stone}
                  </option>
                ))}
              </select>
            </label>

            <label className="stack">
              <span>Yard</span>
              <select defaultValue="1" name="yard">
                {YARDS.map((yard) => (
                  <option key={yard} value={yard}>
                    Yard {yard}
                  </option>
                ))}
              </select>
            </label>

            <label className="stack">
              <span>Category</span>
              <select defaultValue="Fresh" name="category">
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <input name="status" type="hidden" value="available" />
          </div>

          <div className="inventory-row inventory-row-create" style={{ marginTop: 12 }}>
            <label className="stack">
              <span>Length ft</span>
              <input defaultValue="6" min="0" name="length_ft" step="0.1" type="number" />
            </label>

            <label className="stack">
              <span>Width ft</span>
              <input defaultValue="4" min="0" name="width_ft" step="0.1" type="number" />
            </label>

            <label className="stack">
              <span>Height ft</span>
              <input defaultValue="2" min="0" name="height_ft" step="0.1" type="number" />
            </label>

            <label className="stack">
              <span>Left trim ft</span>
              <input defaultValue="0" min="0" name="trim_left_ft" step="0.1" type="number" />
            </label>

            <label className="stack">
              <span>Right trim ft</span>
              <input defaultValue="0" min="0" name="trim_right_ft" step="0.1" type="number" />
            </label>

            <label className="stack">
              <span>Near trim ft</span>
              <input defaultValue="0" min="0" name="trim_near_ft" step="0.1" type="number" />
            </label>

            <label className="stack">
              <span>Far trim ft</span>
              <input defaultValue="0" min="0" name="trim_far_ft" step="0.1" type="number" />
            </label>
          </div>

          <div className="create-footer" style={{ marginTop: 16 }}>
            <button className="primary-button" type="submit">
              Add Block
            </button>
          </div>
        </form>
      ) : null}

      <div className="section-heading" style={{ marginTop: 22 }}>
        <div>
          <h2 style={{ margin: 0 }}>Current Inventory</h2>
          <p className="muted">
            {blocks?.length ?? 0} available blocks. Click any row to edit.
          </p>
        </div>
        <ExportBlocksButton blocks={allBlocks ?? []} />
      </div>

      <div className="block-compact-list" style={{ marginTop: 10 }}>
        {(blocks ?? []).map((block) => (
          <details className="block-compact-item" key={block.id}>
            <summary className="block-compact-summary">
              <span className="mini-cube" />
              <strong>{block.id}</strong>
              <span className="role-pill">{block.category}</span>
              <span className="role-pill">Yard {block.yard}</span>
              <span className="block-summary-stone">{block.stone}</span>
              <span className="block-summary-dims">{block.length_ft} × {block.width_ft} × {block.height_ft} ft</span>
              <span className="block-summary-date muted">{new Date(block.created_at).toLocaleDateString("en-IN")}</span>
            </summary>

            <form action={updateBlockAction} className="block-edit-form">
              <input name="original_id" type="hidden" value={block.id} />

              <div className="inventory-row">
                <label className="stack">
                  <span>ID</span>
                  <input defaultValue={block.id} name="id" required />
                </label>
                <label className="stack">
                  <span>Stone</span>
                  <select defaultValue={block.stone} name="stone">
                    {STONES.map((stone) => (
                      <option key={stone} value={stone}>{stone}</option>
                    ))}
                  </select>
                </label>
                <label className="stack">
                  <span>Yard</span>
                  <select defaultValue={String(block.yard)} name="yard">
                    {YARDS.map((yard) => (
                      <option key={yard} value={yard}>Yard {yard}</option>
                    ))}
                  </select>
                </label>
                <label className="stack">
                  <span>Category</span>
                  <select defaultValue={block.category} name="category">
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label className="stack">
                  <span>Status</span>
                  <select defaultValue={block.status} name="status">
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="stack">
                  <span>Length ft</span>
                  <input defaultValue={String(block.length_ft)} min="0" name="length_ft" step="0.1" type="number" />
                </label>
                <label className="stack">
                  <span>Width ft</span>
                  <input defaultValue={String(block.width_ft)} min="0" name="width_ft" step="0.1" type="number" />
                </label>
                <label className="stack">
                  <span>Height ft</span>
                  <input defaultValue={String(block.height_ft)} min="0" name="height_ft" step="0.1" type="number" />
                </label>
                <label className="stack">
                  <span>Trim L</span>
                  <input defaultValue={String(block.trim_left_ft)} min="0" name="trim_left_ft" step="0.1" type="number" />
                </label>
                <label className="stack">
                  <span>Trim R</span>
                  <input defaultValue={String(block.trim_right_ft)} min="0" name="trim_right_ft" step="0.1" type="number" />
                </label>
                <label className="stack">
                  <span>Trim N</span>
                  <input defaultValue={String(block.trim_near_ft)} min="0" name="trim_near_ft" step="0.1" type="number" />
                </label>
                <label className="stack">
                  <span>Trim F</span>
                  <input defaultValue={String(block.trim_far_ft)} min="0" name="trim_far_ft" step="0.1" type="number" />
                </label>
              </div>

              <div className="block-edit-footer">
                <label className="stack delete-code-field">
                  <span>Delete code</span>
                  <input name="delete_code" placeholder="Enter code to delete" />
                </label>
                <button className="ghost-button danger-ghost" formAction={deleteBlockAction} name="id" type="submit" value={block.id}>
                  Delete
                </button>
                <button className="secondary-button" type="submit">
                  Update
                </button>
              </div>
            </form>
          </details>
        ))}
      </div>

      {!blocks?.length ? (
        <div className="banner" style={{ marginTop: 16 }}>
          No blocks found yet. Add your first block above.
        </div>
      ) : null}
    </section>
  );
}
