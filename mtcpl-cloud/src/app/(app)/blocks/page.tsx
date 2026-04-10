import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AddBlockForm } from "./add-block-form";
import { BlockGrid } from "./block-grid";
import { generateNextCode } from "./utils";

function calcCft(l: number, w: number, h: number) {
  return ((l * w * h) / 1728).toFixed(2);
}

export default async function BlocksPage() {
  const { profile } = await requireAuth(["owner", "planner", "block_entry", "slab_entry"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: blocks, error }, { data: allIds }] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, created_at")
      .in("status", ["available", "reserved"])
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("blocks").select("id"),
  ]);

  if (error) throw new Error(error.message);

  const canEdit = ["owner", "planner", "block_entry"].includes(profile.role);
  const blockList = blocks ?? [];
  const suggestedId = generateNextCode((allIds ?? []).map(r => r.id));

  const totalBlocks = blockList.length;
  const pinkCount = blockList.filter(b => b.stone === "PinkStone").length;
  const whiteCount = blockList.filter(b => b.stone === "WhiteStone").length;
  const totalCft = blockList.reduce(
    (sum, b) => sum + (Number(b.length_ft) * Number(b.width_ft) * Number(b.height_ft)) / 1728,
    0
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Blocks Inventory</h1>
          <p className="muted">Available and reserved blocks ready for planning.</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="metrics-row">
        <div className="metric-card accent-green">
          <span>Available</span>
          <strong>{blockList.filter(b => b.status === "available").length}</strong>
          <small>ready for planning</small>
        </div>
        <div className="metric-card">
          <span>Reserved</span>
          <strong>{blockList.filter(b => b.status === "reserved").length}</strong>
          <small>in active sessions</small>
        </div>
        <div className="metric-card accent-orange">
          <span>PinkStone</span>
          <strong>{pinkCount}</strong>
          <small>{totalBlocks > 0 ? Math.round((pinkCount / totalBlocks) * 100) : 0}%</small>
        </div>
        <div className="metric-card">
          <span>Total Volume</span>
          <strong>{totalCft.toFixed(0)}</strong>
          <small>cubic feet</small>
        </div>
      </div>

      {/* Add form */}
      {canEdit && <AddBlockForm suggestedId={suggestedId} />}

      {/* Inventory */}
      <div className="section-heading">
        <div>
          <h2>{totalBlocks} Blocks</h2>
          <p>Click any card to edit · Esc to close</p>
        </div>
      </div>

      {blockList.length === 0 ? (
        <div className="banner">No blocks yet. Add your first block above.</div>
      ) : (
        <BlockGrid blocks={blockList} canEdit={canEdit} />
      )}
    </>
  );
}
