import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { IsoBlockPreview } from "@/components/planning-workbench";
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
  rot?: boolean;
};

export default async function CuttingDetailPage({ params }: { params: Params }) {
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: block, error } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, largest_remainder, restocked_block_id, layout, updated_at, cut_session_id, cut_sessions(id, session_code, kerf_mm, created_at), cut_session_slabs(id, slab_requirement_id)"
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
  const session = block.cut_sessions as unknown as {
    id: string;
    session_code: string;
    kerf_mm: number;
    created_at: string;
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
              ? ` · ${blk.stone} · Yard ${blk.yard} · ${blk.l} × ${blk.w} × ${blk.h} ft`
              : ""}
            {session?.kerf_mm ? ` · Kerf ${session.kerf_mm} mm` : ""}
          </p>
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

      {/* 3D block preview */}
      {blk && placed.length > 0 && (
        <div style={{ margin: "0 0 20px" }}>
          <IsoBlockPreview block={blk as any} placed={placed as any} />
        </div>
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
              {layout.biggest.l} × {layout.biggest.w} × {layout.biggest.h} ft
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

      {/* Planned slab chips */}
      {placed.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            Planned Slabs
          </p>
          <div className="chip-row">
            {placed.map((s) => (
              <span className="plan-chip" key={s.id} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                {s.id}
                {s.temple ? ` · ${s.temple}` : ""}
                {` · ${s.sw}×${s.sh}${s.sd ? `×${s.sd}` : ""} ft`}
                {s.rot ? " ↻" : ""}
              </span>
            ))}
          </div>
        </div>
      )}

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
