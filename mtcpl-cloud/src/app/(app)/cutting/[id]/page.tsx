import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { CuttingDetailPreview } from "../cutting-detail-preview";
import { FinishBlockForm } from "../finish-block-form";
import { UndoButton } from "../undo-button";
import { RejectButton } from "../reject-button";
import {
  approveBlockAction,
  rejectBlockAction,
  finishBlockAction,
  undoDoneAction,
} from "../actions";

type Params = Promise<{ id: string }>;

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
  sd?: number;
  px?: number;
  py?: number;
  pw?: number;
  ph?: number;
  rot?: boolean;
  zTop?: number;
  zBot?: number;
};

const SLAB_COLORS = ["#D85A30","#378ADD","#1D9E75","#7F77DD","#BA7517","#639922","#D4537E","#E24B4A","#5F5E5A","#0F6E56"];
function slabColor(id: string) {
  const num = parseInt(String(id || "").replace(/\D/g, ""), 10);
  if (!num || Number.isNaN(num)) return SLAB_COLORS[0];
  return SLAB_COLORS[(num - 1) % SLAB_COLORS.length];
}

export default async function CuttingDetailPage({ params }: { params: Params }) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: block, error } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, largest_remainder, restocked_block_id, layout, updated_at, cut_session_id, cut_sessions(id, session_code, kerf_mm, created_at, planned_by), cut_session_slabs(id, slab_requirement_id)"
    )
    .eq("id", id)
    .single();

  if (error || !block) notFound();

  const layout = block.layout as {
    blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number };
    placed?: PlacedSlab[];
    biggest?: { l: number; w: number; h: number } | null;
  } | null;

  const blk = layout?.blk;
  const placed = layout?.placed ?? [];
  const [profilesMap, { data: stoneTypes }] = await Promise.all([
    getProfilesMap(),
    createAdminSupabaseClient().from("stone_types").select("id, name, color_top, color_front, color_side").order("name"),
  ]);

  const session = block.cut_sessions as unknown as {
    id: string;
    session_code: string;
    kerf_mm: number;
    created_at: string;
    planned_by: string | null;
  } | null;
  const slabReqIds = (
    block.cut_session_slabs as Array<{ id: string; slab_requirement_id: string }>
  ).map((s) => s.slab_requirement_id);

  const isPending = block.status === "pending_worker";
  const isCutting = block.status === "cutting" || block.status === "done_prompt";
  const isDone = block.status === "done";
  const isRejected = block.status === "rejected";

  return (
    <section className="page-card">
      {/* Breadcrumb */}
      <div style={{ marginBottom: 18 }}>
        <Link
          href={`/cutting?tab=${isCutting ? "in_progress" : isDone ? "done" : isRejected ? "done" : "pending"}`}
          style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}
        >
          ← Back to Cutting
        </Link>
      </div>

      {/* Header */}
      <div className="record-head" style={{ marginBottom: 20 }}>
        <div>
          <h1
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: 0,
            }}
          >
            {isCutting && <span className="live-dot" />}
            {isCutting
              ? "Slab Selection"
              : `Block ${block.block_id}`}
          </h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {session?.session_code ?? "—"}
            {blk
              ? ` · ${blk.stone} · Yard ${blk.yard} · ${blk.l} × ${blk.w} × ${blk.h} in`
              : ""}
            {session?.kerf_mm ? ` · Kerf ${session.kerf_mm} mm` : ""}
          </p>
          {session?.planned_by && profilesMap[session.planned_by] && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Plan by{" "}
              <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                {profilesMap[session.planned_by]}
              </span>
            </p>
          )}
        </div>
        <div>
          {isPending && (
            <span className="role-pill badge-reserved">Pending Approval</span>
          )}
          {isCutting && (
            <span
              className="role-pill"
              style={{
                background: "#dcfce7",
                color: "#15803d",
                border: "1px solid #86efac",
              }}
            >
              ● Live Cutting
            </span>
          )}
          {isDone && (
            <span className="role-pill badge-available">✓ Done</span>
          )}
          {isRejected && (
            <span className="role-pill badge-discarded">Rejected</span>
          )}
        </div>
      </div>

      {/* 3D preview + slab chip list (cross-highlighted on hover) */}
      {blk && placed.length > 0 && (
        <CuttingDetailPreview blk={blk} placed={placed as any} stoneTypes={stoneTypes ?? undefined} />
      )}

      {/* Info cards row */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        {session?.kerf_mm && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 10,
                color: "var(--muted)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Kerf
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700 }}>
              {session.kerf_mm} mm
            </p>
          </div>
        )}
        {layout?.biggest && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 10,
                color: "var(--muted)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Planned Largest Remainder
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700 }}>
              {layout.biggest.l} × {layout.biggest.w} × {layout.biggest.h} in
            </p>
          </div>
        )}
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 14px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 10,
              color: "var(--muted)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Slabs Planned
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700 }}>
            {placed.length}
          </p>
        </div>
      </div>

      {/* Slab chips now rendered inside CuttingDetailPreview above */}

      {/* ── Layer-by-Layer Guide (when multiple layers exist) ── */}
      {blk && placed.length > 0 && (() => {
        const slabsWithZ = placed.filter(s => s.zTop != null && s.px != null);
        if (slabsWithZ.length === 0) return null;
        const map = new Map<string, { zBot: number; zTop: number; slabs: PlacedSlab[] }>();
        for (const s of slabsWithZ) {
          const zTop = s.zTop!;
          const zBot = s.zBot ?? 0;
          const key = `${zBot.toFixed(2)}_${zTop.toFixed(2)}`;
          if (!map.has(key)) map.set(key, { zBot, zTop, slabs: [] });
          map.get(key)!.slabs.push(s);
        }
        const layers = [...map.values()].sort((a, b) => b.zTop - a.zTop);
        if (layers.length < 2) return null;
        const PAD = 8;
        const MAX_SIZE = 130;
        const sc = Math.min((MAX_SIZE - PAD * 2) / blk.l, (MAX_SIZE - PAD * 2) / blk.w, 5);
        const svgW = blk.l * sc + PAD * 2;
        const svgH = blk.w * sc + PAD * 2;
        return (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              Layer Cutting Guide — {layers.length} layers (cut top → bottom)
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {layers.map((layer, li) => (
                <div key={li} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 6px 4px", background: "var(--bg)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center", marginBottom: 4 }}>
                    Layer {li + 1}
                  </div>
                  <svg viewBox={`0 0 ${svgW.toFixed(1)} ${svgH.toFixed(1)}`} style={{ width: "100%", display: "block" }}>
                    <rect x={PAD} y={PAD} width={blk.l * sc} height={blk.w * sc}
                      fill="var(--surface-alt,#f5f5f0)" stroke="var(--border,#ccc)" strokeWidth="0.8" strokeDasharray="3 2" />
                    {slabsWithZ.map((s) => {
                      const inLayer = layer.slabs.some(ls => ls.id === s.id);
                      const col = slabColor(s.id);
                      const x = PAD + (s.px ?? 0) * sc;
                      const y = PAD + (s.py ?? 0) * sc;
                      const w = (s.pw ?? 0) * sc;
                      const h = (s.ph ?? 0) * sc;
                      return (
                        <g key={s.id}>
                          <rect x={x} y={y} width={w} height={h}
                            fill={inLayer ? col : "#d0d0d0"}
                            fillOpacity={inLayer ? 0.55 : 0.2}
                            stroke={inLayer ? col : "#bbb"}
                            strokeWidth={inLayer ? "1.2" : "0.4"}
                          />
                          {inLayer && Math.min(w, h) > 12 && (
                            <text x={x + w / 2} y={y + h / 2}
                              textAnchor="middle" dominantBaseline="middle"
                              fill="#1a1a1a" fontSize={7} fontWeight={700}
                              fontFamily="ui-monospace,monospace">
                              {s.id}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                  <div style={{ fontSize: 9, color: "var(--muted)", textAlign: "center", marginTop: 3, fontFamily: "ui-monospace, monospace" }}>
                    {layer.zBot.toFixed(1)}″ – {layer.zTop.toFixed(1)}″ deep
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4, justifyContent: "center" }}>
                    {layer.slabs.map(s => (
                      <span key={s.id} style={{ fontSize: 9, fontFamily: "ui-monospace, monospace", fontWeight: 700,
                        background: slabColor(s.id) + "33", color: "#1a1a1a",
                        padding: "1px 5px", borderRadius: 3, border: `1px solid ${slabColor(s.id)}66` }}>
                        {s.id}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── PENDING: Approve / Reject ── */}
      {isPending && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            paddingTop: 8,
          }}
        >
          <form action={approveBlockAction}>
            <input
              type="hidden"
              name="session_block_id"
              value={block.id}
            />
            <input
              type="hidden"
              name="session_id"
              value={block.cut_session_id}
            />
            <button className="primary-button" type="submit">
              Approve &amp; Start Cutting
            </button>
          </form>
          <form action={rejectBlockAction}>
            <input
              type="hidden"
              name="session_block_id"
              value={block.id}
            />
            <input
              type="hidden"
              name="session_id"
              value={block.cut_session_id}
            />
            <input type="hidden" name="block_id" value={block.block_id} />
            <input
              type="hidden"
              name="slab_ids"
              value={JSON.stringify(slabReqIds)}
            />
            <RejectButton />
          </form>
        </div>
      )}

      {/* ── IN PROGRESS: Slab selection form ── */}
      {isCutting && (
        <>
          <div
            style={{
              margin: "0 0 18px",
              padding: "12px 16px",
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: 8,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "#15803d",
                fontWeight: 600,
              }}
            >
              🔪 Cutting done — select which slabs were actually cut, then record any leftover block pieces below.
              If no remainder pieces are entered (or left at 0), the block will be discarded.
            </p>
          </div>
          <FinishBlockForm
            sessionBlockId={block.id}
            sessionId={block.cut_session_id}
            blockId={block.block_id}
            stone={blk?.stone ?? "PinkStone"}
            yard={blk?.yard ?? 1}
            allSlabs={placed.map((s) => ({
              id: s.id,
              label: s.label,
              temple: s.temple,
              sw: s.sw,
              sh: s.sh,
            }))}
            finishAction={finishBlockAction}
          />
        </>
      )}

      {/* ── DONE: Summary + optional undo ── */}
      {isDone && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              padding: 16,
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: 8,
            }}
          >
            <p style={{ margin: 0, fontWeight: 700, color: "#15803d" }}>
              ✓ Cut completed
            </p>
            {block.restocked_block_id ? (
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Restocked blocks:{" "}
                {block.restocked_block_id
                  .split(",")
                  .map((s: string) => s.trim())
                  .join(", ")}
              </p>
            ) : (
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Block discarded — no remainder pieces entered.
              </p>
            )}
            {block.updated_at && (
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Completed:{" "}
                {new Date(block.updated_at).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
          {(profile.role === "owner" || profile.role === "developer") && (
            <form action={undoDoneAction} style={{ display: "inline" }}>
              <input
                type="hidden"
                name="session_block_id"
                value={block.id}
              />
              <input
                type="hidden"
                name="session_id"
                value={block.cut_session_id}
              />
              <input type="hidden" name="block_id" value={block.block_id} />
              <input
                type="hidden"
                name="slab_ids"
                value={JSON.stringify(slabReqIds)}
              />
              <input
                type="hidden"
                name="restocked_block_id"
                value={block.restocked_block_id ?? ""}
              />
              <UndoButton message="Undo this cut? Block goes back to reserved and slabs back to planned." />
            </form>
          )}
        </div>
      )}

      {/* ── REJECTED ── */}
      {isRejected && (
        <div
          style={{
            padding: 16,
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, color: "#dc2626" }}>
            Block rejected
          </p>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            This block was returned to inventory and its slabs are back to open
            status.
          </p>
        </div>
      )}
    </section>
  );
}
