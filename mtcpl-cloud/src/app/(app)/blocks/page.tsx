import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ExportBlocksButton } from "@/components/export-button";
import { BlockMiniPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const STONES = ["Makrana", "Pinkstone"] as const;
const CATEGORIES = ["Fresh", "Reused"] as const;
const STATUSES = ["available", "reserved", "consumed", "discarded"] as const;
const YARDS = [1, 2, 3] as const;
const BLOCK_DELETE_CODE = process.env.BLOCK_DELETE_CODE || "MTCPL-DELETE";
const LEGACY_DELETE_CODES = ["1255", "MTCPL-DELETE"];

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

function redirectWithToast(path: string, message: string) {
  redirect(`${path}?toast=${encodeURIComponent(message)}`);
}

async function addBlockAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();
  const { data: existingRows } = await supabase.from("blocks").select("id");
  const existingIds = (existingRows ?? []).map((row) => row.id);
  const requestedId = textValue(formData, "id");

  const payload = {
    stone: textValue(formData, "stone") || "Pinkstone",
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

  let attempt = 0;
  let nextId = requestedId;
  let lastError: string | null = null;

  while (attempt < 5) {
    if (!nextId || existingIds.includes(nextId)) {
      nextId = nextCode(existingIds, "BLK-", 1000);
    }

    const { error } = await supabase.from("blocks").insert({
      ...payload,
      id: nextId
    });

    if (!error) {
      revalidatePath("/blocks");
      revalidatePath("/dashboard");
      redirect("/blocks?toast=Block+added+successfully");
    }

    lastError = error.message;
    if (error.code !== "23505") {
      throw new Error(error.message);
    }

    existingIds.push(nextId);
    nextId = "";
    attempt += 1;
  }

  throw new Error(lastError || "Unable to generate a unique block ID. Please try again.");
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

  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();
  const id = textValue(formData, "delete_target_id") || textValue(formData, "id");
  const deleteCode = textValue(formData, "delete_code");

  if (!id) {
    redirectWithToast("/blocks", "Block ID is missing");
  }

  if (![BLOCK_DELETE_CODE, ...LEGACY_DELETE_CODES].includes(deleteCode)) {
    redirectWithToast("/blocks", "Delete code is incorrect. Block was not deleted.");
  }

  const { error } = await supabase.from("blocks").delete().eq("id", id);

  if (error) {
    if (error.code === "23503") {
      const archive = await supabase
        .from("blocks")
        .update({
          status: "discarded",
          updated_by: profile.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (archive.error) {
        redirectWithToast("/blocks", archive.error.message);
      }

      revalidatePath("/blocks");
      revalidatePath("/dashboard");
      redirectWithToast("/blocks", "Block was referenced and has been archived");
    }

    redirectWithToast("/blocks", error.message);
  }

  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirectWithToast("/blocks", "Block deleted");
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
      .order("stone", { ascending: true })
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
  const blockList = blocks ?? [];
  const totalVolume = blockList.reduce((sum, block) => {
    return sum + Number(block.length_ft) * Number(block.width_ft) * Number(block.height_ft);
  }, 0);
  const reusedCount = blockList.filter((block) => block.category === "Reused").length;
  const makranaCount = blockList.filter((block) => block.stone === "Makrana").length;
  const pinkstoneCount = blockList.filter((block) => block.stone === "Pinkstone").length;
  const yardSpread = [1, 2, 3].map((yard) => ({
    yard,
    count: blockList.filter((block) => Number(block.yard) === yard).length
  }));

  return (
    <>
      <section className="page-card inventory-hero inventory-hero-blocks">
        <div className="inventory-hero-copy">
          <div className="dashboard-chip">Stock Intelligence</div>
          <h1>Blocks Inventory</h1>
          <p className="muted">
            Track every available block with cleaner visibility across stone type, yard, volume, and reusable remainder stock.
          </p>
          <div className="inventory-chip-row">
            <span className="role-pill">Editable by owner, planner, block entry</span>
            <span className="role-pill">Delete code protected</span>
            <span className="role-pill">Realtime shared</span>
          </div>
        </div>

        <div className="inventory-hero-panel">
          <div className="inventory-hero-art">
            <BlockMiniPreview stone="Pinkstone" className="hero-block-art" />
            <div>
              <strong>Live Stock Snapshot</strong>
              <p className="muted">
                {pinkstoneCount} Pinkstone · {makranaCount} Makrana · {reusedCount} reused pieces ready for planning.
              </p>
            </div>
          </div>
          <div className="inventory-mini-bars">
            {yardSpread.map((item) => (
              <div className="inventory-mini-bar" key={item.yard}>
                <div className="inventory-mini-bar-head">
                  <span>Yard {item.yard}</span>
                  <strong>{item.count}</strong>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill inventory-fill-warm"
                    style={{ width: `${blockList.length ? (item.count / blockList.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="metrics-grid inventory-metrics-row">
        <div className="metric-card inventory-metric">
          <span>Available Blocks</span>
          <strong>{blockList.length}</strong>
        </div>
        <div className="metric-card inventory-metric">
          <span>Total Volume</span>
          <strong>{totalVolume.toFixed(1)}</strong>
          <small>ft3 ready for planning</small>
        </div>
        <div className="metric-card inventory-metric">
          <span>Reused Pieces</span>
          <strong>{reusedCount}</strong>
        </div>
        <div className="metric-card inventory-metric">
          <span>Pinkstone Bias</span>
          <strong>{pinkstoneCount}</strong>
        </div>
      </section>

      {canEdit ? (
        <form action={addBlockAction} className="page-card compact-create-card inventory-create-shell inventory-studio" style={{ marginTop: 18, padding: 18 }}>
          <div className="inventory-studio-main">
            <div className="section-heading">
              <div>
                <h2 style={{ margin: 0 }}>Add New Block</h2>
                <p className="muted">Fast, structured entry for stock teams. The next block code is prepared automatically.</p>
              </div>
            </div>

            <div className="inventory-row inventory-row-create">
              <label className="stack">
                <span>ID</span>
                <input defaultValue={suggestedId} name="id" placeholder={suggestedId} />
              </label>

              <label className="stack">
                <span>Stone</span>
                <select defaultValue="Pinkstone" name="stone">
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
          </div>

          <aside className="inventory-studio-side">
            <div className="inventory-preview-card">
              <BlockMiniPreview stone="Pinkstone" className="inventory-preview-art" />
              <strong>Premium Entry Flow</strong>
              <p className="muted">
                Default stone is now Pinkstone, IDs auto-increment, and delete stays protected with a code.
              </p>
              <div className="inventory-preview-stats">
                <div>
                  <span className="muted">Suggested code</span>
                  <strong>{suggestedId}</strong>
                </div>
                <div>
                  <span className="muted">Recommended size</span>
                  <strong>6 × 4 × 2</strong>
                </div>
              </div>
            </div>
          </aside>
        </form>
      ) : null}

      <div className="section-heading inventory-list-header" style={{ marginTop: 22 }}>
        <div>
          <h2 style={{ margin: 0 }}>Current Inventory</h2>
          <p className="muted">
            {blocks?.length ?? 0} available blocks. Click any row to edit.
          </p>
        </div>
        <ExportBlocksButton blocks={allBlocks ?? []} />
      </div>

      <div className="block-compact-list" style={{ marginTop: 10 }}>
        {(() => {
          const byStone = blockList.reduce<Record<string, typeof blockList>>((acc, block) => {
            if (!acc[block.stone]) acc[block.stone] = [];
            acc[block.stone].push(block);
            return acc;
          }, {});
          const stoneKeys = Object.keys(byStone).sort();
          return stoneKeys.map((stone) => (
            <div className="inventory-cluster" key={stone}>
              <div className="stone-group-header inventory-cluster-header">
                <span>{stone}</span>
                <strong>{byStone[stone].length} blocks</strong>
              </div>
              {byStone[stone].map((block) => (
          <details className="block-compact-item" key={block.id}>
            <summary className="block-compact-summary">
              <BlockMiniPreview stone={block.stone} />
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
                  <input defaultValue={String(block.length_ft)} min="0" name="length_ft" step="0.01" type="number" />
                </label>
                <label className="stack">
                  <span>Width ft</span>
                  <input defaultValue={String(block.width_ft)} min="0" name="width_ft" step="0.01" type="number" />
                </label>
                <label className="stack">
                  <span>Height ft</span>
                  <input defaultValue={String(block.height_ft)} min="0" name="height_ft" step="0.01" type="number" />
                </label>
                <label className="stack">
                  <span>Trim L</span>
                  <input defaultValue={String(block.trim_left_ft)} min="0" name="trim_left_ft" step="0.01" type="number" />
                </label>
                <label className="stack">
                  <span>Trim R</span>
                  <input defaultValue={String(block.trim_right_ft)} min="0" name="trim_right_ft" step="0.01" type="number" />
                </label>
                <label className="stack">
                  <span>Trim N</span>
                  <input defaultValue={String(block.trim_near_ft)} min="0" name="trim_near_ft" step="0.01" type="number" />
                </label>
                <label className="stack">
                  <span>Trim F</span>
                  <input defaultValue={String(block.trim_far_ft)} min="0" name="trim_far_ft" step="0.01" type="number" />
                </label>
              </div>

              <div className="block-edit-footer">
                <label className="stack delete-code-field">
                  <span>Delete code</span>
                  <input name="delete_code" placeholder="Enter code to delete" />
                </label>
                <button className="ghost-button danger-ghost" formAction={deleteBlockAction} formNoValidate name="delete_target_id" type="submit" value={block.id}>
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
          ));
        })()}
      </div>

      {!blocks?.length ? (
        <div className="banner" style={{ marginTop: 16 }}>
          No blocks found yet. Add your first block above.
        </div>
      ) : null}
    </>
  );
}
