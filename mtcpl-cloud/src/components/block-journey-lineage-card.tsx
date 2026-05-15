"use client";

/**
 * A single lineage row on the Block Journey page. Collapsed view shows
 * the root block's headline + a three-colour utilisation bar; expanded
 * view walks the tree gold-rail style (similar to TimelineCard but
 * data-shape-specific).
 *
 * The header numbers flip based on `mode`:
 *   - "yield"     → headline = slabPct, secondary = livePct + wastePct
 *   - "recovered" → headline = recoveredPct, secondary = wastePct
 */

import Link from "next/link";
import { useState } from "react";
import { yardLabel } from "@/lib/yards";
import { cftEquivFromTonnes } from "@/lib/stone-categories";
import type { Lineage, LineageNode } from "@/app/(app)/block-journey/build-lineages";

export type ViewMode = "yield" | "recovered";

export function LineageCard({
  lineage,
  mode,
  createdByName,
}: {
  lineage: Lineage;
  mode: ViewMode;
  createdByName: string | null;
}) {
  // Marble lineages have a completely different headline shape —
  // render a dedicated component.
  if (lineage.category === "marble") {
    return <MarbleLineageCard lineage={lineage} createdByName={createdByName} />;
  }
  return <SandstoneLineageCard lineage={lineage} mode={mode} createdByName={createdByName} />;
}

function SandstoneLineageCard({
  lineage,
  mode,
  createdByName,
}: {
  lineage: import("@/app/(app)/block-journey/build-lineages").SandstoneLineage;
  mode: ViewMode;
  createdByName: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const l = lineage;
  const isResolved = l.isResolved;

  return (
    <div
      style={{
        background: expanded ? "var(--surface-alt)" : "var(--surface)",
        border: `1px solid ${isResolved ? "var(--border)" : "rgba(180,83,9,0.3)"}`,
        borderLeft: expanded ? `4px solid var(--gold-dark)` : `1px solid ${isResolved ? "var(--border)" : "rgba(180,83,9,0.3)"}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: expanded ? 18 : 10,
        boxShadow: expanded ? "0 4px 14px rgba(0,0,0,0.06)" : "none",
        transition: "background 0.12s, margin 0.12s, box-shadow 0.12s",
      }}
    >
      {/* Header row — block id, stone/yard, resolution badge, expand toggle */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Link
              href={`/blocks/report?block=${encodeURIComponent(l.rootId)}`}
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text)",
                textDecoration: "none",
              }}
            >
              {l.rootId}
            </Link>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {l.rootStone ?? "—"} · {yardLabel(l.rootYard)}
              {l.rootQuality ? ` · Grade ${l.rootQuality}` : ""}
            </span>
            {isResolved ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#15803d",
                  background: "rgba(22,101,52,0.12)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  letterSpacing: "0.04em",
                }}
              >
                ✓ RESOLVED
              </span>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#b45309",
                  background: "rgba(180,83,9,0.12)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  letterSpacing: "0.04em",
                }}
              >
                ⏱ IN PROGRESS
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            Original <strong style={{ color: "var(--text)" }}>{l.originalCft.toFixed(2)} CFT</strong>
            {l.rootCreatedAt && (
              <> · Added {new Date(l.rootCreatedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</>
            )}
            {createdByName && (
              <> by <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>{createdByName}</span></>
            )}
            {l.tree.cutAt && (
              <>
                {" · "}
                <span style={{ color: "#15803d", fontWeight: 600 }}>
                  ✓ Cut {new Date(l.tree.cutAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                </span>
              </>
            )}
            {" · "}{l.cutCount} cut{l.cutCount !== 1 ? "s" : ""}
            {l.descendantCount > 0 ? ` · ${l.descendantCount} remainder piece${l.descendantCount !== 1 ? "s" : ""}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            fontSize: 12,
            padding: "5px 12px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {expanded ? "Collapse ▴" : "Expand ▾"}
        </button>
      </div>

      {/* Metric row — flips between modes */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 12,
          fontFamily: "ui-monospace, monospace",
          flexWrap: "wrap",
        }}
      >
        {mode === "yield" ? (
          <>
            <span>
              Yield <strong style={{ color: "#15803d", fontSize: 14 }}>{l.slabPct}%</strong>
              <span style={{ color: "var(--muted)", marginLeft: 4 }}>({l.slabCft.toFixed(2)} CFT)</span>
            </span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span>
              Still pending <strong style={{ color: "#b45309" }}>{l.livePct}%</strong>
              <span style={{ color: "var(--muted)", marginLeft: 4 }}>({l.liveCft.toFixed(2)} CFT)</span>
            </span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span>
              Waste <strong style={{ color: "#b91c1c" }}>{l.wastePct}%</strong>
              <span style={{ color: "var(--muted)", marginLeft: 4 }}>({l.wasteCft.toFixed(2)} CFT)</span>
            </span>
          </>
        ) : (
          <>
            <span>
              Recovered <strong style={{ color: "#b45309", fontSize: 14 }}>{l.recoveredPct}%</strong>
              <span style={{ color: "var(--muted)", marginLeft: 4 }}>({(l.slabCft + l.liveCft).toFixed(2)} CFT)</span>
            </span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span>
              Real waste <strong style={{ color: "#b91c1c" }}>{l.wastePct}%</strong>
              <span style={{ color: "var(--muted)", marginLeft: 4 }}>({l.wasteCft.toFixed(2)} CFT)</span>
            </span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span style={{ color: "var(--muted)" }}>
              (of which slabs <strong style={{ color: "#15803d" }}>{l.slabPct}%</strong>, live <strong style={{ color: "#b45309" }}>{l.livePct}%</strong>)
            </span>
          </>
        )}
      </div>

      {/* Utilisation bar — 3-colour stacked */}
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            display: "flex",
            height: 10,
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ width: `${l.slabPct}%`, background: "#15803d" }} title={`Slabs ${l.slabPct}%`} />
          <div style={{ width: `${l.livePct}%`, background: "#b45309" }} title={`Live ${l.livePct}%`} />
          <div style={{ width: `${l.wastePct}%`, background: "#b91c1c" }} title={`Waste ${l.wastePct}%`} />
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 8,
          }}>
            Journey — {l.cutCount} cut{l.cutCount !== 1 ? "s" : ""}, {l.descendantCount} descendant{l.descendantCount !== 1 ? "s" : ""}
          </div>
          <TreeView node={l.tree} depth={0} />
        </div>
      )}
    </div>
  );
}

// ─── Tree renderer ───────────────────────────────────────────────────────

function TreeView({ node, depth }: { node: LineageNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 16, position: "relative" }}>
      {depth > 0 && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: -12,
            top: 0,
            bottom: "50%",
            width: 2,
            background: "var(--border)",
          }}
        />
      )}
      <div style={{ padding: "6px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Link
            href={`/blocks/report?block=${encodeURIComponent(node.id)}`}
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              fontWeight: 700,
              color: node.isRoot ? "var(--gold-dark)" : "var(--text)",
              textDecoration: "none",
            }}
          >
            {node.isRoot ? "🌱" : "↳"} {node.id}
          </Link>
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
            {node.l}×{node.w}×{node.h}″ ({node.cft.toFixed(2)} CFT)
          </span>
          <StatusPill status={node.status} wasCut={node.wasCut} />
          {node.createdAt && (
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              · {node.isRoot ? "added" : "created"} {new Date(node.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}
            </span>
          )}
        </div>

        {node.slabsFromThis.length > 0 && (
          <div style={{ marginTop: 6, marginLeft: 14 }}>
            <div style={{
              fontSize: 11,
              color: "var(--muted)",
              marginBottom: 4,
            }}>
              → <strong style={{ color: "#15803d" }}>{node.slabCftFromThis.toFixed(2)} CFT</strong> in {node.slabsFromThis.length} slab{node.slabsFromThis.length !== 1 ? "s" : ""}
            </div>
            {/* Slab list as a compact table — easier to scan than
                comma-separated text, and we show ALL slabs (no
                "+N more" truncation) so the operator never has to
                wonder which ones got hidden. */}
            <div style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
              background: "var(--bg)",
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "var(--surface-alt)" }}>
                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>#</th>
                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>Slab ID</th>
                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>Source</th>
                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>Dim (in)</th>
                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>Temple</th>
                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>Label</th>
                    <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>CFT</th>
                  </tr>
                </thead>
                <tbody>
                  {node.slabsFromThis.map((s, i) => (
                    <tr key={s.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-light)" }}>
                      <td style={{ padding: "5px 8px", color: "var(--muted)", fontFamily: "ui-monospace, monospace", width: 28 }}>{i + 1}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "ui-monospace, monospace", fontWeight: 600, color: "var(--text)" }}>{s.id}</td>
                      <td style={{ padding: "5px 8px" }}>
                        <ProvenancePill kind={s.provenance} />
                      </td>
                      <td style={{ padding: "5px 8px", fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>
                        {s.l && s.w ? `${formatDim(s.l)}×${formatDim(s.w)}${s.t ? `×${formatDim(s.t)}` : ""}` : "—"}
                      </td>
                      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{s.temple ?? "—"}</td>
                      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{s.label ?? "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#15803d", fontWeight: 600 }}>{s.cft.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {node.wasCut && node.slabsFromThis.length === 0 && (
          <div style={{ marginTop: 4, marginLeft: 14, fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
            → cut recorded but no slabs linked
          </div>
        )}
      </div>

      {/* Visual divider when entering descendants — only at the top
          level. Makes the "block had remainders that became reused
          blocks" relationship obvious without forcing the operator
          to count tree-indents. */}
      {depth === 0 && node.children.length > 0 && (
        <div style={{
          marginTop: 12,
          marginBottom: 4,
          paddingTop: 10,
          borderTop: "1px dashed var(--border)",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}>
          ↳ {node.children.length} remainder piece{node.children.length === 1 ? "" : "s"} · cut from above
        </div>
      )}

      {node.children.map((child) => (
        <TreeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function StatusPill({ status, wasCut }: { status: string; wasCut: boolean }) {
  const label = statusLabel(status, wasCut);
  const { bg, fg } = statusColors(status);
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: fg,
        background: bg,
        padding: "1px 7px",
        borderRadius: 3,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {label}
    </span>
  );
}

/** Compact pill that calls out where a slab in the lineage card
 *  came from: was it part of the original plan, a Fit-to-Fill
 *  filler at planning time, or an unplanned addition / transfer
 *  during cutting-done? Helps the team eyeball "this block
 *  picked up 3 extras at cutting time" at a glance. */
function ProvenancePill({ kind }: { kind: "planned" | "filler" | "extra" | "transferred" }) {
  if (kind === "planned") {
    return (
      <span title="In the original cut plan" style={{
        fontSize: 9, fontWeight: 700, padding: "1px 6px",
        borderRadius: 3, color: "#15803d",
        background: "rgba(22,101,52,0.10)",
        border: "1px solid rgba(22,101,52,0.25)",
        letterSpacing: "0.04em",
      }}>PLAN</span>
    );
  }
  if (kind === "filler") {
    return (
      <span title="Cut-ahead inventory — added via Fit-to-Fill at planning time" style={{
        fontSize: 9, fontWeight: 700, padding: "1px 6px",
        borderRadius: 3, color: "#fff",
        background: "#7c3aed",
        letterSpacing: "0.04em",
      }}>FILLER</span>
    );
  }
  if (kind === "transferred") {
    return (
      <span title="Claimed from another block's plan during Cutting Done — that block had to reprint" style={{
        fontSize: 9, fontWeight: 700, padding: "1px 6px",
        borderRadius: 3, color: "#fff",
        background: "#7c3aed",
        border: "1px solid #6d28d9",
        letterSpacing: "0.04em",
      }}>TRANSFER</span>
    );
  }
  return (
    <span title="Added during Cutting Done from open inventory — was not in the original plan" style={{
      fontSize: 9, fontWeight: 700, padding: "1px 6px",
      borderRadius: 3, color: "#b45309",
      background: "rgba(180,83,9,0.10)",
      border: "1px solid rgba(180,83,9,0.30)",
      letterSpacing: "0.04em",
    }}>EXTRA</span>
  );
}

/** Render a dimension number compactly: integers stay as-is,
 *  fractional values get one decimal. Drops trailing ".0". */
function formatDim(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function statusLabel(status: string, wasCut: boolean): string {
  if (status === "consumed") return wasCut ? "Cut" : "Consumed";
  if (status === "available") return "Available";
  if (status === "reserved") return "Reserved";
  if (status === "cutting") return "Cutting";
  if (status === "discarded") return "Discarded";
  return status;
}

function statusColors(status: string): { bg: string; fg: string } {
  if (status === "available") return { bg: "rgba(22,101,52,0.12)", fg: "#15803d" };
  if (status === "reserved" || status === "cutting") return { bg: "rgba(180,83,9,0.12)", fg: "#b45309" };
  if (status === "discarded") return { bg: "rgba(185,28,28,0.12)", fg: "#b91c1c" };
  // consumed
  return { bg: "rgba(255,255,255,0.06)", fg: "var(--muted)" };
}

// ─── Marble lineage card ─────────────────────────────────────────────────
// Simpler than sandstone — no descendant tree, no restock logic, single
// headline metric (CFT per tonne).

function MarbleLineageCard({
  lineage,
  createdByName,
}: {
  lineage: import("@/app/(app)/block-journey/build-lineages").MarbleLineage;
  createdByName: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const l = lineage;
  const isResolved = l.isResolved;
  const cftEquiv = cftEquivFromTonnes(l.tonnes);

  return (
    <div
      style={{
        background: expanded ? "var(--surface-alt)" : "var(--surface)",
        border: `1px solid ${isResolved ? "var(--border)" : "rgba(180,83,9,0.3)"}`,
        borderLeft: expanded ? `4px solid var(--gold-dark)` : `1px solid ${isResolved ? "var(--border)" : "rgba(180,83,9,0.3)"}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: expanded ? 18 : 10,
        boxShadow: expanded ? "0 4px 14px rgba(0,0,0,0.06)" : "none",
        transition: "background 0.12s, margin 0.12s, box-shadow 0.12s",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Link
              href={`/blocks/report?block=${encodeURIComponent(l.rootId)}`}
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text)",
                textDecoration: "none",
              }}
            >
              {l.rootId}
            </Link>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {l.rootStone ?? "—"} · {yardLabel(l.rootYard)}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#b45309",
                background: "rgba(180,83,9,0.12)",
                padding: "2px 8px",
                borderRadius: 4,
                letterSpacing: "0.04em",
              }}
            >
              🗿 MARBLE
            </span>
            {isResolved ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#15803d",
                  background: "rgba(22,101,52,0.12)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  letterSpacing: "0.04em",
                }}
              >
                ✓ CUT
              </span>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--muted)",
                  background: "rgba(255,255,255,0.06)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  letterSpacing: "0.04em",
                }}
              >
                ⏱ IN YARD
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>
              {l.tonnes.toFixed(3)} T
            </strong>{" "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              (≈ {cftEquiv.toFixed(2)} CFT equiv · 8 CFT/tonne)
            </span>
            {l.rootCreatedAt && (
              <>
                {" · "}Added {new Date(l.rootCreatedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
              </>
            )}
            {createdByName && (
              <>
                {" "}by <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>{createdByName}</span>
              </>
            )}
            {l.tree.cutAt && (
              <>
                {" · "}
                <span style={{ color: "#15803d", fontWeight: 600 }}>
                  ✓ Cut {new Date(l.tree.cutAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                </span>
              </>
            )}
            {l.truckNo && (
              <>
                {" · "}
                <span style={{ color: "#b45309", fontWeight: 600 }}>🚚 {l.truckNo}</span>
              </>
            )}
            {l.vendorName && (
              <>
                {" · "}
                <span>{l.vendorName}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            fontSize: 12,
            padding: "5px 12px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {expanded ? "Collapse ▴" : "Expand ▾"}
        </button>
      </div>

      {/* Metrics row */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 12,
          fontFamily: "ui-monospace, monospace",
          flexWrap: "wrap",
        }}
      >
        <span>
          Slab yield{" "}
          <strong style={{ color: "#15803d", fontSize: 14 }}>{l.slabCft.toFixed(2)} CFT</strong>
          <span style={{ color: "var(--muted)", marginLeft: 4 }}>from {l.tonnes.toFixed(3)} T</span>
        </span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span>
          <strong style={{ color: "#b45309", fontSize: 14 }}>{l.cftPerTonne.toFixed(2)} CFT</strong> per tonne
        </span>
      </div>

      {/* Progress bar — green proportion = slab yield % vs CFT equiv */}
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            display: "flex",
            height: 10,
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              width: `${cftEquiv > 0 ? Math.min(100, (l.slabCft / cftEquiv) * 100) : 0}%`,
              background: "#15803d",
            }}
            title={`Slab CFT (${l.slabCft.toFixed(2)}) vs CFT equiv (${cftEquiv.toFixed(2)})`}
          />
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 8,
          }}>
            Journey — {l.cutCount} cut{l.cutCount !== 1 ? "s" : ""}
            {l.truckEntryId && ", part of truck entry"}
          </div>
          <TreeView node={l.tree} depth={0} />
          {l.truckTotalTonnes != null && l.truckEntryId && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "rgba(180,83,9,0.06)",
                border: "1px solid rgba(180,83,9,0.2)",
                borderRadius: 6,
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              🚚 This block came from a <strong>{l.truckTotalTonnes.toFixed(3)} T</strong> truck
              {l.truckNo ? ` (${l.truckNo})` : ""}
              {l.vendorName ? ` delivered by ${l.vendorName}` : ""}. Other blocks from the same
              truck may have different yields — use the "Group by Truck" view to see the truck-wide average.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
