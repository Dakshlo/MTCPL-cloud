import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { AddBlockForm } from "./add-block-form";
import { BlockGrid } from "./block-grid";
import { BlockExport } from "./block-export";
import { generateNextCode } from "./utils";

export default async function BlocksPage() {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "slab_entry", "block_entry"]);

  const supabase = await createDataClient(profile.role);
  const [{ data: blocks, error }, { data: allIds }, { data: consumed }, { data: vendorRows }] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, quality, truck_no, vendor_name, bill_no, created_at")
      .in("status", ["available", "reserved"])
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("blocks").select("id"),
    supabase
      .from("blocks")
      .select("id, stone, yard, length_ft, width_ft, height_ft, updated_at")
      .eq("status", "consumed")
      .order("updated_at", { ascending: false })
      .limit(30),
    supabase
      .from("vendors")
      .select("name")
      .eq("vendor_type", "block_vendor")
      .eq("is_active", true)
      .order("name"),
  ]);

  if (error) throw new Error(error.message);

  const canEdit = ["developer", "owner", "team_head", "block_slab_entry", "block_entry"].includes(profile.role);
  const canViewReport = ["developer", "owner", "team_head"].includes(profile.role);
  const blockList = blocks ?? [];
  const consumedList = consumed ?? [];
  const vendors = (vendorRows ?? []).map(v => v.name);
  const suggestedId = generateNextCode((allIds ?? []).map(r => r.id));

  const totalBlocks = blockList.length;
  const pinkCount = blockList.filter(b => b.stone === "PinkStone").length;
  const totalCft = blockList.reduce(
    (sum, b) => sum + (Number(b.length_ft) * Number(b.width_ft) * Number(b.height_ft)) / 1728,
    0
  );

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(yest.getDate() - 1);
    if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Blocks Inventory</h1>
          <p className="muted">Available and reserved blocks ready for planning.</p>
        </div>
      </div>

      {canEdit && <AddBlockForm suggestedId={suggestedId} vendors={vendors} />}

      {canViewReport && (
        <div style={{ margin: "28px 0 4px", padding: "14px 18px", background: "var(--surface)", border: "2px dashed var(--border)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Block Report</p>
            <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>View, filter and sort all block records — including consumed, discarded, and active · Export to Excel</p>
          </div>
          <BlockExport />
        </div>
      )}

      <div className="section-heading">
        <div>
          <h2>{totalBlocks} Blocks</h2>
          <p>Click any card to edit · Esc to close</p>
        </div>
      </div>

      {blockList.length === 0 ? (
        <div className="banner">No blocks yet. Add your first block above.</div>
      ) : (
        <BlockGrid blocks={blockList} canEdit={canEdit} vendors={vendors} />
      )}

      {/* Block Usage History — collapsible */}
      {consumedList.length > 0 && (
        <details style={{ marginTop: 40 }}>
          <summary style={{ cursor: "pointer", listStyle: "none", userSelect: "none" }}>
            <div className="section-heading" style={{ marginTop: 0, display: "inline-flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0 }}>Block History ({consumedList.length}) ▾</h2>
                <p className="muted" style={{ margin: "2px 0 0" }}>Recently consumed blocks · click to expand</p>
              </div>
            </div>
          </summary>
          <div className="records-stack" style={{ marginTop: 12 }}>
            {consumedList.map(blk => {
              const cft = ((Number(blk.length_ft) * Number(blk.width_ft) * Number(blk.height_ft)) / 1728).toFixed(2);
              return (
                <div className="record-card compact-record" key={blk.id}>
                  <div className="record-head">
                    <div>
                      <strong style={{ fontFamily: "ui-monospace, monospace" }}>{blk.id}</strong>
                      <p className="muted" style={{ margin: "2px 0 0" }}>
                        {blk.stone} · Yard {blk.yard} · {Number(blk.length_ft)} × {Number(blk.width_ft)} × {Number(blk.height_ft)} ft · {cft} CFT
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className="role-pill badge-consumed">cut &amp; consumed</span>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Used: {fmtDate(blk.updated_at)}
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
