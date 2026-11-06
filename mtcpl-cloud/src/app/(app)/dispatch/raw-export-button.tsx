"use client";

/**
 * "⬇ Excel" on the Dispatch header — downloads every dispatched slab
 * as a flat sheet to pivot (Daksh, Nov 2026: "that excel export we
 * made for cnc, likewise we want excel export feature for dispatch
 * module too").
 *
 * Deliberately the same control as the Carving one, down to the
 * wording: two screens, one thing to learn.
 *
 * Filters are optional and all default to everything. Only the date
 * range really matters — temple and stage are one click of Excel's
 * own autofilter once the file is open, so narrowing here is a
 * convenience, not the point.
 *
 * Downloaded through fetch + blob rather than a plain link so the
 * button can say when the file is actually in hand. The Pay Today
 * bank file taught us that a download nobody confirms is a download
 * people do three times.
 */

import { useRef, useState } from "react";

/** Matches STAGE_KEYS in lib/dispatch-raw-export — the lanes the
 *  dispatch board itself shows, so the filter speaks the same language
 *  as the screen it sits on. */
const STAGES: Array<{ value: string; label: string }> = [
  { value: "waiting", label: "Waiting for approval" },
  { value: "invoice", label: "Invoice in process" },
  { value: "on_road", label: "On road" },
  { value: "delivered", label: "Delivered" },
  { value: "returned", label: "Returned" },
];

export function DispatchExportButton({ temples }: { temples: string[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [temple, setTemple] = useState("");
  const [stage, setStage] = useState("");

  const anchorRef = useRef<HTMLDivElement | null>(null);

  const narrowed = Boolean(from || to || temple || stage);

  async function download() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (temple) qs.set("temple", temple);
      if (stage) qs.set("stage", stage);

      const res = await fetch(`/api/dispatch/raw-export.xlsx?${qs.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          res.status === 403
            ? "You do not have access to this export."
            : text.slice(0, 200) || `Export failed (${res.status}).`,
        );
      }
      const blob = await res.blob();
      if (blob.size === 0) throw new Error("The file came back empty — nothing was downloaded.");

      const stamp = new Date().toISOString().slice(0, 10);
      const name = `dispatch-raw-data-${stamp}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a beat to start the save before the handle goes.
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      const kb = Math.max(1, Math.round(blob.size / 1024));
      setDone(`${name} · ${kb.toLocaleString("en-IN")} KB`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={anchorRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Download the raw dispatch data as Excel"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 14px", fontSize: 12, fontWeight: 700,
          color: "var(--text)", background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer",
        }}
      >
        ⬇ Excel{narrowed ? " (filtered)" : ""}
      </button>

      {open && (
        <>
          {/* Click-away. Sits behind the panel, over everything else. */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 41,
              width: 310, padding: 14, textAlign: "left",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
              Raw dispatch data
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>
              One row per slab per trip, every column. Filter it however you like in
              Excel — these are just to keep the file small.
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <label style={{ flex: 1 }}>
                <span style={lbl}>From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
              </label>
              <label style={{ flex: 1 }}>
                <span style={lbl}>To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} />
              </label>
            </div>

            <label style={{ display: "block", marginTop: 9 }}>
              <span style={lbl}>Temple</span>
              <select value={temple} onChange={(e) => setTemple(e.target.value)} style={inp}>
                <option value="">All temples</option>
                {temples.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label style={{ display: "block", marginTop: 9 }}>
              <span style={lbl}>Stage</span>
              <select value={stage} onChange={(e) => setStage(e.target.value)} style={inp}>
                <option value="">Every stage</option>
                {STAGES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={download}
              style={{
                width: "100%", marginTop: 13, padding: "11px 14px",
                fontSize: 13, fontWeight: 800, borderRadius: 10, border: "none",
                color: "#fff", cursor: busy ? "wait" : "pointer",
                background: busy
                  ? "var(--border)"
                  : "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
              }}
            >
              {busy ? "Building the sheet…" : narrowed ? "Download filtered" : "Download everything"}
            </button>

            {narrowed && !busy && (
              <button
                type="button"
                onClick={() => { setFrom(""); setTo(""); setTemple(""); setStage(""); }}
                style={{
                  width: "100%", marginTop: 7, padding: "7px 10px", fontSize: 11.5,
                  fontWeight: 700, borderRadius: 8, cursor: "pointer",
                  background: "transparent", color: "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              >
                Clear filters
              </button>
            )}

            {done && (
              <div
                style={{
                  marginTop: 10, padding: "9px 11px", borderRadius: 9, fontSize: 11.5,
                  lineHeight: 1.5, color: "#15803d",
                  background: "rgba(21,128,61,0.09)", border: "1px solid rgba(21,128,61,0.3)",
                }}
              >
                <strong>Downloaded.</strong><br />{done}
              </div>
            )}
            {error && (
              <div
                style={{
                  marginTop: 10, padding: "9px 11px", borderRadius: 9, fontSize: 11.5,
                  lineHeight: 1.5, color: "var(--danger)",
                  background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)",
                }}
              >
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
  textTransform: "uppercase", color: "var(--muted)", marginBottom: 4,
};

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 12.5, borderRadius: 8,
  border: "1px solid var(--border)", background: "var(--surface-alt)",
  color: "var(--text)", outline: "none",
};
