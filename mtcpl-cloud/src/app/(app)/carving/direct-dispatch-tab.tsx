"use client";

/**
 * 🚚 Direct Dispatch lane (mig 130) — Carving Jobs' third mode.
 *
 * Some slabs skip carving entirely: cut → straight onto a truck. This
 * lane shows the same cut-&-ready slabs as CNC Unassigned; the office
 * taps the ones to skip, presses Send, and they appear in Dispatch →
 * Make Dispatch (status 'completed'), vanishing from CNC Unassigned and
 * the Outsource work-order picker. Every send is stamped
 * direct_dispatched_at/by — the permanent record listed below.
 *
 * Daksh June 2026 — reskinned to match CNC Unassigned: temple CARDS in
 * a grid (count + priority + "selected" badge) that open a center-peek
 * modal holding the slab picker, instead of one long expanded list.
 * Selection is held at the tab level so picks survive opening/closing
 * temples and the top "Send" bar shows the running total across temples.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { directDispatchSlabsAction } from "./actions";
import { SlabComponentDetail } from "@/components/slab-component-detail";

export type DirectSlab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  priority: boolean | null;
  stock_location: string | null;
  /** Mig 126 — set while the slab is PRE-CUT (released early; its block
   *  is still cutting). Direct dispatch is allowed; the chip just tells
   *  the office the block's audit hasn't closed yet. */
  precut_at: string | null;
  /** Mig 123 / 128 — component hierarchy (Category 1 / Category 2 /
   *  Description / Additional). Optional; the card shows the levels present. */
  description?: string | null;
  component_section?: string | null;
  component_element?: string | null;
  additional_description?: string | null;
};

export type DirectHistoryRow = {
  id: string;
  label: string | null;
  temple: string;
  status: string;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  direct_dispatched_at: string;
  byName: string | null;
};

const TEAL = "#0f766e";

function cft(l: number, w: number, t: number): number {
  return (l * w * t) / 1728;
}

function matches(s: DirectSlab, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const dim = `${s.length_ft}x${s.width_ft}x${s.thickness_ft}`;
  const hay = `${s.id} ${s.label ?? ""} ${s.temple} ${s.stone ?? ""} ${dim}`.toLowerCase();
  return query.split(/\s+/).every((tok) => hay.includes(tok.replace(/[×x*]/g, "x")));
}

const HISTORY_STATUS: Record<string, { label: string; c: string; bg: string }> = {
  completed: { label: "IN MAKE DISPATCH", c: "#b87333", bg: "rgba(184,115,51,0.12)" },
  dispatched: { label: "DISPATCHED", c: "#2563EB", bg: "rgba(37,99,235,0.1)" },
};

export function DirectDispatchTab({
  slabs,
  history,
}: {
  slabs: DirectSlab[];
  history: DirectHistoryRow[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTemple, setOpenTemple] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const groups = useMemo(() => {
    const map = new Map<string, DirectSlab[]>();
    for (const s of slabs) {
      if (!matches(s, query)) continue;
      const arr = map.get(s.temple) ?? [];
      arr.push(s);
      map.set(s.temple, arr);
    }
    return [...map.entries()]
      .map(([temple, items]) => ({ temple, items }))
      .sort((a, b) => a.temple.localeCompare(b.temple));
  }, [slabs, query]);

  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);
  const selSlabs = slabs.filter((s) => selected.has(s.id));
  const selCft = selSlabs.reduce((sum, s) => sum + cft(s.length_ft, s.width_ft, s.thickness_ft), 0);

  const openGroup = openTemple ? groups.find((g) => g.temple === openTemple) ?? null : null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMsg(null);
    setErr(null);
  }

  function setMany(ids: string[], select: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (select) for (const id of ids) next.add(id);
      else for (const id of ids) next.delete(id);
      return next;
    });
    setMsg(null);
    setErr(null);
  }

  function send() {
    if (selected.size === 0 || submitting) return;
    if (
      !confirm(
        `Send ${selected.size} slab${selected.size === 1 ? "" : "s"} DIRECT to dispatch (skip carving)?\n\nThey will move to Dispatch → Make Dispatch and disappear from carving.`,
      )
    ) {
      return;
    }
    setMsg(null);
    setErr(null);
    const fd = new FormData();
    fd.set("slab_ids", JSON.stringify([...selected]));
    startSubmit(async () => {
      try {
        const res = await directDispatchSlabsAction(fd);
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setMsg(`✓ ${res.count} slab${res.count === 1 ? "" : "s"} sent to Make Dispatch — the dispatch team can build the truck now.`);
        setSelected(new Set());
        setOpenTemple(null);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* What this lane does */}
      <div
        style={{
          background: "rgba(15,118,110,0.06)", border: "1.5px solid rgba(15,118,110,0.35)",
          borderRadius: 12, padding: "12px 16px", fontSize: 13, lineHeight: 1.55,
        }}
      >
        <strong style={{ color: TEAL }}>🚚 Direct Dispatch — slabs that skip carving.</strong>{" "}
        Open a temple, tap the cut-&-ready slabs that go straight to site, then press <strong>Send to Make Dispatch</strong>.
        They leave carving completely (CNC Unassigned + Outsource work orders won&apos;t show them) and the
        dispatch team finds them ready in{" "}
        <Link href="/dispatch" style={{ fontWeight: 700 }}>Dispatch → Make Dispatch</Link>.
        जो slab बिना carving सीधे भेजनी है, उन्हें चुनें।
      </div>

      {msg && (
        <div style={{ padding: "11px 15px", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 10, color: "#15803d", fontSize: 13.5, fontWeight: 700 }}>
          {msg}
        </div>
      )}
      {err && (
        <div style={{ padding: "11px 15px", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.3)", borderRadius: 10, color: "#b91c1c", fontSize: 13.5, fontWeight: 700 }}>
          ⚠ {err}
        </div>
      )}

      {/* Search + send bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 280px" }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.6 }}>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search slab — code / label / temple / size…"
            style={{
              width: "100%", padding: "11px 14px 11px 38px", fontSize: 14,
              border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)",
            }}
          />
        </div>
        <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
          {visibleCount} slab{visibleCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={send}
          disabled={submitting || selected.size === 0}
          style={{
            background: submitting || selected.size === 0 ? "var(--border)" : TEAL,
            color: submitting || selected.size === 0 ? "var(--muted)" : "#fff",
            border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 14, fontWeight: 800,
            cursor: submitting ? "wait" : selected.size === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap",
          }}
        >
          {submitting
            ? "Sending…"
            : `🚚 Send to Make Dispatch (${selected.size}${selected.size > 0 ? ` · ${selCft.toFixed(1)} CFT` : ""})`}
        </button>
      </div>

      {/* Temple cards — click → center-peek picker (mirrors CNC Unassigned) */}
      {visibleCount === 0 ? (
        <div className="muted" style={{ padding: "34px 16px", textAlign: "center", fontSize: 14, background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12 }}>
          {slabs.length === 0
            ? "No cut-&-ready slabs right now."
            : `No slab matches “${query}”.`}
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            {visibleCount} slab{visibleCount !== 1 ? "s" : ""} across {groups.length} temple
            {groups.length !== 1 ? "s" : ""}. Tap a temple to view + select slabs to dispatch.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 10,
            }}
          >
            {groups.map(({ temple, items }) => {
              const urgent = items.filter((s) => s.priority).length;
              const selHere = items.filter((s) => selected.has(s.id)).length;
              return (
                <button
                  key={temple}
                  type="button"
                  onClick={() => setOpenTemple(temple)}
                  style={{
                    textAlign: "left",
                    padding: "14px 16px",
                    background: selHere > 0 ? "rgba(15,118,110,0.05)" : urgent > 0 ? "rgba(220,38,38,0.04)" : "var(--surface)",
                    border: `1.5px solid ${selHere > 0 ? "rgba(15,118,110,0.5)" : urgent > 0 ? "rgba(220,38,38,0.3)" : "var(--border)"}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    transition: "border-color 0.12s, background 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = TEAL;
                    e.currentTarget.style.background = "var(--surface-alt)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor =
                      selHere > 0 ? "rgba(15,118,110,0.5)" : urgent > 0 ? "rgba(220,38,38,0.3)" : "var(--border)";
                    e.currentTarget.style.background =
                      selHere > 0 ? "rgba(15,118,110,0.05)" : urgent > 0 ? "rgba(220,38,38,0.04)" : "var(--surface)";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
                      🏛 Temple
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 10px",
                        borderRadius: 999,
                        background: "var(--gold-dark)",
                        color: "#fff",
                        fontFamily: "ui-monospace, monospace",
                        minWidth: 26,
                        textAlign: "center",
                      }}
                    >
                      {items.length}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {temple}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {urgent > 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#dc2626",
                          background: "rgba(220,38,38,0.1)",
                          padding: "3px 8px",
                          borderRadius: 5,
                        }}
                      >
                        ⚡ {urgent} priority
                      </span>
                    )}
                    {selHere > 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#fff",
                          background: TEAL,
                          padding: "3px 8px",
                          borderRadius: 5,
                        }}
                      >
                        ✓ {selHere} selected
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: "auto", fontSize: 11, color: "var(--gold-dark)", fontWeight: 600 }}>
                    Open &amp; select →
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {openGroup && (
        <TempleDispatchPeek
          temple={openGroup.temple}
          slabs={openGroup.items}
          selected={selected}
          onToggle={toggle}
          onSetMany={setMany}
          onClose={() => setOpenTemple(null)}
          onSend={send}
          submitting={submitting}
          totalSelected={selected.size}
          totalCft={selCft}
        />
      )}

      {/* Permanent record */}
      <details open={history.length > 0 && slabs.length === 0}>
        <summary
          style={{
            cursor: "pointer", fontSize: 13.5, fontWeight: 800, color: "var(--text)",
            padding: "10px 4px", userSelect: "none", borderTop: "1px dashed var(--border)", listStyle: "none",
          }}
        >
          📜 Direct-dispatch record ({history.length}) — every slab that skipped carving
        </summary>
        {history.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5, padding: "6px 4px 12px" }}>Nothing direct-dispatched yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
            {history.map((h) => {
              const chip = HISTORY_STATUS[h.status] ?? { label: h.status.toUpperCase(), c: "#666", bg: "var(--bg)" };
              return (
                <div
                  key={h.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                    padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5,
                  }}
                >
                  <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{h.id}</code>
                  {h.label && <span className="muted">{h.label}</span>}
                  <span className="muted">🏛 {h.temple}</span>
                  <span className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
                    {h.length_ft}×{h.width_ft}×{h.thickness_ft} in
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {new Date(h.direct_dispatched_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {h.byName ? ` · by ${h.byName}` : ""}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: chip.c, background: chip.bg, borderRadius: 999, padding: "2px 9px", letterSpacing: "0.03em" }}>
                    {chip.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </details>
    </div>
  );
}

// ─── Center-peek picker — all slabs in one temple as a tappable grid.
// Mirrors CNC Unassigned's TempleSlabsPeek: fixed overlay, dialog with a
// within-temple search + Select-all, and a sticky footer carrying the
// same Send button as the top bar (selection lives in the parent, so
// the footer count includes picks made in other temples too).
function TempleDispatchPeek({
  temple,
  slabs,
  selected,
  onToggle,
  onSetMany,
  onClose,
  onSend,
  submitting,
  totalSelected,
  totalCft,
}: {
  temple: string;
  slabs: DirectSlab[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSetMany: (ids: string[], select: boolean) => void;
  onClose: () => void;
  onSend: () => void;
  submitting: boolean;
  totalSelected: number;
  totalCft: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [peekQuery, setPeekQuery] = useState("");

  const visibleSlabs = useMemo(
    () => slabs.filter((s) => matches(s, peekQuery)),
    [slabs, peekQuery],
  );

  const allSel = visibleSlabs.length > 0 && visibleSlabs.every((s) => selected.has(s.id));
  const selHere = slabs.filter((s) => selected.has(s.id)).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        top: 0,
        left: "var(--content-left)",
        right: 0,
        bottom: 0,
        background: "rgba(15,12,6,0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "5vh",
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: 960,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              🚚 Direct dispatch · Temple
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: 17 }}>{temple}</h2>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              {peekQuery.trim()
                ? `${visibleSlabs.length} of ${slabs.length} slab${slabs.length !== 1 ? "s" : ""} match`
                : `${slabs.length} cut-&-ready slab${slabs.length !== 1 ? "s" : ""}`}
              {selHere > 0 ? ` · ${selHere} selected here` : ""}
            </p>
            <input
              type="search"
              value={peekQuery}
              onChange={(e) => setPeekQuery(e.target.value)}
              placeholder="🔍 Filter — slab id, label, stone, or 53x29x14"
              autoCorrect="off"
              spellCheck={false}
              style={{
                marginTop: 8,
                padding: "8px 10px",
                fontSize: 12,
                width: "100%",
                maxWidth: 420,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
                color: "var(--text)",
                fontFamily: "ui-monospace, monospace",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => onSetMany(visibleSlabs.map((s) => s.id), !allSel)}
              disabled={visibleSlabs.length === 0}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                border: `1.5px solid ${allSel ? TEAL : "var(--border)"}`,
                background: allSel ? "rgba(15,118,110,0.10)" : "var(--surface)",
                color: allSel ? TEAL : "var(--text)",
                borderRadius: 6,
                cursor: visibleSlabs.length === 0 ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {allSel ? "✕ Clear all" : "✓ Select all"}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                fontSize: 18,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--muted)",
                padding: 4,
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Slab grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {visibleSlabs.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No slabs match{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>{peekQuery}</code> in {temple}.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(225px, 1fr))",
                gap: 9,
              }}
            >
              {visibleSlabs.map((s) => {
                const isSel = selected.has(s.id);
                return (
                  <div
                    key={s.id}
                    onClick={() => onToggle(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(s.id); } }}
                    style={{
                      background: isSel ? "rgba(15,118,110,0.08)" : "var(--surface)",
                      border: isSel ? `2px solid ${TEAL}` : "1px solid var(--border)",
                      borderRadius: 10, padding: "9px 11px", cursor: "pointer", userSelect: "none",
                      display: "flex", flexDirection: "column", gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 19, height: 19, borderRadius: 6, flexShrink: 0,
                          border: isSel ? "none" : "2px solid var(--border)",
                          background: isSel ? TEAL : "transparent",
                          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 900,
                        }}
                      >
                        {isSel ? "✓" : ""}
                      </span>
                      <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12.5 }}>{s.id}</code>
                      {s.priority && <span title="Urgent" style={{ fontSize: 12 }}>⚡</span>}
                      {s.precut_at && (
                        <span
                          title="Pre-cut — released early; its block is still cutting. Can still be dispatched."
                          style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.12)", border: "1px solid rgba(180,83,9,0.35)", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}
                        >
                          ⏳ block cutting
                        </span>
                      )}
                    </div>
                    <SlabComponentDetail
                      section={s.component_section}
                      element={s.component_element}
                      label={s.label}
                      description={s.description}
                      additional={s.additional_description}
                    />
                    <div className="muted" style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                      {s.length_ft}×{s.width_ft}×{s.thickness_ft} in · {cft(s.length_ft, s.width_ft, s.thickness_ft).toFixed(2)} CFT
                    </div>
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      {s.stone ?? "—"}
                      {s.stock_location ? ` · 📍 ${s.stock_location}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky footer — same Send action as the top bar */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="muted" style={{ fontSize: 12.5 }}>
            {totalSelected === 0
              ? "Tap slabs to select."
              : `${totalSelected} slab${totalSelected === 1 ? "" : "s"} selected · ${totalCft.toFixed(1)} CFT`}
          </span>
          <button
            type="button"
            onClick={onSend}
            disabled={submitting || totalSelected === 0}
            style={{
              background: submitting || totalSelected === 0 ? "var(--border)" : TEAL,
              color: submitting || totalSelected === 0 ? "var(--muted)" : "#fff",
              border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 800,
              cursor: submitting ? "wait" : totalSelected === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap",
            }}
          >
            {submitting ? "Sending…" : `🚚 Send to Make Dispatch (${totalSelected})`}
          </button>
        </div>
      </div>
    </div>
  );
}
