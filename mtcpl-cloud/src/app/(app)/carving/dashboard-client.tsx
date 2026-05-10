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
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AssignModal } from "./assign-modal";
import {
  approveCarvingJobAction,
  rejectCarvingJobAction,
  getJobEvents,
  type JobEvent,
} from "./actions";
import { IsoBlockStaticSVG } from "@/components/iso-block-static";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { VendorGridSection, type FloorVendor } from "./floor/floor-client";

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
  /** Free-text description per slab (e.g. "NE corner, set 2"). Surfaces
   *  on the card so the carving head doesn't have to drill into the
   *  detail page just to read the design note. */
  slab_description?: string | null;
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
  /** Urgency stamp from the assign step. Used to surface a chip on
   *  Active cards beside the queued/carving status ribbon. */
  urgency?: "normal" | "urgent" | null;
  due_at: string | null;
  assigned_at: string;
  completed_at: string | null;
  review_approved_at?: string | null;
  progress_phase?: string | null;
  cnc_machine_id?: string | null;
  location?: string | null;
  ready_to_dispatch_at?: string | null;
  /** Live timer fields for the Active tab card. loaded_at is set by
   *  loadSlabOnMachineAction; minutes prefer the vendor's tighter
   *  estimate, fall back to the carving head's rough one. */
  loaded_at?: string | null;
  vendor_estimated_minutes?: number | null;
  estimated_minutes?: number | null;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  machines: Array<{
    id: string;
    machine_code: string;
    status: "idle" | "carving" | "maintenance" | "inactive";
    machine_type?: "single_head" | "multi_head_2" | "lathe";
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
  floorVendors,
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
  /** Floor view payload — only sent when on the Active tab. Used to
   *  render vendor cockpit sections above the active job cards. */
  floorVendors?: FloorVendor[] | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [assigning, setAssigning] = useState<UnassignedSlab | null>(null);
  // Job detail peek — opened by clicking any card on Active /
  // Awaiting Review / Carving Done. Center modal with slab info,
  // assignment, and inline approve/reject forms.
  const [peekJob, setPeekJob] = useState<JobRow | null>(null);

  // ── Filter / view state ──────────────────────────────────────────
  // Single search box covers slab id, label, description, temple,
  // stone, vendor name, status. Lower-cased compare.
  const [query, setQuery] = useState("");
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

  const queryNorm = query.trim().toLowerCase();

  // Single fat filter — temple + stone dropdowns were dropped per
  // the carving head's request: "just keep search bar". Search now
  // matches across slab id / label / description / temple / stone /
  // vendor name / status so the user can find anything by typing.
  function matches(item: {
    id?: string;
    slab_requirement_id?: string;
    label?: string | null;
    slab_label?: string | null;
    slab_description?: string | null;
    temple: string;
    stone: string | null;
    vendor_name?: string;
    status?: string;
    priority?: boolean | null;
    source_block_id?: string | null;
  }): boolean {
    if (priorityOnly && !item.priority) return false;
    if (queryNorm) {
      const haystack = [
        item.id,
        item.slab_requirement_id,
        item.label,
        item.slab_label,
        item.slab_description,
        item.temple,
        item.stone,
        item.vendor_name,
        item.status,
        item.source_block_id,
      ]
        .filter(Boolean)
        .join(" · ")
        .toLowerCase();
      if (!haystack.includes(queryNorm)) return false;
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
    [unassignedSlabs, priorityOnly, queryNorm, dateFilter],
  );
  const filteredActive = useMemo(
    () => activeJobs.filter((j) => matches(j) && passesDate(j.assigned_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeJobs, priorityOnly, queryNorm, dateFilter],
  );
  const filteredReview = useMemo(
    () => reviewJobs.filter((j) => matches(j) && passesDate(j.completed_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewJobs, priorityOnly, queryNorm, dateFilter],
  );
  const filteredDone = useMemo(
    () => doneJobs.filter((j) => matches(j) && passesDate(j.review_approved_at ?? null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doneJobs, priorityOnly, queryNorm, dateFilter],
  );

  const hasAnyFilter = queryNorm.length > 0 || priorityOnly || dateFilter !== "all";

  function clearAllFilters() {
    setQuery("");
    setPriorityOnly(false);
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
        {/* One big search bar — the only filter the user wants here.
            Matches slab id, label, description, temple, stone, vendor
            name, status, source block. Temple + stone dropdowns are
            gone; just type into the search to narrow down. */}
        <div
          style={{
            position: "relative",
            flex: "1 1 320px",
            minWidth: 240,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              pointerEvents: "none",
              fontSize: 16,
            }}
          >
            🔎
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anything — slab id, temple, stone, vendor, label…   (press / to focus)"
            style={{
              width: "100%",
              padding: "10px 36px 10px 38px",
              fontSize: 14,
              border: "1px solid var(--border)",
              borderRadius: 8,
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
                right: 8,
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
        <>
          {floorVendors && floorVendors.length > 0 && (
            <ActiveFloorEmbed vendors={floorVendors} />
          )}
          <JobsByTemple
            jobs={filteredActive}
            machineCodeById={machineCodeById}
            stoneTypes={stoneTypes}
            groupBy={jobsGroupBy}
            fields={["deadline", "phase"]}
            emptyMessage="No active carving jobs. Assign some slabs from the Unassigned tab."
            fmtDate={fmtDate}
            daysUntil={daysUntil}
            onOpenJob={(j) => setPeekJob(j)}
          />
        </>
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
          onOpenJob={(j) => setPeekJob(j)}
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
          onOpenJob={(j) => setPeekJob(j)}
        />
      )}

      {assigning && (
        <AssignModal slab={assigning} vendors={vendors} onClose={() => setAssigning(null)} />
      )}

      {peekJob && (
        <JobDetailPeek
          job={peekJob}
          machineCodeById={machineCodeById}
          stoneTypes={stoneTypes}
          onClose={() => setPeekJob(null)}
        />
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

  // Grouped view — temple cards. Click a card → center-peek modal
  // with the slabs inside that temple. Cards show count + a
  // priority-aware summary so the carving head can scan which
  // temples have urgent work without expanding everything.
  return (
    <TempleCardGrid
      groups={groups}
      stoneTypes={stoneTypes}
      slabsTotal={slabs.length}
      onAssign={onAssign}
      renderCard={renderCard}
    />
  );
  void openByDefault; // unused after card refactor
}

// ─── Temple cards — clickable squares; one per temple group.
// Clicking opens a center-peek modal containing the slab cards.
function TempleCardGrid({
  groups,
  slabsTotal,
  renderCard,
}: {
  groups: Array<{ temple: string; items: UnassignedSlab[] }>;
  stoneTypes: StoneTypeDef[];
  slabsTotal: number;
  onAssign: (s: UnassignedSlab) => void;
  renderCard: (s: UnassignedSlab) => React.ReactNode;
}) {
  const [openTemple, setOpenTemple] = useState<string | null>(null);
  const openGroup = openTemple ? groups.find((g) => g.temple === openTemple) ?? null : null;

  return (
    <>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        {slabsTotal} slab{slabsTotal !== 1 ? "s" : ""} across {groups.length} temple
        {groups.length !== 1 ? "s" : ""}. Click a temple to view + assign its slabs.
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
          return (
            <button
              key={temple}
              type="button"
              onClick={() => setOpenTemple(temple)}
              style={{
                textAlign: "left",
                padding: "14px 16px",
                background: urgent > 0 ? "rgba(220,38,38,0.04)" : "var(--surface)",
                border: `1.5px solid ${urgent > 0 ? "rgba(220,38,38,0.3)" : "var(--border)"}`,
                borderRadius: 10,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                transition: "border-color 0.12s, background 0.12s, transform 0.08s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--gold-dark)";
                e.currentTarget.style.background = "var(--surface-alt)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor =
                  urgent > 0 ? "rgba(220,38,38,0.3)" : "var(--border)";
                e.currentTarget.style.background =
                  urgent > 0 ? "rgba(220,38,38,0.04)" : "var(--surface)";
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
              {urgent > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#dc2626",
                    background: "rgba(220,38,38,0.1)",
                    padding: "3px 8px",
                    borderRadius: 5,
                    alignSelf: "flex-start",
                  }}
                >
                  ⚡ {urgent} priority
                </div>
              )}
              <div style={{ marginTop: "auto", fontSize: 11, color: "var(--gold-dark)", fontWeight: 600 }}>
                Open & assign →
              </div>
            </button>
          );
        })}
      </div>

      {openGroup && (
        <TempleSlabsPeek
          temple={openGroup.temple}
          slabs={openGroup.items}
          renderCard={renderCard}
          onClose={() => setOpenTemple(null)}
        />
      )}
    </>
  );
}

// Center-peek modal that shows all slabs in one temple as the same
// card grid the flat view uses. Clicking a slab card's "Assign to
// Vendor" still opens the AssignModal stacked over this peek.
function TempleSlabsPeek({
  temple,
  slabs,
  renderCard,
  onClose,
}: {
  temple: string;
  slabs: UnassignedSlab[];
  renderCard: (s: UnassignedSlab) => React.ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
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
              🏛 Temple
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: 17 }}>
              {temple}
            </h2>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              {slabs.length} slab{slabs.length !== 1 ? "s" : ""} ready to assign
            </p>
          </div>
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
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 8,
            }}
          >
            {slabs.map(renderCard)}
          </div>
        </div>
      </div>
    </div>
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
  onOpenJob,
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
  /** Click handler — opens the JobDetailPeek modal. The card is
   *  no longer a navigation target; clicking opens the peek. */
  onOpenJob: (job: JobRow) => void;
}) {
  // 30-second tick so the "waiting since" timer in the Awaiting
  // Review tab updates without a full reload.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Pick the date that defines "most recent activity" for the
  // current tab — drives both card sort within a group AND the
  // group sort itself. Falls back to assigned_at.
  const primaryDate = (j: JobRow): number => {
    if (fields.includes("approved") && j.review_approved_at) return new Date(j.review_approved_at).getTime();
    if (fields.includes("completed") && j.completed_at) return new Date(j.completed_at).getTime();
    return new Date(j.assigned_at).getTime();
  };

  // Group key + display label depend on groupBy. Within each group
  // we sort items latest-first; the groups themselves sort by their
  // most-recent item so the "freshest" vendor/temple is at top.
  const groups = useMemo(() => {
    const grouped = groupBy === "vendor"
      ? groupByKey(jobs, (j) => j.vendor_name || "(no vendor)")
      : groupByKey(jobs, (j) => j.temple);
    // Sort items inside each group by latest activity desc.
    for (const g of grouped) {
      g.items.sort((a, b) => primaryDate(b) - primaryDate(a));
    }
    // Sort groups by their freshest item desc.
    return grouped.sort((a, b) => {
      const aMax = Math.max(...a.items.map(primaryDate));
      const bMax = Math.max(...b.items.map(primaryDate));
      return bMax - aMax;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, groupBy, fields.join(",")]);
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
              const openPeek = () => onOpenJob(j);
              return (
                <div
                  key={j.id}
                  onClick={openPeek}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openPeek();
                    }
                  }}
                  role="button"
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

                  {/* ACTIVE-tab status ribbon. Surfaces "▶ CARVING NOW"
                      vs "⏳ WAITING" so the carving head + team can
                      tell at a glance whether each row is loaded on a
                      machine or sitting in the vendor's queue.
                      Carving rows show the running-for / remaining
                      duo when a loaded_at + ETA exist. */}
                  {fields.includes("deadline") && (() => {
                    const isCarving = j.status === "carving_in_progress";
                    const isUrgent = j.urgency === "urgent";
                    if (isCarving && j.loaded_at) {
                      const elapsedMin = (now - new Date(j.loaded_at).getTime()) / 60000;
                      const eta = j.vendor_estimated_minutes ?? j.estimated_minutes ?? null;
                      const remaining = eta != null ? eta - elapsedMin : null;
                      const fmtDur = (m: number) => {
                        const a = Math.abs(Math.round(m));
                        if (a < 60) return `${a}m`;
                        if (a < 60 * 24) return `${Math.floor(a / 60)}h ${a % 60}m`;
                        return `${Math.floor(a / (60 * 24))}d ${Math.floor((a % (60 * 24)) / 60)}h`;
                      };
                      return (
                        <div
                          style={{
                            background: "rgba(37,99,235,0.08)",
                            border: "1px solid rgba(37,99,235,0.35)",
                            borderRadius: 6,
                            padding: "5px 8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <div style={{ fontSize: 9, fontWeight: 800, color: "#1d4ed8", letterSpacing: "0.07em" }}>
                            ▶ CARVING NOW
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "#1e3a8a",
                              fontFamily: "ui-monospace, monospace",
                              display: "flex",
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <span>▶ {fmtDur(elapsedMin)}</span>
                            {remaining != null && (
                              <span style={{ color: remaining < 0 ? "#dc2626" : remaining < 15 ? "#b45309" : "#1d4ed8", fontWeight: 700 }}>
                                ⏱ {remaining < 0 ? `${fmtDur(remaining)} over` : `${fmtDur(remaining)} left`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }
                    // Carving_assigned / not loaded yet
                    return (
                      <div
                        style={{
                          background: isUrgent ? "rgba(220,38,38,0.08)" : "rgba(217,119,6,0.08)",
                          border: `1px solid ${isUrgent ? "rgba(220,38,38,0.35)" : "rgba(217,119,6,0.3)"}`,
                          borderRadius: 6,
                          padding: "5px 8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: "0.07em",
                          color: isUrgent ? "#991b1b" : "#b45309",
                        }}
                      >
                        <span>⏳ WAITING (queued)</span>
                        {isUrgent && <span style={{ fontSize: 9, fontWeight: 800 }}>⚡ URGENT</span>}
                      </div>
                    );
                  })()}

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

                  {/* Temple — primary identifying context for the
                      carving head. Always visible (was missing from
                      the card before; user could only see slab id). */}
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    🏛 {j.temple}
                  </div>
                  {j.slab_label && (
                    <div style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.slab_label}
                    </div>
                  )}
                  {/* Free-text description — gives context the carving
                      head needs to brief the vendor (e.g. "NE corner,
                      set 2"). Two-line clamp keeps card height stable. */}
                  {j.slab_description && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        fontStyle: "italic",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                      title={j.slab_description}
                    >
                      “{j.slab_description}”
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

                  {/* Awaiting-review timer — counts UP from completed_at
                      so the carving head can see at a glance how long
                      a job has been blocked on approval. Only renders
                      on the review tab (fields includes 'completed'). */}
                  {fields.includes("completed") && j.completed_at && (() => {
                    const waitingMin = (now - new Date(j.completed_at).getTime()) / 60000;
                    const tone =
                      waitingMin >= 60 * 24
                        ? { fg: "#991b1b", bg: "rgba(220,38,38,0.08)", icon: "⚠" }
                        : waitingMin >= 60 * 4
                          ? { fg: "#b45309", bg: "rgba(217,119,6,0.08)", icon: "⏳" }
                          : { fg: "#15803d", bg: "rgba(22,163,74,0.08)", icon: "⏱" };
                    const label =
                      waitingMin < 60
                        ? `${Math.max(0, Math.round(waitingMin))}m`
                        : waitingMin < 60 * 24
                          ? `${Math.floor(waitingMin / 60)}h ${Math.round(waitingMin % 60)}m`
                          : `${Math.floor(waitingMin / (60 * 24))}d ${Math.floor((waitingMin % (60 * 24)) / 60)}h`;
                    return (
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: tone.fg,
                          background: tone.bg,
                          padding: "3px 8px",
                          borderRadius: 5,
                          alignSelf: "flex-start",
                          fontFamily: "ui-monospace, monospace",
                        }}
                        title={`Awaiting approval since ${new Date(j.completed_at).toLocaleString("en-IN")}`}
                      >
                        {tone.icon} waiting {label}
                      </div>
                    );
                  })()}

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

// ─── Job detail peek modal ──────────────────────────────────────────
//
// Center-peek dialog opened by clicking any card on Active / Awaiting
// Review / Carving Done. Shows everything the carving head usually
// needs without leaving the dashboard:
//   • Slab thumbnail + dimensions + temple + label + description
//   • Assignment summary (vendor, machine, urgency, deadline, status)
//   • Inline approve / reject forms when status = awaiting review
//   • Approved + ready / dispatched info banners when applicable
//   • "Open full job ↗" link to /carving/[id] for the event timeline
//
// We deliberately rely only on the JobRow already in memory — no
// extra fetch — so opening the peek is instant.
function JobDetailPeek({
  job,
  machineCodeById,
  stoneTypes,
  onClose,
}: {
  job: JobRow;
  machineCodeById: Record<string, string>;
  stoneTypes: StoneTypeDef[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

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

  const inReview = !!job.completed_at && !job.review_approved_at;
  const approved = !!job.review_approved_at;
  const dispatched = job.status === "dispatched";
  const machineCode = job.cnc_machine_id ? machineCodeById[job.cnc_machine_id] ?? null : null;

  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtDateTime = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString("en-IN", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        })
      : "—";

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
        background: "rgba(15, 12, 6, 0.55)",
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
          maxWidth: 640,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header strip — slab id big, status pill on the right */}
        <div
          style={{
            padding: "16px 20px",
            background:
              "linear-gradient(180deg, var(--bg) 0%, var(--surface) 100%)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <code
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 800,
                  fontSize: 18,
                  color: "var(--text)",
                }}
              >
                {job.slab_requirement_id}
              </code>
              <StatusPill status={job.status} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: "var(--text)" }}>
              🏛 {job.temple}
            </div>
            {job.slab_label && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
                {job.slab_label}
              </div>
            )}
          </div>
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

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Slab — thumbnail + key facts grid */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 14,
              alignItems: "stretch",
            }}
          >
            <div style={{ minHeight: 120 }}>
              <SlabThumb
                stone={job.stone}
                l={job.length_ft}
                w={job.width_ft}
                t={job.thickness_ft}
                stoneTypes={stoneTypes}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <Field label="Dimensions">
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {job.length_ft}×{job.width_ft}×{job.thickness_ft}″
                </span>
              </Field>
              {job.stone && <Field label="Stone">{job.stone}</Field>}
              {job.slab_description && (
                <Field label="Description">
                  <span style={{ fontStyle: "italic", color: "var(--muted)" }}>
                    “{job.slab_description}”
                  </span>
                </Field>
              )}
            </div>
          </section>

          {/* Assignment */}
          <section
            style={{
              padding: "12px 14px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 13,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                marginBottom: 2,
              }}
            >
              Assignment
            </div>
            <Field label="Vendor">
              <strong>{job.vendor_name}</strong>
              <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                ({job.vendor_type})
              </span>
            </Field>
            {machineCode && (
              <Field label="Machine">
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{machineCode}</span>
              </Field>
            )}
            <Field label="Assigned">{fmtDate(job.assigned_at)}</Field>
            {job.due_at && <Field label="Due">{fmtDate(job.due_at)}</Field>}
            {job.progress_phase && <Field label="Phase">{job.progress_phase}</Field>}
            {job.completed_at && (
              <Field label="Vendor completed">{fmtDateTime(job.completed_at)}</Field>
            )}
            {job.review_approved_at && (
              <Field label="Approved">{fmtDateTime(job.review_approved_at)}</Field>
            )}
            {job.location && (
              <Field label="Location">
                <span style={{ color: "#15803d", fontWeight: 600 }}>📍 {job.location}</span>
              </Field>
            )}
          </section>

          {/* Status banner — context-specific */}
          {inReview && (
            <ApproveRejectForms jobId={job.id} onDone={onClose} />
          )}
          {/* Event timeline — server-action fetched on mount.
              Lazy so opening the peek stays instant. */}
          <JobTimelineSection jobId={job.id} />
          {approved && !dispatched && (
            <div
              style={{
                padding: "12px 14px",
                background: "rgba(22,163,74,0.08)",
                border: "1px solid rgba(22,163,74,0.25)",
                borderRadius: 8,
                fontSize: 13,
                color: "#15803d",
                fontWeight: 600,
              }}
            >
              ✓ Approved &amp; ready for dispatch — visible in{" "}
              <Link href="/dispatch" style={{ color: "#15803d", textDecoration: "underline" }}>
                Dispatch Station
              </Link>
              .
            </div>
          )}
          {dispatched && (
            <div
              style={{
                padding: "12px 14px",
                background: "rgba(37,99,235,0.08)",
                border: "1px solid rgba(37,99,235,0.25)",
                borderRadius: 8,
                fontSize: 13,
                color: "#1d4ed8",
                fontWeight: 600,
              }}
            >
              🚚 This slab has been dispatched.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Inline approve/reject forms inside the peek. Forms send `stay=1`
// so the server action skips its redirect; on success we close the
// modal and refresh the route, which keeps the carving head on the
// Awaiting Review tab instead of bouncing them to the detail page.
function ApproveRejectForms({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState<{ kind: "approve" | "reject" | null; err: string | null }>({ kind: null, err: null });

  function submit(kind: "approve" | "reject", e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending({ kind, err: null });
    const fd = new FormData(e.currentTarget);
    fd.set("stay", "1");
    const action = kind === "approve" ? approveCarvingJobAction : rejectCarvingJobAction;
    action(fd)
      .then(() => {
        // Close the modal first so the user sees the list refresh
        // beneath them. router.refresh re-runs server data fetching
        // for the current route — the row leaves Awaiting Review.
        onDone();
        router.refresh();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setPending({ kind: null, err: msg });
      });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {pending.err && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.25)",
            color: "#991b1b",
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          ⚠ {pending.err}
        </div>
      )}
      <form
        onSubmit={(e) => submit("approve", e)}
        style={{ display: "flex", gap: 8, alignItems: "stretch" }}
      >
        <input type="hidden" name="job_id" value={jobId} />
        <input type="hidden" name="stay" value="1" />
        <input
          type="text"
          name="notes"
          placeholder="Approval notes (optional)"
          style={{
            flex: 1,
            fontSize: 13,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />
        <button
          type="submit"
          disabled={pending.kind !== null}
          className="primary-button"
          style={{
            fontSize: 14,
            padding: "10px 22px",
            fontWeight: 700,
            whiteSpace: "nowrap",
            opacity: pending.kind !== null ? 0.6 : 1,
          }}
        >
          {pending.kind === "approve" ? "Approving…" : "✔ Approve"}
        </button>
      </form>
      <form
        onSubmit={(e) => submit("reject", e)}
        style={{ display: "flex", gap: 8, alignItems: "stretch" }}
      >
        <input type="hidden" name="job_id" value={jobId} />
        <input type="hidden" name="stay" value="1" />
        <input
          type="text"
          name="notes"
          required
          placeholder="Rejection reason (required)"
          style={{
            flex: 1,
            fontSize: 13,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />
        <button
          type="submit"
          disabled={pending.kind !== null}
          className="ghost-button danger-ghost"
          style={{
            fontSize: 14,
            padding: "10px 22px",
            fontWeight: 700,
            whiteSpace: "nowrap",
            opacity: pending.kind !== null ? 0.6 : 1,
          }}
        >
          {pending.kind === "reject" ? "Rejecting…" : "✗ Reject"}
        </button>
      </form>
    </div>
  );
}

// Lazy-loaded event timeline for the peek. Calls the server action
// on mount; renders a small chronological list. Same content as the
// legacy /carving/[id] detail page's event timeline so users don't
// need to leave the peek to see history.
function JobTimelineSection({ jobId }: { jobId: string }) {
  const [events, setEvents] = useState<JobEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJobEvents(jobId)
      .then((es) => {
        if (!cancelled) setEvents(es);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <section
      style={{
        padding: "12px 14px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 8,
        }}
      >
        Event timeline
      </div>
      {error ? (
        <div style={{ fontSize: 12, color: "#991b1b" }}>⚠ {error}</div>
      ) : !events ? (
        <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
      ) : events.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>No events recorded.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {events.map((e) => {
            const when = new Date(e.created_at).toLocaleString("en-IN", {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            });
            const colour =
              e.event_type === "approved" ? "#15803d"
                : e.event_type === "rejected" ? "#b91c1c"
                  : e.event_type === "completed" ? "#15803d"
                    : e.event_type === "loaded" ? "#1d4ed8"
                      : e.event_type === "assigned" ? "#b45309"
                        : "var(--muted)";
            return (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "6px 8px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: colour,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    flexShrink: 0,
                    minWidth: 80,
                  }}
                >
                  {e.event_type.replace(/_/g, " ")}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {e.message && (
                    <div style={{ fontSize: 12, color: "var(--text)" }}>{e.message}</div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {when}{e.user_name ? ` · ${e.user_name}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? { fg: "#15803d", bg: "rgba(22,163,74,0.12)" }
      : status === "dispatched"
        ? { fg: "#1d4ed8", bg: "rgba(37,99,235,0.12)" }
        : status === "carving_in_progress"
          ? { fg: "#2563eb", bg: "rgba(37,99,235,0.1)" }
          : status === "carving_assigned"
            ? { fg: "#b45309", bg: "rgba(217,119,6,0.1)" }
            : { fg: "var(--muted)", bg: "var(--surface-alt)" };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        padding: "3px 10px",
        borderRadius: 999,
        color: tone.fg,
        background: tone.bg,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--text)", textAlign: "right", minWidth: 0 }}>
        {children}
      </span>
    </div>
  );
}

// ─── Active-tab floor embed ─────────────────────────────────────────
//
// Renders one VendorGridSection per CNC vendor inline on the Active
// carving tab so the carving head sees their full floor cockpit
// (machines + queue + last 24h done) without having to navigate to
// /carving/floor. The 30s tick is local so its timers stay live.
function ActiveFloorEmbed({ vendors }: { vendors: FloorVendor[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Aggregate fleet totals so the embed has its own header strip.
  const fleet = useMemo(() => {
    const acc = { total: 0, idle: 0, carving: 0, maintenance: 0, queue: 0, today: 0 };
    for (const v of vendors) {
      acc.total += v.totals.total;
      acc.idle += v.totals.idle;
      acc.carving += v.totals.carving;
      acc.maintenance += v.totals.maintenance;
      acc.queue += v.totals.queue;
      acc.today += v.totals.today;
    }
    return acc;
  }, [vendors]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 14px",
          background: "linear-gradient(135deg, #2D2410 0%, #4a3a1f 100%)",
          color: "#fff",
          borderRadius: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
            📺 Floor — live
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
            {vendors.length} operator{vendors.length !== 1 ? "s" : ""} · {fleet.total} CNC{fleet.total !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <FleetTile label="Free" value={fleet.idle} fg="#22c55e" />
          <FleetTile label="Carving" value={fleet.carving} fg="#60a5fa" />
          <FleetTile label="Maint" value={fleet.maintenance} fg="#f87171" />
          <FleetTile label="Queue" value={fleet.queue} fg="#fbbf24" />
          <FleetTile label="Today" value={fleet.today} fg="#E8C572" />
        </div>
        <Link
          href="/carving/floor?mode=tv"
          target="_blank"
          rel="noreferrer"
          style={{
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.25)",
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 700,
            borderRadius: 6,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
          title="Open this floor in TV mode (auto-rotate)"
        >
          📺 TV mode
        </Link>
      </div>

      {vendors.map((v) => (
        <VendorGridSection key={v.id} vendor={v} now={now} />
      ))}
    </section>
  );
}

function FleetTile({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div
      style={{
        padding: "5px 10px",
        background: "rgba(255,255,255,0.08)",
        borderRadius: 6,
        textAlign: "center",
        minWidth: 50,
      }}
    >
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: fg, fontFamily: "ui-monospace, monospace", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}
