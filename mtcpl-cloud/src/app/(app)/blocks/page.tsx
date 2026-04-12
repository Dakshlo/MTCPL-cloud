import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AddBlockForm } from "./add-block-form";
import { BlockGrid } from "./block-grid";
import { BlockExport } from "./block-export";
import { generateNextCode } from "./utils";

export default async function BlocksPage() {
  const { profile } = await requireAuth(["owner", "planner", "block_entry", "slab_entry"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: blocks, error }, { data: allIds }, { data: history }] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, created_at, truck_no, vendor_name, bill_no")
      .in("status", ["available", "reserved"])
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("blocks").select("id"),
    supabase
      .from("blocks")
      .select("id, stone, yard, length_ft, width_ft, height_ft, status, created_at, updated_at, truck_no, vendor_name, bill_no")
      .in("status", ["consumed", "discarded"])
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  if (error) throw new Error(error.message);

  const canEdit = ["owner", "planner", "block_entry"].includes(profile.role);
  const canExport = ["owner", "planner"].includes(profile.role);
  const blockList = blocks ?? [];
  const historyList = history ?? [];
  const suggestedId = generateNextCode((allIds ?? []).map(r => r.id));

  const totalBlocks = blockList.length;
  const pinkCount = blockList.filter(b => b.stone === "PinkStone").length;
  const totalCft = blockList.reduce(
    (sum, b) => sum + (Number(b.length_ft) * Number(b.width_ft) * Number(b.height_ft)) / 1728,
    0
  );

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Blocks Inventory</h1>
          <p className="muted">Available and reserved blocks ready for planning.</p>
        </div>
      </div>

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

      {canEdit && <AddBlockForm suggestedId={suggestedId} />}

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

      {/* Export Panel — owner/planner only */}
      {canExport && (
        <div style={{ marginTop: 40 }}>
          <div className="section-heading">
            <div>
              <h2>Export</h2>
              <p className="muted">Download block records including all statuses</p>
            </div>
          </div>
          <BlockExport />
        </div>
      )}

      {/* Block History — consumed + discarded */}
      {historyList.length > 0 && (
        <>
          <div className="section-heading" style={{ marginTop: 40 }}>
            <div>
              <h2>Block History ({historyList.length})</h2>
              <p className="muted">Consumed blocks (used in cutting) and removed/discarded blocks</p>
            </div>
          </div>
          <div className="records-stack">
            {historyList.map(blk => {
              const cft = ((Number(blk.length_ft) * Number(blk.width_ft) * Number(blk.height_ft)) / 1728).toFixed(2);
              const isDiscarded = blk.status === "discarded";
              return (
                <div className="record-card compact-record" key={blk.id}>
                  <div className="record-head">
                    <div>
                      <strong style={{ fontFamily: "ui-monospace, monospace" }}>{blk.id}</strong>
                      <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
                        {blk.stone} · Yard {blk.yard} · {Number(blk.length_ft)} × {Number(blk.width_ft)} × {Number(blk.height_ft)} in · {cft} CFT
                      </p>
                      {(blk.truck_no || blk.vendor_name || blk.bill_no) && (
                        <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
                          {[
                            blk.truck_no ? `Truck: ${blk.truck_no}` : null,
                            blk.vendor_name ? `Vendor: ${blk.vendor_name}` : null,
                            blk.bill_no ? `Bill: ${blk.bill_no}` : null,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span className={`role-pill ${isDiscarded ? "badge-discarded" : "badge-consumed"}`}>
                        {isDiscarded ? "removed" : "consumed"}
                      </span>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Added: {fmtDate(blk.created_at)}
                      </p>
                      <p className="muted" style={{ fontSize: 12, marginTop: 1 }}>
                        {isDiscarded ? "Removed" : "Used"}: {fmtDate(blk.updated_at)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
