import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BlockCardPreview } from "@/components/stone-previews";
import { AddBlockForm } from "./add-block-form";
import { generateNextCode } from "./utils";
import { updateBlockAction, deleteBlockAction } from "./actions";

const STONES = ["PinkStone", "WhiteStone"] as const;
const YARDS = [1, 2, 3] as const;
const STATUSES = ["available", "reserved", "consumed", "discarded"] as const;

function calcCft(l: number, w: number, h: number) {
  return ((l * w * h) / 1728).toFixed(2);
}

function statusBadgeClass(status: string) {
  const map: Record<string, string> = {
    available: "badge-available",
    reserved:  "badge-reserved",
    consumed:  "badge-consumed",
    discarded: "badge-discarded"
  };
  return map[status] || "";
}

export default async function BlocksPage() {
  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: blocks, error }, { data: allIds }] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, created_at")
      .in("status", ["available", "reserved"])
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("blocks").select("id")
  ]);

  if (error) throw new Error(error.message);

  const canEdit = ["owner", "planner", "block_entry"].includes(profile.role);
  const blockList = blocks ?? [];
  const suggestedId = generateNextCode((allIds ?? []).map(r => r.id));

  const totalBlocks = blockList.length;
  const pinkCount = blockList.filter(b => b.stone === "PinkStone").length;
  const whiteCount = blockList.filter(b => b.stone === "WhiteStone").length;
  const totalCft = blockList.reduce((sum, b) =>
    sum + (Number(b.length_ft) * Number(b.width_ft) * Number(b.height_ft)) / 1728, 0
  );

  return (
    <>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1>Blocks Inventory</h1>
          <p className="muted">Available and reserved blocks ready for planning.</p>
        </div>
      </div>

      {/* Quick metrics */}
      <div className="metrics-row">
        <div className="metric-card">
          <span>Total Blocks</span>
          <strong>{totalBlocks}</strong>
          <small>available + reserved</small>
        </div>
        <div className="metric-card">
          <span>PinkStone</span>
          <strong>{pinkCount}</strong>
        </div>
        <div className="metric-card">
          <span>WhiteStone</span>
          <strong>{whiteCount}</strong>
        </div>
        <div className="metric-card">
          <span>Total Volume</span>
          <strong>{totalCft.toFixed(1)}</strong>
          <small>cubic feet</small>
        </div>
      </div>

      {/* Add form — client component for CFT auto-calc */}
      {canEdit ? <AddBlockForm suggestedId={suggestedId} /> : null}

      {/* Inventory header */}
      <div className="section-heading" style={{ marginTop: 4 }}>
        <div>
          <h2>{totalBlocks} Blocks</h2>
          <p>Click any card to edit · Delete requires code 1255</p>
        </div>
      </div>

      {/* Card grid */}
      {blockList.length === 0 ? (
        <div className="banner">No blocks yet. Add your first block above.</div>
      ) : (
        <div className="block-card-grid">
          {blockList.map(block => {
            const L = Number(block.length_ft);
            const W = Number(block.width_ft);
            const H = Number(block.height_ft);
            const cft = calcCft(L, W, H);
            const stoneBadge = block.stone === "PinkStone" ? "badge-pink" : "badge-white-stone";

            return (
              <details className="block-card" key={block.id}>
                {/* Card face */}
                <summary className="block-card-face">
                  <div className="block-card-preview">
                    <BlockCardPreview stone={block.stone} l={L} w={W} h={H} />
                  </div>
                  <div className="block-card-info">
                    <div className="block-card-code">{block.id}</div>
                    <div className="block-card-badges">
                      <span className={`role-pill ${stoneBadge}`}>{block.stone}</span>
                      <span className="role-pill">Yard {block.yard}</span>
                      <span className={`role-pill ${statusBadgeClass(block.status)}`}>{block.status}</span>
                    </div>
                    <div className="block-card-dims">{L} × {W} × {H} in</div>
                    <div className="block-card-cft">{cft} CFT</div>
                  </div>
                  <div className="block-card-hint">↓ Click to edit</div>
                </summary>

                {/* Edit form */}
                {canEdit ? (
                  <div className="block-card-edit">
                    <div className="block-card-edit-header">
                      <h3>Edit Block — {block.id}</h3>
                    </div>

                    <form action={updateBlockAction}>
                      <input name="original_id" type="hidden" value={block.id} />

                      <div className="inventory-row" style={{ marginBottom: 12 }}>
                        <label className="stack">
                          <span>Block Code</span>
                          <input defaultValue={block.id} name="id" required style={{ fontFamily: "monospace" }} />
                        </label>
                        <label className="stack">
                          <span>Stone</span>
                          <select defaultValue={block.stone} name="stone">
                            {STONES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="stack">
                          <span>Yard</span>
                          <select defaultValue={String(block.yard)} name="yard">
                            {YARDS.map(y => <option key={y} value={y}>Yard {y}</option>)}
                          </select>
                        </label>
                        <label className="stack">
                          <span>Status</span>
                          <select defaultValue={block.status} name="status">
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                      </div>

                      <div className="inventory-row" style={{ marginBottom: 14 }}>
                        <label className="stack">
                          <span>Length (in)</span>
                          <input defaultValue={String(L)} min="0" name="length_in" step="0.5" type="number" />
                        </label>
                        <label className="stack">
                          <span>Width (in)</span>
                          <input defaultValue={String(W)} min="0" name="width_in" step="0.5" type="number" />
                        </label>
                        <label className="stack">
                          <span>Height (in)</span>
                          <input defaultValue={String(H)} min="0" name="height_in" step="0.5" type="number" />
                        </label>
                      </div>

                      <div className="record-actions">
                        <label className="stack" style={{ flex: "0 0 auto" }}>
                          <span>Delete Code</span>
                          <input name="delete_code" placeholder="Enter to delete" style={{ width: 160 }} />
                        </label>
                        <button
                          className="ghost-button danger-ghost"
                          formAction={deleteBlockAction}
                          formNoValidate
                          name="delete_target_id"
                          type="submit"
                          value={block.id}
                          style={{ alignSelf: "flex-end" }}
                        >
                          Delete
                        </button>
                        <button className="secondary-button" type="submit" style={{ alignSelf: "flex-end" }}>
                          Update
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
