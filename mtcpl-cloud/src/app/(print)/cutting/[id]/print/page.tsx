import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { IsoBlockStaticSVG } from "@/components/iso-block-static";
import { PrintBtn } from "./print-btn";

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

const SLAB_COLORS = [
  "#D85A30","#378ADD","#1D9E75","#7F77DD","#BA7517",
  "#639922","#D4537E","#E24B4A","#5F5E5A","#0F6E56",
];
function slabColor(id: string) {
  const num = parseInt(String(id || "").replace(/\D/g, ""), 10);
  if (!num || Number.isNaN(num)) return SLAB_COLORS[0];
  return SLAB_COLORS[(num - 1) % SLAB_COLORS.length];
}

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

  const [profilesMap, { data: stoneTypes }] = await Promise.all([
    getProfilesMap(),
    supabase.from("stone_types").select("id, name, color_top, color_front, color_side").order("sort_order").order("name"),
  ]);

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

  const plannerName = session?.planned_by ? (profilesMap[session.planned_by] ?? "Unknown") : null;
  const printDate = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Build 2D top-down layout SVG inline
  const topDownSvg = (() => {
    if (!blk || placed.length === 0) return null;
    const PAD = 12;
    const MAX_W = 340;
    const MAX_H = 280;
    const scaleX = (MAX_W - PAD * 2) / blk.l;
    const scaleY = (MAX_H - PAD * 2) / blk.w;
    const sc = Math.min(scaleX, scaleY, 6);
    const svgW = blk.l * sc + PAD * 2;
    const svgH = blk.w * sc + PAD * 2;
    return { sc, PAD, svgW, svgH };
  })();

  // Group slabs by layer (unique zBot–zTop range) for layer-by-layer guide
  const layers = (() => {
    if (!blk || placed.length === 0) return [];
    const map = new Map<string, { zBot: number; zTop: number; slabs: PlacedSlab[] }>();
    for (const s of placed) {
      const zTop = s.zTop ?? blk.h;
      const zBot = s.zBot ?? 0;
      const key = `${zBot.toFixed(2)}_${zTop.toFixed(2)}`;
      if (!map.has(key)) map.set(key, { zBot, zTop, slabs: [] });
      map.get(key)!.slabs.push(s);
    }
    return [...map.values()].sort((a, b) => b.zTop - a.zTop); // top layer first
  })();

  // Volume in CFT (values stored in inches, 1728 in³ = 1 ft³)
  const volCft = blk ? ((blk.l * blk.w * blk.h) / 1728).toFixed(2) : null;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          font-size: 13px;
          color: #1a1a1a;
          background: #f0f0f0;
        }

        .print-wrap {
          max-width: 900px;
          margin: 0 auto;
          background: #fff;
          padding: 28px 32px 36px;
        }

        /* Screen-only print button bar */
        .screen-bar {
          background: #1a1a1a;
          color: #fff;
          padding: 10px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          max-width: 900px;
          margin: 0 auto;
        }
        .screen-bar-title { font-size: 13px; color: rgba(255,255,255,0.65); }
        .print-action-btn {
          background: #b87333;
          color: #fff;
          border: none;
          padding: 8px 22px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.02em;
        }
        .print-action-btn:hover { background: #a06428; }

        /* Typography */
        .doc-eyebrow {
          font-size: 10px;
          font-weight: 700;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 6px;
        }
        .doc-title {
          font-size: 22px;
          font-weight: 700;
          color: #1a1a1a;
          font-family: ui-monospace, monospace;
          margin-bottom: 3px;
        }
        .doc-sub { font-size: 13px; color: #555; }
        .doc-date { font-size: 11px; color: #888; text-align: right; line-height: 1.6; }

        /* Section headings */
        .section-head {
          font-size: 11px;
          font-weight: 700;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border-bottom: 2px solid #1a1a1a;
          padding-bottom: 4px;
          margin: 20px 0 10px;
        }

        /* Meta grid */
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
          gap: 12px 20px;
        }
        .meta-label {
          font-size: 9px;
          font-weight: 700;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 2px;
        }
        .meta-val {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
        }
        .meta-val.mono { font-family: ui-monospace, monospace; }

        /* 3D + 2D Views */
        .views-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-items: start;
        }
        .view-card {
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 8px 8px 4px;
          background: #fafafa;
        }
        .view-lbl {
          font-size: 9px;
          font-weight: 700;
          color: #888;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-top: 4px;
        }

        /* Planned slabs table */
        table.slab-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        table.slab-table th {
          background: #f5f5f5;
          padding: 5px 8px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 2px solid #ddd;
        }
        table.slab-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #f0f0f0;
          vertical-align: middle;
        }
        table.slab-table tr:last-child td { border-bottom: none; }

        .color-dot {
          display: inline-block;
          width: 9px;
          height: 9px;
          border-radius: 2px;
          margin-right: 5px;
          vertical-align: middle;
          flex-shrink: 0;
        }
        .slab-code { font-family: ui-monospace, monospace; font-weight: 700; }

        /* Layer-by-layer guide grid */
        .layer-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px;
          margin-bottom: 4px;
        }
        .layer-card {
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 6px 6px 4px;
          background: #fafafa;
          page-break-inside: avoid;
        }
        .layer-lbl {
          font-size: 8px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          text-align: center;
          margin-bottom: 3px;
        }
        .layer-depth {
          font-size: 8px;
          color: #888;
          text-align: center;
          margin-top: 3px;
          font-family: ui-monospace, monospace;
        }

        /* Primary slab views */
        .prim-slab-block {
          page-break-inside: avoid;
        }
        .prim-slab-block + .prim-slab-block {
          page-break-before: always;
        }
        .prim-slab-view-card {
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 10px 10px 6px;
          background: #fafafa;
          margin-bottom: 10px;
        }
        .prim-slab-list {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #eee;
          font-family: ui-monospace, monospace;
          font-size: 12px;
        }
        .prim-slab-chip {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 10px;
          font-weight: 700;
          font-family: ui-monospace, monospace;
        }

        /* ─── MANUAL ENTRY SECTION ─────────────────────────── */
        .manual-section {
          margin-top: 24px;
          border: 2px dashed #bbb;
          border-radius: 8px;
          padding: 16px 20px 20px;
          page-break-inside: avoid;
        }
        .manual-title {
          font-size: 12px;
          font-weight: 700;
          color: #444;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 4px;
        }
        .manual-hint {
          font-size: 10px;
          color: #888;
          margin-bottom: 14px;
        }

        /* Slab checklist in manual section */
        .slab-checklist {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 6px 16px;
          margin-bottom: 18px;
        }
        .slab-check-row {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
        }
        .check-box {
          width: 14px;
          height: 14px;
          border: 1.5px solid #555;
          border-radius: 3px;
          flex-shrink: 0;
          display: inline-block;
        }

        /* Waste block form lines */
        .waste-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin-bottom: 16px;
        }
        .waste-table th {
          background: #f5f5f5;
          padding: 5px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 2px solid #ddd;
        }
        .waste-table td {
          padding: 0;
          border-bottom: 1px solid #eee;
          height: 34px;
        }
        .write-line {
          display: block;
          width: 100%;
          height: 100%;
          border-bottom: 1.5px solid #ccc;
          margin: 0 8px;
          width: calc(100% - 16px);
        }

        /* Sign-off row */
        .signoff-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          margin-top: 12px;
        }
        .signoff-field { display: flex; flex-direction: column; gap: 4px; }
        .signoff-label { font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .signoff-line { border-bottom: 1.5px solid #888; height: 28px; width: 100%; }

        /* Footer */
        .doc-footer {
          margin-top: 20px;
          padding-top: 10px;
          border-top: 1px solid #e0e0e0;
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #aaa;
        }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 10mm 12mm; margin: 0; }
          .section-head { margin-top: 14px; }
          @page { margin: 10mm; }
        }

        @media screen {
          body { padding: 0; }
        }
      `}</style>

      {/* Screen-only top bar with print button */}
      <div className="screen-bar">
        <span className="screen-bar-title">
          Cutting Plan — {block.block_id} · {session?.session_code ?? ""}
        </span>
        <PrintBtn />
      </div>

      <div className="print-wrap">

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div className="doc-eyebrow">MTCPL · Cutting Plan</div>
            <div className="doc-title">{block.block_id}</div>
            <div className="doc-sub">
              Session: <strong>{session?.session_code ?? "—"}</strong>
              {plannerName && (
                <> &nbsp;·&nbsp; Plan by <strong style={{ color: "#b87333" }}>{plannerName}</strong></>
              )}
            </div>
          </div>
          <div className="doc-date">
            <div>Printed: {printDate}</div>
            {session?.created_at && (
              <div>Plan date: {new Date(session.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
            )}
          </div>
        </div>

        {/* ── Block info ── */}
        <div className="section-head">Block Information</div>
        <div className="meta-grid">
          <div>
            <div className="meta-label">Block ID</div>
            <div className="meta-val mono">{block.block_id}</div>
          </div>
          <div>
            <div className="meta-label">Stone</div>
            <div className="meta-val">{blk?.stone ?? "—"}</div>
          </div>
          <div>
            <div className="meta-label">Yard</div>
            <div className="meta-val">Yard {blk?.yard ?? "—"}</div>
          </div>
          <div>
            <div className="meta-label">Dimensions (in)</div>
            <div className="meta-val mono">
              {blk ? `${blk.l} × ${blk.w} × ${blk.h}` : "—"} in
            </div>
          </div>
          {volCft && (
            <div>
              <div className="meta-label">Volume</div>
              <div className="meta-val">{volCft} CFT</div>
            </div>
          )}
          <div>
            <div className="meta-label">Kerf</div>
            <div className="meta-val">{session?.kerf_mm ?? "—"} mm</div>
          </div>
          {blk?.quality && (
            <div>
              <div className="meta-label">Quality</div>
              <div className="meta-val">Grade {blk.quality}</div>
            </div>
          )}
          {layout?.biggest && (
            <div>
              <div className="meta-label">Expected Remainder (in)</div>
              <div className="meta-val mono">
                {layout.biggest.l} × {layout.biggest.w} × {layout.biggest.h} in
              </div>
            </div>
          )}
        </div>

        {/* ── 3D Isometric + 2D Top Layout ── */}
        {blk && placed.length > 0 && (
          <>
            <div className="section-head">Block Layout — {placed.length} slab{placed.length !== 1 ? "s" : ""} planned</div>
            <div className="views-row">
              {/* Left: Isometric 3D View */}
              <div className="view-card">
                <IsoBlockStaticSVG
                  block={{ l: blk.l, w: blk.w, h: blk.h, stone: blk.stone }}
                  placed={placed}
                  az={Math.PI * 0.25}
                  size={300}
                  stoneTypes={stoneTypes ?? undefined}
                />
                <div className="view-lbl">Isometric View</div>
              </div>

              {/* Middle: 2D Top-Down Layout Plan */}
              {topDownSvg && (
                <div className="view-card">
                  <svg
                    viewBox={`0 0 ${topDownSvg.svgW.toFixed(1)} ${topDownSvg.svgH.toFixed(1)}`}
                    style={{ width: "100%", display: "block" }}
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    {/* Block outline */}
                    <rect
                      x={topDownSvg.PAD} y={topDownSvg.PAD}
                      width={blk.l * topDownSvg.sc} height={blk.w * topDownSvg.sc}
                      fill="none" stroke="#888" strokeWidth="1.5" strokeDasharray="4 2"
                    />
                    {/* Block dimension labels */}
                    <text x={topDownSvg.PAD + (blk.l * topDownSvg.sc) / 2} y={topDownSvg.PAD - 4}
                      textAnchor="middle" fill="#666" fontSize={8} fontFamily="ui-monospace,monospace">
                      {blk.l}&quot; L
                    </text>
                    <text x={topDownSvg.PAD - 4} y={topDownSvg.PAD + (blk.w * topDownSvg.sc) / 2}
                      textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize={8}
                      transform={`rotate(-90,${topDownSvg.PAD - 4},${topDownSvg.PAD + (blk.w * topDownSvg.sc) / 2})`}
                      fontFamily="ui-monospace,monospace">
                      {blk.w}&quot; W
                    </text>
                    {/* Placed slabs */}
                    {placed.map((s) => {
                      const col = slabColor(s.id);
                      const x = topDownSvg.PAD + s.px * topDownSvg.sc;
                      const y = topDownSvg.PAD + s.py * topDownSvg.sc;
                      const w = s.pw * topDownSvg.sc;
                      const h = s.ph * topDownSvg.sc;
                      const cx = x + w / 2;
                      const cy = y + h / 2;
                      const showId = Math.min(w, h) > 18;
                      return (
                        <g key={s.id}>
                          <rect x={x} y={y} width={w} height={h}
                            fill={col} fillOpacity={0.28}
                            stroke={col} strokeWidth="1.2"
                          />
                          {showId && (
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                              fill="#1a1a1a" fontSize={8} fontWeight={700} fontFamily="ui-monospace,monospace">
                              {s.id}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                  <div className="view-lbl">Top-Down Layout Plan (L × W)</div>
                </div>
              )}

            </div>
          </>
        )}

        {/* ── Layer-by-Layer Cutting Guide ── */}
        {blk && layers.length > 1 && (
          <>
            <div className="section-head">Layer-by-Layer Cutting Guide ({layers.length} layers — cut top to bottom)</div>
            <div style={{
              display: "grid",
              gridTemplateColumns: layers.length <= 2 ? "1fr 1fr" : layers.length <= 3 ? "1fr 1fr 1fr" : "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 4,
            }}>
              {layers.map((layer, li) => {
                const PAD = 8;
                const MAX_SIZE = layers.length <= 2 ? 320 : layers.length <= 3 ? 240 : 170;
                const sc = Math.min((MAX_SIZE - PAD * 2) / blk.l, (MAX_SIZE - PAD * 2) / blk.w, 5);
                const svgW = blk.l * sc + PAD * 2;
                const svgH = blk.w * sc + PAD * 2;
                return (
                  <div key={li} className="layer-card">
                    <div className="layer-lbl">Layer {li + 1}</div>
                    <svg viewBox={`0 0 ${svgW.toFixed(1)} ${svgH.toFixed(1)}`} style={{ width: "100%", display: "block" }} xmlns="http://www.w3.org/2000/svg">
                      {/* Block outline */}
                      <rect x={PAD} y={PAD} width={blk.l * sc} height={blk.w * sc}
                        fill="#f0f0f0" stroke="#aaa" strokeWidth="0.8" strokeDasharray="3 2" />
                      {/* All slabs: dim those not in this layer, highlight current layer */}
                      {placed.map((s) => {
                        const inLayer = layer.slabs.some(ls => ls.id === s.id);
                        const col = slabColor(s.id);
                        const x = PAD + s.px * sc;
                        const y = PAD + s.py * sc;
                        const w = s.pw * sc;
                        const h = s.ph * sc;
                        return (
                          <g key={s.id}>
                            <rect x={x} y={y} width={w} height={h}
                              fill={inLayer ? col : "#e0e0e0"}
                              fillOpacity={inLayer ? 0.55 : 0.25}
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
                    <div className="layer-depth">
                      depth {layer.zBot.toFixed(1)}″ – {layer.zTop.toFixed(1)}″
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Primary Slab Cutting Guide ── */}
        {blk && placed.length > 0 && (() => {
          const map2 = new Map<string, { zBot: number; zTop: number; slabs: PlacedSlab[] }>();
          for (const s of placed) {
            const zTop = s.zTop ?? blk.h;
            const zBot = s.zBot ?? 0;
            const key = `${zBot.toFixed(2)}_${zTop.toFixed(2)}`;
            if (!map2.has(key)) map2.set(key, { zBot, zTop, slabs: [] });
            map2.get(key)!.slabs.push(s);
          }
          const pLayers = [...map2.values()].sort((a, b) => b.zTop - a.zTop);
          const PL = 32; const PT = 22; const PR = 14; const PB = 12;
          const MAX_W = 700; const MAX_H = 480;
          const sc2 = Math.min(MAX_W / Math.max(blk.l, 1), MAX_H / Math.max(blk.w, 1), 14);
          const svgW2 = PL + blk.l * sc2 + PR;
          const svgH2 = PT + blk.w * sc2 + PB;
          return (
            <>
              <div className="section-head">
                Primary Slab Cutting Guide — {pLayers.length} {pLayers.length === 1 ? "slab" : "slabs"}
              </div>
              {pLayers.map((layer, li) => {
                const thickness = (layer.zTop - layer.zBot).toFixed(1);
                return (
                  <div key={li} className="prim-slab-block">
                    {/* Sub-heading per slab */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "ui-monospace, monospace" }}>
                          Primary Slab {li + 1}{pLayers.length > 1 ? ` of ${pLayers.length}` : ""}
                        </span>
                        <span style={{ fontSize: 12, color: "#666", marginLeft: 12, fontFamily: "ui-monospace, monospace" }}>
                          {blk.l}″ L × {blk.w}″ W × {thickness}″ thick
                        </span>
                        {pLayers.length > 1 && (
                          <span style={{ fontSize: 11, color: "#888", marginLeft: 10 }}>
                            depth {layer.zBot.toFixed(1)}″ – {layer.zTop.toFixed(1)}″
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {layer.slabs.map(s => (
                          <span key={s.id} className="prim-slab-chip"
                            style={{ background: slabColor(s.id) + "28", border: `1px solid ${slabColor(s.id)}55` }}>
                            {s.id}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Large 2D layout SVG */}
                    <div className="prim-slab-view-card">
                      <svg viewBox={`0 0 ${svgW2.toFixed(1)} ${svgH2.toFixed(1)}`} style={{ width: "100%", display: "block" }} xmlns="http://www.w3.org/2000/svg">
                        {/* Slab face */}
                        <rect x={PL} y={PT} width={blk.l * sc2} height={blk.w * sc2}
                          fill="#f5f5f0" stroke="#999" strokeWidth="1.2" strokeDasharray="5 3" />
                        {/* L dimension */}
                        <line x1={PL} y1={PT - 8} x2={PL + blk.l * sc2} y2={PT - 8} stroke="#bbb" strokeWidth="0.8" />
                        <line x1={PL} y1={PT - 12} x2={PL} y2={PT - 4} stroke="#bbb" strokeWidth="0.8" />
                        <line x1={PL + blk.l * sc2} y1={PT - 12} x2={PL + blk.l * sc2} y2={PT - 4} stroke="#bbb" strokeWidth="0.8" />
                        <text x={PL + (blk.l * sc2) / 2} y={PT - 10} textAnchor="middle" fill="#777" fontSize={9} fontFamily="ui-monospace,monospace">
                          {blk.l}&quot; L
                        </text>
                        {/* W dimension */}
                        <line x1={PL - 8} y1={PT} x2={PL - 8} y2={PT + blk.w * sc2} stroke="#bbb" strokeWidth="0.8" />
                        <line x1={PL - 12} y1={PT} x2={PL - 4} y2={PT} stroke="#bbb" strokeWidth="0.8" />
                        <line x1={PL - 12} y1={PT + blk.w * sc2} x2={PL - 4} y2={PT + blk.w * sc2} stroke="#bbb" strokeWidth="0.8" />
                        <text x={PL - 15} y={PT + (blk.w * sc2) / 2} textAnchor="middle" dominantBaseline="middle" fill="#777" fontSize={9}
                          fontFamily="ui-monospace,monospace"
                          transform={`rotate(-90,${PL - 15},${PT + (blk.w * sc2) / 2})`}>
                          {blk.w}&quot; W
                        </text>
                        {/* All slabs: bright = this layer, dimmed = other layers */}
                        {placed.map(s => {
                          const inLayer = layer.slabs.some(ls => ls.id === s.id);
                          const col = slabColor(s.id);
                          const x = PL + s.px * sc2;
                          const y = PT + s.py * sc2;
                          const w = s.pw * sc2;
                          const h = s.ph * sc2;
                          const cx = x + w / 2; const cy = y + h / 2;
                          const minDim = Math.min(w, h);
                          return (
                            <g key={s.id}>
                              <rect x={x} y={y} width={w} height={h}
                                fill={col} fillOpacity={inLayer ? 0.42 : 0.08}
                                stroke={col} strokeWidth={inLayer ? "1.5" : "0.5"}
                                strokeOpacity={inLayer ? 1 : 0.25} />
                              {inLayer && minDim > 18 && (
                                <text x={cx} y={minDim > 42 ? cy - 7 : cy} textAnchor="middle" dominantBaseline="middle"
                                  fill="#1a1a1a" fontSize={minDim > 38 ? 10 : 8} fontWeight={700} fontFamily="ui-monospace,monospace">
                                  {s.id}
                                </text>
                              )}
                              {inLayer && minDim > 42 && (
                                <text x={cx} y={cy + 6} textAnchor="middle" dominantBaseline="middle"
                                  fill="#333" fontSize={8} fontFamily="ui-monospace,monospace">
                                  {s.sw}×{s.sh}″
                                </text>
                              )}
                              {inLayer && minDim > 64 && s.temple && (
                                <text x={cx} y={cy + 16} textAnchor="middle" dominantBaseline="middle"
                                  fill="#666" fontSize={7} fontFamily="-apple-system,Arial,sans-serif">
                                  {s.temple}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </svg>
                      <div style={{ fontSize: 9, color: "#aaa", textAlign: "center", marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
                        Top-down view · Primary Slab {li + 1} face (L × W) · dimmed = other layers
                      </div>
                    </div>

                    {/* Required sizes table for this slab */}
                    <table className="slab-table" style={{ marginBottom: li < pLayers.length - 1 ? 0 : 4 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 24 }}>#</th>
                          <th>Slab ID</th>
                          <th>Temple</th>
                          <th>Label</th>
                          <th>W × H (in)</th>
                          <th>Thickness (in)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {layer.slabs.map((s, i) => {
                          const color = slabColor(s.id);
                          return (
                            <tr key={s.id}>
                              <td style={{ color: "#999" }}>{i + 1}</td>
                              <td>
                                <span className="color-dot" style={{ background: color }} />
                                <span className="slab-code">{s.id}</span>
                              </td>
                              <td>{s.temple ?? "—"}</td>
                              <td style={{ color: "#555" }}>{s.label ?? "—"}</td>
                              <td style={{ fontFamily: "ui-monospace, monospace" }}>{s.sw} × {s.sh}</td>
                              <td style={{ fontFamily: "ui-monospace, monospace" }}>{s.sd ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </>
          );
        })()}

        {/* ── Planned slabs table ── */}
        <div className="section-head">Slabs to Cut ({placed.length})</div>
        {placed.length === 0 ? (
          <p style={{ color: "#888", fontSize: 12 }}>No slabs planned.</p>
        ) : (
          <table className="slab-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th>Slab ID</th>
                <th>Temple</th>
                <th>Label</th>
                <th>W × H (in)</th>
                <th>Thickness (in)</th>
                <th>Position X, Y (in)</th>
                <th>Rotated</th>
                <th>Layer Depth (in)</th>
              </tr>
            </thead>
            <tbody>
              {placed.map((s, i) => {
                const color = slabColor(s.id);
                return (
                  <tr key={s.id}>
                    <td style={{ color: "#999" }}>{i + 1}</td>
                    <td>
                      <span className="color-dot" style={{ background: color }} />
                      <span className="slab-code">{s.id}</span>
                    </td>
                    <td>{s.temple ?? "—"}</td>
                    <td style={{ color: "#555" }}>{s.label ?? "—"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{s.sw} × {s.sh}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{s.sd ?? "—"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>
                      {s.px != null ? `${Number(s.px).toFixed(1)}, ${Number(s.py).toFixed(1)}` : "—"}
                    </td>
                    <td style={{ textAlign: "center" }}>{s.rot ? "↻" : "—"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace", color: "#888" }}>
                      {s.zBot != null && s.zTop != null
                        ? `${Number(s.zBot).toFixed(1)} – ${Number(s.zTop).toFixed(1)}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* ── MANUAL ENTRY SECTION (filled after cutting) ── */}
        <div className="manual-section">
          <div className="manual-title">✍ After Cutting — Fill in Manually &amp; Return to Office</div>
          <div className="manual-hint">Cutter fills this section. Office staff enters into system after receiving.</div>

          {/* Slab checklist */}
          {placed.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Slabs Actually Cut — tick each one completed:
              </div>
              <div className="slab-checklist">
                {placed.map((s) => (
                  <div className="slab-check-row" key={s.id}>
                    <span className="check-box" />
                    <span className="color-dot" style={{ background: slabColor(s.id) }} />
                    <span className="slab-code" style={{ fontSize: 12 }}>{s.id}</span>
                    <span style={{ fontSize: 11, color: "#888" }}>{s.sw}×{s.sh} in</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Waste / remainder block entries */}
          <div style={{ fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Remaining Block Pieces (leave blank if none / discarded):
          </div>
          <table className="waste-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Length (in)</th>
                <th>Width (in)</th>
                <th>Height (in)</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((n) => (
                <tr key={n}>
                  <td style={{ padding: "0 8px", color: "#999", textAlign: "center", verticalAlign: "middle" }}>{n}</td>
                  <td><span className="write-line" /></td>
                  <td><span className="write-line" /></td>
                  <td><span className="write-line" /></td>
                  <td><span className="write-line" /></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Sign-off row */}
          <div className="signoff-row">
            <div className="signoff-field">
              <div className="signoff-label">Cutting Operator</div>
              <div className="signoff-line" />
            </div>
            <div className="signoff-field">
              <div className="signoff-label">Date Completed</div>
              <div className="signoff-line" />
            </div>
            <div className="signoff-field">
              <div className="signoff-label">Checked By (Office)</div>
              <div className="signoff-line" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="doc-footer">
          <span>MTCPL · Cutting Plan · {block.block_id}</span>
          <span>{session?.session_code ?? ""}{plannerName ? ` · Plan by ${plannerName}` : ""}</span>
        </div>

      </div>
    </>
  );
}
