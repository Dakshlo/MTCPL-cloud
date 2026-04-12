"use client";

import { useState } from "react";

type Piece = { l: string; w: string; h: string };

export function RemainderPieces({ suggestedL = "", suggestedW = "", suggestedH = "" }: {
  suggestedL?: string;
  suggestedW?: string;
  suggestedH?: string;
}) {
  const [pieces, setPieces] = useState<Piece[]>([{ l: "0", w: "0", h: "0" }]);

  function update(i: number, field: keyof Piece, val: string) {
    setPieces(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  }

  function addPiece() {
    setPieces(prev => [...prev, { l: "0", w: "0", h: "0" }]);
  }

  function removePiece(i: number) {
    setPieces(prev => prev.filter((_, idx) => idx !== i));
  }

  const serialized = JSON.stringify(
    pieces.map(p => ({ l: Number(p.l) || 0, w: Number(p.w) || 0, h: Number(p.h) || 0 }))
  );

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Remaining block pieces</p>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Enter dimensions of each leftover piece that can be reused. Leave at 0 if no piece remains. Each piece gets its own block code (e.g. ORIG-R1, ORIG-R2).
      </p>

      <input type="hidden" name="remainder_pieces" value={serialized} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
        {pieces.map((piece, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--border-light)", borderRadius: 6 }}>
            <span className="muted" style={{ fontSize: 12, minWidth: 60, paddingBottom: 8 }}>Piece {i + 1}</span>
            <label className="stack" style={{ flex: "1 1 70px" }}>
              <span>Length (in)</span>
              <input
                type="number" min="0" step="any"
                value={piece.l}
                onChange={e => update(i, "l", e.target.value)}
                placeholder={i === 0 ? suggestedL : "0"}
              />
            </label>
            <label className="stack" style={{ flex: "1 1 70px" }}>
              <span>Width (in)</span>
              <input
                type="number" min="0" step="any"
                value={piece.w}
                onChange={e => update(i, "w", e.target.value)}
                placeholder={i === 0 ? suggestedW : "0"}
              />
            </label>
            <label className="stack" style={{ flex: "1 1 70px" }}>
              <span>Height (in)</span>
              <input
                type="number" min="0" step="any"
                value={piece.h}
                onChange={e => update(i, "h", e.target.value)}
                placeholder={i === 0 ? suggestedH : "0"}
              />
            </label>
            {pieces.length > 1 && (
              <button type="button" className="ghost-button" style={{ fontSize: 12, padding: "4px 10px", marginBottom: 2 }} onClick={() => removePiece(i)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <button type="button" className="ghost-button" style={{ fontSize: 12 }} onClick={addPiece}>
        + Add another piece
      </button>
    </div>
  );
}
