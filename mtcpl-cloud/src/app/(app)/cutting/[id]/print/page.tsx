import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { IsoBlockStaticSVG } from "@/components/iso-block-static";
import { PrintButton } from "@/components/print-button";

type Params = Promise<{ id: string }>;

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
  sd?: number;
  px: number;
  py: number;
  pw: number;
  ph: number;
  aw?: number;
  ah?: number;
  rot?: boolean;
  zTop?: number;
  zBot?: number;
};

export default async function CuttingPrintPage({ params }: { params: Params }) {
  await requireAuth(["owner", "team_head", "cutting_operator"]);
  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: block, error } = await supabase
    .from("cut_session_blocks")
    .select(
      "id, status, block_id, largest_remainder, layout, cut_session_id, cut_sessions(id, session_code, kerf_mm, created_at, planned_by), cut_session_slabs(id, slab_requirement_id)"
    )
    .eq("id", id)
    .single();

  if (error || !block) notFound();

  const profilesMap = await getProfilesMap();

  const layout = block.layout as {
    blk?: { id: string; stone: string; yard: number; l: number; w: number; h: number; quality?: string | null };
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
    planned_by: string | null;
  } | null;

  const slabReqIds = (
    block.cut_session_slabs as Array<{ id: string; slab_requirement_id: string }>
  ).map((s) => s.slab_requirement_id);

  const plannerName = session?.planned_by ? profilesMap[session.planned_by] ?? null : null;
  const printDate = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Three views: front-left (default), front-right, front-straight
  const views = [
    { az: Math.PI * 0.25,  label: "Front-Left View" },
    { az: -Math.PI * 0.25, label: "Front-Right View" },
    { az: Math.PI * 0.75,  label: "Back-Left View" },
  ];

  return (
    <>
      <style>{`
        @media screen {
          body { background: #f5f5f5; }
          .print-page { max-width: 860px; margin: 0 auto; padding: 24px; }
        }
        @media print {
          .print-btn { display: none !important; }
          body { margin: 0; background: #fff; }
          .print-page { padding: 10mm 12mm; }
        }
        .print-page {
          background: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 13px;
          color: #1a1a1a;
        }
        h1 { font-size: 20px; margin: 0 0 4px; }
        h2 { font-size: 14px; margin: 18px 0 8px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; }
        .meta-row { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 6px; }
        .meta-item { display: flex; flex-direction: column; }
        .meta-label { font-size: 10px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .meta-value { font-size: 14px; font-weight: 600; margin-top: 2px; }
        .views-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 0 0 4px; }
        .view-box { border: 1px solid #e5e5e5; border-radius: 8px; padding: 8px; background: #fafafa; }
        .view-label { font-size: 10px; color: #888; text-align: center; margin-top: 4px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        thead th { background: #f5f5f5; padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e5e5e5; }
        tbody td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
        tbody tr:last-child td { border-bottom: none; }
        .slab-id { font-family: ui-monospace, monospace; font-weight: 700; font-size: 12px; }
        .print-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e5e5; font-size: 11px; color: #aaa; display: flex; justify-content: space-between; }
        .color-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; flex-shrink: 0; }
      `}</style>

      {/* Print button — only visible on screen */}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 1000 }}>
        <PrintButton />
      </div>

      <div className="print-page">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              MTCPL · Cutting Plan
            </div>
            <h1>{block.block_id}</h1>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
              Session: <strong>{session?.session_code ?? "—"}</strong>
              {plannerName && (
                <> · Plan by <strong style={{ color: "#b87333" }}>{plannerName}</strong></>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "#888" }}>
            <div>Printed {printDate}</div>
            {session?.created_at && (
              <div>Plan created: {new Date(session.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
            )}
          </div>
        </div>

        {/* Block details */}
        <h2>Block Information</h2>
        <div className="meta-row">
          <div className="meta-item">
            <span className="meta-label">Block ID</span>
            <span className="meta-value" style={{ fontFamily: "ui-monospace, monospace" }}>{block.block_id}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Stone</span>
            <span className="meta-value">{blk?.stone ?? "—"}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Yard</span>
            <span className="meta-value">Yard {blk?.yard ?? "—"}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Dimensions</span>
            <span className="meta-value">{blk ? `${blk.l} × ${blk.w} × ${blk.h} ft` : "—"}</span>
          </div>
          {blk && (
            <div className="meta-item">
              <span className="meta-label">Volume</span>
              <span className="meta-value">
                {((blk.l * blk.w * blk.h) / 1728).toFixed(2)} CFT
              </span>
            </div>
          )}
          <div className="meta-item">
            <span className="meta-label">Kerf</span>
            <span className="meta-value">{session?.kerf_mm ?? "—"} mm</span>
          </div>
          {blk?.quality && (
            <div className="meta-item">
              <span className="meta-label">Quality</span>
              <span className="meta-value">Grade {blk.quality}</span>
            </div>
          )}
          {layout?.biggest && (
            <div className="meta-item">
              <span className="meta-label">Expected Remainder</span>
              <span className="meta-value">{layout.biggest.l} × {layout.biggest.w} × {layout.biggest.h} ft</span>
            </div>
          )}
        </div>

        {/* 3 ISO views */}
        {blk && placed.length > 0 && (
          <>
            <h2>3D Block Views ({placed.length} slabs)</h2>
            <div className="views-grid">
              {views.map((v) => (
                <div className="view-box" key={v.label}>
                  <IsoBlockStaticSVG
                    block={{ l: blk.l, w: blk.w, h: blk.h, stone: blk.stone }}
                    placed={placed}
                    az={v.az}
                    size={240}
                  />
                  <div className="view-label">{v.label}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Slab table */}
        <h2>Slabs to Cut ({placed.length})</h2>
        {placed.length === 0 ? (
          <p style={{ color: "#888" }}>No slabs planned for this block.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Slab ID</th>
                <th>Temple</th>
                <th>Label</th>
                <th>Size (W × H ft)</th>
                <th>Thickness</th>
                <th>Position (X, Y ft)</th>
                <th>Rotated</th>
                <th>Layer Depth</th>
              </tr>
            </thead>
            <tbody>
              {placed.map((s, i) => {
                const COLORS = ["#D85A30","#378ADD","#1D9E75","#7F77DD","#BA7517","#639922","#D4537E","#E24B4A","#5F5E5A","#0F6E56"];
                const num = parseInt(String(s.id || "").replace(/\D/g, ""), 10);
                const color = !num || Number.isNaN(num) ? COLORS[0] : COLORS[(num - 1) % COLORS.length];
                return (
                  <tr key={s.id}>
                    <td style={{ color: "#888", width: 28 }}>{i + 1}</td>
                    <td>
                      <span className="color-dot" style={{ background: color }} />
                      <span className="slab-id">{s.id}</span>
                    </td>
                    <td>{s.temple ?? "—"}</td>
                    <td style={{ color: "#555" }}>{s.label ?? "—"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{s.sw} × {s.sh}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{s.sd ? `${s.sd} ft` : "—"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>
                      {s.px != null ? `${Number(s.px).toFixed(1)}, ${Number(s.py).toFixed(1)}` : "—"}
                    </td>
                    <td style={{ textAlign: "center" }}>{s.rot ? "↻ Yes" : "No"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#888" }}>
                      {s.zBot != null && s.zTop != null
                        ? `${Number(s.zBot).toFixed(2)}–${Number(s.zTop).toFixed(2)} ft`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Footer */}
        <div className="print-footer">
          <span>MTCPL · Cutting Plan · {block.block_id}</span>
          <span>Session: {session?.session_code ?? "—"} · {plannerName ? `Plan by ${plannerName}` : ""}</span>
        </div>
      </div>
    </>
  );
}

