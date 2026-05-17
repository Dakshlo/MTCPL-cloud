"use client";

/**
 * Mig 063 follow-on (Daksh, May 2026) — clickable variant of the
 * CFT CUT KPI tile on the cutter cost report. Tap the tile → a
 * centred peek modal opens with every slab counted in the current
 * period (size code · from block · temple · stone · dimensions ·
 * CFT). Lets the user audit "where does this 2,588 CFT come from?".
 *
 * Pure presentation — the slab list is computed server-side in
 * buildCutterCostReport() and passed in via props. Closing on
 * Escape + outside click. No deps beyond React.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CutterContributingSlab } from "@/lib/cutter-cost-report";

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n) || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

export function CftPeekTile({
  totalCft,
  slabsCount,
  contributingSlabs,
  periodLabel,
}: {
  totalCft: number;
  slabsCount: number;
  contributingSlabs: CutterContributingSlab[];
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Click to view every slab counted in this period"
        style={{
          position: "relative",
          padding: "16px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          textAlign: "left",
          cursor: "pointer",
          width: "100%",
          transition: "transform 0.12s, box-shadow 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow =
            "0 4px 12px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: "#10b981",
          }}
        />
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>CFT Cut</span>
          <span style={{ fontSize: 10, color: "var(--gold-dark)", fontWeight: 700 }}>
            ⌕ View slabs
          </span>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em", marginTop: 4 }}>
          {fmtNum(totalCft)}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          {slabsCount} slab{slabsCount === 1 ? "" : "s"} counted
        </div>
      </button>

      {open && mounted &&
        createPortal(
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.55)",
              display: "grid",
              placeItems: "center",
              padding: "24px 16px",
              zIndex: 200,
              animation: "cftFade 0.15s",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: 14,
                width: "92%",
                maxWidth: 980,
                maxHeight: "85vh",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 24px 64px rgba(15,23,42,0.25)",
                animation: "cftScaleIn 0.15s ease-out",
              }}
            >
              <div
                style={{
                  padding: "18px 22px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Slabs counted · {periodLabel}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                    {slabsCount} slab{slabsCount === 1 ? "" : "s"} ·{" "}
                    <span style={{ fontFamily: "ui-monospace, monospace" }}>{fmtNum(totalCft)} CFT</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    Status post-cut · updated_at within the selected window
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    background: "#f1f5f9",
                    color: "#0f172a",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Esc · Close
                </button>
              </div>

              <div style={{ overflow: "auto", padding: "8px 0" }}>
                {contributingSlabs.length === 0 ? (
                  <div
                    style={{
                      padding: 48,
                      textAlign: "center",
                      color: "#64748b",
                      fontSize: 14,
                    }}
                  >
                    No slabs were cut in this period.
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
                        <th style={th()}>Size Code</th>
                        <th style={th()}>From Block</th>
                        <th style={th()}>Temple</th>
                        <th style={th()}>Label</th>
                        <th style={th()}>Stone</th>
                        <th style={{ ...th(), textAlign: "right" }}>Dimensions (in)</th>
                        <th style={{ ...th(), textAlign: "right" }}>CFT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contributingSlabs.map((s) => (
                        <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ ...td(), fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{s.id}</td>
                          <td style={{ ...td(), fontFamily: "ui-monospace, monospace", color: "#b45309" }}>
                            {s.sourceBlockId ?? "—"}
                          </td>
                          <td style={td()}>{s.temple ?? "—"}</td>
                          <td style={td()}>{s.label ?? "—"}</td>
                          <td style={{ ...td(), color: "#64748b" }}>{s.stone ?? "—"}</td>
                          <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                            {fmtNum(s.lengthIn, 0)}{"× "}
                            {fmtNum(s.widthIn, 0)}{"× "}
                            {fmtNum(s.thicknessIn, 0)}
                          </td>
                          <td style={{ ...td(), textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                            {fmtNum(s.cft, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#fffbeb", borderTop: "2px solid #d97706" }}>
                        <td style={{ ...td(), fontWeight: 800 }} colSpan={6}>
                          Total
                        </td>
                        <td
                          style={{
                            ...td(),
                            textAlign: "right",
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 800,
                            fontSize: 14,
                          }}
                        >
                          {fmtNum(totalCft, 2)} CFT
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>

            <style>{`
              @keyframes cftFade { from { opacity: 0 } to { opacity: 1 } }
              @keyframes cftScaleIn {
                from { opacity: 0; transform: scale(0.96) }
                to   { opacity: 1; transform: scale(1) }
              }
            `}</style>
          </div>,
          document.body,
        )}
    </>
  );
}

function th(): React.CSSProperties {
  return {
    padding: "10px 14px",
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    textAlign: "left",
  };
}

function td(): React.CSSProperties {
  return {
    padding: "8px 14px",
    fontSize: 12,
    color: "#0f172a",
  };
}
