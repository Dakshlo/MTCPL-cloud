"use client";

// ──────────────────────────────────────────────────────────────────
// Topbar ID Lookup — quick "where is this stone?" search.
// ──────────────────────────────────────────────────────────────────
// Daksh: "feature for when someone in the workshop finds a stone
// with a code on it, they should get all info — first WHERE IT IS
// (stage), then everything else (dimensions, temple, CFT, source
// block / derived slabs)."
//
// Visibility (gated by the parent — layout.tsx renders this only
// for the permitted roles, mirroring lookupId's requireAuth):
//   developer · owner · team_head · crosscheck · carving_head
//
// Interaction: same hover-or-tap pattern as TopbarTasksBadge, same
// frosted-glass aesthetic, same ripple-bloom open animation. Search
// input auto-focuses on open; Enter submits; result panel replaces
// the input below.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { lookupId, type LookupResult } from "@/app/(app)/dashboard/lookup-action";

const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  open:                { fg: "#0f766e", bg: "rgba(15,118,110,0.10)" },
  planned:             { fg: "#1e40af", bg: "rgba(30,64,175,0.10)" },
  cutting:             { fg: "#9a3412", bg: "rgba(154,52,18,0.10)" },
  awaiting_approval:   { fg: "#9a3412", bg: "rgba(154,52,18,0.10)" },
  cut_done:            { fg: "#15803d", bg: "rgba(21,128,61,0.10)" },
  carving_assigned:    { fg: "#7c3aed", bg: "rgba(124,58,237,0.10)" },
  carving_in_progress: { fg: "#7c3aed", bg: "rgba(124,58,237,0.10)" },
  completed:           { fg: "#15803d", bg: "rgba(21,128,61,0.10)" },
  dispatched:          { fg: "#1e40af", bg: "rgba(30,64,175,0.10)" },
  rejected:            { fg: "#b91c1c", bg: "rgba(185,28,28,0.10)" },
  available:           { fg: "#15803d", bg: "rgba(21,128,61,0.10)" },
  reserved:            { fg: "#9a3412", bg: "rgba(154,52,18,0.10)" },
  consumed:            { fg: "#525252", bg: "rgba(82,82,82,0.10)" },
  discarded:           { fg: "#525252", bg: "rgba(82,82,82,0.10)" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function TopbarIdLookup() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the search input when the panel opens.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Reset on close so the next open is fresh.
      setQuery("");
      setResult(null);
      setError(null);
    }
  }, [open]);

  // Outside-click + Esc close (covers touch + keyboard).
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

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function openNow() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 220);
  }

  async function runSearch(qRaw?: string) {
    const q = (qRaw ?? query).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await lookupId(q);
      setResult(res);
      if (qRaw !== undefined) setQuery(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
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
        title="Look up any slab or block ID"
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 12px 5px 10px",
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
          🔍
        </span>
        <span>Find ID</span>
      </button>

      {open && (
        <>
          <style>{`
            @keyframes mtcpl-idlookup-bloom {
              0%   { opacity: 0; clip-path: circle(0% at calc(100% - 32px) 0%); }
              30%  { opacity: 1; }
              100% { opacity: 1; clip-path: circle(160% at calc(100% - 32px) 0%); }
            }
          `}</style>
          <div
            role="dialog"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              width: 440,
              maxWidth: "calc(100vw - 32px)",
              padding: 14,
              background: "rgba(255, 255, 255, 0.78)",
              backdropFilter: "blur(22px) saturate(180%)",
              WebkitBackdropFilter: "blur(22px) saturate(180%)",
              border: "1px solid rgba(255, 255, 255, 0.55)",
              borderRadius: 14,
              boxShadow:
                "0 12px 40px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.55)",
              zIndex: 200,
              animation:
                "mtcpl-idlookup-bloom 0.34s cubic-bezier(0.2, 0.8, 0.2, 1.05) both",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15, 23, 42, 0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Look up a slab or block ID
            </div>

            {/* Search row */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="WF-0001 · MT-B-245 · AGROHA-0002-13"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  background: "#fff",
                  color: "var(--text)",
                  border: "1px solid rgba(15, 23, 42, 0.12)",
                  borderRadius: 9,
                  letterSpacing: "0.02em",
                }}
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                style={{
                  padding: "9px 14px",
                  fontSize: 12,
                  fontWeight: 800,
                  background: "var(--gold)",
                  color: "#fff",
                  border: "1px solid var(--gold-dark)",
                  borderRadius: 9,
                  cursor: loading ? "wait" : "pointer",
                  opacity: query.trim() ? 1 : 0.55,
                  whiteSpace: "nowrap",
                }}
              >
                {loading ? "Searching…" : "Find"}
              </button>
            </form>

            {/* Result */}
            {error && (
              <div
                role="alert"
                style={{
                  padding: "10px 12px",
                  background: "rgba(185, 28, 28, 0.08)",
                  color: "#b91c1c",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid rgba(185, 28, 28, 0.25)",
                  borderRadius: 8,
                }}
              >
                {error}
              </div>
            )}
            {result && <ResultPanel result={result} onPick={runSearch} />}

            {!loading && !result && !error && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "rgba(15, 23, 42, 0.55)",
                  lineHeight: 1.5,
                }}
              >
                Type any slab or block ID (case-insensitive, leading /
                trailing space OK). Hit <strong>Find</strong> or press
                Enter.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Result panel ──────────────────────────────────────────────────

function ResultPanel({
  result,
  onPick,
}: {
  result: LookupResult;
  onPick: (q: string) => void;
}) {
  if (result.kind === "not_found") {
    return (
      <div
        style={{
          padding: "14px 12px",
          background: "rgba(15, 23, 42, 0.04)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          No match for{" "}
          <code style={{ fontFamily: "ui-monospace, monospace" }}>{result.query}</code>
        </div>
        {result.suggestions.length > 0 && (
          <>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Did you mean…
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {result.suggestions.map((s) => (
                <button
                  key={`${s.kind}-${s.id}`}
                  type="button"
                  onClick={() => onPick(s.id)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    background: "#fff",
                    border: "1px solid rgba(15,23,42,0.08)",
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 800,
                      color: "var(--text)",
                    }}
                  >
                    {s.id}
                  </span>
                  <span style={{ color: "rgba(15,23,42,0.55)", fontSize: 11 }}>
                    {s.hint}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (result.kind === "slab") return <SlabResultPanel result={result} />;
  return <BlockResultPanel result={result} />;
}

function StagePill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? { fg: "#525252", bg: "rgba(82,82,82,0.10)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        fontSize: 12,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone.fg,
          boxShadow: `0 0 0 3px ${tone.bg}`,
        }}
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Field({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "4px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "rgba(15,23,42,0.55)", fontWeight: 600 }}>{k}</span>
      <span
        style={{
          color: "var(--text)",
          fontWeight: 700,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          textAlign: "right",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function SlabResultPanel({ result }: { result: Extract<LookupResult, { kind: "slab" }> }) {
  const s = result.slab;

  // Compose the "where it is now" stage. Slab status is the
  // canonical state but we mix in the carving / dispatch context
  // when it's available so the very first line of the panel reads
  // like "carving in progress at Mohit Carving Works" rather than
  // just "carving_in_progress".
  let stageContext: string | null = null;
  if (result.dispatch?.delivered_at) {
    stageContext = `Delivered to ${result.dispatch.receiver_name ?? result.dispatch.temple ?? "—"}`;
  } else if (result.dispatch?.dispatched_at) {
    stageContext = `On vehicle ${result.dispatch.vehicle_no ?? "—"}`;
  } else if (result.carving) {
    stageContext = `${result.carving.vendor_name}${
      result.carving.location ? ` · ${result.carving.location}` : ""
    }`;
  } else if (result.cut?.cut_at) {
    stageContext = `Cut ${fmtDate(result.cut.cut_at)} · ${result.cut.session_code}`;
  } else if (s.yard) {
    stageContext = `Yard ${s.yard}`;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      {/* WHERE IT IS — biggest line. Stage pill + free-text context. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Where it is now
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StagePill status={s.status} />
          {s.priority && (
            <span
              style={{
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 800,
                background: "rgba(220, 38, 38, 0.12)",
                color: "#b91c1c",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              🚨 priority
            </span>
          )}
        </div>
        {stageContext && (
          <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
            {stageContext}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      {/* SLAB BASICS */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Slab {s.id}
          {s.label && (
            <span style={{ color: "rgba(15,23,42,0.45)", marginLeft: 6 }}>
              · {s.label}
            </span>
          )}
        </div>
        <Field k="Temple" v={s.temple} />
        {s.stone && <Field k="Stone" v={s.stone} />}
        <Field
          k="Dimensions"
          v={
            <>
              {fmtNum(s.length_in)}″ × {fmtNum(s.width_in)}″ ×{" "}
              {fmtNum(s.thickness_in)}″
            </>
          }
          mono
        />
        <Field k="CFT" v={fmtNum(s.cft, 2)} mono />
        {s.source_block_id && (
          <Field
            k="Source block"
            v={
              <Link
                href={`/blocks?q=${encodeURIComponent(s.source_block_id)}`}
                style={{ color: "var(--gold-dark)", textDecoration: "none" }}
              >
                {s.source_block_id}
              </Link>
            }
            mono
          />
        )}
        {s.deadline && <Field k="Deadline" v={fmtDate(s.deadline)} />}
      </div>

      {/* CUT INFO */}
      {result.cut && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Cut
            </div>
            <Field k="Session" v={result.cut.session_code} mono />
            {result.cut.planner_name && (
              <Field k="Planner" v={result.cut.planner_name} />
            )}
            {result.cut.cut_at && (
              <Field k="Cut at" v={fmtDate(result.cut.cut_at)} />
            )}
            {result.cut.is_filler && (
              <Field
                k="Type"
                v={
                  <span style={{ color: "#c2410c", fontWeight: 700 }}>
                    fit-to-fill
                  </span>
                }
              />
            )}
          </div>
        </>
      )}

      {/* CARVING INFO */}
      {result.carving && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Carving
            </div>
            <Field k="Vendor" v={result.carving.vendor_name} />
            <Field k="Vendor type" v={result.carving.vendor_type} />
            <Field k="Status" v={result.carving.status} mono />
            {result.carving.location && (
              <Field k="Location" v={result.carving.location} />
            )}
            {result.carving.due_at && (
              <Field k="Due" v={fmtDate(result.carving.due_at)} />
            )}
            {result.carving.completed_at && (
              <Field k="Completed" v={fmtDate(result.carving.completed_at)} />
            )}
            {result.carving.ready_to_dispatch_at && (
              <Field
                k="Ready to dispatch"
                v={fmtDate(result.carving.ready_to_dispatch_at)}
              />
            )}
          </div>
        </>
      )}

      {/* DISPATCH INFO */}
      {result.dispatch && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Dispatch
            </div>
            {result.dispatch.challan_number != null && (
              <Field k="Challan" v={`#${result.dispatch.challan_number}`} mono />
            )}
            {result.dispatch.vehicle_no && (
              <Field k="Vehicle" v={result.dispatch.vehicle_no} mono />
            )}
            {result.dispatch.dispatched_at && (
              <Field k="Dispatched" v={fmtDate(result.dispatch.dispatched_at)} />
            )}
            {result.dispatch.delivered_at && (
              <Field k="Delivered" v={fmtDate(result.dispatch.delivered_at)} />
            )}
            {result.dispatch.receiver_name && (
              <Field k="Received by" v={result.dispatch.receiver_name} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BlockResultPanel({ result }: { result: Extract<LookupResult, { kind: "block" }> }) {
  const b = result.block;

  // Block stage context — what's happening with cutting + how many
  // slabs have come out.
  let stageContext: string | null = null;
  if (result.cutting?.session_block_status === "done") {
    stageContext = `Cut done · session ${result.cutting.session_code}`;
  } else if (result.cutting?.session_block_status === "cutting") {
    stageContext = `Cutting in progress · session ${result.cutting.session_code}`;
  } else if (result.cutting) {
    stageContext = `Cut session ${result.cutting.session_code}`;
  } else {
    stageContext = `Yard ${b.yard}`;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(15, 23, 42, 0.04)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Where it is now
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StagePill status={b.status} />
          <span
            style={{
              padding: "3px 8px",
              fontSize: 10,
              fontWeight: 800,
              background: "rgba(15,23,42,0.08)",
              color: "rgba(15,23,42,0.65)",
              borderRadius: 999,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {b.category}
          </span>
          {result.cutting?.needs_reprint && (
            <span
              style={{
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 800,
                background: "rgba(220, 38, 38, 0.12)",
                color: "#b91c1c",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              needs reprint
            </span>
          )}
        </div>
        {stageContext && (
          <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
            {stageContext}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(15,23,42,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          Block {b.id}
        </div>
        <Field k="Yard" v={b.yard} />
        <Field k="Stone" v={b.stone} />
        <Field
          k="Dimensions"
          v={
            <>
              {fmtNum(b.length_in)}″ × {fmtNum(b.width_in)}″ ×{" "}
              {fmtNum(b.height_in)}″
            </>
          }
          mono
        />
        <Field k="CFT" v={fmtNum(b.cft, 2)} mono />
        {b.quality && <Field k="Quality" v={b.quality} />}
      </div>

      {result.cutting && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Cut session
            </div>
            <Field k="Session" v={result.cutting.session_code} mono />
            <Field k="Status" v={result.cutting.session_block_status} mono />
            {result.cutting.largest_remainder_cft != null && (
              <Field
                k="Largest remainder"
                v={`${fmtNum(result.cutting.largest_remainder_cft, 2)} CFT`}
                mono
              />
            )}
          </div>
        </>
      )}

      {result.slabs_from_block.total > 0 && (
        <>
          <div style={{ height: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(15,23,42,0.55)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Slabs cut from this block · {result.slabs_from_block.total} total
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(result.slabs_from_block.by_status).map(([st, n]) => {
                const tone = STATUS_TONE[st] ?? {
                  fg: "#525252",
                  bg: "rgba(82,82,82,0.10)",
                };
                return (
                  <span
                    key={st}
                    style={{
                      padding: "3px 9px",
                      fontSize: 10,
                      fontWeight: 800,
                      background: tone.bg,
                      color: tone.fg,
                      borderRadius: 999,
                      fontFamily: "ui-monospace, monospace",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {st.replace(/_/g, " ")} · {n}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
