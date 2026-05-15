"use client";

// ──────────────────────────────────────────────────────────────────
// Topbar consolidated tasks / approvals dropdown
// ──────────────────────────────────────────────────────────────────
// Daksh: the four separate pills (Cutting Audit / Crosscheck / Pay
// Today / Inventory Audit) cluttered the top bar. Consolidates into
// one pill that shows the total pending count, with a hover-expand
// glass dropdown listing each queue + its individual count + a link.
//
// Visibility is fully driven by the items the parent (app layout)
// passes in. Each item maps 1:1 to a permission helper:
//   canApproveCuts                  → Cutting Audit
//   canApproveBills                 → Crosscheck (bill verification)
//   canConfirmPayments              → Pay Today
//   canApproveInventoryMovements    → Inventory Audit
//
// Layout decides which items to include based on those helpers, so
// the role rules Daksh described (Mafat sees Crosscheck + Cutting
// Audit + Inventory Audit, Parth sees only Cutting Audit, etc.)
// fall out automatically without any extra logic here.
//
// If the items array is empty, the whole pill is hidden — slab-entry
// / dispatch / etc. roles never see anything.
//
// Interaction:
//   • Desktop: hover the pill (or the dropdown panel) keeps it open.
//     A short close-delay on mouseleave lets the user travel from
//     the pill down into the panel without losing it.
//   • Touch / keyboard: click toggles. Outside-click closes.
//   • The dropdown row links navigate normally; the global
//     NavigationProgress bar already handles the loading cursor.
//
// Visual: Apple-style frosted glass (backdrop-filter blur +
// saturate, semi-transparent white background, subtle inner ring,
// soft shadow). Fits the gold-on-cream MTCPL theme without
// committing a heavy panel.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type TopbarTaskDepartment = "production" | "finance" | "inventory";

export type TopbarTask = {
  id: string;
  /** Where the link lands when the user clicks the row. */
  href: string;
  /** Short title (e.g. "Cutting Audit"). */
  label: string;
  /** One-line description shown below the label. */
  description: string;
  /** Pending count for this queue. */
  count: number;
  /** Small leading emoji / glyph. */
  icon: string;
  /** Which department this queue belongs to. Used by the dropdown
   *  to group rows by department + colour-tag each section. */
  department: TopbarTaskDepartment;
};

// Department accent colours used by the dropdown headers + the
// item-icon backgrounds. Same palette as the sidebar's department
// switcher so the visual language is consistent across the app.
const DEPT_META: Record<
  TopbarTaskDepartment,
  { label: string; color: string }
> = {
  production: { label: "Production", color: "#c9a14a" },
  finance:    { label: "Finance",    color: "#5e8c4e" },
  inventory:  { label: "Inventory",  color: "#c87850" },
};

export function TopbarTasksBadge({ items }: { items: TopbarTask[] }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Outside-click handler — covers touch + keyboard users where
  // hover semantics don't apply. Set up only while the dropdown is
  // open to avoid a permanent listener.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      if (e.target instanceof Node && wrapper.contains(e.target)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Tidy any pending close timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (items.length === 0) return null;

  const total = items.reduce((s, it) => s + it.count, 0);
  const hasPending = total > 0;

  // Group items by department in render order: Production → Finance
  // → Inventory. Sections that have no items for this user (e.g.
  // an accountant doesn't get a Production row) are skipped.
  const grouped: Array<{
    dept: TopbarTaskDepartment;
    items: TopbarTask[];
  }> = [];
  const order: TopbarTaskDepartment[] = ["production", "finance", "inventory"];
  for (const dept of order) {
    const deptItems = items.filter((it) => it.department === dept);
    if (deptItems.length > 0) grouped.push({ dept, items: deptItems });
  }

  function openNow() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  // Daksh (May 2026 follow-on): bring back the hover-out auto-close.
  // 180ms grace so a quick cursor slip from the pill to the panel
  // doesn't lose the dropdown. The Tasks pill has no input to pin
  // open — so close behaviour is purely "leave to close, click row /
  // Esc / outside-click also closes."
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      style={{ position: "relative", display: "inline-block" }}
    >
      {/* Trigger pill */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={hasPending ? `${total} pending` : "All clear"}
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px 5px 10px",
          background: hasPending ? "var(--gold)" : "var(--bg)",
          color: hasPending ? "#fff" : "var(--text)",
          border: `1px solid ${hasPending ? "var(--gold-dark)" : "var(--border)"}`,
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          position: "relative",
          transition: "transform 0.12s ease, box-shadow 0.12s ease",
          boxShadow: hasPending
            ? "0 1px 0 rgba(0,0,0,0.04), 0 0 0 0 rgba(201,161,74,0.0)"
            : "0 1px 0 rgba(0,0,0,0.04)",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
          🔔
        </span>
        <span>{hasPending ? "Tasks" : "All clear"}</span>
        <span
          style={{
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            fontWeight: 800,
            padding: "1px 8px",
            borderRadius: 999,
            background: hasPending ? "rgba(255,255,255,0.25)" : "var(--border)",
            color: hasPending ? "#fff" : "var(--muted)",
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {total}
        </span>
        {hasPending && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "#dc2626",
              border: "1.5px solid var(--surface, #fff)",
            }}
          />
        )}
      </button>

      {/* Glassmorphism dropdown — Daksh follow-on: opens with a
          clip-path circle that "blooms" out from the trigger
          button's anchor point (top-right of the panel), rather
          than the flat fade-down. Reads as a half-circle ripple
          spreading from where the click happened. Subtle but very
          recognisably "ours." */}
      {open && (
        <>
          <style>{`
            @keyframes mtcpl-tasks-bloom {
              0% {
                opacity: 0;
                /* Origin: top-right of the panel, roughly the
                   trigger button's vertical centre projected onto
                   the panel's top edge. */
                clip-path: circle(0% at calc(100% - 28px) 0%);
              }
              30% {
                opacity: 1;
              }
              100% {
                opacity: 1;
                clip-path: circle(160% at calc(100% - 28px) 0%);
              }
            }
            @keyframes mtcpl-tasks-row-in {
              from { opacity: 0; transform: translateY(2px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              minWidth: 320,
              maxWidth: 360,
              padding: 8,
              background: "rgba(255, 255, 255, 0.78)",
              // Apple-style frosted glass. Both prefixed + standard
              // for Safari + Chrome / Firefox.
              backdropFilter: "blur(22px) saturate(180%)",
              WebkitBackdropFilter: "blur(22px) saturate(180%)",
              border: "1px solid rgba(255, 255, 255, 0.55)",
              borderRadius: 14,
              boxShadow:
                "0 12px 40px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.55)",
              zIndex: 200,
              animation:
                "mtcpl-tasks-bloom 0.34s cubic-bezier(0.2, 0.8, 0.2, 1.05) both",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div
              style={{
                padding: "8px 12px 6px",
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15, 23, 42, 0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Pending tasks</span>
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 800,
                  color: hasPending ? "var(--gold-dark)" : "rgba(15,23,42,0.45)",
                }}
              >
                {total}
              </span>
            </div>

            {/* Department-grouped sections */}
            {grouped.map((group, groupIdx) => {
              const meta = DEPT_META[group.dept];
              const groupTotal = group.items.reduce((s, it) => s + it.count, 0);
              return (
                <div
                  key={group.dept}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    marginTop: groupIdx === 0 ? 0 : 6,
                  }}
                >
                  {/* Department header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 12px 2px",
                      fontSize: 9.5,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      color: meta.color,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: meta.color,
                        boxShadow: `0 0 0 3px ${meta.color}22`,
                      }}
                    />
                    {meta.label}
                    {groupTotal > 0 && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontFamily: "ui-monospace, monospace",
                          fontWeight: 800,
                          color: meta.color,
                          opacity: 0.85,
                        }}
                      >
                        {groupTotal}
                      </span>
                    )}
                  </div>

                  {group.items.map((it) => {
                    const itemHasCount = it.count > 0;
                    return (
                      <Link
                        key={it.id}
                        href={it.href}
                        onClick={() => setOpen(false)}
                        role="menuitem"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 12px",
                          borderRadius: 10,
                          textDecoration: "none",
                          color: "var(--text)",
                          background: "transparent",
                          transition: "background 0.12s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = `${meta.color}14`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span
                          style={{
                            width: 32,
                            height: 32,
                            flexShrink: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 8,
                            background: itemHasCount
                              ? `${meta.color}22`
                              : "rgba(15, 23, 42, 0.06)",
                            fontSize: 16,
                            lineHeight: 1,
                          }}
                        >
                          {it.icon}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            gap: 1,
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: "var(--text)",
                              letterSpacing: "-0.005em",
                            }}
                          >
                            {it.label}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "rgba(15, 23, 42, 0.55)",
                              lineHeight: 1.35,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {it.description}
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 800,
                            padding: "2px 9px",
                            borderRadius: 999,
                            background: itemHasCount
                              ? meta.color
                              : "rgba(15, 23, 42, 0.08)",
                            color: itemHasCount
                              ? "#fff"
                              : "rgba(15, 23, 42, 0.45)",
                            minWidth: 22,
                            textAlign: "center",
                            flexShrink: 0,
                          }}
                        >
                          {it.count}
                        </span>
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: 13,
                            color: "rgba(15, 23, 42, 0.35)",
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          →
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
