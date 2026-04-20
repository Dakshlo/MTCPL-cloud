"use client";

/**
 * Client-side wrapper for the Block Journey page.
 * - Filters (stone / facility / quality / size bucket / date range / resolution)
 * - Sort
 * - Mode toggle (yield vs recovered) — persisted in URL as ?mode=
 * - Summary KPI tiles at the top, recomputed live on any filter change
 * - List of LineageCard rows
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { facilityLabel, FACILITIES } from "@/lib/yards";
import { LineageCard, type ViewMode } from "./block-journey-lineage-card";
import { aggregateLineages, type Lineage } from "@/app/(app)/block-journey/build-lineages";

type Resolution = "all" | "resolved" | "in_progress";
type SortKey = "eff_desc" | "eff_asc" | "cft_desc" | "cft_asc" | "newest" | "oldest";
type SizeBucket = "all" | "small" | "medium" | "large";

export function BlockJourneyClient({
  lineages,
  profilesMap,
  stoneOptions,
  initialMode,
}: {
  lineages: Lineage[];
  profilesMap: Record<string, string>;
  stoneOptions: string[];
  initialMode: ViewMode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Mode (persisted in URL) ────────────────────────────────────────────
  const mode: ViewMode = initialMode;
  function setMode(next: ViewMode) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "yield") params.delete("mode");
    else params.set("mode", next);
    const q = params.toString();
    router.replace(q ? `/block-journey?${q}` : "/block-journey");
  }

  // ── Filters (client state) ─────────────────────────────────────────────
  const [stone, setStone] = useState<string>("all");
  const [facility, setFacility] = useState<"all" | "mtcpl" | "riico">("all");
  const [quality, setQuality] = useState<"all" | "A" | "B">("all");
  const [sizeBucket, setSizeBucket] = useState<SizeBucket>("all");
  const [resolution, setResolution] = useState<Resolution>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("eff_desc");

  // ── Apply filters ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return lineages.filter((l) => {
      if (stone !== "all" && l.rootStone !== stone) return false;
      if (facility !== "all" && l.rootFacility !== facility) return false;
      if (quality !== "all" && l.rootQuality !== quality) return false;
      if (sizeBucket !== "all" && l.sizeBucket !== sizeBucket) return false;
      if (resolution === "resolved" && !l.isResolved) return false;
      if (resolution === "in_progress" && l.isResolved) return false;
      if (dateFrom && l.rootCreatedAt && l.rootCreatedAt < dateFrom) return false;
      if (dateTo && l.rootCreatedAt && l.rootCreatedAt > dateTo + "T23:59:59Z") return false;
      return true;
    });
  }, [lineages, stone, facility, quality, sizeBucket, resolution, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortKey) {
        case "eff_desc":
          return (mode === "yield" ? b.slabPct - a.slabPct : b.recoveredPct - a.recoveredPct);
        case "eff_asc":
          return (mode === "yield" ? a.slabPct - b.slabPct : a.recoveredPct - b.recoveredPct);
        case "cft_desc":
          return b.originalCft - a.originalCft;
        case "cft_asc":
          return a.originalCft - b.originalCft;
        case "newest":
          return (b.rootCreatedAt ?? "").localeCompare(a.rootCreatedAt ?? "");
        case "oldest":
          return (a.rootCreatedAt ?? "").localeCompare(b.rootCreatedAt ?? "");
      }
    });
    return copy;
  }, [filtered, sortKey, mode]);

  const agg = useMemo(() => aggregateLineages(filtered), [filtered]);

  function exportExcel() {
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (stone !== "all") params.set("stone", stone);
    if (facility !== "all") params.set("facility", facility);
    if (quality !== "all") params.set("quality", quality);
    if (sizeBucket !== "all") params.set("size", sizeBucket);
    if (resolution !== "all") params.set("resolution", resolution);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    window.location.href = `/api/block-journey/export?${params.toString()}`;
  }

  return (
    <section className="page-card">
      {/* Header */}
      <div className="record-head" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Block Journey</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Track every Fresh block end-to-end — true slab yield across the full cutting lineage, not just one cut.
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
          padding: "10px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          View mode
        </div>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <ModeButton active={mode === "yield"} onClick={() => setMode("yield")} color="#15803d">
            Yield
          </ModeButton>
          <ModeButton active={mode === "recovered"} onClick={() => setMode("recovered")} color="#b45309">
            Recovered
          </ModeButton>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", flex: 1, minWidth: 240 }}>
          {mode === "yield"
            ? "Yield = slabs ÷ original. Conservative — only counts sellable slabs. Use for pricing."
            : "Recovered = (slabs + live remainders) ÷ original. Optimistic — credits in-inventory restocks as recovered."}
        </div>
      </div>

      {/* Filters bar */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          padding: "10px 14px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          marginBottom: 14,
        }}
      >
        <Select
          label="Stone"
          value={stone}
          onChange={setStone}
          options={[{ value: "all", label: "All stones" }, ...stoneOptions.map((s) => ({ value: s, label: s }))]}
        />
        <Select
          label="Facility"
          value={facility}
          onChange={(v) => setFacility(v as typeof facility)}
          options={[
            { value: "all", label: "All facilities" },
            ...FACILITIES.map((f) => ({ value: f, label: facilityLabel(f) })),
          ]}
        />
        <Select
          label="Quality"
          value={quality}
          onChange={(v) => setQuality(v as typeof quality)}
          options={[
            { value: "all", label: "All grades" },
            { value: "A", label: "Grade A" },
            { value: "B", label: "Grade B" },
          ]}
        />
        <Select
          label="Size"
          value={sizeBucket}
          onChange={(v) => setSizeBucket(v as SizeBucket)}
          options={[
            { value: "all", label: "Any size" },
            { value: "small", label: "Small (<30 CFT)" },
            { value: "medium", label: "Medium (30–80)" },
            { value: "large", label: "Large (>80)" },
          ]}
        />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Added</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={inputStyle}
          />
          <span style={{ color: "var(--muted)" }}>–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Resolution segmented */}
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {(["all", "resolved", "in_progress"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setResolution(k)}
              style={{
                padding: "5px 11px",
                fontSize: 12,
                fontWeight: 600,
                background: resolution === k ? "var(--gold-dark)" : "transparent",
                color: resolution === k ? "#fff" : "var(--muted)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {k === "all" ? "All" : k === "resolved" ? "Resolved" : "In progress"}
            </button>
          ))}
        </div>

        <Select
          label="Sort"
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          options={[
            { value: "eff_desc", label: mode === "yield" ? "Highest yield" : "Highest recovered" },
            { value: "eff_asc", label: mode === "yield" ? "Lowest yield" : "Lowest recovered" },
            { value: "cft_desc", label: "Biggest CFT first" },
            { value: "cft_asc", label: "Smallest CFT first" },
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
          ]}
        />

        <button
          type="button"
          onClick={exportExcel}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
            marginLeft: "auto",
          }}
        >
          ⬇ Export Excel
        </button>
      </div>

      {/* Summary KPI tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 18 }}>
        <Tile label="Lineages">
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
            {agg.totalLineages}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            {agg.resolvedCount} resolved · {agg.inProgressCount} in progress
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {agg.totalOriginalCft.toFixed(1)} CFT original · {agg.totalSlabCft.toFixed(1)} CFT slabs
          </div>
        </Tile>

        {mode === "yield" ? (
          <>
            <Tile label="Weighted slab yield" accent="good">
              <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "#15803d" }}>
                {agg.weightedSlabPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                Simple avg: {agg.simpleSlabPctAvg.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Use this for tender pricing
              </div>
            </Tile>
            <Tile label="Still pending" accent="warn">
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "#b45309" }}>
                {agg.weightedLivePct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                {agg.totalLiveCft.toFixed(1)} CFT still in yard
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Will settle as live pieces get cut
              </div>
            </Tile>
          </>
        ) : (
          <>
            <Tile label="Weighted recovered" accent="warn">
              <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "#b45309" }}>
                {agg.weightedRecoveredPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                Simple avg: {agg.simpleRecoveredPctAvg.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Slabs + still-live restocks
              </div>
            </Tile>
            <Tile label="Real waste" accent="bad">
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "#b91c1c" }}>
                {agg.weightedWastePct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                {agg.totalWasteCft.toFixed(1)} CFT truly lost
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Kerf + scraps + discards
              </div>
            </Tile>
          </>
        )}
      </div>

      {/* Lineage list */}
      {sorted.length === 0 ? (
        <div
          style={{
            padding: "30px 20px",
            textAlign: "center",
            color: "var(--muted)",
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: 10,
          }}
        >
          No lineages match these filters.
        </div>
      ) : (
        sorted.map((l) => (
          <LineageCard
            key={l.rootId}
            lineage={l}
            mode={mode}
            createdByName={l.rootCreatedBy ? (profilesMap[l.rootCreatedBy] ?? null) : null}
          />
        ))
      )}
    </section>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────

function ModeButton({
  active, onClick, color, children,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 16px",
        fontSize: 13,
        fontWeight: 700,
        background: active ? color : "transparent",
        color: active ? "#fff" : "var(--muted)",
        border: "none",
        cursor: "pointer",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </button>
  );
}

function Tile({
  label, accent = "neutral", children,
}: {
  label: string;
  accent?: "good" | "warn" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  const borderColor =
    accent === "good" ? "rgba(22,101,52,0.35)" :
    accent === "warn" ? "rgba(180,83,9,0.35)" :
    accent === "bad" ? "rgba(185,28,28,0.35)" :
    "var(--border)";
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--surface)",
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  background: "var(--surface)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  outline: "none",
};
