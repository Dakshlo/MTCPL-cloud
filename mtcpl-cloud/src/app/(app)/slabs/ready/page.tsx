import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { ReadySlabsClient } from "./ready-client";

function stoneLabel(stone: string | null) {
  if (!stone) return "Unknown";
  return stone.replace(/Stone$/i, "") || stone;
}

export default async function ReadySlabsPage() {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry"]);
  const supabase = await createDataClient(profile.role);

  const { data, error } = await supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at")
    .eq("status", "cut_done")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  const slabs = data ?? [];

  // --- Summary stats ---
  const totalPieces = slabs.length;
  const totalCft = slabs.reduce(
    (sum, s) => sum + (Number(s.length_ft) * Number(s.width_ft) * Number(s.thickness_ft)) / 1728,
    0
  );

  // Stone-wise breakdown
  const stoneMap = slabs.reduce<Record<string, number>>((acc, s) => {
    const key = s.stone ?? "Unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Temple-wise breakdown
  const templeMap = slabs.reduce<Record<string, number>>((acc, s) => {
    const key = s.temple ?? "Unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const stoneEntries = Object.entries(stoneMap).sort((a, b) => b[1] - a[1]);
  const templeEntries = Object.entries(templeMap).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ready Sizes</h1>
          <p className="muted">Sizes that have been cut and are ready for carving or dispatch.</p>
        </div>
      </div>

      {/* Summary report */}
      {totalPieces > 0 && (
        <div style={{ marginBottom: 28, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Top row: total pieces + total cft */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{
              flex: "1 1 160px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 18px",
            }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Pieces</p>
              <p style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 800, color: "var(--text)" }}>{totalPieces}</p>
            </div>
            <div style={{
              flex: "1 1 160px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 18px",
            }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Quantity</p>
              <p style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 800, color: "var(--text)" }}>{totalCft.toFixed(2)} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>CFT</span></p>
            </div>
          </div>

          {/* Stone-wise + Temple-wise side by side */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            {/* Stone wise */}
            <div style={{
              flex: "1 1 220px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 18px",
            }}>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Stone Type</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stoneEntries.map(([stone, count]) => (
                  <div key={stone} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                        background: stone === "PinkStone" ? "#c084fc" : stone === "WhiteStone" ? "#d1d5db" : "var(--gold)",
                      }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{stoneLabel(stone)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        height: 6, borderRadius: 3,
                        background: stone === "PinkStone" ? "rgba(192,132,252,0.35)" : stone === "WhiteStone" ? "rgba(209,213,219,0.5)" : "rgba(184,115,51,0.35)",
                        width: Math.max(24, Math.round((count / totalPieces) * 120)),
                      }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", minWidth: 28, textAlign: "right" }}>{count}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 36 }}>({Math.round((count / totalPieces) * 100)}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Temple wise */}
            <div style={{
              flex: "1 1 220px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 18px",
            }}>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Temple Wise</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {templeEntries.map(([temple, count]) => (
                  <div key={temple} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{temple}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <div style={{
                        height: 6, borderRadius: 3,
                        background: "rgba(184,115,51,0.3)",
                        width: Math.max(24, Math.round((count / totalPieces) * 120)),
                      }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", minWidth: 28, textAlign: "right" }}>{count}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 36 }}>({Math.round((count / totalPieces) * 100)}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <ReadySlabsClient slabs={slabs} />
    </>
  );
}
