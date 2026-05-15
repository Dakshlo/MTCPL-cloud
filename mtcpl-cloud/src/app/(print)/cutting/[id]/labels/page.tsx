/**
 * Cutting "Labels" print sheet — generated AFTER cutting is done.
 *
 * Audience: the cutter / shop floor operator. They take this print
 * to the pile of cut slabs and write the slab IDs (in the system)
 * onto each physical slab. Without this, manual slabs and even
 * planned slabs can lose their identity once they leave the saw.
 *
 * Includes EVERY slab attributed to this block — plan slabs that
 * were marked cut, extras pulled from open inventory, transfers
 * claimed from another block's plan, and any manual slabs the
 * office team adds later (those get source_block_id set when they
 * link the manual slab to the block).
 *
 * Layout: large slab id, dimensions, temple/label, stock location,
 * a generous write-area where the operator confirms with a tick.
 */

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { yardLabel } from "@/lib/yards";
import { PrintBtn } from "../print/print-btn";

type Params = Promise<{ id: string }>;

type SlabRow = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_ft: number | string;
  width_ft: number | string;
  thickness_ft: number | string;
  status: string;
  stock_location?: string | null;
  priority: boolean;
};

export default async function CuttingLabelsPrintPage({ params }: { params: Params }) {
  await requireAuth(["owner", "team_head", "cutting_operator", "developer"]);
  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  // Find the cut session block. We need block_id to query all slabs
  // attributed to that physical block.
  const { data: csb, error } = await supabase
    .from("cut_session_blocks")
    .select("id, status, block_id, cut_session_id, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !csb) notFound();
  const sessionBlock = csb as {
    id: string;
    status: string;
    block_id: string;
    cut_session_id: string;
    updated_at: string;
  };

  // Pull session info + parent block info + every slab tied to this block.
  const [{ data: session }, { data: parentBlock }, { data: slabs }] = await Promise.all([
    supabase
      .from("cut_sessions")
      .select("session_code, kerf_mm")
      .eq("id", sessionBlock.cut_session_id)
      .maybeSingle(),
    supabase
      .from("blocks")
      .select("id, stone, yard, length_ft, width_ft, height_ft, quality")
      .eq("id", sessionBlock.block_id)
      .maybeSingle(),
    // Every slab whose source_block_id is this block — covers plan
    // cuts, extras, transfers, AND manual slabs added later by office
    // staff. We deliberately do NOT filter by status; cut_done is the
    // common case but slabs may already be in carving / completed /
    // dispatched if this print is being run later.
    supabase
      .from("slab_requirements")
      .select(
        "id, label, temple, stone, length_ft, width_ft, thickness_ft, status, stock_location, priority",
      )
      .eq("source_block_id", sessionBlock.block_id)
      .order("temple")
      .order("id"),
  ]);

  const slabRows = (slabs ?? []) as SlabRow[];
  const printedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Group by temple for a tidy print
  const byTemple = new Map<string, SlabRow[]>();
  for (const s of slabRows) {
    const t = s.temple || "(no temple)";
    if (!byTemple.has(t)) byTemple.set(t, []);
    byTemple.get(t)!.push(s);
  }
  const templeGroups = [...byTemple.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Tally the unique stock locations so we can show them in the
  // header. If everything was stocked in the same place we get a
  // single label; otherwise the per-row column carries the detail.
  const distinctLocations = [
    ...new Set(slabRows.map((s) => s.stock_location).filter(Boolean) as string[]),
  ];

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          color: #1a1a1a;
          background: #f0f0f0;
        }

        .print-wrap {
          max-width: 900px;
          margin: 0 auto;
          background: #fff;
          padding: 28px 32px 36px;
        }

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
          font-family: ui-monospace, monospace;
          margin-bottom: 4px;
        }
        .doc-sub { font-size: 13px; color: #555; }
        .doc-date { font-size: 11px; color: #888; text-align: right; line-height: 1.6; }

        .meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px 20px;
          padding: 10px 0 12px;
          border-bottom: 2px solid #1a1a1a;
          margin-bottom: 18px;
        }
        .meta-cell { display: flex; flex-direction: column; gap: 2px; }
        .meta-label {
          font-size: 9px;
          font-weight: 700;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .meta-val { font-size: 14px; font-weight: 600; color: #1a1a1a; }
        .meta-val.mono { font-family: ui-monospace, monospace; }

        .temple-block { page-break-inside: avoid; margin-bottom: 18px; }
        .temple-head {
          font-size: 13px;
          font-weight: 700;
          color: #555;
          background: #f5f5f0;
          padding: 6px 10px;
          border-left: 4px solid #b87333;
          margin-bottom: 6px;
          letter-spacing: 0.02em;
        }

        .label-row {
          display: grid;
          grid-template-columns: 36px 22px 1.2fr 1fr 0.9fr 1.1fr 30px;
          gap: 0;
          align-items: stretch;
          border: 1.5px solid #1a1a1a;
          margin-bottom: -1.5px;
          background: #fff;
          page-break-inside: avoid;
        }
        .label-row > div {
          padding: 8px 10px;
          border-right: 1px solid #ccc;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .label-row > div:last-child { border-right: none; }

        .label-row.head {
          background: #1a1a1a;
          color: #fff;
        }
        .label-row.head > div {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.85);
          padding: 7px 10px;
        }
        .label-row.head > div { border-right: 1px solid rgba(255,255,255,0.15); }

        .label-row .num { text-align: center; font-family: ui-monospace, monospace; color: #888; font-weight: 700; }
        .label-row .tick {
          width: 22px; height: 22px; border: 1.5px solid #555; border-radius: 4px;
          align-self: center; margin: 0 auto;
        }
        .label-row .id {
          font-family: ui-monospace, monospace;
          font-weight: 800;
          font-size: 14px;
          color: #1a1a1a;
        }
        .label-row .lbl { font-size: 11px; color: #666; }
        .label-row .dims { font-family: ui-monospace, monospace; font-weight: 700; font-size: 13px; }
        .label-row .stone { font-size: 11px; color: #666; }
        .label-row .loc {
          font-size: 12px;
          font-weight: 700;
          color: #15803d;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .label-row .priority-tag {
          font-size: 9px;
          font-weight: 800;
          padding: 1px 6px;
          background: #dc2626;
          color: #fff;
          border-radius: 999px;
          width: fit-content;
          margin-top: 3px;
          letter-spacing: 0.05em;
        }
        .label-row .status-tag {
          font-size: 9px;
          font-weight: 700;
          color: #888;
          font-family: ui-monospace, monospace;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-top: 3px;
        }

        .signoff-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 22px;
          margin-top: 22px;
          padding-top: 12px;
          border-top: 1px solid #ccc;
        }
        .signoff-cell { display: flex; flex-direction: column; gap: 6px; }
        .signoff-label { font-size: 10px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .signoff-line { border-bottom: 1.5px solid #888; height: 32px; width: 100%; }

        .doc-footer {
          margin-top: 22px;
          padding-top: 8px;
          border-top: 1px solid #ddd;
          font-size: 10px;
          color: #aaa;
          display: flex;
          justify-content: space-between;
        }

        .empty-state {
          padding: 32px 20px;
          text-align: center;
          color: #999;
          font-size: 13px;
          border: 1px dashed #ccc;
          border-radius: 8px;
        }

        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 8mm 10mm; margin: 0; }
          @page { margin: 8mm; size: A4 portrait; }
        }
        @media screen {
          body { padding: 0; }
        }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">
          Slab Labels — {sessionBlock.block_id} · {session?.session_code ?? ""}
        </span>
        <PrintBtn />
      </div>

      <div className="print-wrap">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="doc-eyebrow">MTCPL · Slab Labels (post-cut)</div>
            <div className="doc-title">{sessionBlock.block_id}</div>
            <div className="doc-sub">
              {slabRows.length} slab{slabRows.length !== 1 ? "s" : ""} attributed to this block ·
              cutter writes each ID on the physical slab
            </div>
          </div>
          <div className="doc-date">
            <div>Printed: {printedAt}</div>
            {session?.session_code && <div>Session: {session.session_code}</div>}
          </div>
        </div>

        {/* Meta — block summary */}
        <div className="meta-row">
          <div className="meta-cell">
            <div className="meta-label">Block</div>
            <div className="meta-val mono">{sessionBlock.block_id}</div>
          </div>
          {parentBlock && (
            <>
              <div className="meta-cell">
                <div className="meta-label">Stone</div>
                <div className="meta-val">{(parentBlock as { stone: string }).stone}</div>
              </div>
              <div className="meta-cell">
                <div className="meta-label">Yard</div>
                <div className="meta-val">{yardLabel((parentBlock as { yard: number }).yard)}</div>
              </div>
              {(parentBlock as { quality: string | null }).quality && (
                <div className="meta-cell">
                  <div className="meta-label">Grade</div>
                  <div className="meta-val">{(parentBlock as { quality: string }).quality}</div>
                </div>
              )}
            </>
          )}
          {distinctLocations.length === 1 && (
            <div className="meta-cell">
              <div className="meta-label">Stock location</div>
              <div className="meta-val" style={{ color: "#15803d" }}>
                📍 {distinctLocations[0]}
              </div>
            </div>
          )}
          {distinctLocations.length > 1 && (
            <div className="meta-cell">
              <div className="meta-label">Stock locations</div>
              <div className="meta-val" style={{ color: "#15803d" }}>
                {distinctLocations.length} different — see rows
              </div>
            </div>
          )}
        </div>

        {/* Slab labels grouped by temple */}
        {slabRows.length === 0 ? (
          <div className="empty-state">
            No slabs found for this block yet.
            <br />
            If you cut manual slabs, ask the office team to add them in the
            system first — then come back to print this sheet.
          </div>
        ) : (
          templeGroups.map(([temple, items]) => (
            <div key={temple} className="temple-block">
              <div className="temple-head">
                🏛 {temple} · {items.length} slab{items.length !== 1 ? "s" : ""}
              </div>
              <div className="label-row head">
                <div>#</div>
                <div>✓</div>
                <div>Slab ID</div>
                <div>W × H × T</div>
                <div>Stone</div>
                <div>Stock location</div>
                <div></div>
              </div>
              {items.map((s, i) => {
                const L = Number(s.length_ft);
                const W = Number(s.width_ft);
                const T = Number(s.thickness_ft);
                return (
                  <div key={s.id} className="label-row">
                    <div className="num">{i + 1}</div>
                    <div>
                      <span className="tick" />
                    </div>
                    <div>
                      <span className="id">{s.id}</span>
                      {s.label && <span className="lbl">{s.label}</span>}
                      {s.priority && <span className="priority-tag">⚡ PRIORITY</span>}
                      {s.status && s.status !== "cut_done" && (
                        <span className="status-tag">{s.status.replace(/_/g, " ")}</span>
                      )}
                    </div>
                    <div>
                      <span className="dims">{L}×{W}×{T}″</span>
                    </div>
                    <div>
                      <span className="stone">{s.stone ?? "—"}</span>
                    </div>
                    <div>
                      <span className="loc">📍 {s.stock_location ?? "—"}</span>
                    </div>
                    <div></div>
                  </div>
                );
              })}
            </div>
          ))
        )}

        {/* Sign-off */}
        <div className="signoff-row">
          <div className="signoff-cell">
            <div className="signoff-label">Cutter</div>
            <div className="signoff-line" />
          </div>
          <div className="signoff-cell">
            <div className="signoff-label">Date written on slabs</div>
            <div className="signoff-line" />
          </div>
          <div className="signoff-cell">
            <div className="signoff-label">Office check</div>
            <div className="signoff-line" />
          </div>
        </div>

        <div className="doc-footer">
          <span>MTCPL · Slab labels · {sessionBlock.block_id}</span>
          <span>{slabRows.length} rows</span>
        </div>
      </div>
    </>
  );
}
