"use client";

/**
 * Carving dashboard client — renders each of the four tabs (Unassigned,
 * Active, Awaiting Review, Carving Done) as temple-grouped
 * sections. Also exposes a Temple filter dropdown to narrow the view
 * to one specific temple.
 *
 * Temple filter is persisted in the URL as ?temple=... so switching
 * tabs preserves it, and operators who only handle one temple can
 * bookmark their scope.
 *
 * Future-proofing: when we add per-user temple scopes, the server
 * will pre-filter `unassignedSlabs` / `activeJobs` / etc. to the
 * user's scope and pass `scopedTemples` as the only valid filter
 * options. Client code stays the same.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AssignModal } from "./assign-modal";
import { IsoBlockStaticSVG } from "@/components/iso-block-static";
import type { StoneTypeDef } from "@/lib/stone-utils";

type UnassignedSlab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean | null;
  source_block_id: string | null;
  /** Last time this slab's row changed — for slabs in cut_done this
   *  is effectively when it became "ready" (status flipped). Drives
   *  the "Ready in last X days" date filter on the carving toolbar. */
  updated_at?: string | null;
};

type JobRow = {
  id: string;
  slab_requirement_id: string;
  temple: string;
  slab_label: string | null;
  // Slab dimensions + stone are needed to render the 3D thumbnail on
  // each job card. Plumbed through from page.tsx → enrich().
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  vendor_id: string;
  vendor_name: string;
  vendor_type: "CNC" | "Manual";
  status: string;
  due_at: string | null;
  assigned_at: string;
  completed_at: string | null;
  review_approved_at?: string | null;
  progress_phase?: string | null;
  cnc_machine_id?: string | null;
  location?: string | null;
  ready_to_dispatch_at?: string | null;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  machines: Array<{
    id: string;
    machine_code: string;
    status: "idle" | "carving" | "maintenance" | "inactive";
  }>;
  /** Live machine status counts + queue depth, surfaced in the
   *  Assign modal so the carving head can pick a vendor with idle
   *  capacity. */
  live: {
    free: number;
    busy: number;
    maintenance: number;
    total: number;
    queued: number;
  };
};

export function CarvingDashboardClient({
  tab,
  unassignedSlabs,
  activeJobs,
  reviewJobs,
  doneJobs,
  vendors,
  machineCodeById,
  templeNames,
  templeFilter,
  stoneTypes,
}: {
  tab: "unassigned" | "active" | "review" | "done";
  unassignedSlabs: UnassignedSlab[];
  activeJobs: JobRow[];
  reviewJobs: JobRow[];
  doneJobs: JobRow[];
  vendors: Vendor[];
  machineCodeById: Record<string, string>;
  /** Every temple that appears in any of the four datasets. Dropdown source. */
  templeNames: string[];
  /** Currently-selected temple filter. "" or "all" means no filter. */
  templeFilter: string;
  /** Stone palette definitions for the 3D thumbnails on cards. */
  stoneTypes: StoneTypeDef[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [assigning, setAssigning] = useState<UnassignedSlab | null>(null);

  // ── Filter / view state ──────────────────────────────────────────
  // Search across slab id, label, and temple. Lower-cased compare.
  const [query, setQuery] = useState("");
  const [stoneFilter, setStoneFilter] = useState("all");
  const [priorityOnly, setPriorityOnly] = useState(false);
  // Unassigned tab can render either temple-grouped (default, good
  // when the carving head is working through one temple at a time)
  // or as a flat searchable grid (better with a query active).
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  // Active / Awaiting Review / Carving Done can be grouped by vendor
  // (default — what the carving head usually wants) or by temple.
  // The Unassigned tab is always temple-or-flat (no vendor yet).
  const [jobsGroupBy, setJobsGroupBy] = useState<"vendor" | "temple">("vendor");
  // Date filter — meaning depends on tab:
  //   unassigned → "ready since" (slab.updated_at)
  //   active     → "assigned in"
  //   review     → "completed in"
  //   done       → "approved in"
  // Default 'all' keeps the old behaviour.
  const [dateFilter, setDateFilter] = useState<"all" | "1d" | "2d" | "7d" | "30d">("all");

  // Cmd/Ctrl-K or `/` focuses the search input — power users can fly.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isInput =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Temple filter handler — updates URL, preserving tab.
  function setTempleFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== "all") params.set("temple", next);
    else params.delete("temple");
    const q = params.toString();
    router.replace(q ? `/carving?${q}` : "/carving");
  }

  // Stones derived from the actual data — saves us plumbing another
  // list from the server. Sorted alphabetically.
  const stoneNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of unassignedSlabs) if (s.stone) set.add(s.stone);
    for (const j of activeJobs) if (j.stone) set.add(j.stone);
    for (const j of reviewJobs) if (j.stone) set.add(j.stone);
    for (const j of doneJobs) if (j.stone) set.add(j.stone);
    return [...set].sort();
  }, [unassignedSlabs, activeJobs, reviewJobs, doneJobs]);

  const queryNorm = query.trim().toLowerCase();

  // Generic filter that works on both unassigned slabs and job rows.
  // Pulls the right id/label fields off either shape.
  function matches(item: {
    id?: string;
    slab_requirement_id?: string;
    label?: string | null;
    slab_label?: string | null;
    temple: string;
    stone: string | null;
    priority?: boolean | null;
  }): boolean {
    if (templeFilter && templeFilter !== "all" && item.temple !== templeFilter) return false;
    if (stoneFilter !== "all" && item.stone !== stoneFilter) return false;
    if (priorityOnly && !item.priority) return false;
    if (queryNorm) {
      const id = (item.id ?? item.slab_requirement_id ?? "").toLowerCase();
      const lbl = (item.label ?? item.slab_label ?? "").toLowerCase();
      const tem = item.temple.toLowerCase();
      if (!id.includes(queryNorm) && !lbl.includes(queryNorm) && !tem.includes(queryNorm)) {
        return false;
      }
    }
    return true;
  }

  // Date filter helper — returns true if the row falls within the
  // currently-selected date window. `all` always passes.
  function passesDate(iso: string | null | undefined): boolean {
    if (dateFilter === "all") return true;
    if (!iso) return false;
    const days =
      dateFilter === "1d" ? 1 : dateFilter === "2d" ? 2 : dateFilter === "7d" ? 7 : 30;
    return Date.now() - new Date(iso).getTime() <= days * 86400000;
  }

  const filteredUnassigned = useMemo(
    () => unassignedSlabs.filter((s) => matches(s) && passesDate(s.updated_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unassignedSlabs, templeFilter, stoneFilter, priorityOnly, queryNorm, dateFilter],
  );
  const filteredActive = useMemo(
    () => activeJobs.filter((j) => matches(j) && passesDate(j.assigned_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeJobs, templeFilter, stoneFilter, priorityOnly, queryNorm, dateFilter],
  );
  const filteredReview = useMemo(
    () => reviewJobs.filter((j) => matches(j) && passesDate(j.completed_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewJobs, templeFilter, stoneFilter, priorityOnly, queryNorm, dateFilter],
  );
  const filteredDone = useMemo(
    () => doneJobs.filter((j) => matches(j) && passesDate(j.review_approved_at ?? null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doneJobs, templeFilter, stoneFilter, priorityOnly, queryNorm, dateFilter],
  );

  const hasAnyFilter =
    queryNorm.length > 0 ||
    (templeFilter && templeFilter !== "all") ||
    stoneFilter !== "all" ||
    priorityOnly ||
    dateFilter !== "all";

  function clearAllFilters() {
    setQuery("");
    setStoneFilter("all");
    setPriorityOnly(false);
    setTempleFilter("all");
    setDateFilter("all");
  }

  // Label for the date pill row depends on which tab is active.
  const dateFilterLabel =
    tab === "unassigned"
      ? "Ready in"
      : tab === "active"
        ? "Assigned in"
        : tab === "review"
          ? "Completed in"
          : "Approved in";

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  function daysUntil(iso: string | null) {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  }

  // Result count for the current tab — displayed in the toolbar.
  const currentTabCount =
    tab === "unassigned"
      ? filteredUnassigned.length
      : tab === "active"
        ? filteredActive.length
        : tab === "review"
          ? filteredReview.length
          : filteredDone.length;

  const filterBar = (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 4,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          flexWrap: "wrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}
      >
        {/* Search — primary control, gets the most weight */}
        <div
          style={{
            position: "relative",
            flex: "1 1 280px",
            minWidth: 220,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              pointerEvents: "none",
              fontSize: 14,
            }}
          >
            🔎
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search slab id, label or temple…   (press / to focus)"
            style={{
              width: "100%",
              padding: "8px 32px 8px 32px",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 14,
                padding: 4,
              }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Temple */}
        <select
          value={templeFilter || "all"}
          onChange={(e) => setTempleFilter(e.target.value)}
          title="Filter by temple"
          style={{
            fontSize: 12,
            padding: "7px 10px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
            minWidth: 160,
          }}
        >
          <option value="all">All temples</option>
          {templeNames.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Stone */}
        {stoneNames.length > 0 && (
          <select
            value={stoneFilter}
            onChange={(e) => setStoneFilter(e.target.value)}
            title="Filter by stone"
            style={{
              fontSize: 12,
              padding: "7px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
              minWidth: 120,
            }}
          >
            <option value="all">All stones</option>
            {stoneNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}

        {/* Priority toggle */}
        <button
          type="button"
          onClick={() => setPriorityOnly((p) => !p)}
          title="Show only ⚡ priority slabs"
          style={{
            padding: "7px 12px",
            fontSize: 12,
            fontWeight: 700,
            border: `1.5px solid ${priorityOnly ? "#dc2626" : "var(--border)"}`,
            background: priorityOnly ? "rgba(220,38,38,0.08)" : "var(--surface)",
            color: priorityOnly ? "#991b1b" : "var(--muted)",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ⚡ Priority
        </button>

        {/* View toggle.
            Unassigned tab: Grouped (by temple) vs Flat list.
            Other tabs: Vendor vs Temple grouping (vendor = default
            since the carving head usually works per-vendor). */}
        {tab === "unassigned" ? (
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {(
              [
                { v: "grouped", label: "🏛 Grouped" },
                { v: "flat", label: "▦ Flat" },
              ] as const
            ).map((m) => (
              <button
                key={m.v}
                type="button"
                onClick={() => setViewMode(m.v)}
                style={{
                  padding: "7px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  border: "none",
                  background: viewMode === m.v ? "var(--gold-dark)" : "var(--bg)",
                  color: viewMode === m.v ? "#fff" : "var(--muted)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {(
              [
                { v: "vendor", label: "👷 By vendor" },
                { v: "temple", label: "🏛 By temple" },
              ] as const
            ).map((m) => (
              <button
                key={m.v}
                type="button"
                onClick={() => setJobsGroupBy(m.v)}
                style={{
                  padding: "7px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  border: "none",
                  background: jobsGroupBy === m.v ? "var(--gold-dark)" : "var(--bg)",
                  color: jobsGroupBy === m.v ? "#fff" : "var(--muted)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Result count + clear */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
            {currentTabCount} result{currentTabCount !== 1 ? "s" : ""}
          </span>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearAllFilters}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                padding: "5px 10px",
                fontSize: 11,
                borderRadius: 5,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ✕ Clear all
            </button>
          )}
        </div>
      </div>

      {/* Date filter pill row — second line in the toolbar so it
          doesn't crowd the search input. Label updates per tab so
          it reads naturally ("Ready in last 7 days" on Unassigned,
          "Assigned in" on Active, etc). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          marginTop: 6,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {dateFilterLabel}
        </span>
        {(
          [
            { v: "all", label: "All time" },
            { v: "1d", label: "Today" },
            { v: "2d", label: "Last 2d" },
            { v: "7d", label: "Last 7d" },
            { v: "30d", label: "Last 30d" },
          ] as const
        ).map((opt) => {
          const isSelected = dateFilter === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => setDateFilter(opt.v)}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: isSelected ? 700 : 500,
                border: `1.5px solid ${isSelected ? "var(--gold-dark)" : "var(--border)"}`,
                background: isSelected ? "rgba(180,115,51,0.1)" : "var(--bg)",
                color: isSelected ? "var(--gold-dark)" : "var(--muted)",
                borderRadius: 999,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {filterBar}

      {tab === "unassigned" && (
        <UnassignedByTemple
          slabs={filteredUnassigned}
          stoneTypes={stoneTypes}
          viewMode={viewMode}
          onAssign={(s) => setAssigning(s)}
        />
      )}

      {tab === "active" && (
        <JobsByTemple
          jobs={filteredActive}
          machineCodeById={machineCodeById}
          stoneTypes={stoneTypes}
          groupBy={jobsGroupBy}
          fields={["deadline", "phase"]}
          emptyMessage="No active carving jobs. Assign some slabs from the Unassigned tab."
          fmtDate={fmtDate}
          daysUntil={daysUntil}
        />
      )}

      {tab === "review" && (
        <JobsByTemple
          jobs={filteredReview}
          machineCodeById={machineCodeById}
          stoneTypes={stoneTypes}
          groupBy={jobsGroupBy}
          fields={["completed"]}
          emptyMessage="Nothing waiting for review. When a vendor marks a job complete, it lands here."
          fmtDate={fmtDate}
          daysUntil={daysUntil}
        />
      )}

      {tab === "done" && (
        <JobsByTemple
          jobs={filteredDone}
          machineCodeById={machineCodeById}
          stoneTypes={stoneTypes}
          groupBy={jobsGroupBy}
          fields={["approved", "location", "ready"]}
          emptyMessage="No slabs in Carving Done yet."
          fmtDate={fmtDate}
          daysUntil={daysUntil}
        />
      )}

      {assigning && (
        <AssignModal slab={assigning} vendors={vendors} onClose={() => setAssigning(null)} />
      )}
    </>
  );
}

// ─── Slab 3D thumbnail (used on cards) ─────────────────────────────────
// Renders a single slab as a 3D box. We treat the slab dimensions as
// the "block" passed to IsoBlockStaticSVG and pass an empty placed
// array — gives us a clean coloured box with the right proportions.
// Stone palette comes from stoneTypes (with built-in fallback).
//
// The SVG inside IsoBlockStaticSVG fills its container at 100% width,
// so the thumbnail's footprint is controlled by the OUTER wrapper —
// fixed-height row with a small inner box that the SVG fits into.
// Keeps every card the same height regardless of slab proportions.
function SlabThumb({
  stone,
  l,
  w,
  t,
  stoneTypes,
}: {
  stone: string | null;
  l: number;
  w: number;
  t: number;
  stoneTypes: StoneTypeDef[];
}) {
  // Guard against zero dims (would crash the SVG math)
  if (!l || !w || !t) {
    return (
      <div
        style={{
          height: 70,
          background: "var(--surface-alt)",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted-light)",
          fontSize: 11,
        }}
      >
        no dimensions
      </div>
    );
  }
  return (
    <div
      style={{
        height: 80,
        background: "var(--surface-alt)",
        borderRadius: 6,
        padding: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 90, maxHeight: 72, display: "flex" }}>
        <IsoBlockStaticSVG
          block={{ l, w, h: t, stone: stone ?? "" }}
          placed={[]}
          size={90}
          stoneTypes={stoneTypes}
        />
      </div>
    </div>
  );
}

// ─── Unassigned tab — grouped by temple ─────────────────────────────────

function UnassignedByTemple({
  slabs,
  stoneTypes,
  viewMode,
  onAssign,
}: {
  slabs: UnassignedSlab[];
  stoneTypes: StoneTypeDef[];
  viewMode: "grouped" | "flat";
  onAssign: (s: UnassignedSlab) => void;
}) {
  const groups = useMemo(() => groupByTemple(slabs, (s) => s.temple), [slabs]);

  if (slabs.length === 0) {
    return (
      <section className="page-card">
        <div style={{ textAlign: "center", padding: "32px 20px", color: "var(--muted-light)" }}>
          🎉 No slabs waiting for carving assignment in this view.
        </div>
      </section>
    );
  }

  const openByDefault = groups.length <= 3;

  // Card render reused by both grouped and flat views — keeps the
  // visual identical so the user can switch view modes without
  // re-learning the layout.
  const renderCard = (s: UnassignedSlab) => (
    <div
      key={s.id}
      style={{
        padding: "8px 10px",
        background: s.priority ? "rgba(220,38,38,0.04)" : "var(--surface)",
        border: `1px solid ${s.priority ? "rgba(220,38,38,0.2)" : "var(--border)"}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <SlabThumb
        stone={s.stone}
        l={Number(s.length_ft)}
        w={Number(s.width_ft)}
        t={Number(s.thickness_ft)}
        stoneTypes={stoneTypes}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.priority && "⚡ "}
          {s.id}
        </span>
        {s.stone && (
          <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>
            {s.stone}
          </span>
        )}
      </div>
      {/* In flat view we surface temple under the slab id since the
          temple group header is gone. In grouped view temple is in
          the accordion header so we hide it here. */}
      {viewMode === "flat" && (
        <div style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          🏛 {s.temple}
        </div>
      )}
      {s.label && (
        <div style={{ fontSize: 10, color: "var(--muted)" }}>{s.label}</div>
      )}
      <div
        style={{
          fontSize: 10,
          color: "var(--muted-light)",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {s.length_ft}×{s.width_ft}×{s.thickness_ft}&Prime;
        {s.source_block_id && ` · ${s.source_block_id}`}
      </div>
      {/* Ready-since pill — tells the carving head how long this
          slab has been sitting in cut_done. Older = more pressure. */}
      {s.updated_at && (() => {
        const ageMs = Date.now() - new Date(s.updated_at).getTime();
        const ageDays = Math.floor(ageMs / 86400000);
        const tone =
          ageDays >= 14
            ? { fg: "#991b1b", bg: "rgba(220,38,38,0.08)", icon: "⚠" }
            : ageDays >= 7
              ? { fg: "#b45309", bg: "rgba(217,119,6,0.08)", icon: "⏳" }
              : { fg: "#15803d", bg: "rgba(22,163,74,0.08)", icon: "✓" };
        const label =
          ageDays === 0
            ? "ready today"
            : ageDays === 1
              ? "ready 1 day ago"
              : `ready ${ageDays} days ago`;
        return (
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: tone.fg,
              background: tone.bg,
              padding: "3px 7px",
              borderRadius: 5,
              alignSelf: "flex-start",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {tone.icon} {label}
          </div>
        );
      })()}
      <button
        type="button"
        onClick={() => onAssign(s)}
        className="primary-button"
        style={{ marginTop: 4, fontSize: 13, padding: "9px 12px", fontWeight: 700 }}
      >
        Assign to Vendor →
      </button>
    </div>
  );

  // ── Flat view — one big grid, no temple grouping. Best when a
  //    search query is active or the carving head wants to scan
  //    across temples.
  if (viewMode === "flat") {
    return (
      <>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
          {slabs.length} slab{slabs.length > 1 ? "s" : ""} across {groups.length} temple
          {groups.length > 1 ? "s" : ""}.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 8,
          }}
        >
          {slabs.map(renderCard)}
        </div>
      </>
    );
  }

  return (
    <>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        {slabs.length} slab{slabs.length > 1 ? "s" : ""} across {groups.length} temple{groups.length > 1 ? "s" : ""}.
        Assign each to a carving vendor.
      </p>
      {groups.map(({ temple, items }) => (
        <details key={temple} open={openByDefault} style={{ marginBottom: 10 }}>
          <summary
            style={{
              cursor: "pointer",
              padding: "10px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px 10px 0 0",
              display: "flex",
              alignItems: "center",
              gap: 10,
              userSelect: "none",
              listStyle: "none",
            }}
          >
            <span style={{ fontSize: 11 }}>▾</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>🏛 {temple}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--gold-dark)",
                color: "#fff",
                fontFamily: "ui-monospace, monospace",
                minWidth: 24,
                textAlign: "center",
              }}
            >
              {items.length}
            </span>
          </summary>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
              padding: 10,
              display: "grid",
              // Compact card width — fits 4–5 cards per row on a
              // typical desktop instead of 3.
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 8,
            }}
          >
            {items.map(renderCard)}
          </div>
        </details>
      ))}
    </>
  );
}

// ─── Jobs (active / review / done) — grouped by temple ──────────────────

function JobsByTemple({
  jobs,
  machineCodeById,
  stoneTypes,
  groupBy,
  fields,
  emptyMessage,
  fmtDate,
  daysUntil,
}: {
  jobs: JobRow[];
  machineCodeById: Record<string, string>;
  stoneTypes: StoneTypeDef[];
  /** What to group jobs under — 'vendor' is the carving head's
   *  default (they usually work per-vendor); 'temple' for when a
   *  specific temple's status is the question. */
  groupBy: "vendor" | "temple";
  /** Which phase-specific status fields to render on the card. */
  fields: Array<"deadline" | "phase" | "completed" | "approved" | "location" | "ready">;
  emptyMessage: string;
  fmtDate: (iso: string | null) => string;
  daysUntil: (iso: string | null) => number | null;
}) {
  const router = useRouter();
  // Group key + display label depend on groupBy.
  const groups = useMemo(() => {
    if (groupBy === "vendor") {
      return groupByKey(jobs, (j) => j.vendor_name || "(no vendor)");
    }
    return groupByKey(jobs, (j) => j.temple);
  }, [jobs, groupBy]);
  const groupIcon = groupBy === "vendor" ? "👷" : "🏛";
  const groupNoun = groupBy === "vendor" ? "vendor" : "temple";

  if (jobs.length === 0) {
    return (
      <section className="page-card">
        <div style={{ textAlign: "center", padding: "32px 20px", color: "var(--muted-light)" }}>
          {emptyMessage}
        </div>
      </section>
    );
  }

  const openByDefault = groups.length <= 3;

  return (
    <>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        {jobs.length} job{jobs.length > 1 ? "s" : ""} across {groups.length} {groupNoun}
        {groups.length > 1 ? "s" : ""}.
      </p>
      {groups.map(({ key, items }) => (
        <details key={key} open={openByDefault} style={{ marginBottom: 10 }}>
          <summary
            style={{
              cursor: "pointer",
              padding: "10px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px 10px 0 0",
              display: "flex",
              alignItems: "center",
              gap: 10,
              userSelect: "none",
              listStyle: "none",
            }}
          >
            <span style={{ fontSize: 11 }}>▾</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {groupIcon} {key}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--gold-dark)",
                color: "#fff",
                fontFamily: "ui-monospace, monospace",
                minWidth: 24,
                textAlign: "center",
              }}
            >
              {items.length}
            </span>
          </summary>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
              padding: 10,
              display: "grid",
              // Compact card width — fits 4–5 cards per row on a
              // typical desktop instead of 3.
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 8,
            }}
          >
            {items.map((j) => {
              const days = daysUntil(j.due_at);
              const overdue = days !== null && days < 0;
              const goToDetail = () => router.push(`/carving/${j.id}`);
              return (
                <div
                  key={j.id}
                  onClick={goToDetail}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      goToDetail();
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  style={{
                    padding: "8px 10px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    cursor: "pointer",
                    transition: "border-color 0.12s, background 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--surface-alt)";
                    e.currentTarget.style.borderColor = "var(--gold-dark)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--surface)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  {/* 3D slab thumbnail */}
                  <SlabThumb
                    stone={j.stone}
                    l={j.length_ft}
                    w={j.width_ft}
                    t={j.thickness_ft}
                    stoneTypes={stoneTypes}
                  />

                  {/* Header: slab id + stone */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.slab_requirement_id}
                    </span>
                    {j.stone && (
                      <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>
                        {j.stone}
                      </span>
                    )}
                  </div>

                  {j.slab_label && (
                    <div style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.slab_label}
                    </div>
                  )}

                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--muted-light)",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {j.length_ft}×{j.width_ft}×{j.thickness_ft}&Prime;
                  </div>

                  {/* Vendor + machine */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingTop: 4,
                      borderTop: "1px dashed var(--border-light)",
                      fontSize: 11,
                      gap: 6,
                    }}
                  >
                    <div style={{ minWidth: 0, overflow: "hidden" }}>
                      <div style={{ fontWeight: 600, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {j.vendor_name}
                      </div>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>{j.vendor_type}</div>
                    </div>
                    <div
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 10,
                        color: "var(--muted)",
                        flexShrink: 0,
                      }}
                    >
                      {j.cnc_machine_id ? machineCodeById[j.cnc_machine_id] ?? "" : ""}
                    </div>
                  </div>

                  {/* Phase-specific footer rows */}
                  {fields.includes("deadline") && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 10 }}>
                      <span className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Deadline
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: overdue
                            ? "#DC2626"
                            : days !== null && days <= 2
                              ? "#D97706"
                              : "var(--text)",
                        }}
                      >
                        {days === null
                          ? "—"
                          : overdue
                            ? `Overdue ${Math.abs(days)}d`
                            : days === 0
                              ? "Due today"
                              : `${days}d`}
                      </span>
                    </div>
                  )}
                  {fields.includes("phase") && j.progress_phase && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, gap: 6 }}>
                      <span className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Phase
                      </span>
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        {j.progress_phase}
                      </span>
                    </div>
                  )}
                  {fields.includes("completed") && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                      <span className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Completed
                      </span>
                      <span style={{ color: "var(--text)" }}>{fmtDate(j.completed_at)}</span>
                    </div>
                  )}
                  {fields.includes("approved") && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                      <span className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Approved
                      </span>
                      <span style={{ color: "var(--text)" }}>
                        {j.status === "dispatched"
                          ? "✓ Dispatched"
                          : fmtDate(j.review_approved_at ?? null)}
                      </span>
                    </div>
                  )}
                  {fields.includes("location") && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, gap: 6 }}>
                      <span className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Location
                      </span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {j.location ? (
                          <span style={{ color: "var(--text)" }}>📍 {j.location}</span>
                        ) : (
                          <span style={{ color: "#D97706", fontStyle: "italic" }}>not set</span>
                        )}
                      </span>
                    </div>
                  )}
                  {fields.includes("ready") && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                      <span className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Status
                      </span>
                      {j.status === "dispatched" ? (
                        <span style={{ color: "var(--muted)" }}>✓ Dispatched</span>
                      ) : j.ready_to_dispatch_at ? (
                        <span style={{ color: "#15803d", fontWeight: 600 }}>✓ Ready</span>
                      ) : (
                        <span style={{ color: "#D97706", fontWeight: 600 }}>Awaiting location</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Generic grouping helper — used by JobsByTemple to group on any key
// (vendor name, temple, etc). Returns groups sorted alphabetically by
// key so the layout is stable across renders.
function groupByKey<T>(items: T[], getKey: (item: T) => string): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = getKey(item) || "(unknown)";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return [...map.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function groupByTemple<T>(items: T[], getTemple: (item: T) => string): Array<{ temple: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const t = getTemple(item) || "(no temple)";
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(item);
  }
  return [...map.entries()]
    .map(([temple, items]) => ({ temple, items }))
    .sort((a, b) => a.temple.localeCompare(b.temple));
}
