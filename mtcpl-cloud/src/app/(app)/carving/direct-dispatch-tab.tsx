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
 */

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { directDispatchSlabsAction } from "./actions";

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
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [slabs, query]);

  const visibleCount = groups.reduce((n, [, list]) => n + list.length, 0);
  const selSlabs = slabs.filter((s) => selected.has(s.id));
  const selCft = selSlabs.reduce((sum, s) => sum + cft(s.length_ft, s.width_ft, s.thickness_ft), 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <strong style={{ color: "#0f766e" }}>🚚 Direct Dispatch — slabs that skip carving.</strong>{" "}
        Tap the cut-&-ready slabs that go straight to site, then press <strong>Send to Make Dispatch</strong>.
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
            background: submitting || selected.size === 0 ? "var(--border)" : "#0f766e",
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

      {/* Slab picker, temple-grouped */}
      {visibleCount === 0 ? (
        <div className="muted" style={{ padding: "34px 16px", textAlign: "center", fontSize: 14, background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12 }}>
          {slabs.length === 0
            ? "No cut-&-ready slabs right now."
            : `No slab matches “${query}”.`}
        </div>
      ) : (
        groups.map(([temple, list]) => {
          const allSel = list.every((s) => selected.has(s.id));
          return (
            <div key={temple} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--bg)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14.5, fontWeight: 800 }}>🏛 {temple}</span>
                <span className="muted" style={{ fontSize: 12 }}>{list.length} slab{list.length === 1 ? "" : "s"}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (allSel) for (const s of list) next.delete(s.id);
                      else for (const s of list) next.add(s.id);
                      return next;
                    });
                  }}
                  style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", cursor: "pointer" }}
                >
                  {allSel ? "Clear all" : "Select all"}
                </button>
              </div>
              <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(235px, 1fr))", gap: 9 }}>
                {list.map((s) => {
                  const isSel = selected.has(s.id);
                  return (
                    <div
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s.id); } }}
                      style={{
                        background: isSel ? "rgba(15,118,110,0.08)" : "var(--surface)",
                        border: isSel ? "2px solid #0f766e" : "1px solid var(--border)",
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
                            background: isSel ? "#0f766e" : "transparent",
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
                      {s.label && <div style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</div>}
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
            </div>
          );
        })
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
