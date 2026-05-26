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
import { BulkAssignModal } from "./bulk-assign-modal";
import {
  approveCarvingJobAction,
  rejectCarvingJobAction,
  markCarvingStartedManuallyAction,
  markCarvingCompleteManuallyAction,
  getJobEvents,
  type JobEvent,
} from "./actions";
import { SlabThumb } from "@/components/slab-thumb";
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
  /** Migration 020 — physical stock location set by the cutter at
   *  finish-block time. Surfaced as a 📍 chip on each unassigned
   *  card so the carving head knows where each cut slab sits. */
  stock_location?: string | null;
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
  /** Migration 023 — timestamp when the slab physically arrived at
   *  the vendor's shade. NULL while the slab is still in transit. */
  received_at_vendor_at?: string | null;
  /** Migration 024 — work-type tag for CNC jobs. 'lathe' = must go
   *  on a lathe machine. NULL = flat-panel default (multi-head). */
  requires_machine_type?: string | null;
  /** Migration 020 — last known physical location set by the cutter
   *  operator at finish-block time (e.g. "Yard 2"). Shown next to the
   *  🚚 IN TRANSIT pill so people know where to fetch the slab. */
  slab_stock_location?: string | null;
  /** Migration 025 — slab transfer claim. claimed_by = NULL while
   *  unclaimed. claimed_at fires when a transfer runner grabs the
   *  job. Cleared on delivery (along with receipt being marked). */
  claimed_by?: string | null;
  claimed_at?: string | null;
  /** Migration 025 — where the transfer runner actually left the
   *  slab (optional — only set when not at standard vendor dropoff). */
  dropoff_note?: string | null;
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
  // Job detail peek — opened by clicking any card on Active /
  // Awaiting Review / Carving Done. Center modal with slab info,
  // assignment, and inline approve/reject forms.
  const [peekJob, setPeekJob] = useState<JobRow | null>(null);

  // Bulk-select mode on the Unassigned tab. The carving head taps
  // "📋 Bulk select" to enter, then taps up to 10 slabs (a 2-head
  // is the common case). A sticky bar at the bottom shows the count
  // + "Assign N selected →" which opens BulkAssignModal. The chosen
  // slabs share a batch_id so the vendor sees them colour-grouped.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Daksh May 2026 — bumped from 4 to 10 so the carving head /
  // senior incharge / dev / owner / Mohit can push bigger batches
  // (e.g. a temple's full set of 8 panels) in one go without
  // splitting it into multiple proposals. Server action enforces
  // the same cap.
  const BULK_MAX = 10;

  // After a successful batch assign the action redirects to
  // /carving?tab=active&toast=Batch+of+N+queued. Detect that and
  // clear the bulk state so the sticky bar doesn't keep showing
  // stale counts for slabs that have already moved out of the
  // unassigned list.
  useEffect(() => {
    const toast = searchParams.get("toast") ?? "";
    if (toast.startsWith("📦 Batch") || toast.startsWith("Batch")) {
      setBulkOpen(false);
      setBulkSelected(new Set());
      setBulkMode(false);
    }
  }, [searchParams]);

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

  // Daksh May 2026 — "from date" cutoff for the Unassigned tab.
  // Live production launched 22 May 2026; ~1100 slabs from the
  // testing period are still in the unassigned pool. This date
  // picker lets the carving head hide them with one tap: only
  // slabs whose updated_at >= the picked date pass through.
  //
  // Persisted in localStorage so the cutoff sticks across reloads
  // and across navigation. Empty string ("") = "All time" — the
  // user has explicitly asked that this be the fresh-install default.
  //
  // Daksh round 2 — earlier default was hardcoded to 2026-05-22 so
  // the carving head wouldn't see legacy test slabs. But the
  // localStorage gets wiped on private mode / cleared cookies /
  // new browser, and Daksh kept finding the picker "stuck on 22
  // May" with no obvious way back to seeing everything. Default
  // is now "" (all time) — the carving head can re-pick a cutoff
  // any time, and that pick still sticks in localStorage as
  // before.
  const UNASSIGNED_FROM_STORAGE_KEY = "mtcpl:carving:unassigned-from-date";
  const DEFAULT_UNASSIGNED_FROM = "";
  const [unassignedFromDate, setUnassignedFromDate] = useState<string>(
    DEFAULT_UNASSIGNED_FROM,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(UNASSIGNED_FROM_STORAGE_KEY);
      // Empty string is a valid "All time" choice; null means
      // never-set, fall back to default.
      if (raw !== null) setUnassignedFromDate(raw);
    } catch {
      // Private mode / quota — ignore, keep the default.
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(UNASSIGNED_FROM_STORAGE_KEY, unassignedFromDate);
    } catch {
      // ignore
    }
  }, [unassignedFromDate]);

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

  // Daksh May 2026 — if the search query is a 3-dim triple like
  // "53x29x14" / "53 × 29 × 14" / "53*29*14" (any case, decimals
  // OK), we match orientation-agnostically against the slab/job
  // dimensions (L×W×T sorted vs query sorted). Otherwise fall back
  // to the existing substring search across slab id / label /
  // description / temple / stone / vendor name / status.
  const dimQuery = useMemo(() => {
    const m = queryNorm.match(
      /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i,
    );
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c))
      return null;
    return [a, b, c].sort((x, y) => x - y) as [number, number, number];
  }, [queryNorm]);

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
    length_ft?: number | null;
    width_ft?: number | null;
    thickness_ft?: number | null;
  }): boolean {
    if (priorityOnly && !item.priority) return false;
    // Dimension search short-circuits the text search — if the user
    // typed a triple, we ONLY want dim-matching slabs. Orientation-
    // agnostic via sorted multiset compare.
    if (dimQuery) {
      const L = Number(item.length_ft);
      const W = Number(item.width_ft);
      const T = Number(item.thickness_ft);
      if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(T))
        return false;
      const triple = [L, W, T].sort((x, y) => x - y);
      return (
        triple[0] === dimQuery[0] &&
        triple[1] === dimQuery[1] &&
        triple[2] === dimQuery[2]
      );
    }
    if (queryNorm) {
      // Daksh May 2026 — include EVERY permutation of L×W×T in the
      // haystack so typing partial dimensions like "99x" / "99x50"
      // hits (orientation-agnostic substring). A complete triple
      // takes the multiset path above, so we only get here for
      // partial-dim / non-dim queries.
      const L = item.length_ft != null ? Number(item.length_ft) : NaN;
      const W = item.width_ft != null ? Number(item.width_ft) : NaN;
      const T = item.thickness_ft != null ? Number(item.thickness_ft) : NaN;
      const dimPerms: string[] = [];
      if (Number.isFinite(L) && Number.isFinite(W) && Number.isFinite(T)) {
        dimPerms.push(
          `${L}x${W}x${T}`,
          `${L}x${T}x${W}`,
          `${W}x${L}x${T}`,
          `${W}x${T}x${L}`,
          `${T}x${L}x${W}`,
          `${T}x${W}x${L}`,
        );
      }
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
        ...dimPerms,
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

  // Daksh May 2026 — apply the "from date" cutoff before the
  // rolling-window dateFilter. Slab passes if its updated_at is
  // ≥ the cutoff date (or the cutoff is the empty "All time"
  // sentinel). Cheap string compare since updated_at is ISO and
  // the cutoff is YYYY-MM-DD; ISO sort order = chronological.
  function passesUnassignedFrom(iso: string | null | undefined): boolean {
    if (!unassignedFromDate) return true;
    if (!iso) return false;
    // Compare YYYY-MM-DD prefix — works because IS0 timestamps
    // sort lexicographically by date prefix.
    return iso.slice(0, 10) >= unassignedFromDate;
  }
  const filteredUnassigned = useMemo(
    () =>
      unassignedSlabs.filter(
        (s) =>
          matches(s) && passesDate(s.updated_at) && passesUnassignedFrom(s.updated_at),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unassignedSlabs, priorityOnly, queryNorm, dateFilter, unassignedFromDate],
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
    return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
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

        {/* Bulk-select toggle — only on Unassigned tab. Lets the
            carving head pick up to 10 slabs at once for a batch
            assign (most common case: 2 mirror slabs for a 2-head
            CNC pair load; bigger batches for a temple's panel set).
            Exiting bulk mode clears selection. */}
        {tab === "unassigned" && (
          <button
            type="button"
            onClick={() => {
              setBulkMode((on) => {
                if (on) setBulkSelected(new Set()); // exiting → clear
                return !on;
              });
            }}
            title="Select multiple slabs and assign them as a batch (max 10)"
            style={{
              padding: "7px 12px",
              fontSize: 12,
              fontWeight: 700,
              border: `1.5px solid ${bulkMode ? "var(--gold-dark)" : "var(--border)"}`,
              background: bulkMode ? "rgba(180,115,51,0.10)" : "var(--surface)",
              color: bulkMode ? "var(--gold-dark)" : "var(--muted)",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {bulkMode ? "✕ Cancel select" : "📋 Bulk select"}
          </button>
        )}

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
        {/* Daksh May 2026 — "From date" cutoff for the Unassigned
            tab only. Hides legacy test slabs from before the
            22 May 2026 go-live. Persists in localStorage; clear
            with the small ✕ button to show everything again.
            Hidden on other tabs because the rolling-window pills
            above already handle "Assigned in", "Completed in",
            "Approved in". */}
        {tab === "unassigned" && (
          <>
            <span
              aria-hidden
              style={{
                width: 1,
                height: 18,
                background: "var(--border)",
                margin: "0 4px",
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              From
            </span>
            <input
              type="date"
              value={unassignedFromDate}
              onChange={(e) => setUnassignedFromDate(e.target.value)}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                border: `1.5px solid ${
                  unassignedFromDate ? "var(--gold-dark)" : "var(--border)"
                }`,
                background: unassignedFromDate
                  ? "rgba(180,115,51,0.1)"
                  : "var(--bg)",
                color: unassignedFromDate ? "var(--gold-dark)" : "var(--text)",
                borderRadius: 999,
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
              }}
              title="Hide slabs that became ready before this date — covers the legacy test pool from before go-live"
            />
            {unassignedFromDate && (
              <button
                type="button"
                onClick={() => setUnassignedFromDate("")}
                title="Show all slabs (no date cutoff)"
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  fontWeight: 700,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                  borderRadius: 999,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                ✕ all time
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {filterBar}

      {tab === "unassigned" && (() => {
        // Derive the "anchor" — dims of the FIRST selected slab. Once
        // anchored, any further additions must match L×W×T (a hard
        // constraint per Daksh: bulk-assign is for mirror-pair work
        // which only makes sense for identical slabs). Different-dim
        // cards go dim + cursor:not-allowed in the renderCard.
        const anchorId = bulkSelected.size > 0 ? [...bulkSelected][0] : null;
        const anchor = anchorId ? unassignedSlabs.find((s) => s.id === anchorId) ?? null : null;
        return (
          <UnassignedByTemple
            slabs={filteredUnassigned}
            stoneTypes={stoneTypes}
            viewMode={viewMode}
            onAssign={(s) => setAssigning(s)}
            bulkMode={bulkMode}
            bulkSelected={bulkSelected}
            onBulkToggle={(slabId) => {
              setBulkSelected((prev) => {
                const next = new Set(prev);
                if (next.has(slabId)) {
                  next.delete(slabId);
                  return next;
                }
                if (next.size >= BULK_MAX) return prev;
                // Enforce same-dim constraint when there's an anchor.
                if (anchor) {
                  const cand = unassignedSlabs.find((s) => s.id === slabId);
                  if (
                    cand &&
                    (Number(cand.length_ft) !== Number(anchor.length_ft) ||
                      Number(cand.width_ft) !== Number(anchor.width_ft) ||
                      Number(cand.thickness_ft) !== Number(anchor.thickness_ft))
                  ) {
                    return prev; // mismatched dims — silently refuse
                  }
                }
                next.add(slabId);
                return next;
              });
            }}
            onToggleBulkMode={() => {
              setBulkMode((on) => {
                if (on) setBulkSelected(new Set());
                return !on;
              });
            }}
            bulkMax={BULK_MAX}
            anchorDims={
              anchor
                ? {
                    length_ft: Number(anchor.length_ft),
                    width_ft: Number(anchor.width_ft),
                    thickness_ft: Number(anchor.thickness_ft),
                  }
                : null
            }
          />
        );
      })()}

      {tab === "active" && (
        <>
          {/* Single Floor View link — was a full inline cockpit
              embed, but the user wants the Active tab focused on the
              job cards. The button takes them to the dedicated
              /carving/floor page when they need the cockpit view. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              marginBottom: 14,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                }}
              >
                Live operator cockpit
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>
                Every vendor&apos;s machines, queue, and last-24h done
              </div>
            </div>
            <Link
              href="/carving/floor"
              className="primary-button"
              style={{
                fontSize: 13,
                padding: "8px 16px",
                fontWeight: 700,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              📺 Open Floor View
            </Link>
          </div>
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
        <>
          {/* Mig 060 — the CNC report quick-link lived here, but
              now the report is reachable via Dashboard → Various
              Costing → CNC Costing. /carving/reports still works
              as a direct URL for bookmarks. Removing the strip
              keeps the Done tab focused on the shipped-output
              table itself. */}
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
        </>
      )}

      {assigning && (
        <AssignModal slab={assigning} vendors={vendors} onClose={() => setAssigning(null)} />
      )}

      {/* Bulk-assign modal — fired by the sticky bottom bar. */}
      {bulkOpen && bulkSelected.size > 0 && (
        <BulkAssignModal
          slabs={unassignedSlabs
            .filter((s) => bulkSelected.has(s.id))
            .map((s) => ({
              id: s.id,
              label: s.label,
              temple: s.temple,
              stone: s.stone,
              length_ft: Number(s.length_ft) || 0,
              width_ft: Number(s.width_ft) || 0,
              thickness_ft: Number(s.thickness_ft) || 0,
            }))}
          vendors={vendors}
          stoneTypes={stoneTypes}
          onClose={() => {
            setBulkOpen(false);
            // Clear selection after successful assign so the user
            // doesn't accidentally re-fire on stale state. (If they
            // cancel, the selection stays — they can re-open.)
          }}
        />
      )}

      {/* Sticky bulk-select action bar. Only renders on the
          Unassigned tab when the user has selected >0 slabs AND
          the BulkAssignModal isn't open (otherwise both surfaces
          show an "Assign N" button which is confusing). Lives at
          the bottom of the viewport. z-index 1100 floats it ABOVE
          the temple peek modal (z-index 1000) so it stays visible
          while selecting inside a temple peek. */}
      {tab === "unassigned" && bulkMode && bulkSelected.size > 0 && !bulkOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: "calc(var(--content-left) + 16px)",
            right: 16,
            zIndex: 1100,
            padding: "12px 16px",
            background: "var(--gold-dark)",
            color: "#fff",
            borderRadius: 12,
            boxShadow: "0 12px 36px rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 16 }}>
              📦 {bulkSelected.size} of {BULK_MAX} selected
            </span>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              Pick a vendor, batch them together.
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setBulkSelected(new Set())}
              style={{
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              style={{
                background: "#fff",
                color: "#7c2d12",
                border: "none",
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 800,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Assign {bulkSelected.size} →
            </button>
          </div>
        </div>
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
// SlabThumb moved to @/components/slab-thumb so the vendor cockpit
// + slab transfer page can reuse it without importing the whole
// carving dashboard module.

// ─── Unassigned tab — grouped by temple ─────────────────────────────────

function UnassignedByTemple({
  slabs,
  stoneTypes,
  viewMode,
  onAssign,
  bulkMode,
  bulkSelected,
  onBulkToggle,
  onToggleBulkMode,
  bulkMax,
  anchorDims,
}: {
  slabs: UnassignedSlab[];
  stoneTypes: StoneTypeDef[];
  viewMode: "grouped" | "flat";
  onAssign: (s: UnassignedSlab) => void;
  /** Bulk-select mode on the Unassigned tab. When true, clicking a
   *  card toggles its membership in `bulkSelected` instead of opening
   *  the single-slab assign modal. Capped at `bulkMax` selections. */
  bulkMode: boolean;
  bulkSelected: Set<string>;
  onBulkToggle: (slabId: string) => void;
  /** Toggles bulk mode on/off — leaving bulk mode wipes the selection.
   *  Same callback fires from both the toolbar button and a copy of
   *  the toggle inside the temple peek modal. */
  onToggleBulkMode: () => void;
  bulkMax: number;
  /** Dims of the first slab selected in this bulk batch. Once set,
   *  any further additions must match L×W×T or they're silently
   *  refused by the toggle handler. We surface that visually here
   *  by dimming non-matching cards. NULL = no anchor yet. */
  anchorDims: { length_ft: number; width_ft: number; thickness_ft: number } | null;
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
  const renderCard = (s: UnassignedSlab) => {
    const isSelected = bulkSelected.has(s.id);
    const atLimit = !isSelected && bulkSelected.size >= bulkMax;
    // Same-dim constraint: if a bulk batch has been started, only
    // cards matching the anchor's L×W×T can join. Non-matching cards
    // get the dim/disabled treatment so the user understands why.
    const dimMismatch =
      bulkMode &&
      anchorDims &&
      !isSelected &&
      (Number(s.length_ft) !== anchorDims.length_ft ||
        Number(s.width_ft) !== anchorDims.width_ft ||
        Number(s.thickness_ft) !== anchorDims.thickness_ft);
    const cardClickable = bulkMode && !dimMismatch;
    const isDisabled = bulkMode && (atLimit || !!dimMismatch);
    return (
    <div
      key={s.id}
      onClick={cardClickable ? () => onBulkToggle(s.id) : undefined}
      style={{
        padding: "8px 10px",
        background: bulkMode && isSelected
          ? "rgba(180,115,51,0.12)"
          : s.priority
            ? "rgba(220,38,38,0.04)"
            : "var(--surface)",
        border: `2px solid ${
          bulkMode && isSelected
            ? "var(--gold-dark)"
            : s.priority
              ? "rgba(220,38,38,0.2)"
              : "var(--border)"
        }`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: bulkMode
          ? isDisabled
            ? "not-allowed"
            : "pointer"
          : "default",
        opacity: isDisabled ? 0.35 : 1,
        position: "relative",
        transition: "border-color 0.12s, background 0.12s",
      }}
      title={
        dimMismatch
          ? `Different dimensions — bulk select requires matching L×W×T (anchor: ${anchorDims?.length_ft}×${anchorDims?.width_ft}×${anchorDims?.thickness_ft}″)`
          : atLimit
            ? `Max ${bulkMax} slabs per batch`
            : undefined
      }
    >
      {/* Bulk-select checkbox overlay — only shown in bulk mode. */}
      {bulkMode && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 24,
            height: 24,
            borderRadius: 6,
            background: isSelected ? "var(--gold-dark)" : "var(--surface)",
            border: `2px solid ${isSelected ? "var(--gold-dark)" : "var(--border)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: isSelected ? "#fff" : "var(--muted-light)",
            fontWeight: 800,
            fontSize: 14,
            zIndex: 1,
            pointerEvents: "none",
            boxShadow: isSelected ? "0 2px 6px rgba(180,115,51,0.4)" : "none",
          }}
        >
          {isSelected ? "✓" : ""}
        </div>
      )}
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
      {/* Stock-location chip — shows where the cutter dropped this
          slab. Migration 020. Hidden when missing so older slabs
          (pre-migration) don't render a stray "not set" line. */}
      {s.stock_location && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#7c2d12",
            background: "rgba(180,115,51,0.08)",
            border: "1px solid rgba(180,115,51,0.25)",
            padding: "3px 7px",
            borderRadius: 5,
            alignSelf: "flex-start",
            fontFamily: "ui-monospace, monospace",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Where the cutter team dropped this slab"
        >
          📍 {s.stock_location}
        </div>
      )}
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
      {/* Single-slab Assign button — only shown when NOT in bulk
          mode. In bulk mode the whole card acts as a toggle. */}
      {!bulkMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAssign(s);
          }}
          className="primary-button"
          style={{ marginTop: 4, fontSize: 13, padding: "9px 12px", fontWeight: 700 }}
        >
          Assign to Vendor →
        </button>
      )}
    </div>
    );
  };

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
      bulkMode={bulkMode}
      onToggleBulkMode={onToggleBulkMode}
      bulkSelectedCount={bulkSelected.size}
      bulkMax={bulkMax}
      anchorDims={anchorDims}
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
  bulkMode,
  onToggleBulkMode,
  bulkSelectedCount,
  bulkMax,
  anchorDims,
}: {
  groups: Array<{ temple: string; items: UnassignedSlab[] }>;
  stoneTypes: StoneTypeDef[];
  slabsTotal: number;
  onAssign: (s: UnassignedSlab) => void;
  renderCard: (s: UnassignedSlab) => React.ReactNode;
  /** Bulk-select propagated from UnassignedByTemple → here →
   *  TempleSlabsPeek. Lets the user enter bulk mode without
   *  leaving the temple peek. */
  bulkMode: boolean;
  onToggleBulkMode: () => void;
  bulkSelectedCount: number;
  bulkMax: number;
  anchorDims: { length_ft: number; width_ft: number; thickness_ft: number } | null;
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
          bulkMode={bulkMode}
          onToggleBulkMode={onToggleBulkMode}
          bulkSelectedCount={bulkSelectedCount}
          bulkMax={bulkMax}
          anchorDims={anchorDims}
        />
      )}
    </>
  );
}

// Soft pastel palette for the mirror-pair group accents. Each
// unique (label + L×W×T) combination within a temple gets its own
// colour so the carving head can spot at a glance which slabs are
// candidates for 2-head pair loads. Limited to 8 colours; if a temple
// has more than 8 distinct shapes the palette wraps (acceptable —
// the eye can still see groups).
const PAIR_GROUP_COLORS: Array<{ bg: string; border: string; label: string }> = [
  { bg: "rgba(37,99,235,0.08)",  border: "rgba(37,99,235,0.45)",  label: "#1d4ed8" },
  { bg: "rgba(22,163,74,0.08)",  border: "rgba(22,163,74,0.45)",  label: "#15803d" },
  { bg: "rgba(217,119,6,0.08)",  border: "rgba(217,119,6,0.45)",  label: "#b45309" },
  { bg: "rgba(124,58,237,0.08)", border: "rgba(124,58,237,0.45)", label: "#7c3aed" },
  { bg: "rgba(190,18,60,0.08)",  border: "rgba(190,18,60,0.45)",  label: "#be123c" },
  { bg: "rgba(14,165,233,0.08)", border: "rgba(14,165,233,0.45)", label: "#0284c7" },
  { bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.45)", label: "#7c3aed" },
  { bg: "rgba(234,88,12,0.08)",  border: "rgba(234,88,12,0.45)",  label: "#c2410c" },
];

function pairGroupKey(s: UnassignedSlab): string {
  // Two slabs are pair-eligible when label + dims match exactly.
  // Don't include stone in the key — same temple = same stone in
  // practice — and stone mismatch would surface separately.
  return `${s.label ?? ""}::${Number(s.length_ft)}×${Number(s.width_ft)}×${Number(s.thickness_ft)}`;
}

// Center-peek modal that shows all slabs in one temple as the same
// card grid the flat view uses. Clicking a slab card's "Assign to
// Vendor" still opens the AssignModal stacked over this peek.
//
// Mirror-pair grouping: slabs that share (label + L×W×T) get a
// shared coloured "left bar" accent + faint tinted background. Lone
// shapes (1 of a kind) get no colour so the eye is drawn to actual
// pairs/groups — those are the 2-head candidates.
function TempleSlabsPeek({
  temple,
  slabs,
  renderCard,
  onClose,
  bulkMode,
  onToggleBulkMode,
  bulkSelectedCount,
  bulkMax,
  anchorDims,
}: {
  temple: string;
  slabs: UnassignedSlab[];
  renderCard: (s: UnassignedSlab) => React.ReactNode;
  onClose: () => void;
  /** Bulk-select propagated from the parent. Adds a toggle to the
   *  peek header so the carving head can enter bulk mode without
   *  closing the peek + clicking the toolbar button. */
  bulkMode: boolean;
  onToggleBulkMode: () => void;
  bulkSelectedCount: number;
  bulkMax: number;
  anchorDims: { length_ft: number; width_ft: number; thickness_ft: number } | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Daksh May 2026 — temple-peek search bar. Local-only state (the
  // peek scopes to one temple already, so this is just within-temple
  // narrowing). Supports both substring (slab id / label / stock
  // location) and dimension queries (53x29x14, orientation-agnostic).
  const [peekQuery, setPeekQuery] = useState("");
  const peekQueryNorm = peekQuery.trim().toLowerCase();
  const peekDimQuery = useMemo(() => {
    const m = peekQueryNorm.match(
      /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i,
    );
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c))
      return null;
    return [a, b, c].sort((x, y) => x - y) as [number, number, number];
  }, [peekQueryNorm]);

  const visibleSlabs = useMemo(() => {
    if (!peekQueryNorm) return slabs;
    return slabs.filter((s) => {
      if (peekDimQuery) {
        const triple = [
          Number(s.length_ft),
          Number(s.width_ft),
          Number(s.thickness_ft),
        ].sort((x, y) => x - y);
        return (
          triple[0] === peekDimQuery[0] &&
          triple[1] === peekDimQuery[1] &&
          triple[2] === peekDimQuery[2]
        );
      }
      // Daksh May 2026 — same permutation trick as matches() so
      // partial dim text ("99x" / "99x50") still hits inside the
      // temple peek, regardless of which axis the user starts with.
      const L = Number(s.length_ft);
      const W = Number(s.width_ft);
      const T = Number(s.thickness_ft);
      const dimPerms: string[] = [];
      if (Number.isFinite(L) && Number.isFinite(W) && Number.isFinite(T)) {
        dimPerms.push(
          `${L}x${W}x${T}`,
          `${L}x${T}x${W}`,
          `${W}x${L}x${T}`,
          `${W}x${T}x${L}`,
          `${T}x${L}x${W}`,
          `${T}x${W}x${L}`,
        );
      }
      const hay = [
        s.id,
        s.label,
        s.temple,
        s.stone,
        s.source_block_id,
        s.stock_location,
        ...dimPerms,
      ]
        .filter(Boolean)
        .join(" · ")
        .toLowerCase();
      return hay.includes(peekQueryNorm);
    });
  }, [slabs, peekQueryNorm, peekDimQuery]);

  // Walk the slabs once: count occurrences per pair key, then assign
  // each key a colour index. Singletons get no colour (NULL). Run
  // against the VISIBLE list so a search that narrows to one slab
  // doesn't strand its mirror in a now-orphan tint.
  const groupColorMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of visibleSlabs) {
      const k = pairGroupKey(s);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const colourByKey = new Map<string, (typeof PAIR_GROUP_COLORS)[number]>();
    let nextIdx = 0;
    for (const [k, count] of counts.entries()) {
      if (count >= 2) {
        colourByKey.set(k, PAIR_GROUP_COLORS[nextIdx % PAIR_GROUP_COLORS.length]);
        nextIdx += 1;
      }
    }
    return colourByKey;
  }, [visibleSlabs]);

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
              {peekQueryNorm
                ? `${visibleSlabs.length} of ${slabs.length} slab${slabs.length !== 1 ? "s" : ""} match`
                : `${slabs.length} slab${slabs.length !== 1 ? "s" : ""} ready to assign`}
            </p>
            {/* Daksh May 2026 — within-temple search. Supports id /
                label / stock-location substring, and dimension
                triples like "53x29x14" (orientation-agnostic). */}
            <input
              type="search"
              value={peekQuery}
              onChange={(e) => setPeekQuery(e.target.value)}
              placeholder="🔍 Filter — slab id, label, stock loc, or 53x29x14"
              autoCapitalize="characters"
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
          {/* Bulk-select toggle — same fn as the toolbar button so
              entering bulk mode here just flips the same state.
              Cards in the peek will then become tappable checkboxes,
              and the sticky bottom bar appears with "Assign N →". */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button
              type="button"
              onClick={onToggleBulkMode}
              title={
                bulkMode
                  ? "Exit bulk select"
                  : `Select up to ${bulkMax} slabs to assign as a batch`
              }
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                border: `1.5px solid ${bulkMode ? "var(--gold-dark)" : "var(--border)"}`,
                background: bulkMode ? "rgba(180,115,51,0.10)" : "var(--surface)",
                color: bulkMode ? "var(--gold-dark)" : "var(--text)",
                borderRadius: 6,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {bulkMode
                ? `✕ Cancel select${bulkSelectedCount > 0 ? ` (${bulkSelectedCount})` : ""}`
                : "📋 Select multiple"}
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
        {/* Hint that explains bulk-select once it's on. When an
            anchor has been set (first slab selected), the message
            shifts to call out the L×W×T requirement explicitly. */}
        {bulkMode && (
          <div
            style={{
              padding: "8px 18px",
              background: "rgba(180,115,51,0.06)",
              borderBottom: "1px solid var(--border)",
              fontSize: 12,
              color: "#7c2d12",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {anchorDims ? (
              <span>
                📋 Batch locked to <strong>{anchorDims.length_ft}×{anchorDims.width_ft}×{anchorDims.thickness_ft}″</strong>.
                Only matching slabs can be added (max {bulkMax}).
              </span>
            ) : (
              <span>
                📋 Tap up to {bulkMax} slabs to select. They must share the same L×W×T.
              </span>
            )}
          </div>
        )}
        {groupColorMap.size > 0 && (
          <div
            style={{
              padding: "8px 18px",
              background: "var(--surface-alt)",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <strong style={{ color: "var(--text)" }}>🪞 Mirror pairs:</strong>
            <span>
              Slabs with matching label + L×W×T share a colour — pick two same-coloured
              slabs to assign as a 2-head pair.
            </span>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {visibleSlabs.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              No slabs match{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {peekQuery}
              </code>{" "}
              in {temple}.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 8,
              }}
            >
              {visibleSlabs.map((s) => {
                const tint = groupColorMap.get(pairGroupKey(s));
                if (!tint) {
                  return renderCard(s);
                }
                return (
                  <div
                    key={s.id}
                    style={{
                      background: tint.bg,
                      border: `2px solid ${tint.border}`,
                      borderRadius: 10,
                      padding: 2,
                    }}
                  >
                    {renderCard(s)}
                  </div>
                );
              })}
            </div>
          )}
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

  // Daksh May 2026 — within each vendor's section in the Active tab,
  // CARVING NOW cards should always float to the top so the operator
  // sees what's running before what's still queued. Rank: 0 =
  // carving_in_progress (running), 1 = everything else (assigned/
  // pending). Date tiebreak stays as before.
  const activeSortRank = (j: JobRow): number =>
    j.status === "carving_in_progress" ? 0 : 1;

  // Group key + display label depend on groupBy. Within each group
  // we sort items latest-first; the groups themselves sort by their
  // most-recent item so the "freshest" vendor/temple is at top.
  const groups = useMemo(() => {
    const grouped = groupBy === "vendor"
      ? groupByKey(jobs, (j) => j.vendor_name || "(no vendor)")
      : groupByKey(jobs, (j) => j.temple);
    // Sort items inside each group. Active tab (which has the
    // 'deadline' field on it) gets the carving-now-first sort;
    // other tabs keep the date-only sort they had.
    const sortByCarvingFirst = fields.includes("deadline");
    for (const g of grouped) {
      g.items.sort((a, b) => {
        if (sortByCarvingFirst) {
          const r = activeSortRank(a) - activeSortRank(b);
          if (r !== 0) return r;
        }
        return primaryDate(b) - primaryDate(a);
      });
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
      {groups.map(({ key, items }) => {
        // Daksh May 2026 round 2 — vendor separation needs to be
        // visually obvious. Compute a quick stat strip per group
        // (slab count, total CFT/SFT, carving-now count) so the
        // header actually carries information instead of just being
        // an accordion chevron + name. All math is local in-memory
        // — JobRow already has the dimensions on it.
        let totalCft = 0;
        let totalSft = 0;
        let carvingNow = 0;
        let inStock = 0;
        let inTransit = 0;
        for (const j of items) {
          totalCft += (j.length_ft * j.width_ft * j.thickness_ft) / 1728;
          totalSft += (j.length_ft * j.width_ft) / 144;
          if (j.status === "carving_in_progress") carvingNow++;
          else if (j.status === "carving_assigned") {
            if (j.received_at_vendor_at) inStock++;
            else inTransit++;
          }
        }
        const fmtVol = (n: number) =>
          n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
        return (
        <details
          key={key}
          open={openByDefault}
          // Bigger gap between vendor sections so the eye reads them
          // as distinct groups, not a continuous list.
          style={{ marginBottom: 22 }}
        >
          <summary
            style={{
              cursor: "pointer",
              padding: 0,
              userSelect: "none",
              listStyle: "none",
              // Sit the chevron arrow without using ::marker (which
              // we can't style cross-browser).
              marginBottom: 0,
            }}
          >
            {/* Prominent vendor section header — gold accent bar on
                the left, large name, summary stat strip, status
                chips. Reads as a "card" not just an accordion line. */}
            <div
              style={{
                position: "relative",
                background:
                  "linear-gradient(135deg, rgba(201,161,74,0.14) 0%, rgba(201,161,74,0.04) 100%)",
                border: "1px solid var(--border)",
                borderLeft: "5px solid var(--gold)",
                borderRadius: "12px 12px 0 0",
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                transition: "transform 0.12s ease, box-shadow 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow =
                  "0 2px 8px rgba(184,115,51,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: 28,
                  lineHeight: 1,
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.06))",
                  flexShrink: 0,
                }}
              >
                {groupIcon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: "var(--text)",
                    letterSpacing: "-0.01em",
                    lineHeight: 1.2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {key}
                </div>
                {/* Stat strip: count + volume + status chips. Only
                    renders chips with non-zero counts so a Done-tab
                    section doesn't show "carving now: 0". */}
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 4,
                    display: "flex",
                    gap: 14,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span>
                    <strong style={{ color: "var(--text)", fontWeight: 700 }}>
                      {items.length}
                    </strong>{" "}
                    slab{items.length !== 1 ? "s" : ""}
                  </span>
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>
                    {fmtVol(totalSft)} SFT
                  </span>
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>
                    {fmtVol(totalCft)} CFT
                  </span>
                  {carvingNow > 0 && (
                    <span
                      style={{
                        color: "#15803d",
                        fontWeight: 700,
                        padding: "1px 8px",
                        borderRadius: 999,
                        background: "rgba(22,163,74,0.12)",
                        border: "1px solid rgba(22,163,74,0.25)",
                      }}
                    >
                      ▶ {carvingNow} carving now
                    </span>
                  )}
                  {inStock > 0 && (
                    <span
                      style={{
                        color: "#78350f",
                        fontWeight: 700,
                        padding: "1px 8px",
                        borderRadius: 999,
                        background: "rgba(180,115,51,0.10)",
                        border: "1px solid rgba(180,115,51,0.25)",
                      }}
                    >
                      📦 {inStock} in stock
                    </span>
                  )}
                  {inTransit > 0 && (
                    <span
                      style={{
                        color: "#b45309",
                        fontWeight: 700,
                        padding: "1px 8px",
                        borderRadius: 999,
                        background: "rgba(217,119,6,0.10)",
                        border: "1px solid rgba(217,119,6,0.25)",
                      }}
                    >
                      🚚 {inTransit} in transit
                    </span>
                  )}
                </div>
              </div>
              <span
                aria-hidden
                style={{
                  fontSize: 14,
                  color: "var(--muted)",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                ▾
              </span>
            </div>
          </summary>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderTop: "none",
              borderRadius: "0 0 12px 12px",
              padding: 12,
              display: "grid",
              // Slightly larger min-width so cards have room to
              // breathe — was 200, now 220.
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {items.map((j) => {
              const days = daysUntil(j.due_at);
              const overdue = days !== null && days < 0;
              const openPeek = () => onOpenJob(j);
              // Status-color left stripe so the user can scan a
              // section and see at a glance "what state is each
              // slab in" without reading every ribbon. Same palette
              // as the existing ribbons inside the card — green for
              // running, gold-tan for stock, orange for transit,
              // sky-blue for approved, gold for awaiting review.
              const statusStripe = (() => {
                if (j.status === "carving_in_progress") return "#16a34a";
                if (j.status === "carving_completed") return "#c9a14a";
                if (j.status === "carving_approved") return "#0ea5e9";
                if (j.status === "dispatched") return "#0284c7";
                if (j.status === "carving_assigned") {
                  return j.received_at_vendor_at ? "#b45309" : "#d97706";
                }
                return "var(--border)";
              })();
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
                    padding: "10px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderLeft: `4px solid ${statusStripe}`,
                    borderRadius: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    cursor: "pointer",
                    transition:
                      "border-color 0.12s, background 0.12s, transform 0.12s, box-shadow 0.12s",
                    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--surface-alt)";
                    // Daksh round 2 — DO NOT touch borderLeftColor /
                    // the `borderColor` shorthand here. The 4-px
                    // status stripe on the left side lives in
                    // border-left-color; the shorthand wipes it and
                    // mouseLeave repaints the wrong color, so cards
                    // stayed grey-striped after a single hover until
                    // a full reload. Animate only the three OTHER
                    // sides — the status stripe stays put.
                    e.currentTarget.style.borderTopColor = "var(--gold-dark)";
                    e.currentTarget.style.borderRightColor = "var(--gold-dark)";
                    e.currentTarget.style.borderBottomColor = "var(--gold-dark)";
                    // Subtle lift instead of just border-color flip so
                    // hover feels alive on dense card grids.
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow =
                      "0 4px 12px rgba(15,23,42,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--surface)";
                    e.currentTarget.style.borderTopColor = "var(--border)";
                    e.currentTarget.style.borderRightColor = "var(--border)";
                    e.currentTarget.style.borderBottomColor = "var(--border)";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 1px 2px rgba(15,23,42,0.04)";
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

                  {/* ACTIVE-tab status ribbon. Surfaces six possible
                      states so the carving head + team can tell at a
                      glance where each job sits:
                        ▶ CARVING NOW          (loaded on CNC)
                        🪚 MANUAL CARVING       (in_progress, no machine, Manual vendor)
                        🪚 AWAITING MANUAL START (assigned, Manual vendor)
                        🚚 AWAITING DELIVERY    (assigned, CNC, no receipt yet)
                        📦 IN STOCK             (assigned, CNC, received but not loaded —
                                                 was "AT VENDOR", renamed per Daksh May 2026)
                        ⏳ WAITING              (legacy fallback)
                      Carving rows still show the running-for / remaining
                      duo when a loaded_at + ETA exist. */}
                  {fields.includes("deadline") && (() => {
                    const isCarving = j.status === "carving_in_progress";
                    const isUrgent = j.urgency === "urgent";
                    const isManual = j.vendor_type === "Manual";
                    const fmtDur = (m: number) => {
                      const a = Math.abs(Math.round(m));
                      if (a < 60) return `${a}m`;
                      if (a < 60 * 24) return `${Math.floor(a / 60)}h ${a % 60}m`;
                      return `${Math.floor(a / (60 * 24))}d ${Math.floor((a % (60 * 24)) / 60)}h`;
                    };
                    if (isCarving && j.loaded_at) {
                      const elapsedMin = (now - new Date(j.loaded_at).getTime()) / 60000;
                      const eta = j.vendor_estimated_minutes ?? j.estimated_minutes ?? null;
                      const remaining = eta != null ? eta - elapsedMin : null;
                      // Daksh May 2026 — Active-tab CARVING NOW pill
                      // recoloured from blue → green to match the
                      // cockpit palette swap.
                      return (
                        <div
                          style={{
                            background: isManual ? "rgba(120,53,15,0.08)" : "rgba(22,163,74,0.10)",
                            border: `1px solid ${isManual ? "rgba(120,53,15,0.35)" : "rgba(22,163,74,0.40)"}`,
                            borderRadius: 6,
                            padding: "5px 8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <div style={{ fontSize: 9, fontWeight: 800, color: isManual ? "#92400e" : "#15803d", letterSpacing: "0.07em" }}>
                            {isManual ? "🪚 MANUAL CARVING" : "▶ CARVING NOW"}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: isManual ? "#78350f" : "#166534",
                              fontFamily: "ui-monospace, monospace",
                              display: "flex",
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <span>▶ {fmtDur(elapsedMin)}</span>
                            {remaining != null && (
                              <span style={{ color: remaining < 0 ? "#dc2626" : remaining < 15 ? "#b45309" : isManual ? "#92400e" : "#15803d", fontWeight: 700 }}>
                                ⏱ {remaining < 0 ? `${fmtDur(remaining)} over` : `${fmtDur(remaining)} left`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }
                    // Queued state: branch on Manual vs CNC + receipt
                    if (isManual) {
                      return (
                        <div
                          style={{
                            background: isUrgent ? "rgba(220,38,38,0.08)" : "rgba(120,53,15,0.08)",
                            border: `1px solid ${isUrgent ? "rgba(220,38,38,0.35)" : "rgba(120,53,15,0.3)"}`,
                            borderRadius: 6,
                            padding: "5px 8px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.07em",
                            color: isUrgent ? "#991b1b" : "#78350f",
                          }}
                        >
                          <span>🪚 AWAITING MANUAL START</span>
                          {isUrgent && <span style={{ fontSize: 9, fontWeight: 800 }}>⚡ URGENT</span>}
                        </div>
                      );
                    }
                    // CNC + carving_assigned — branch on receipt
                    const received = !!j.received_at_vendor_at;
                    const assignedAt = j.assigned_at ? new Date(j.assigned_at).getTime() : null;
                    const sinceAssignedMin =
                      assignedAt != null ? (now - assignedAt) / 60000 : null;
                    const sinceReceivedMin =
                      received && j.received_at_vendor_at
                        ? (now - new Date(j.received_at_vendor_at).getTime()) / 60000
                        : null;
                    return (
                      <div
                        style={{
                          background: isUrgent
                            ? "rgba(220,38,38,0.08)"
                            : received
                              ? "rgba(180,115,51,0.08)"
                              : "rgba(217,119,6,0.08)",
                          border: `1px solid ${
                            isUrgent
                              ? "rgba(220,38,38,0.35)"
                              : received
                                ? "rgba(180,115,51,0.3)"
                                : "rgba(217,119,6,0.3)"
                          }`,
                          borderRadius: 6,
                          padding: "5px 8px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: "0.07em",
                          color: isUrgent ? "#991b1b" : received ? "#78350f" : "#b45309",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                          }}
                        >
                          <span>
                            {received
                              ? `📦 IN STOCK${sinceReceivedMin != null ? ` · ${fmtDur(sinceReceivedMin)}` : ""}`
                              : `🚚 AWAITING DELIVERY${sinceAssignedMin != null ? ` · ${fmtDur(sinceAssignedMin)}` : ""}`}
                          </span>
                          {isUrgent && <span style={{ fontSize: 9, fontWeight: 800 }}>⚡ URGENT</span>}
                        </div>
                        {/* While in transit, show the slab's last known
                            physical location so whoever is moving it
                            knows where to pick it up. Once received,
                            show the dropoff_note (if set) so the team
                            knows exactly where the runner left it.
                            Migrations 020 + 023 + 025. */}
                        {!received && j.slab_stock_location && (
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: "#7c2d12",
                              letterSpacing: "0.04em",
                              fontFamily: "ui-monospace, monospace",
                            }}
                          >
                            📍 {j.slab_stock_location}
                            {j.claimed_by && (
                              <span style={{ marginLeft: 6, color: "#1d4ed8" }}>
                                · 🚧 runner has it
                              </span>
                            )}
                          </div>
                        )}
                        {received && j.dropoff_note && (
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: "#15803d",
                              letterSpacing: "0.04em",
                              fontFamily: "ui-monospace, monospace",
                            }}
                          >
                            📍 left at {j.dropoff_note}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Header: slab id + stone (+ lathe / manual chips) */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.slab_requirement_id}
                    </span>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                      {j.requires_machine_type === "lathe" && (
                        <span
                          style={{
                            fontSize: 9,
                            padding: "1px 6px",
                            borderRadius: 3,
                            background: "rgba(124,58,237,0.15)",
                            color: "#7c3aed",
                            fontWeight: 800,
                            letterSpacing: "0.05em",
                          }}
                          title="Cylindrical work — must go on a lathe"
                        >
                          🌀 LATHE
                        </span>
                      )}
                      {j.vendor_type === "Manual" && (
                        <span
                          style={{
                            fontSize: 9,
                            padding: "1px 6px",
                            borderRadius: 3,
                            background: "rgba(120,53,15,0.15)",
                            color: "#78350f",
                            fontWeight: 800,
                            letterSpacing: "0.05em",
                          }}
                          title="Manual carver — head fires Mark started / complete"
                        >
                          🪚 MANUAL
                        </span>
                      )}
                      {j.stone && (
                        <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px" }}>
                          {j.stone}
                        </span>
                      )}
                    </div>
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

                  {/* Inline manual-vendor lifecycle buttons. Surfaced
                      directly on the Active-tab card so the carving
                      head can fire Mark started / Mark complete
                      without drilling into the detail page. Buttons
                      stopPropagation so clicking them doesn't also
                      open the peek modal. CNC cards skip this. */}
                  {j.vendor_type === "Manual" && (
                    <ManualLifecycleButtons job={j} />
                  )}
                </div>
              );
            })}
          </div>
        </details>
        );
      })}
    </>
  );
}

// Tiny client-side button bar for manual-vendor jobs on Active cards.
// Imported actions are server actions; calling them from a form runs
// the server action and refreshes via revalidatePath().
function ManualLifecycleButtons({ job }: { job: JobRow }) {
  // carving_assigned → Mark started
  if (job.status === "carving_assigned") {
    return (
      <form
        action={markCarvingStartedManuallyAction}
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: 4 }}
      >
        <input type="hidden" name="carving_item_id" value={job.id} />
        <input type="hidden" name="redirect_to" value="/carving?tab=active" />
        <button
          type="submit"
          style={{
            width: "100%",
            fontSize: 11,
            padding: "6px 10px",
            fontWeight: 700,
            background: "#78350f",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          ▶ Mark started
        </button>
      </form>
    );
  }
  // carving_in_progress + completed_at NULL → Mark complete
  if (job.status === "carving_in_progress" && !job.completed_at) {
    return (
      <form
        action={markCarvingCompleteManuallyAction}
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: 4 }}
      >
        <input type="hidden" name="carving_item_id" value={job.id} />
        <input type="hidden" name="redirect_to" value="/carving?tab=active" />
        <button
          type="submit"
          style={{
            width: "100%",
            fontSize: 11,
            padding: "6px 10px",
            fontWeight: 700,
            background: "#15803d",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          🎯 Mark complete
        </button>
      </form>
    );
  }
  return null;
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
    iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtDateTime = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
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
            {/* Link to the full detail page — that's where the
                Workflow card lives (✅ Mark received, ↔ Transfer,
                Re-tag work type, Manual start/complete). The peek
                only shows summary + Approve/Reject; everything
                else requires the detail page. */}
            <Link
              href={`/carving/${job.id}`}
              style={{
                display: "inline-block",
                marginTop: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--gold-dark)",
                textDecoration: "underline",
              }}
            >
              Open full job ↗
            </Link>
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
            const when = new Date(e.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
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
  // Daksh May 2026 — palette swap: carving_in_progress now reads
  // as green (active work = healthy). dispatched stays blue (it's a
  // logistics state, not a machine status — different semantic).
  const tone =
    status === "completed"
      ? { fg: "#15803d", bg: "rgba(22,163,74,0.12)" }
      : status === "dispatched"
        ? { fg: "#1d4ed8", bg: "rgba(37,99,235,0.12)" }
        : status === "carving_in_progress"
          ? { fg: "#15803d", bg: "rgba(22,163,74,0.12)" }
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

