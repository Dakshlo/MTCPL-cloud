"use client";

/**
 * Dashboard "ID Search" card → opens a center-peek modal where the
 * owner can paste any slab/block id (e.g. seen stencilled on a slab in
 * the yard) and instantly see the full system view: dimensions,
 * temple, status, cutting history, carving status, dispatch info.
 *
 * Owner + developer only — gated at the page level (we don't render
 * this card for other roles), and the server action also re-checks.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { lookupId, type LookupResult } from "@/app/(app)/dashboard/lookup-action";

const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  open:              { fg: "#0f766e", bg: "rgba(15,118,110,0.1)" },
  planned:           { fg: "#1e40af", bg: "rgba(30,64,175,0.1)" },
  cutting:           { fg: "#9a3412", bg: "rgba(154,52,18,0.1)" },
  cut_done:          { fg: "#15803d", bg: "rgba(21,128,61,0.1)" },
  carving_assigned:  { fg: "#7c3aed", bg: "rgba(124,58,237,0.1)" },
  carving_in_progress: { fg: "#7c3aed", bg: "rgba(124,58,237,0.1)" },
  completed:         { fg: "#15803d", bg: "rgba(21,128,61,0.1)" },
  dispatched:        { fg: "#1e40af", bg: "rgba(30,64,175,0.1)" },
  available:         { fg: "#15803d", bg: "rgba(21,128,61,0.1)" },
  reserved:          { fg: "#9a3412", bg: "rgba(154,52,18,0.1)" },
  consumed:          { fg: "#525252", bg: "rgba(82,82,82,0.1)" },
};

function statusPill(status: string) {
  const tone = STATUS_TONE[status] ?? { fg: "#525252", bg: "rgba(82,82,82,0.1)" };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function IdSearchEntryCard() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (open) {
      // small delay so the dialog has mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // reset on close so reopening starts fresh
      setQuery("");
      setResult(null);
      setError(null);
    }
  }, [open]);

  async function handleSearch(qOverride?: string) {
    const q = (qOverride ?? query).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await lookupId(q);
      setResult(res);
      if (qOverride) setQuery(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Visible card — mirrors the gold-themed entry-card style used by
  // AskAi / Block Journey cards on the dashboard.
  const card = (
    <div
      onClick={() => setOpen(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen(true);
        }
      }}
      style={{
        cursor: "pointer",
        // Daksh OCD fix — all four dashboard cards equal-height.
        display: "flex",
        flexDirection: "column",
        height: "100%",
        textDecoration: "none",
        background: "linear-gradient(135deg, #1a1a1a 0%, #2D2410 60%, #6b4f18 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(45,36,16,0.15)",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(232,197,114,0.22) 0%, rgba(232,197,114,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          position: "relative",
        }}
      >
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#E8C572",
              marginBottom: 6,
            }}
          >
            🔎 ID lookup
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "-0.2px",
              marginBottom: 4,
            }}
          >
            Find any slab or block
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            Spotted an ID on the floor? Type it here for the full story —
            yard, dimensions, cut date, carving / dispatch status.
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            padding: "8px 14px",
            background: "rgba(232,197,114,0.18)",
            border: "1px solid rgba(232,197,114,0.4)",
            borderRadius: 8,
            color: "#E8C572",
            fontWeight: 600,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Open search ▸
        </div>
      </div>
    </div>
  );

  return (
    <>
      {card}

      {open && (
        <div
          onMouseDown={(e) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
              setOpen(false);
            }
          }}
          style={{
            position: "fixed",
            top: 0,
            left: "var(--content-left)",
            right: 0,
            bottom: 0,
            background: "rgba(15, 12, 6, 0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "8vh",
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
              maxWidth: 720,
              maxHeight: "84vh",
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
                <h2 style={{ margin: 0, fontSize: 17, display: "flex", alignItems: "center", gap: 10 }}>
                  <span>🔎</span>
                  <span>ID Lookup</span>
                </h2>
                <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                  Type any slab id (e.g. <code>AGROHA-0002-13</code>) or block id
                  (<code>MT-B-245</code>). Press Enter to search.
                </p>
              </div>
              <kbd
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  background: "var(--surface-alt)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                Esc
              </kbd>
            </div>

            {/* Search input */}
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                gap: 8,
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="Slab id or block id…"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  fontSize: 14,
                  fontFamily: "ui-monospace, monospace",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg)",
                  color: "var(--text)",
                  textTransform: "uppercase",
                }}
              />
              <button
                type="button"
                onClick={() => handleSearch()}
                disabled={loading || !query.trim()}
                className="primary-button"
                style={{
                  padding: "10px 18px",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  opacity: loading || !query.trim() ? 0.6 : 1,
                }}
              >
                {loading ? "Searching…" : "Search"}
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 16px" }}>
              {error && (
                <div
                  role="alert"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(220,38,38,0.08)",
                    border: "1px solid rgba(220,38,38,0.25)",
                    color: "#991b1b",
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              )}

              {!error && !result && !loading && (
                <div
                  className="muted"
                  style={{ padding: 24, textAlign: "center", fontSize: 13 }}
                >
                  Start typing — partial IDs work too (you&apos;ll get suggestions).
                </div>
              )}

              {result && <ResultPanel result={result} onPickSuggestion={handleSearch} />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Result panel — switches on the kind ────────────────────────────

function ResultPanel({
  result,
  onPickSuggestion,
}: {
  result: LookupResult;
  onPickSuggestion: (q: string) => void;
}) {
  if (result.kind === "not_found") {
    return (
      <div>
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(217,119,6,0.08)",
            border: "1px solid rgba(217,119,6,0.25)",
            color: "#92400e",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          No exact match for <strong>{result.query}</strong>.
        </div>
        {result.suggestions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
              }}
            >
              Did you mean…
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {result.suggestions.map((s) => (
                <button
                  key={`${s.kind}-${s.id}`}
                  type="button"
                  onClick={() => onPickSuggestion(s.id)}
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--text)",
                  }}
                >
                  <span
                    style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}
                  >
                    {s.id}
                  </span>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                    {s.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (result.kind === "slab") return <SlabPanel data={result} />;
  return <BlockPanel data={result} />;
}

// ── Slab result ─────────────────────────────────────────────────────

function SlabPanel({ data }: { data: Extract<LookupResult, { kind: "slab" }> }) {
  const { slab, cut, carving, dispatch } = data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                fontFamily: "ui-monospace, monospace",
                color: "var(--text)",
              }}
            >
              {slab.priority && "⚡ "}
              {slab.id}
            </span>
            <span
              className="role-pill"
              style={{ fontSize: 10, background: "rgba(124,58,237,0.1)", color: "#7c3aed" }}
            >
              SLAB
            </span>
            {statusPill(slab.status)}
          </div>
          {slab.stone && <span className="role-pill">{slab.stone}</span>}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {slab.temple}
          {slab.label ? ` · ${slab.label}` : ""}
        </div>
      </div>

      {/* Key facts grid */}
      <Grid>
        <Field label="Dimensions">
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
            {slab.length_in}×{slab.width_in}×{slab.thickness_in}″
          </span>
        </Field>
        <Field label="Volume">
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{slab.cft.toFixed(2)} CFT</span>
        </Field>
        <Field label="Yard">{slab.yard != null ? `Yard ${slab.yard}` : "—"}</Field>
        <Field label="Source block">
          {slab.source_block_id ? (
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              {slab.source_block_id}
            </span>
          ) : (
            "—"
          )}
        </Field>
        {slab.deadline && <Field label="Deadline">{fmtDate(slab.deadline)}</Field>}
        <Field label="Created">{fmtDate(slab.created_at)}</Field>
        <Field label="Last updated">{fmtDate(slab.updated_at)}</Field>
      </Grid>

      {slab.priority && slab.priority_note && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.2)",
            borderRadius: 6,
            fontSize: 12,
            color: "#991b1b",
          }}
        >
          <strong>⚡ Priority note:</strong> {slab.priority_note}
        </div>
      )}

      {/* Cut info */}
      <Section title="Cutting">
        {cut ? (
          <Grid>
            <Field label="Session">
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{cut.session_code}</span>
            </Field>
            <Field label="Cut date">{cut.cut_at ? fmtDate(cut.cut_at) : "Not yet cut"}</Field>
            <Field label="Planned by">{cut.planner_name ?? "—"}</Field>
            {cut.is_filler && (
              <Field label="Source">
                <span style={{ color: "#7c3aed", fontWeight: 600 }}>FILLER (Fit-to-Fill)</span>
              </Field>
            )}
          </Grid>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            Not yet placed in any cut session.
          </div>
        )}
      </Section>

      {/* Carving info */}
      {carving && (
        <Section title="Carving">
          <Grid>
            <Field label="Vendor">
              {carving.vendor_name}
              <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                ({carving.vendor_type})
              </span>
            </Field>
            <Field label="Status">{statusPill(carving.status)}</Field>
            <Field label="Due">{fmtDate(carving.due_at)}</Field>
            <Field label="Completed">{fmtDate(carving.completed_at)}</Field>
            {carving.location && <Field label="Location">📍 {carving.location}</Field>}
            {carving.ready_to_dispatch_at && (
              <Field label="Ready to dispatch">{fmtDate(carving.ready_to_dispatch_at)}</Field>
            )}
          </Grid>
        </Section>
      )}

      {/* Dispatch info */}
      {dispatch && (
        <Section title="Dispatch">
          <Grid>
            {dispatch.challan_number != null && (
              <Field label="Challan #">
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {dispatch.challan_number}
                </span>
              </Field>
            )}
            <Field label="Vehicle">{dispatch.vehicle_no ?? "—"}</Field>
            <Field label="Dispatched">{fmtDate(dispatch.dispatched_at)}</Field>
            <Field label="Delivered">
              {dispatch.delivered_at ? fmtDate(dispatch.delivered_at) : "In transit"}
            </Field>
            {dispatch.receiver_name && (
              <Field label="Received by">{dispatch.receiver_name}</Field>
            )}
            {dispatch.temple && <Field label="Temple">{dispatch.temple}</Field>}
          </Grid>
        </Section>
      )}
    </div>
  );
}

// ── Block result ────────────────────────────────────────────────────

function BlockPanel({ data }: { data: Extract<LookupResult, { kind: "block" }> }) {
  const { block, cutting, slabs_from_block } = data;

  // Order statuses for display so cutting/cut_done show first.
  const orderedStatusEntries = useMemo(() => {
    const order = [
      "open",
      "planned",
      "cutting",
      "cut_done",
      "carving_assigned",
      "carving_in_progress",
      "completed",
      "dispatched",
    ];
    return Object.entries(slabs_from_block.by_status).sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [slabs_from_block.by_status]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                fontFamily: "ui-monospace, monospace",
                color: "var(--text)",
              }}
            >
              {block.id}
            </span>
            <span
              className="role-pill"
              style={{ fontSize: 10, background: "rgba(180,115,51,0.15)", color: "#b45309" }}
            >
              BLOCK
            </span>
            {statusPill(block.status)}
          </div>
          <span className="role-pill">{block.stone}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {block.category}
          {block.quality ? ` · Grade ${block.quality}` : ""}
        </div>
      </div>

      <Grid>
        <Field label="Yard">Yard {block.yard}</Field>
        <Field label="Dimensions">
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
            {block.length_in}×{block.width_in}×{block.height_in}″
          </span>
        </Field>
        <Field label="Volume">
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{block.cft.toFixed(2)} CFT</span>
        </Field>
        <Field label="Created">{fmtDate(block.created_at)}</Field>
        <Field label="Last updated">{fmtDate(block.updated_at)}</Field>
      </Grid>

      {/* Cutting info */}
      <Section title="Cutting">
        {cutting ? (
          <Grid>
            <Field label="Session">
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{cutting.session_code}</span>
            </Field>
            <Field label="Status">{statusPill(cutting.session_block_status)}</Field>
            {cutting.largest_remainder_cft != null && (
              <Field label="Largest remainder">
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {cutting.largest_remainder_cft.toFixed(2)} CFT
                </span>
              </Field>
            )}
            {cutting.needs_reprint && (
              <Field label="Flag">
                <span style={{ color: "#DC2626", fontWeight: 700 }}>🚨 REPRINT NEEDED</span>
              </Field>
            )}
          </Grid>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            Not yet sent to cutting.
          </div>
        )}
      </Section>

      {/* Slabs derived from this block */}
      <Section title={`Slabs derived (${slabs_from_block.total})`}>
        {slabs_from_block.total === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            No slabs reference this block as their source yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {orderedStatusEntries.map(([status, count]) => (
              <span
                key={status}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--surface-alt)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}
              >
                {statusPill(status)}
                <strong>{count}</strong>
              </span>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Tiny presentational helpers ────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 6,
          paddingBottom: 4,
          borderBottom: "1px solid var(--border-light)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: "8px 16px",
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--text)" }}>{children}</div>
    </div>
  );
}
