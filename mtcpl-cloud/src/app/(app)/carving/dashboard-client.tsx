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
import { ReceiveModal } from "./receive-modal";
import {
  approveCarvingJobAction,
  getDispatchStationsAction,
  reworkCarvingJobAction,
  stillPendingWorkAction,
  involveOwnerAction,
  backToApprovalAction,
  markCarvingStartedManuallyAction,
  getJobEvents,
  getSignedReviewMediaUrl,
  type JobEvent,
} from "./actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";
// Daksh May 2026 — live camera capture only (no gallery / file
// picker). MediaRecorder-style getUserMedia + canvas snapshot.
import { CameraCaptureModal } from "@/components/camera-capture-modal";
// Daksh (June 2026) — highlight / colour-mark the review photo. Marks
// are baked into the uploaded image so they show on every surface
// (Carving Done card + peek, rework cockpit, Carving Rejected page).
import { ImageAnnotateModal } from "@/components/image-annotate-modal";
// Mig 132 — slab cancellation: long-press a card (or 🚫 in the peek) to
// request a cancel; owner approves/rejects on /tasks/slab-cancels.
import { SlabCancelRequestModal, longPressHandlers } from "@/components/slab-cancel-request-modal";
import { requestSlabCancelAction } from "@/app/(app)/slabs/cancel-actions";
import { SlabComponentDetail } from "@/components/slab-component-detail";

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
  /** Mig 126 — set while the slab is PRE-CUT (released early; its block
   *  is still cutting). Blinking dot on the card; cleared when the
   *  block's cutting is fully approved. */
  precut_at?: string | null;
  /** Mig 132 — a cancel request is pending (slab reported broken). Card
   *  shows RED + locked (no assign) until the owner decides. */
  cancel_requested_at?: string | null;
  /** Mig 123 / 128 — component hierarchy: Category 1 = component_section,
   *  Category 2 = component_element, Additional = additional_description,
   *  plus the plain description. All nullable; each is shown on the
   *  Unassigned card ONLY when present, so older slabs (null) simply show
   *  fewer levels. Test bed for rolling this detail out elsewhere. */
  description?: string | null;
  component_section?: string | null;
  component_element?: string | null;
  additional_description?: string | null;
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
  /** Mig 123 / 128 — component hierarchy joined from slab_requirements
   *  (Category 1 = section, Category 2 = element, Additional). Shown on the
   *  job cards + the detail peek. Nullable; older slabs come back null. */
  slab_component_section?: string | null;
  slab_component_element?: string | null;
  slab_additional_description?: string | null;
  // Slab dimensions + stone are needed to render the 3D thumbnail on
  // each job card. Plumbed through from page.tsx → enrich().
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  vendor_id: string;
  vendor_name: string;
  vendor_type: "CNC" | "Outsource";
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
  /** Mig 075 — the CNC machine that actually carved the slab,
   *  preserved at unload (cnc_machine_id is nulled once the slab
   *  comes off the bed). Used to show which machine produced a slab
   *  on the Carving Done Approval + Carving Done cards, since by
   *  then cnc_machine_id is gone. NULL for Manual vendors. */
  completed_on_cnc_machine_id?: string | null;
  location?: string | null;
  ready_to_dispatch_at?: string | null;
  /** Mig 080/081 — reviewer's sign-off attachment + structured
   *  quality flag + freeform notes captured at Approve. Surface the
   *  photo on the Carving Done card + peek so the team can see what
   *  the reviewer saw. Only populated on approved slabs. */
  review_image_path?: string | null;
  /** Mig 089 — all 1-3 review photos. Falls back to review_image_path. */
  review_image_paths?: string[] | null;
  review_quality_flag?: string | null;
  review_notes?: string | null;
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
  /** Mig 079 — axis requirement on CNC jobs. NULL = "Any CNC". */
  requires_cnc_axes?: number | null;
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
  /** Mig 069 — on-hold metadata. Set when a loaded slab is parked in
   *  the cockpit On-Hold tray. Surfaces the "⏸ ON HOLD" ribbon +
   *  reason on the Active tab card. NULL unless status is
   *  carving_on_hold. */
  held_at?: string | null;
  held_reason?: string | null;
  /** Mig 097 — Depart: approved but held from dispatch (needs a touch-up).
   *  Surfaces a distinct card tint on Carving Done. */
  depart_flag?: boolean | null;
  depart_note?: string | null;
  /** Mig 097 — Outsource "Still Pending Work" — received, not approved,
   *  waiting on vendor rework. */
  pending_work_at?: string | null;
  pending_work_note?: string | null;
  /** Mig 118 — "Involve owner": a problem escalated to the owner during
   *  Carving Done Approval. 'open' shows an "Owner review" badge; once the
   *  owner resolves it the card shows "Issue resolved". */
  owner_review_status?: string | null;
  owner_review_kind?: string | null;
  owner_review_note?: string | null;
  /** Mig 132 — the slab under this job has a pending cancel request.
   *  Red card + lock banner until the owner approves/rejects. */
  slab_cancel_pending?: boolean;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Outsource";
  machines: Array<{
    id: string;
    machine_code: string;
    status: "idle" | "carving" | "maintenance" | "inactive";
    machine_type?: "single_head" | "multi_head_2" | "lathe";
    /** Mig 079 — CNC axis count (3/4/5). NULL on lathes. */
    cnc_axes?: number | null;
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
  mode,
  unassignedSlabs,
  activeJobs,
  reviewJobs,
  doneJobs,
  pendingJobs,
  vendors,
  machineCodeById,
  templeNames,
  templeFilter,
  stoneTypes,
  canRequestCancel = false,
}: {
  tab: "unassigned" | "active" | "review" | "done" | "pending";
  /** Daksh June 2026 — CNC vs Outsource view. Drives assign-vendor
   *  filtering + the Outsource "Receive" affordance. */
  mode: "cnc" | "outsource";
  unassignedSlabs: UnassignedSlab[];
  activeJobs: JobRow[];
  reviewJobs: JobRow[];
  doneJobs: JobRow[];
  /** Mig 097 — Outsource "Still Pending Work" (received, not approved). */
  pendingJobs: JobRow[];
  vendors: Vendor[];
  machineCodeById: Record<string, string>;
  /** Every temple that appears in any of the four datasets. Dropdown source. */
  templeNames: string[];
  /** Currently-selected temple filter. "" or "all" means no filter. */
  templeFilter: string;
  /** Stone palette definitions for the 3D thumbnails on cards. */
  stoneTypes: StoneTypeDef[];
  /** Mig 132 — long-press a slab card to request a cancel (broken slab).
   *  carving_head / senior_incharge / owner / developer. */
  canRequestCancel?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [assigning, setAssigning] = useState<UnassignedSlab | null>(null);
  // Daksh June 2026 — Outsource batch-receive modal. initialId is the
  // carving_item whose card 📥 Receive was tapped (pre-selected); the head
  // can tick up to 8 returned slabs and confirm in one press.
  const [receiving, setReceiving] = useState<{ initialId: string | null; vendorName: string | null } | null>(null);
  // Job detail peek — opened by clicking any card on Active /
  // Awaiting Review / Carving Done. Center modal with slab info,
  // assignment, and inline approve/reject forms.
  const [peekJob, setPeekJob] = useState<JobRow | null>(null);
  // Mig 132 — slab whose cancel-request modal is open (long-press on a
  // card, or the 🚫 button in the job peek).
  const [cancelTarget, setCancelTarget] = useState<{ id: string; temple?: string | null; label?: string | null } | null>(null);

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

  // Date filter helper — true if the row's timestamp falls within the
  // selected window. `all` always passes.
  //
  // Daksh (June 2026) — anchored to IST CALENDAR DAYS, not a rolling 24h
  // window. Previously this was `now - approved <= days*24h`, so a slab
  // approved at, say, 8 PM yesterday still showed under "Today" until 8 PM
  // today (it was < 24h old). Now "Today" = on/after IST-midnight today;
  // "Last 2d" = today + yesterday; "Last 7d" = 7 calendar days; etc.
  function passesDate(iso: string | null | undefined): boolean {
    if (dateFilter === "all") return true;
    if (!iso) return false;
    const daysBack =
      dateFilter === "1d" ? 0 : dateFilter === "2d" ? 1 : dateFilter === "7d" ? 6 : 29;
    const IST = 5.5 * 3600 * 1000;
    const istNow = new Date(Date.now() + IST);
    const cutoffMs =
      Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - daysBack) - IST;
    return new Date(iso).getTime() >= cutoffMs;
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

        {/* Mig 126 — blink keyframes for the pre-cut dot on unassigned
            cards (defined once here, used by every card). */}
        <style>{`@keyframes precutBlink{50%{opacity:0.15}}`}</style>

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
            // Mig 132 — long-press a card to request a cancel.
            onRequestCancel={canRequestCancel ? (s) => setCancelTarget({ id: s.id, temple: s.temple, label: s.label }) : undefined}
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
              // Mig 097 — Outsource has no 2-head pairing, so drop the
              // "identical L×W×T only" rule: any slabs can batch together.
              // CNC keeps the mirror-pair constraint via the anchor.
              mode === "outsource"
                ? null
                : anchor
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
            onReceive={(id, vendorName) => setReceiving({ initialId: id, vendorName })}
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
            // Daksh — start every vendor/temple section minimized
            // here so the lower vendors aren't buried under expanded
            // lists. Active + Approval tabs keep their open default.
            collapseByDefault
          />
        </>
      )}

      {/* Mig 097 — Outsource "Still Pending Work" tab (vendor-wise). */}
      {tab === "pending" && (
        <PendingWorkList jobs={pendingJobs} stoneTypes={stoneTypes} />
      )}

      {assigning && (
        <AssignModal
          slab={assigning}
          vendors={vendors.filter(
            (v) => v.vendor_type === (mode === "outsource" ? "Outsource" : "CNC"),
          )}
          outsourceOnly={mode === "outsource"}
          onClose={() => setAssigning(null)}
        />
      )}

      {/* Outsource batch-receive modal (Daksh June 2026). Lists every
          slab currently out with a vendor (in-progress Outsource jobs),
          pre-selects the tapped card, and receives up to 8 in one press
          with a two-tap confirm. */}
      {receiving && (
        <ReceiveModal
          jobs={activeJobs
            .filter(
              (j) =>
                j.vendor_type === "Outsource" &&
                j.status === "carving_in_progress" &&
                !j.completed_at &&
                // Daksh June 2026 — scope the Receive list to the vendor whose
                // card was tapped; the head receives one carver at a time.
                (!receiving.vendorName || j.vendor_name === receiving.vendorName),
            )
            .map((j) => ({
              id: j.id,
              slab_id: j.slab_requirement_id,
              label: j.slab_label,
              temple: j.temple,
              stone: j.stone,
              length_ft: j.length_ft,
              width_ft: j.width_ft,
              thickness_ft: j.thickness_ft,
              vendor_name: j.vendor_name,
            }))}
          initialId={receiving.initialId}
          vendorName={receiving.vendorName}
          stoneTypes={stoneTypes}
          onClose={() => setReceiving(null)}
        />
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
          vendors={vendors.filter(
            (v) => v.vendor_type === (mode === "outsource" ? "Outsource" : "CNC"),
          )}
          outsourceOnly={mode === "outsource"}
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
          // Mig 132 — 🚫 Request slab cancel from the peek (active jobs).
          onRequestCancel={
            canRequestCancel && !peekJob.slab_cancel_pending && peekJob.status !== "dispatched" && peekJob.status !== "cancelled"
              ? () => setCancelTarget({ id: peekJob.slab_requirement_id, temple: peekJob.temple, label: peekJob.slab_label })
              : undefined
          }
        />
      )}

      {/* Mig 132 — request-cancel modal (long-press on a card / 🚫 in peek). */}
      {cancelTarget && (
        <SlabCancelRequestModal
          slabId={cancelTarget.id}
          temple={cancelTarget.temple}
          label={cancelTarget.label}
          onClose={() => setCancelTarget(null)}
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
  onRequestCancel,
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
  /** Mig 132 — long-press (or right-click) a card to request a cancel.
   *  Undefined = viewer can't request cancels. */
  onRequestCancel?: (s: UnassignedSlab) => void;
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
    // Mig 132 — pending cancel request: card goes RED + fully locked
    // (no bulk toggle, no Assign) until the owner decides.
    const cancelPending = !!s.cancel_requested_at;
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
    const cardClickable = bulkMode && !dimMismatch && !cancelPending;
    const isDisabled = bulkMode && (atLimit || !!dimMismatch || cancelPending);
    // Mig 132 — long-press (or right-click) to request a cancel.
    const pressHandlers =
      onRequestCancel && !cancelPending && !bulkMode
        ? longPressHandlers(() => onRequestCancel(s))
        : {};
    return (
    <div
      key={s.id}
      onClick={cardClickable ? () => onBulkToggle(s.id) : undefined}
      {...pressHandlers}
      style={{
        padding: "8px 10px",
        background: cancelPending
          ? "rgba(185,28,28,0.07)"
          : bulkMode && isSelected
          ? "rgba(180,115,51,0.12)"
          : s.priority
            ? "rgba(220,38,38,0.04)"
            : "var(--surface)",
        border: `2px solid ${
          cancelPending
            ? "#b91c1c"
            : bulkMode && isSelected
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
          {/* Mig 126 — blinking dot: this slab was released early (pre-cut);
              its block is still cutting. Goes normal once the block's
              cutting is fully approved. */}
          {s.precut_at && (
            <span
              title="Pre-cut — released early; its block is still cutting"
              style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#d97706", marginRight: 5, animation: "precutBlink 1.1s steps(1,end) infinite", verticalAlign: "middle" }}
            />
          )}
          {s.priority && "⚡ "}
          {s.id}
        </span>
        {s.stone && (
          <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>
            {s.stone}
          </span>
        )}
      </div>
      {s.precut_at && (
        <div style={{ fontSize: 9.5, fontWeight: 800, color: "#92400e", background: "rgba(217,119,6,0.12)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 4, padding: "1px 6px", alignSelf: "flex-start" }}>
          ⏳ block still cutting
        </div>
      )}
      {/* Mig 132 — cancel-in-process banner. Locked until owner decides. */}
      {cancelPending && (
        <div style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: "#b91c1c", borderRadius: 4, padding: "2px 7px", alignSelf: "flex-start", letterSpacing: "0.03em" }}>
          🚫 CANCEL REQUESTED — waiting for owner
        </div>
      )}
      {/* In flat view we surface temple under the slab id since the
          temple group header is gone. In grouped view temple is in
          the accordion header so we hide it here. */}
      {viewMode === "flat" && (
        <div style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          🏛 {s.temple}
        </div>
      )}
      {/* Daksh June 2026 — full component hierarchy on UNASSIGNED cards
          only (test bed before rolling out elsewhere): Category 1 ›
          Category 2 › Label › Description › Additional. Each level renders
          ONLY when it has a value, so older slabs missing Category 1/2
          (or Additional) just show the levels they have — a slab with only
          a label + description shows just those two. */}
      <SlabComponentDetail
        section={s.component_section}
        element={s.component_element}
        label={s.label}
        description={s.description}
        additional={s.additional_description}
      />
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
          mode. In bulk mode the whole card acts as a toggle.
          Mig 132 — hidden while a cancel request is pending (locked). */}
      {!bulkMode && !cancelPending && (
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

// ── Review photo + quality flag (Daksh, June 2026) ──────────────
// The reviewer can attach a photo + structured quality flag when
// approving a carved slab (mig 080/081). Those were written to the
// row but never SHOWN back on Carving Done — this surfaces them.
//
// The image lives in a PRIVATE storage bucket, so we mint a 5-min
// signed URL on mount via getSignedReviewMediaUrl (same pattern the
// vendor cockpit uses for rework/reject photos). Renders nothing
// until a path resolves so slabs without a photo reserve no space.
function ReviewPhoto({
  path,
  alt,
  maxHeight = 160,
  rounded = 10,
  fit = "cover",
}: {
  path: string | null | undefined;
  alt: string;
  maxHeight?: number;
  rounded?: number;
  /** 'cover' crops to a tidy tile (compact card); 'contain' shows
   *  the whole frame letterboxed (the peek, where detail matters). */
  fit?: "cover" | "contain";
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [visible, setVisible] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);

  // Lazy load — only mint the signed URL once the element scrolls
  // into view. Content inside a COLLAPSED <details> is display:none,
  // so it never intersects → no fetch until the user expands that
  // vendor section. This keeps Carving Done from signing every
  // card's photo on page load (the tab can hold up to 200 rows and
  // groups start collapsed). The peek, always visible, fetches at
  // once. Falls back to eager load where IO is unavailable.
  useEffect(() => {
    if (!path || visible) return;
    const el = holderRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [path, visible]);

  useEffect(() => {
    let cancelled = false;
    if (!path || !visible) return;
    (async () => {
      try {
        const signed = await getSignedReviewMediaUrl(path);
        if (!cancelled) setUrl(signed);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, visible]);

  if (!path) return null;
  if (err) {
    return (
      <div ref={holderRef}>
        <span style={{ fontSize: 11, color: "#b91c1c" }}>⚠ photo unavailable</span>
      </div>
    );
  }
  if (!url) {
    // Same-footprint placeholder the observer watches; also the
    // visible state while the signed URL is in flight.
    return (
      <div
        ref={holderRef}
        style={{
          height: Math.min(maxHeight, 120),
          borderRadius: rounded,
          border: "1px dashed var(--border)",
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        📷 {visible ? "loading…" : "photo"}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      style={{
        width: "100%",
        maxHeight,
        objectFit: fit,
        background: fit === "contain" ? "var(--bg)" : undefined,
        borderRadius: rounded,
        border: "1px solid var(--border)",
        display: "block",
      }}
    />
  );
}

// Mig 089 — render 1-3 review photos. A single photo shows full-width
// (as before); 2-3 show as a thumbnail row. Resolves from the new
// review_image_paths array, falling back to the legacy single
// review_image_path for older rows.
function ReviewPhotoGallery({
  paths,
  single,
  alt,
  maxHeight = 120,
  rounded = 8,
  fit = "cover",
  thumbWidth = 140,
}: {
  paths?: string[] | null;
  single?: string | null;
  alt: string;
  maxHeight?: number;
  rounded?: number;
  fit?: "cover" | "contain";
  thumbWidth?: number;
}) {
  const list = paths && paths.length ? paths : single ? [single] : [];
  if (list.length === 0) return null;
  if (list.length === 1) {
    return (
      <ReviewPhoto path={list[0]} alt={alt} maxHeight={maxHeight} rounded={rounded} fit={fit} />
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {list.map((p) => (
        <div key={p} style={{ flex: "0 0 auto", width: thumbWidth }}>
          <ReviewPhoto path={p} alt={alt} maxHeight={maxHeight} rounded={rounded} fit={fit} />
        </div>
      ))}
    </div>
  );
}

// Mig 081 quality-flag presets → display metadata. Mirrors the
// option list inside ApproveRejectForms; kept here so the Carving
// Done card + peek can render a labeled chip for whatever the
// reviewer flagged at sign-off.
const QUALITY_FLAG_META: Record<string, { label: string; icon: string; tone: string }> = {
  carving_not_good: { label: "Carving quality not great", icon: "🪨", tone: "#b45309" },
  too_many_cracks: { label: "Too many cracks", icon: "⚡", tone: "#dc2626" },
  color_variation: { label: "Color variation", icon: "🎨", tone: "#7c3aed" },
  minor_chips: { label: "Minor chips / rough edges", icon: "⚒", tone: "#d97706" },
  other: { label: "Other (see note)", icon: "✏", tone: "#b8860b" },
};

function QualityFlagChip({ flag }: { flag: string }) {
  const meta =
    QUALITY_FLAG_META[flag] ?? { label: flag, icon: "🏷", tone: "var(--muted)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: 999,
        color: meta.tone,
        background: "var(--surface)",
        border: `1px solid ${meta.tone}`,
      }}
      title="Quality flag set by the reviewer at approval"
    >
      {meta.icon} {meta.label}
    </span>
  );
}

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
  onReceive,
  collapseByDefault = false,
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
  /** Daksh June 2026 — opens the Outsource batch-receive modal with the
   *  tapped slab pre-selected, scoped to the tapped card's vendor. Only
   *  the Active tab passes it. */
  onReceive?: (carvingItemId: string, vendorName: string) => void;
  /** Daksh (June 2026) — when true, every group renders collapsed
   *  on first paint regardless of group count. Set on Carving Done
   *  where the per-vendor sections were all expanded by default,
   *  making lower vendors hard to reach. The user can still expand
   *  any section; the choice persists across the 30s re-render. */
  collapseByDefault?: boolean;
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

  // Daksh — Carving Done passes collapseByDefault so all vendor
  // sections start minimized (easier to locate a specific vendor);
  // other tabs keep the "open when ≤3 groups" convenience.
  const openByDefault = collapseByDefault ? false : groups.length <= 3;

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
        let onHold = 0;
        for (const j of items) {
          totalCft += (j.length_ft * j.width_ft * j.thickness_ft) / 1728;
          totalSft += (j.length_ft * j.width_ft) / 144;
          if (j.status === "carving_in_progress") carvingNow++;
          else if (j.status === "carving_on_hold") onHold++;
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
                  {onHold > 0 && (
                    <span
                      style={{
                        color: "#475569",
                        fontWeight: 700,
                        padding: "1px 8px",
                        borderRadius: 999,
                        background: "rgba(100,116,139,0.12)",
                        border: "1px solid rgba(100,116,139,0.30)",
                      }}
                    >
                      ⏸ {onHold} on hold
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
                if (j.status === "carving_on_hold") return "#64748b"; // slate — paused
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
                    // Mig 097 — departed (approved-but-held) slabs get a
                    // distinct amber card on Carving Done so they stand apart.
                    // Mig 132 — pending-cancel slabs go RED (locked).
                    background: j.slab_cancel_pending
                      ? "rgba(185,28,28,0.07)"
                      : j.depart_flag ? "rgba(180,83,9,0.07)" : "var(--surface)",
                    border: j.slab_cancel_pending
                      ? "1.5px solid #b91c1c"
                      : j.depart_flag ? "1px solid rgba(180,83,9,0.4)" : "1px solid var(--border)",
                    borderLeft: `4px solid ${j.slab_cancel_pending ? "#b91c1c" : j.depart_flag ? "#b45309" : statusStripe}`,
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
                    e.currentTarget.style.background = j.slab_cancel_pending ? "rgba(185,28,28,0.07)" : "var(--surface)";
                    e.currentTarget.style.borderTopColor = j.slab_cancel_pending ? "#b91c1c" : "var(--border)";
                    e.currentTarget.style.borderRightColor = j.slab_cancel_pending ? "#b91c1c" : "var(--border)";
                    e.currentTarget.style.borderBottomColor = j.slab_cancel_pending ? "#b91c1c" : "var(--border)";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 1px 2px rgba(15,23,42,0.04)";
                  }}
                >
                  {/* Mig 132 — pending cancel: red banner, job locked. */}
                  {j.slab_cancel_pending && (
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#b91c1c", borderRadius: 5, padding: "3px 8px", alignSelf: "flex-start", letterSpacing: "0.03em" }}>
                      🚫 CANCEL REQUESTED — waiting for owner
                    </div>
                  )}
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
                        🤝 OUTSOURCE CARVING       (in_progress, no machine, Manual vendor)
                        🪚 AWAITING OUTSOURCE START (assigned, Manual vendor)
                        🚚 AWAITING DELIVERY    (assigned, CNC, no receipt yet)
                        📦 IN STOCK             (assigned, CNC, received but not loaded —
                                                 was "AT VENDOR", renamed per Daksh May 2026)
                        ⏳ WAITING              (legacy fallback)
                      Carving rows still show the running-for / remaining
                      duo when a loaded_at + ETA exist. */}
                  {fields.includes("deadline") && (() => {
                    const isCarving = j.status === "carving_in_progress";
                    const isUrgent = j.urgency === "urgent";
                    const isManual = j.vendor_type === "Outsource";
                    const fmtDur = (m: number) => {
                      const a = Math.abs(Math.round(m));
                      if (a < 60) return `${a}m`;
                      if (a < 60 * 24) return `${Math.floor(a / 60)}h ${a % 60}m`;
                      return `${Math.floor(a / (60 * 24))}d ${Math.floor((a % (60 * 24)) / 60)}h`;
                    };
                    // Daksh June 2026 — on-hold slabs now appear on the
                    // Active tab. Show a dedicated paused ribbon (slate)
                    // with how long it's been held + the reason, so the
                    // head can tell at a glance which slabs are parked
                    // and why. Reload/complete still happens on the
                    // vendor cockpit's On-Hold tray.
                    if (j.status === "carving_on_hold") {
                      const heldMin = j.held_at
                        ? (now - new Date(j.held_at).getTime()) / 60000
                        : null;
                      return (
                        <div
                          style={{
                            background: "rgba(100,116,139,0.10)",
                            border: "1px solid rgba(100,116,139,0.40)",
                            borderRadius: 6,
                            padding: "5px 8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 800,
                              color: "#475569",
                              letterSpacing: "0.07em",
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 6,
                            }}
                          >
                            <span>⏸ ON HOLD</span>
                            {heldMin != null && (
                              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                                {fmtDur(heldMin)}
                              </span>
                            )}
                          </div>
                          {j.held_reason && (
                            <div
                              style={{
                                fontSize: 10,
                                color: "#475569",
                                lineHeight: 1.35,
                                overflow: "hidden",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                              }}
                            >
                              {j.held_reason}
                            </div>
                          )}
                        </div>
                      );
                    }
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
                            {isManual ? "🤝 OUTSOURCE CARVING" : "▶ CARVING NOW"}
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
                          <span>🪚 AWAITING OUTSOURCE START</span>
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

                  {/* Header: slab id + stone (+ lathe / outsource chips).
                      Daksh June 2026 — id must stay fully visible (don't
                      let the Outsource/stone chips squeeze it to "AST–…").
                      Id no longer shrinks; chips wrap to a second line. */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" }}>
                      {j.slab_requirement_id}
                    </span>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
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
                      {/* Mig 079 — 4-axis / 5-axis badges. Only
                          show on non-lathe jobs with an explicit
                          axis requirement. NULL ("Any CNC") gets
                          no badge — that's the default and would
                          clutter every card. */}
                      {j.requires_machine_type !== "lathe" &&
                        (j.requires_cnc_axes === 4 || j.requires_cnc_axes === 5) && (
                          <span
                            style={{
                              fontSize: 9,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: "rgba(180,115,51,0.18)",
                              color: "#7c4a1f",
                              fontWeight: 800,
                              letterSpacing: "0.05em",
                            }}
                            title={`Must be loaded on a ${j.requires_cnc_axes}-axis CNC`}
                          >
                            {j.requires_cnc_axes}-AXIS
                          </span>
                        )}
                      {j.vendor_type === "Outsource" && (
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
                          title="Outsource carver — head fires Mark started / complete"
                        >
                          🤝 OUTSOURCE
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
                  {/* Full component hierarchy: Category 1 › Category 2 ›
                      Label › Description › Additional, each level only when
                      present. */}
                  <SlabComponentDetail
                    section={j.slab_component_section}
                    element={j.slab_component_element}
                    label={j.slab_label}
                    description={j.slab_description}
                    additional={j.slab_additional_description}
                  />

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
                      {(() => {
                        // Daksh — show which CNC produced the slab.
                        // On Active the slab is still on the bed
                        // (cnc_machine_id). On Carving Done Approval +
                        // Carving Done that's been nulled at unload,
                        // so fall back to completed_on_cnc_machine_id
                        // (mig 075, "which machine did the work").
                        const mid =
                          j.cnc_machine_id ?? j.completed_on_cnc_machine_id ?? null;
                        const code = mid ? machineCodeById[mid] ?? null : null;
                        if (!code) return null;
                        return <span title="Carving machine">🏭 {code}</span>;
                      })()}
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

                  {/* Mig 118 — "Owner review" flag so the team doesn't
                      forget an escalated slab; turns into "Issue resolved"
                      once the owner closes it from the Tasks page. */}
                  {j.owner_review_status === "open" && (
                    <div style={{ marginTop: 2, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: "#7c2d12", background: "rgba(180,83,9,0.14)", border: "1px solid rgba(180,83,9,0.45)" }}>
                      👤 Owner review{j.owner_review_kind === "no_slab_code" ? " · no slab code" : ""}
                    </div>
                  )}
                  {j.owner_review_status === "resolved" && (
                    <div style={{ marginTop: 2, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.12)", border: "1px solid rgba(22,163,74,0.4)" }}>
                      ✓ Issue resolved
                    </div>
                  )}

                  {/* Daksh (June 2026) — reviewer's approve photo on
                      the Carving Done card. Before this the photo was
                      saved at sign-off but never shown back here. Only
                      on the Done tab (fields has 'approved') and only
                      when a photo exists. The signed URL lazy-loads on
                      mount; since Done groups collapse by default this
                      only fires for the vendor section the user opens.
                      The quality flag (if the reviewer set one) shows
                      above it so the card carries the "why" too. */}
                  {fields.includes("approved") &&
                    (j.review_image_paths?.length || j.review_image_path) && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        marginTop: 2,
                        paddingTop: 6,
                        borderTop: "1px dashed var(--border-light)",
                      }}
                    >
                      {j.review_quality_flag && (
                        <div>
                          <QualityFlagChip flag={j.review_quality_flag} />
                        </div>
                      )}
                      <ReviewPhotoGallery
                        paths={j.review_image_paths}
                        single={j.review_image_path}
                        alt="Reviewer's approval photo"
                        maxHeight={120}
                        rounded={8}
                      />
                    </div>
                  )}

                  {/* Inline manual-vendor lifecycle buttons. Surfaced
                      directly on the Active-tab card so the carving
                      head can fire Mark started / Mark complete
                      without drilling into the detail page. Buttons
                      stopPropagation so clicking them doesn't also
                      open the peek modal. CNC cards skip this. */}
                  {j.vendor_type === "Outsource" && (
                    <ManualLifecycleButtons job={j} onReceive={onReceive} />
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

// Mig 097 — Outsource "Still Pending Work" tab. Vendor-grouped cards
// (received, not approved, sent back for rework). Each card has a
// "↩ Back to approval" button that returns it to Carving Done Approval.
function PendingWorkList({ jobs, stoneTypes }: { jobs: JobRow[]; stoneTypes: StoneTypeDef[] }) {
  if (jobs.length === 0) {
    return (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
        Nothing is pending vendor rework. When you mark an Outsource slab “Still Pending Work” on the Approval tab, it lands here.
      </div>
    );
  }
  const byVendor = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const arr = byVendor.get(j.vendor_name) ?? [];
    arr.push(j);
    byVendor.set(j.vendor_name, arr);
  }
  const groups = [...byVendor.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {groups.map(([vendor, list]) => (
        <div key={vendor}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#92400e", marginBottom: 8 }}>
            🤝 {vendor} · {list.length} pending
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {list.map((j) => (
              <div key={j.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: "rgba(180,83,9,0.05)", border: "1px solid rgba(180,83,9,0.35)", borderRadius: 12 }}>
                <SlabThumb stone={j.stone} l={j.length_ft} w={j.width_ft} t={j.thickness_ft} stoneTypes={stoneTypes} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.slab_requirement_id}</span>
                  {j.stone && <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>{j.stone}</span>}
                </div>
                <SlabComponentDetail
                  section={j.slab_component_section}
                  element={j.slab_component_element}
                  label={j.slab_label}
                  description={j.slab_description}
                  additional={j.slab_additional_description}
                />
                <div style={{ fontSize: 10, color: "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>{j.length_ft}×{j.width_ft}×{j.thickness_ft}&Prime;</div>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "#b45309", background: "rgba(180,83,9,0.1)", borderRadius: 999, padding: "3px 9px", alignSelf: "flex-start" }}>⏳ Still pending work</div>
                {j.pending_work_note && <div style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.4 }}>📝 {j.pending_work_note}</div>}
                <form action={backToApprovalAction} style={{ marginTop: "auto", paddingTop: 4 }}>
                  <input type="hidden" name="job_id" value={j.id} />
                  <button type="submit" style={{ width: "100%", padding: "7px 10px", fontSize: 12, fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 6, cursor: "pointer" }}>↩ Back to approval</button>
                </form>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Tiny client-side button bar for manual-vendor jobs on Active cards.
// Imported actions are server actions; calling them from a form runs
// the server action and refreshes via revalidatePath().
function ManualLifecycleButtons({
  job,
  onReceive,
}: {
  job: JobRow;
  /** Opens the batch-receive modal with this job pre-selected, scoped to
   *  this job's vendor. Optional because non-Active JobsByTemple instances
   *  don't render Receive. */
  onReceive?: (carvingItemId: string, vendorName: string) => void;
}) {
  // carving_assigned → Mark started (LEGACY: only in-flight Outsource
  // rows assigned before auto-start shipped land here; new ones skip it).
  if (job.status === "carving_assigned") {
    return (
      <form
        action={markCarvingStartedManuallyAction}
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: 4 }}
      >
        <input type="hidden" name="carving_item_id" value={job.id} />
        <input type="hidden" name="redirect_to" value="/carving?tab=active&mode=outsource" />
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
  // carving_in_progress + completed_at NULL → Receive (the carved slab
  // has come back from the vendor's facility). Daksh June 2026 — replaces
  // the old two-step Mark-started/Mark-complete: assign now auto-starts,
  // so the only Outsource action on the Active card is Receive, which
  // sends the slab to Carving Done Approval.
  // Daksh June 2026 — Receive now OPENS a confirm / multi-select modal
  // instead of firing immediately. A stray tap just opens the modal (no
  // accidental receive), and the head can tick up to 8 returned slabs and
  // receive them all in one press.
  if (job.status === "carving_in_progress" && !job.completed_at) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onReceive?.(job.id, job.vendor_name);
        }}
        style={{
          marginTop: 4,
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
        📥 Receive
      </button>
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
  onRequestCancel,
}: {
  job: JobRow;
  machineCodeById: Record<string, string>;
  stoneTypes: StoneTypeDef[];
  onClose: () => void;
  /** Mig 132 — opens the request-cancel modal for this job's slab.
   *  Undefined = viewer can't request / request already pending. */
  onRequestCancel?: () => void;
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
  // Live machine while on the bed; once unloaded that's nulled, so
  // fall back to the carving machine (mig 075) — the peek's 🏭 pill
  // then shows which CNC produced an approved/awaiting-review slab.
  const machineId = job.cnc_machine_id ?? job.completed_on_cnc_machine_id ?? null;
  const machineCode = machineId ? machineCodeById[machineId] ?? null : null;

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
              {/* Mig 132 — pending cancel: red lock banner. */}
              {job.slab_cancel_pending && (
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: "#b91c1c", borderRadius: 999, padding: "3px 10px", letterSpacing: "0.03em" }}>
                  🚫 CANCEL REQUESTED — locked until owner decides
                </span>
              )}
              {/* Mig 132 — request a cancel for this slab (broken). */}
              {onRequestCancel && (
                <button
                  type="button"
                  onClick={onRequestCancel}
                  title="Slab broken / unusable? Send a cancel request to the owner"
                  style={{
                    fontSize: 11.5, fontWeight: 800, color: "#b91c1c", background: "rgba(185,28,28,0.07)",
                    border: "1.5px solid rgba(185,28,28,0.4)", borderRadius: 999, padding: "4px 12px", cursor: "pointer",
                  }}
                >
                  🚫 Request cancel
                </button>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: "var(--text)" }}>
              🏛 {job.temple}
            </div>
            {job.slab_label && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
                {job.slab_label}
              </div>
            )}
            {/* Mig 080 — slab location bumped to the header so the
                reviewer doesn't have to scroll past the timeline
                to find it. Only renders when set. */}
            {job.location && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 8,
                  padding: "4px 10px",
                  background: "rgba(22,163,74,0.08)",
                  border: "1px solid rgba(22,163,74,0.28)",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#15803d",
                }}
                title={`Slab location: ${job.location}`}
              >
                📍 {job.location}
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
                marginLeft: job.location ? 8 : 0,
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
              {job.slab_component_section && (
                <Field label="Category 1">{job.slab_component_section}</Field>
              )}
              {job.slab_component_element && (
                <Field label="Category 2">{job.slab_component_element}</Field>
              )}
              {job.slab_description && (
                <Field label="Description">
                  <span style={{ fontStyle: "italic", color: "var(--muted)" }}>
                    “{job.slab_description}”
                  </span>
                </Field>
              )}
              {job.slab_additional_description && (
                <Field label="Additional">{job.slab_additional_description}</Field>
              )}
            </div>
          </section>

          {/* Mig 080 round 2 — Assignment redesigned as a journey
              card. Vendor avatar + machine chip on the top row; the
              three milestone timestamps (Assigned → Vendor completed
              → Approved) lay out as a horizontal step-timeline with
              filled/unfilled dots so the reviewer can read progress
              at a glance instead of parsing a flat Field stack. */}
          <section
            style={{
              padding: "14px 16px",
              background: "linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              fontSize: 13,
              boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
            }}
          >
            {/* Vendor row — avatar circle + name + (vendor_type) +
                machine pill on the right when one is loaded. */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                aria-hidden
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background:
                    "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)",
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  letterSpacing: "0.02em",
                  flexShrink: 0,
                  boxShadow: "0 2px 6px rgba(180,128,11,0.28)",
                }}
                title={`Vendor ${job.vendor_name}`}
              >
                {job.vendor_name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  Vendor
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "var(--text)",
                    marginTop: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{job.vendor_name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: "rgba(180,128,11,0.10)",
                      color: "var(--gold-dark)",
                      border: "1px solid rgba(180,128,11,0.22)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {job.vendor_type}
                  </span>
                </div>
              </div>
              {machineCode && (
                <div
                  style={{
                    padding: "6px 10px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text)",
                    fontFamily: "ui-monospace, monospace",
                  }}
                  title="CNC machine"
                >
                  🏭 {machineCode}
                </div>
              )}
            </div>

            {/* Step timeline — three milestones. Each step has an
                indicator dot (filled = reached, hollow = future) +
                the label + the timestamp. Connecting line behind
                the dots fills to match progress. */}
            {(() => {
              const steps = [
                {
                  key: "assigned",
                  label: "Assigned",
                  value: fmtDate(job.assigned_at),
                  reached: !!job.assigned_at,
                },
                {
                  key: "completed",
                  label: "Vendor completed",
                  value: job.completed_at ? fmtDateTime(job.completed_at) : "Pending",
                  reached: !!job.completed_at,
                },
                {
                  key: "approved",
                  label: job.review_approved_at ? "Approved" : "Awaiting review",
                  value: job.review_approved_at ? fmtDateTime(job.review_approved_at) : "Pending",
                  reached: !!job.review_approved_at,
                },
              ];
              const reachedCount = steps.filter((s) => s.reached).length;
              return (
                <div style={{ position: "relative", paddingTop: 4 }}>
                  {/* Background line */}
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: "calc(16.66% + 4px)",
                      right: "calc(16.66% + 4px)",
                      top: 12,
                      height: 2,
                      background: "var(--border)",
                      borderRadius: 1,
                    }}
                  />
                  {/* Progress fill — width tracks reachedCount */}
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: "calc(16.66% + 4px)",
                      top: 12,
                      height: 2,
                      width:
                        reachedCount === 0
                          ? 0
                          : reachedCount === 1
                            ? 0
                            : reachedCount === 2
                              ? "calc(33.33% - 8px)"
                              : "calc(66.66% - 8px)",
                      background:
                        "linear-gradient(90deg, var(--gold) 0%, var(--gold-dark) 100%)",
                      borderRadius: 1,
                      transition: "width 0.3s ease",
                    }}
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      position: "relative",
                    }}
                  >
                    {steps.map((step, i) => {
                      const isLast = i === steps.length - 1;
                      return (
                        <div
                          key={step.key}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            textAlign: "center",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: "50%",
                              background: step.reached
                                ? "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)"
                                : "var(--surface)",
                              border: `2px solid ${step.reached ? "var(--gold-dark)" : "var(--border)"}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 800,
                              color: step.reached ? "#fff" : "var(--muted)",
                              boxShadow: step.reached
                                ? "0 2px 6px rgba(180,128,11,0.3)"
                                : "none",
                              flexShrink: 0,
                            }}
                          >
                            {step.reached ? "✓" : i + 1}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              color: step.reached ? "var(--text)" : "var(--muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {step.label}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: step.reached ? "var(--text)" : "var(--muted)",
                              fontFamily: step.reached ? "ui-monospace, monospace" : "inherit",
                              fontStyle: step.reached ? "normal" : "italic",
                            }}
                          >
                            {step.value}
                          </div>
                          {/* Hidden hack to silence the unused isLast var */}
                          <span style={{ display: "none" }}>{isLast ? "" : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Secondary facts (due / phase) — only when set, so the
                card doesn't grow when there's nothing to show. */}
            {(job.due_at || job.progress_phase) && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  paddingTop: 8,
                  borderTop: "1px dashed var(--border)",
                }}
              >
                {job.due_at && (
                  <div
                    style={{
                      padding: "5px 10px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                    title="Due date"
                  >
                    📅 Due {fmtDate(job.due_at)}
                  </div>
                )}
                {job.progress_phase && (
                  <div
                    style={{
                      padding: "5px 10px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                    title="Current phase"
                  >
                    🔄 {job.progress_phase}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Daksh (June 2026) — reviewer's approval photo. The
              Approve sign-off can attach a photo + quality flag (mig
              080/081); it was written to the row but never shown back
              when re-opening an approved slab. This block surfaces it
              inside the peek the user opens from Carving Done. Only
              renders once a photo exists (approved slabs). */}
          {(job.review_image_paths?.length || job.review_image_path) && (
            <section
              style={{
                padding: "14px 16px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                }}
              >
                📷 Review photo{(job.review_image_paths?.length ?? 0) > 1 ? "s" : ""}
              </div>
              {job.review_quality_flag && (
                <div>
                  <QualityFlagChip flag={job.review_quality_flag} />
                </div>
              )}
              <ReviewPhotoGallery
                paths={job.review_image_paths}
                single={job.review_image_path}
                alt="Reviewer's review photo"
                maxHeight={300}
                rounded={10}
                fit="contain"
                thumbWidth={180}
              />
              {job.review_notes && (
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text)",
                    fontStyle: "italic",
                    borderLeft: "3px solid var(--border)",
                    paddingLeft: 10,
                  }}
                >
                  “{job.review_notes}”
                </div>
              )}
            </section>
          )}

          {/* Status banner — context-specific */}
          {inReview && (
            <ApproveRejectForms
              jobId={job.id}
              slabId={job.slab_requirement_id}
              isOutsource={job.vendor_type === "Outsource"}
              ownerReviewStatus={job.owner_review_status ?? null}
              ownerReviewKind={job.owner_review_kind ?? null}
              ownerReviewNote={job.owner_review_note ?? null}
              onDone={onClose}
            />
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
// Mig 118 — "Involve owner" block shown inside the Carving Done Approval
// modal. Lets the reviewer escalate a problem to the owner (one open issue
// per slab); the slab can still be approved / reworked / rejected.
function OwnerInvolveSection({
  jobId, status, kind, note, onDone,
}: {
  jobId: string; status: string | null; kind: string | null; note: string | null; onDone: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pkind, setPkind] = useState<"no_slab_code" | "other">("no_slab_code");
  const [pnote, setPnote] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function send() {
    if (pending) return;
    if (pkind === "other" && !pnote.trim()) {
      setErr("Describe the problem when choosing 'Other'.");
      return;
    }
    setPending(true);
    setErr(null);
    const fd = new FormData();
    fd.set("job_id", jobId);
    fd.set("stay", "1");
    fd.set("problem_kind", pkind);
    if (pnote.trim()) fd.set("problem_note", pnote.trim());
    involveOwnerAction(fd)
      .then((res) => {
        if (res && res.ok === false) {
          setErr(res.error ?? "Couldn't send to owner.");
          setPending(false);
          return;
        }
        onDone();
        router.refresh();
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e));
        setPending(false);
      });
  }

  if (status === "open") {
    return (
      <div style={{ padding: "10px 12px", border: "1.5px solid rgba(180,83,9,0.5)", background: "rgba(180,83,9,0.08)", borderRadius: 10, fontSize: 12.5 }}>
        <div style={{ fontWeight: 800, color: "#7c2d12" }}>👤 Owner review pending</div>
        <div style={{ color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>
          {kind === "no_slab_code" ? "No slab code" : "Reported"}{note && kind !== "no_slab_code" ? ` — ${note}` : ""}. The owner resolves it from their Tasks page; you can still approve / rework / reject this slab.
        </div>
      </div>
    );
  }

  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      {status === "resolved" && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginBottom: open ? 8 : 0 }}>✓ Owner marked the previous issue resolved</div>
      )}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "9px 12px", fontSize: 12.5, fontWeight: 800, color: "#7c2d12", background: "rgba(180,83,9,0.08)", border: "1px solid rgba(180,83,9,0.4)", borderRadius: 8, cursor: "pointer" }}>
          👤 Involve owner — report a problem
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Report to owner</div>
          {/* Segmented picker (matches the "Carved sides" control above). */}
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                { v: "no_slab_code", label: "No slab code" },
                { v: "other", label: "Other (describe)" },
              ] as Array<{ v: "no_slab_code" | "other"; label: string }>
            ).map((o) => {
              const on = pkind === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setPkind(o.v)}
                  style={{
                    flex: 1,
                    padding: "9px 10px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    border: `1.5px solid ${on ? "#b45309" : "var(--border)"}`,
                    background: on ? "rgba(180,83,9,0.10)" : "var(--surface)",
                    color: on ? "#7c2d12" : "var(--text)",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {pkind === "other" && (
            <textarea
              value={pnote}
              onChange={(e) => setPnote(e.target.value)}
              rows={2}
              placeholder="Describe the problem for the owner"
              onFocus={(e) => { e.currentTarget.style.borderColor = "#b45309"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(180,83,9,0.16)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 13, border: "1.5px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--text)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            />
          )}
          {err && <div style={{ fontSize: 12, color: "#991b1b", fontWeight: 600 }}>⚠ {err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => { setOpen(false); setErr(null); }} style={{ padding: "7px 12px", fontSize: 12.5, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", color: "var(--text)" }}>Cancel</button>
            <button type="button" disabled={pending} onClick={send} style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 800, color: "#fff", background: "#b45309", border: "none", borderRadius: 8, cursor: pending ? "wait" : "pointer" }}>{pending ? "Sending…" : "Send to owner"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApproveRejectForms({ jobId, slabId, isOutsource, onDone, ownerReviewStatus, ownerReviewKind, ownerReviewNote }: { jobId: string; slabId: string; isOutsource: boolean; onDone: () => void; ownerReviewStatus?: string | null; ownerReviewKind?: string | null; ownerReviewNote?: string | null }) {
  const router = useRouter();
  // Mig 080 — three outcomes. The selected mode drives which form
  // is open and which server action gets called on submit. Image
  // upload is OPTIONAL on approve, MANDATORY on rework + reject.
  // Mig 097 — Outsource swaps Rework+Reject for a single "pending"
  // (Still Pending Work). CNC keeps all three.
  type Mode = "approve" | "rework" | "reject" | "pending";
  const [mode, setMode] = useState<Mode>("approve");
  const [notes, setNotes] = useState("");
  // Mig 089 — up to 3 review photos (was a single imageFile). Each
  // entry keeps an object-URL for its thumbnail preview.
  const [images, setImages] = useState<Array<{ file: File; url: string }>>([]);
  const MAX_REVIEW_IMAGES = 3;
  // Mig 080 follow-on (Daksh) — camera capture only (no file/gallery
  // pick). Opens the CameraCaptureModal which does getUserMedia +
  // canvas snapshot. Captured File comes back via handleFile().
  const [cameraOpen, setCameraOpen] = useState(false);
  // Daksh (June 2026) — when set, the ImageAnnotateModal is open on
  // this file so the reviewer can highlight the problem area. On
  // save the marked-up file replaces imageFile (marks baked in).
  // Mig 089 — which photo (by index) the annotate modal is editing.
  const [annotate, setAnnotate] = useState<{ idx: number; file: File } | null>(null);
  // Mig 081 follow-on — custom popover state for the quality-flag
  // picker. We replaced the native <select> with a styled card
  // dropdown to match the rest of the modal's visual language. Esc
  // + outside-click close the popup; ref used for the click-outside
  // detection below.
  const [qualityOpen, setQualityOpen] = useState(false);
  const qualityRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!qualityOpen) return;
    function onDocClick(e: MouseEvent) {
      if (qualityRef.current && !qualityRef.current.contains(e.target as Node)) {
        setQualityOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setQualityOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [qualityOpen]);
  // Mig 081 — Approve mode's freeform Notes was replaced with a
  // structured dropdown so analytics can group by issue type later.
  // Empty string = no flag picked (slab was fine). When "other" is
  // picked, the freeform `notes` textarea reappears and is required.
  // Reset when the user flips modes (in switchMode below).
  const [qualityFlag, setQualityFlag] = useState<string>("");
  // Mig 088 — optional carved-sides correction at approval. "" = keep
  // whatever was set at assign (post nothing); "1"/"2" = override.
  const [sidesOverride, setSidesOverride] = useState<"" | "1" | "2">("");
  // Mig 145 — dispatch station + self-transfer (Approve mode only).
  // Stations are fetched on mount via a server action so the list isn't
  // threaded through the whole dashboard tree; the default pre-selects.
  // Self-transfer bypasses the carving→dispatch runner (the slab is
  // received at dispatch immediately and is clickable there at once).
  const [dispatchStations, setDispatchStations] = useState<
    { id: string; name: string; is_default: boolean }[]
  >([]);
  const [dispatchStation, setDispatchStation] = useState("");
  const [selfTransfer, setSelfTransfer] = useState(false);
  useEffect(() => {
    let alive = true;
    getDispatchStationsAction()
      .then((res) => {
        if (!alive || !res.ok) return;
        setDispatchStations(res.stations);
        const def = res.stations.find((s) => s.is_default) ?? res.stations[0];
        if (def) setDispatchStation((cur) => cur || def.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // Mig 081 follow-on — option metadata for the custom picker.
  // Each row drives icon + label + subtitle + accent tint on the
  // popup card. Keep the value strings in lock-step with the
  // server-side APPROVE_QUALITY_FLAGS whitelist + the migration's
  // CHECK constraint.
  const QUALITY_OPTIONS: Array<{
    value: string;
    label: string;
    sub: string;
    icon: string;
    tone: string;
  }> = [
    {
      value: "",
      label: "Slab was fine",
      sub: "Clean approval — nothing to flag",
      icon: "✨",
      tone: "#16a34a", // emerald — quality OK
    },
    {
      value: "carving_not_good",
      label: "Carving quality not great",
      sub: "Workmanship issue — finish, depth, sharpness",
      icon: "🪨",
      tone: "#b45309", // amber — soft warning
    },
    {
      value: "too_many_cracks",
      label: "Too many cracks",
      sub: "Material flaw — pattern or natural cracks",
      icon: "⚡",
      tone: "#dc2626", // red — visible defect
    },
    {
      value: "color_variation",
      label: "Color variation",
      sub: "Stone tone mismatch within or across slabs",
      icon: "🎨",
      tone: "#7c3aed", // violet — visual issue
    },
    {
      value: "minor_chips",
      label: "Minor chips / rough edges",
      sub: "Finishing detail — small but worth flagging",
      icon: "⚒",
      tone: "#d97706", // orange — minor
    },
    {
      value: "other",
      label: "Other",
      sub: "Write a custom note below",
      icon: "✏",
      tone: "var(--gold-dark)", // brand gold — freeform
    },
    {
      // Mig 097 — Depart now lives inside this dropdown (was a separate
      // checkbox). Selecting it = approve but HOLD from dispatch; the
      // logic is unchanged (photo + note required, dispatch_hold set).
      value: "__depart__",
      label: "Depart — hold from dispatch",
      sub: "Approve but keep OUT of dispatch — photo + note required",
      icon: "🚧",
      tone: "#b45309",
    },
  ];
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Reject = two-step confirmation. confirmStage 0 → big "× Reject"
  // button is the trigger; clicking takes us to stage 1 "are you
  // sure?"; clicking that takes us to stage 2 "REALLY sure?";
  // clicking that fires the server action. Any click on any other
  // mode resets confirmStage to 0.
  const [confirmStage, setConfirmStage] = useState<0 | 1 | 2>(0);
  // Mig 097 — "Depart": approve but hold from dispatch (needs a touch-up).
  // Only meaningful in approve mode; requires a photo + note when on.
  const [depart, setDepart] = useState(false);

  // Reset state when the user flips between modes so a half-typed
  // reason doesn't leak across (e.g. typing Approve notes then
  // flipping to Reject shouldn't pre-fill Reject with the approve
  // notes — those are different intents).
  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setNotes("");
    setImages([]);
    setAnnotate(null);
    setErr(null);
    setConfirmStage(0);
    // Mig 081 — reset the quality flag too. The dropdown only
    // applies to Approve; rework/reject use the freeform textarea.
    setQualityFlag("");
    // Mig 088 — reset the carved-sides correction.
    setSidesOverride("");
    // Mig 097 — Depart only applies to approve; clear on any switch.
    setDepart(false);
  }

  // Mig 089 — append a captured photo (up to MAX_REVIEW_IMAGES).
  function handleFile(file: File | null) {
    if (!file) return;
    setImages((prev) =>
      prev.length >= MAX_REVIEW_IMAGES
        ? prev
        : [...prev, { file, url: URL.createObjectURL(file) }],
    );
  }
  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function doSubmit() {
    setPending(true);
    setErr(null);
    const fd = new FormData();
    fd.set("job_id", jobId);
    fd.set("stay", "1");
    fd.set("notes", notes);
    // Mig 089 — up to 3 photos under the keys the server reads.
    const imgKeys = ["review_image", "review_image_2", "review_image_3"];
    images.slice(0, MAX_REVIEW_IMAGES).forEach((im, i) => {
      fd.set(imgKeys[i], im.file);
    });
    // Mig 081 — Approve mode only. Server validates against the
    // whitelist; passing it empty = no flag (slab was fine).
    if (mode === "approve" && qualityFlag) {
      fd.set("quality_flag", qualityFlag);
    }
    // Mig 088 — only post a sides correction when the reviewer
    // explicitly picked one; "" leaves the assign-time value intact.
    if (mode === "approve" && sidesOverride) {
      fd.set("carving_sides", sidesOverride);
    }
    // Mig 097 — Depart rides on the approve action.
    if (mode === "approve" && depart) {
      fd.set("depart", "1");
    }
    // Mig 145 — dispatch station routing + optional self-transfer.
    if (mode === "approve") {
      if (dispatchStation.trim()) fd.set("dispatch_station_name", dispatchStation.trim());
      if (selfTransfer) fd.set("self_transfer", "1");
    }
    // Mig 132 — the old hard-Reject is replaced by the slab-cancel
    // REQUEST flow: reason + photo go to the owner's task panel; the
    // slab stays here (red, locked) until the owner approves/rejects.
    if (mode === "reject") {
      const fd2 = new FormData();
      fd2.set("slab_id", slabId);
      fd2.set("reason", notes);
      if (images[0]) fd2.set("photo", images[0].file);
      requestSlabCancelAction(fd2)
        .then((res) => {
          if (!res.ok) {
            setErr(res.error);
            setPending(false);
            setConfirmStage(0);
            return;
          }
          onDone();
          router.refresh();
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          setErr(msg);
          setPending(false);
          setConfirmStage(0);
        });
      return;
    }
    const action =
      mode === "approve"
        ? approveCarvingJobAction
        : mode === "rework"
          ? reworkCarvingJobAction
          : stillPendingWorkAction;
    action(fd)
      .then(() => {
        onDone();
        router.refresh();
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        setPending(false);
        setConfirmStage(0); // re-arm if the failure was on the server side
      });
  }

  function onSubmitClick(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    // Client-side guards mirror the server's validation so the
    // user gets immediate feedback (and so the file actually leaves
    // the browser when expected).
    if (mode === "rework" || mode === "reject") {
      if (!notes.trim()) {
        setErr(`${mode === "rework" ? "Rework" : "Rejection"} reason is required.`);
        return;
      }
      if (images.length === 0) {
        setErr("At least one photo of the problem is required.");
        return;
      }
    }
    // Mig 097 — Depart requires a photo + note (proof of the touch-up).
    if (mode === "approve" && depart) {
      if (!notes.trim()) {
        setErr("A note is required when marking Depart.");
        return;
      }
      if (images.length === 0) {
        setErr("A photo is required when marking Depart.");
        return;
      }
    }
    // Mig 081 — when Approve mode picks "Other" the notes textarea
    // is mandatory (otherwise we'd save a useless 'other' tag with
    // no detail). Server enforces too, but the client guard avoids
    // the round-trip.
    if (mode === "approve" && qualityFlag === "other" && !notes.trim()) {
      setErr("Please describe the issue when selecting 'Other'.");
      return;
    }
    if (mode === "reject") {
      // Two-step confirmation. Stage 0 → ask once. Stage 1 → ask
      // again. Stage 2 → actually fire.
      if (confirmStage === 0) {
        setConfirmStage(1);
        return;
      }
      if (confirmStage === 1) {
        setConfirmStage(2);
        return;
      }
    }
    doSubmit();
  }

  const isMandatoryImage = mode === "rework" || mode === "reject" || (mode === "approve" && depart);
  // Mig 080 follow-on (Daksh round 2) — full visual rebrand. Three
  // mode-aware tint packs let one component switch entire colour
  // languages (gold/approve, amber/rework, red/reject) without
  // littering the JSX with conditional style props.
  const tintPack = {
    approve: {
      accent: "var(--gold-dark)",
      accentSolid: "#a16207",
      tintBg: "linear-gradient(180deg, rgba(180,128,11,0.05) 0%, rgba(180,128,11,0) 80%)",
      tintBorder: "rgba(180,128,11,0.22)",
      label: "Approve",
      icon: "✓",
      tagline: "Sign off + send to Dispatch",
      submitGradient: "linear-gradient(180deg, #ca8a04 0%, #a16207 100%)",
      shadow: "0 6px 18px rgba(202,138,4,0.35)",
    },
    rework: {
      accent: "#b45309",
      accentSolid: "#b45309",
      tintBg: "linear-gradient(180deg, rgba(180,83,9,0.06) 0%, rgba(180,83,9,0) 80%)",
      tintBorder: "rgba(180,83,9,0.28)",
      label: "Rework",
      icon: "↻",
      tagline: "Send back — vendor redoes the carve",
      submitGradient: "linear-gradient(180deg, #d97706 0%, #b45309 100%)",
      shadow: "0 6px 18px rgba(180,83,9,0.35)",
    },
    reject: {
      accent: "#b91c1c",
      accentSolid: "#b91c1c",
      tintBg: "linear-gradient(180deg, rgba(185,28,28,0.06) 0%, rgba(185,28,28,0) 80%)",
      tintBorder: "rgba(185,28,28,0.32)",
      // Mig 132 — the hard-Reject became a CANCEL REQUEST: it goes to
      // the owner's task panel for approval instead of acting instantly.
      label: "Request Cancel",
      icon: "🚫",
      tagline: "Slab broken? Sends a cancel request to the owner",
      submitGradient: "linear-gradient(180deg, #dc2626 0%, #991b1b 100%)",
      shadow: "0 6px 18px rgba(185,28,28,0.4)",
    },
    // Mig 097 — Outsource "Still Pending Work" (amber, like rework).
    pending: {
      accent: "#b45309",
      accentSolid: "#b45309",
      tintBg: "linear-gradient(180deg, rgba(180,83,9,0.06) 0%, rgba(180,83,9,0) 80%)",
      tintBorder: "rgba(180,83,9,0.28)",
      label: "Still Pending Work",
      icon: "⏳",
      tagline: "Back to vendor — still needs work (slab stays received)",
      submitGradient: "linear-gradient(180deg, #d97706 0%, #b45309 100%)",
      shadow: "0 6px 18px rgba(180,83,9,0.35)",
    },
  }[mode];
  const accent = tintPack.accent;
  const placeholder =
    mode === "approve"
      ? "Approval notes (optional) — anything worth recording?"
      : mode === "rework"
        ? "What exactly needs to be fixed? (required)"
        : mode === "reject"
          ? "Why should this slab be cancelled? (required — goes to the owner)"
          : "What still needs work? (helps the vendor)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 16,
        background: tintPack.tintBg,
        border: `1px solid ${tintPack.tintBorder}`,
        borderRadius: 14,
        transition: "background 0.2s ease, border-color 0.2s ease",
      }}
    >
      {/* ── Three-way decision picker (card style) ───────────── */}
      <div
        role="tablist"
        aria-label="Review outcome"
        style={{
          display: "grid",
          // Mig 097 — Outsource shows 2 options (Approve + Still Pending);
          // CNC keeps 3 (Approve / Rework / Reject).
          gridTemplateColumns: isOutsource ? "1fr 1fr" : "1fr 1fr 1fr",
          gap: 8,
        }}
      >
        {(
          [
            {
              key: "approve" as const,
              icon: "✓",
              label: "Approve",
              sub: "Sign off",
              tone: "var(--gold-dark)",
              toneSolid: "#a16207",
              activeBg:
                "linear-gradient(180deg, rgba(202,138,4,0.18) 0%, rgba(161,98,7,0.08) 100%)",
            },
            // Mig 097 — Outsource: a single "Still Pending Work" replaces
            // Rework + Reject. CNC: keep Rework + Reject as-is.
            ...(isOutsource
              ? [
                  {
                    key: "pending" as const,
                    icon: "⏳",
                    label: "Still Pending",
                    sub: "Send back",
                    tone: "#b45309",
                    toneSolid: "#b45309",
                    activeBg:
                      "linear-gradient(180deg, rgba(217,119,6,0.18) 0%, rgba(180,83,9,0.08) 100%)",
                  },
                ]
              : [
                  {
                    key: "rework" as const,
                    icon: "↻",
                    label: "Rework",
                    sub: "Send back",
                    tone: "#b45309",
                    toneSolid: "#b45309",
                    activeBg:
                      "linear-gradient(180deg, rgba(217,119,6,0.18) 0%, rgba(180,83,9,0.08) 100%)",
                  },
                  {
                    key: "reject" as const,
                    icon: "🚫",
                    label: "Request Cancel",
                    sub: "Owner approves",
                    tone: "#b91c1c",
                    toneSolid: "#b91c1c",
                    activeBg:
                      "linear-gradient(180deg, rgba(220,38,38,0.18) 0%, rgba(153,27,27,0.10) 100%)",
                  },
                ]),
          ]
        ).map((opt) => {
          const active = mode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchMode(opt.key)}
              style={{
                position: "relative",
                padding: "14px 8px 12px",
                background: active ? opt.activeBg : "var(--surface)",
                color: active ? opt.toneSolid : "var(--text)",
                border: `2px solid ${active ? opt.toneSolid : "var(--border)"}`,
                borderRadius: 12,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                fontWeight: 700,
                transition: "transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                boxShadow: active
                  ? `0 4px 14px ${opt.tone === "var(--gold-dark)" ? "rgba(202,138,4,0.28)" : opt.tone === "#b45309" ? "rgba(217,119,6,0.28)" : "rgba(220,38,38,0.28)"}`
                  : "0 1px 0 rgba(0,0,0,0.04)",
                transform: active ? "translateY(-1px)" : "translateY(0)",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 8,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: opt.toneSolid,
                    boxShadow: `0 0 0 3px ${opt.tone === "var(--gold-dark)" ? "rgba(202,138,4,0.25)" : opt.tone === "#b45309" ? "rgba(217,119,6,0.25)" : "rgba(220,38,38,0.25)"}`,
                  }}
                />
              )}
              <span
                aria-hidden
                style={{
                  fontSize: 22,
                  lineHeight: 1,
                  color: active ? opt.toneSolid : "var(--muted)",
                }}
              >
                {opt.icon}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>
                {opt.label}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: active ? opt.toneSolid : "var(--muted)",
                  opacity: active ? 0.9 : 0.7,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {opt.sub}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode tagline — confirms what the selected mode does so the
          reviewer is never surprised by the outcome */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 4px 0",
          fontSize: 11.5,
          fontWeight: 600,
          color: tintPack.accentSolid,
          letterSpacing: "0.02em",
        }}
      >
        <span aria-hidden style={{ fontSize: 13 }}>
          {tintPack.icon}
        </span>
        {tintPack.tagline}
      </div>

      {/* Mig 118 — Involve owner: escalate a problem (e.g. no slab code)
          without blocking approve / rework / reject. */}
      <OwnerInvolveSection
        jobId={jobId}
        status={ownerReviewStatus ?? null}
        kind={ownerReviewKind ?? null}
        note={ownerReviewNote ?? null}
        onDone={onDone}
      />

      {err && (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.32)",
            color: "#991b1b",
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>⚠</span>
          {err}
        </div>
      )}

      <form
        onSubmit={onSubmitClick}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {/* Mig 081 — Approve mode now has a structured quality flag
            dropdown instead of a freeform Notes textarea. The
            textarea reappears below only when "Other" is picked.
            Rework + Reject keep their freeform textarea (their
            reason text IS the analytics signal — a dropdown there
            would add no value). */}
        {mode === "approve" ? (
          <div>
            {/* Mig 145 — dispatch station routing + self-transfer.
                The finished slab heads to this station for loading.
                Self-transfer bypasses the carving→dispatch runner so the
                slab is dispatchable immediately; otherwise it joins the
                carving→dispatch queue until a runner brings it in.
                Hidden until stations load — pre-migration the list comes
                back empty, and we must NOT post these fields then. */}
            {dispatchStations.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <span aria-hidden>📦</span>
                Dispatch station
              </div>
              <DispatchStationCombobox
                value={dispatchStation}
                onChange={setDispatchStation}
                stations={dispatchStations}
              />
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  marginTop: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selfTransfer}
                  onChange={(e) => setSelfTransfer(e.target.checked)}
                  style={{ marginTop: 2, width: 16, height: 16, cursor: "pointer", accentColor: "#1d4ed8" }}
                />
                <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>
                    Self-transfer to dispatch now
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Skip the transfer runner — the slab is received at dispatch
                    immediately and can be loaded right away. Leave off to send
                    it to the carving→dispatch queue.
                  </span>
                </span>
              </label>
            </div>
            )}
            {/* Mig 088 — confirm / correct carved sides right before it
                counts. "Keep" leaves whatever was set at assign. */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <span aria-hidden>🔁</span>
                Carved sides
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(
                  [
                    { v: "", label: "Keep" },
                    { v: "1", label: "1 side" },
                    { v: "2", label: "2 sides" },
                  ] as Array<{ v: "" | "1" | "2"; label: string }>
                ).map((o) => {
                  const active = sidesOverride === o.v;
                  return (
                    <button
                      key={o.v || "keep"}
                      type="button"
                      onClick={() => setSidesOverride(o.v)}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        fontSize: 12.5,
                        fontWeight: 700,
                        border: `1.5px solid ${active ? "#0f766e" : "var(--border)"}`,
                        background: active ? "rgba(13,148,136,0.10)" : "var(--surface)",
                        color: active ? "#0f766e" : "var(--text)",
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>
                “Keep” = leave what was set at assign. 2 sides counts output ×2.
              </div>
            </div>
            <label
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span aria-hidden>🏷</span>
              Quality flag (optional)
            </label>
            {/* Mig 081 follow-on — custom card-style picker. Replaces
                the native <select> so it matches the rest of the
                modal's gold/card visual language. Hidden <input> at
                the end keeps the FormData shape unchanged
                (quality_flag still rides through doSubmit's manual
                fd.set so this hidden input is belt + suspenders). */}
            <div ref={qualityRef} style={{ position: "relative" }}>
              {(() => {
                const selectedValue = depart ? "__depart__" : qualityFlag;
                const selected =
                  QUALITY_OPTIONS.find((o) => o.value === selectedValue) ??
                  QUALITY_OPTIONS[0]; // index 0 is "Slab was fine" (value="")
                return (
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={qualityOpen}
                    onClick={() => setQualityOpen((o) => !o)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      background: "var(--surface)",
                      border: `1.5px solid ${qualityOpen ? tintPack.accentSolid : "var(--border)"}`,
                      borderRadius: 10,
                      cursor: "pointer",
                      transition: "border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease",
                      boxShadow: qualityOpen
                        ? "0 0 0 3px rgba(202,138,4,0.18)"
                        : "0 1px 0 rgba(0,0,0,0.04)",
                      fontFamily: "inherit",
                      color: "var(--text)",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      if (!qualityOpen)
                        e.currentTarget.style.borderColor = "rgba(180,128,11,0.45)";
                    }}
                    onMouseLeave={(e) => {
                      if (!qualityOpen)
                        e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        background: `${selected.tone}1a`,
                        color: selected.tone,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        flexShrink: 0,
                        border: `1px solid ${selected.tone}33`,
                      }}
                    >
                      {selected.icon}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: "var(--text)",
                          lineHeight: 1.2,
                        }}
                      >
                        {selected.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--muted)",
                          marginTop: 2,
                          lineHeight: 1.3,
                        }}
                      >
                        {selected.sub}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      style={{
                        fontSize: 14,
                        color: "var(--muted)",
                        transition: "transform 0.2s ease",
                        transform: qualityOpen ? "rotate(180deg)" : "rotate(0)",
                        flexShrink: 0,
                      }}
                    >
                      ▾
                    </span>
                  </button>
                );
              })()}

              {qualityOpen && (
                <div
                  role="listbox"
                  aria-label="Quality flag options"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    right: 0,
                    zIndex: 30,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
                    padding: 4,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    maxHeight: 400,
                    overflowY: "auto",
                    animation: "qualityFlagOpen 0.16s ease-out both",
                  }}
                >
                  {QUALITY_OPTIONS.map((opt) => {
                    const isSelected = (depart ? "__depart__" : qualityFlag) === opt.value;
                    return (
                      <button
                        key={opt.value || "none"}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          if (opt.value === "__depart__") {
                            // Depart: approve-but-hold. Keep notes (a note is
                            // required) and clear any quality flag.
                            setDepart(true);
                            setQualityFlag("");
                          } else {
                            setDepart(false);
                            setQualityFlag(opt.value);
                            // Drop any "Other" textarea content when switching
                            // away from Other so a stale freeform note doesn't
                            // ride along with a preset on submit.
                            if (opt.value !== "other") setNotes("");
                          }
                          setQualityOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 12px",
                          background: isSelected ? `${opt.tone}14` : "transparent",
                          border: "none",
                          borderLeft: `3px solid ${isSelected ? opt.tone : "transparent"}`,
                          borderRadius: 8,
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "inherit",
                          color: "var(--text)",
                          transition: "background 0.12s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background = "rgba(0,0,0,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 7,
                            background: `${opt.tone}1a`,
                            color: opt.tone,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 16,
                            flexShrink: 0,
                            border: `1px solid ${opt.tone}33`,
                          }}
                        >
                          {opt.icon}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              fontSize: 13,
                              fontWeight: 700,
                              color: "var(--text)",
                              lineHeight: 1.2,
                            }}
                          >
                            {opt.label}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "var(--muted)",
                              marginTop: 2,
                              lineHeight: 1.3,
                            }}
                          >
                            {opt.sub}
                          </span>
                        </span>
                        {isSelected && (
                          <span
                            aria-hidden
                            style={{
                              fontSize: 14,
                              color: opt.tone,
                              fontWeight: 800,
                              flexShrink: 0,
                            }}
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Hidden input keeps the form-data shape standard
                  in case any future caller posts the form directly
                  instead of going through doSubmit's manual
                  fd.set("quality_flag", …). */}
              <input type="hidden" name="quality_flag" value={qualityFlag} />
            </div>

            <div
              style={{
                fontSize: 10.5,
                color: "var(--muted)",
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              Tracks common quality issues so we can spot vendor
              patterns over time. Leave on the default if the slab
              was clean.
            </div>
            {/* Inline keyframes for the popup fade/slide. Plain
                <style> tag so it doesn't depend on styled-jsx. */}
            <style
              dangerouslySetInnerHTML={{
                __html: `@keyframes qualityFlagOpen {
                  from { opacity: 0; transform: translateY(-4px); }
                  to   { opacity: 1; transform: translateY(0); }
                }`,
              }}
            />

            {/* "Other" → free-text issue; "Depart" → finishing-touch note.
                Both require the note (client + server validate). */}
            {(qualityFlag === "other" || depart) && (
              <div style={{ marginTop: 12 }}>
                <label
                  htmlFor="review-other-notes"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  <span aria-hidden>{depart ? "🚧" : "📝"}</span>
                  {depart ? "Finishing-touch note" : "Describe the issue"}
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: tintPack.accentSolid,
                      color: "#fff",
                      letterSpacing: "0.05em",
                    }}
                  >
                    REQUIRED
                  </span>
                </label>
                <textarea
                  id="review-other-notes"
                  name="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  required
                  placeholder={depart ? "What finishing touch does it still need?" : "What was the issue with this carving?"}
                  rows={3}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = tintPack.accentSolid;
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(202,138,4,0.18)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  style={{
                    width: "100%",
                    fontSize: 13.5,
                    padding: "12px 14px",
                    border: "1.5px solid var(--border)",
                    borderRadius: 10,
                    background: "var(--surface)",
                    color: "var(--text)",
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <div>
            <label
              htmlFor="review-notes"
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span aria-hidden>📝</span>
              {mode === "rework"
                ? "Reason for rework"
                : "Reason for rejection"}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "2px 6px",
                  borderRadius: 999,
                  background: tintPack.accentSolid,
                  color: "#fff",
                  letterSpacing: "0.05em",
                }}
              >
                REQUIRED
              </span>
            </label>
            <textarea
              id="review-notes"
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              required
              placeholder={placeholder}
              rows={3}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = tintPack.accentSolid;
                e.currentTarget.style.boxShadow = `0 0 0 3px ${
                  mode === "rework"
                    ? "rgba(217,119,6,0.18)"
                    : "rgba(220,38,38,0.18)"
                }`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.boxShadow = "none";
              }}
              style={{
                width: "100%",
                fontSize: 13.5,
                padding: "12px 14px",
                border: "1.5px solid var(--border)",
                borderRadius: 10,
                background: "var(--surface)",
                color: "var(--text)",
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* ── Photo capture (mig 089 — up to 3). Thumbnail strip of
            captured photos + an "add photo" tile. Live capture only,
            no gallery picker. Each thumb can be marked or removed. ── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {images.map((im, idx) => (
            <div
              key={im.url}
              style={{
                position: "relative",
                width: 132,
                height: 110,
                flex: "0 0 auto",
                borderRadius: 10,
                overflow: "hidden",
                border: `2px solid ${accent}`,
                background: "var(--surface)",
                boxShadow: tintPack.shadow,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={im.url}
                alt={`Photo ${idx + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  left: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  color: "#fff",
                  background: "rgba(0,0,0,0.55)",
                  borderRadius: 999,
                  padding: "1px 7px",
                }}
              >
                {idx + 1}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: "4px 6px",
                  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 100%)",
                  display: "flex",
                  gap: 5,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  title="Mark / highlight"
                  onClick={() => setAnnotate({ idx, file: im.file })}
                  style={{
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    background: "rgba(255,255,255,0.2)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.35)",
                    borderRadius: 5,
                    cursor: "pointer",
                  }}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  title="Remove"
                  onClick={() => removeImage(idx)}
                  style={{
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    background: "rgba(220,38,38,0.85)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: 5,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          {images.length < MAX_REVIEW_IMAGES && (
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              style={{
                flex: images.length === 0 ? "1 1 100%" : "0 0 auto",
                width: images.length === 0 ? "100%" : 132,
                minHeight: 110,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "14px 12px",
                background: "var(--surface)",
                border: `2px dashed ${
                  isMandatoryImage && images.length === 0 ? accent : "var(--border)"
                }`,
                borderRadius: 10,
                cursor: "pointer",
                color: isMandatoryImage && images.length === 0 ? accent : "var(--text)",
                touchAction: "manipulation",
              }}
            >
              <span aria-hidden style={{ fontSize: 24 }}>📸</span>
              <div style={{ fontSize: 12.5, fontWeight: 800, textAlign: "center" }}>
                {images.length === 0
                  ? isMandatoryImage
                    ? "Take photo (required)"
                    : "Take photo (optional)"
                  : `Add another (${images.length}/${MAX_REVIEW_IMAGES})`}
              </div>
              {images.length === 0 && (
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
                  Live capture · up to {MAX_REVIEW_IMAGES} photos · no gallery
                </div>
              )}
            </button>
          )}
        </div>
        {cameraOpen && (
          <CameraCaptureModal
            filenamePrefix="carving-review"
            onCapture={(file) => {
              handleFile(file);
              setCameraOpen(false);
            }}
            onClose={() => setCameraOpen(false)}
          />
        )}
        {annotate && (
          <ImageAnnotateModal
            file={annotate.file}
            onDone={(marked) => {
              // Replace that photo (by index) with the marked-up one —
              // the marks are now part of the image that uploads.
              setImages((prev) =>
                prev.map((im, i) =>
                  i === annotate.idx
                    ? { file: marked, url: URL.createObjectURL(marked) }
                    : im,
                ),
              );
              setAnnotate(null);
            }}
            onCancel={() => setAnnotate(null)}
          />
        )}

        {/* Reject two-step confirmation banner — only renders when
            confirmStage > 0. Stage 1 = "are you sure?", stage 2 =
            "REALLY sure?". Banner pulses on stage 2 to draw the eye. */}
        {mode === "reject" && confirmStage > 0 && (
          <div
            role="alert"
            style={{
              padding: "12px 14px",
              background:
                confirmStage === 2
                  ? "linear-gradient(180deg, rgba(220,38,38,0.18) 0%, rgba(153,27,27,0.10) 100%)"
                  : "rgba(185,28,28,0.10)",
              border: `1.5px solid ${confirmStage === 2 ? "#dc2626" : "#b91c1c"}`,
              borderRadius: 10,
              fontSize: 12.5,
              color: "#7f1d1d",
              fontWeight: 600,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              boxShadow: confirmStage === 2 ? "0 4px 14px rgba(220,38,38,0.25)" : undefined,
              animation: confirmStage === 2 ? "rejectPulse 1.4s ease-in-out infinite" : undefined,
            }}
          >
            <span
              aria-hidden
              style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}
            >
              {confirmStage === 1 ? "⚠" : "🛑"}
            </span>
            <div style={{ flex: 1, lineHeight: 1.45 }}>
              {confirmStage === 1
                ? "Are you sure? Rejecting removes the slab from the carving loop entirely."
                : "Final check — REALLY reject? This cannot be undone from here. The slab moves to the Rejected bucket and the owner / carving head get a Tasks alert."}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          {mode === "reject" && confirmStage > 0 && (
            <button
              type="button"
              onClick={() => setConfirmStage(0)}
              disabled={pending}
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: "12px 18px",
                background: "var(--surface)",
                color: "var(--text)",
                border: "1.5px solid var(--border)",
                borderRadius: 10,
                cursor: pending ? "not-allowed" : "pointer",
                opacity: pending ? 0.6 : 1,
                transition: "background 0.15s ease",
              }}
            >
              ← Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            style={{
              fontSize: 14.5,
              padding: "13px 24px",
              fontWeight: 800,
              whiteSpace: "nowrap",
              opacity: pending ? 0.7 : 1,
              background: tintPack.submitGradient,
              border: `1px solid ${tintPack.accentSolid}`,
              borderRadius: 10,
              color: "#fff",
              cursor: pending ? "not-allowed" : "pointer",
              boxShadow: tintPack.shadow,
              letterSpacing: "0.02em",
              transition: "transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!pending) e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {pending
              ? mode === "approve"
                ? "Approving…"
                : mode === "rework"
                  ? "Sending back…"
                  : "Rejecting…"
              : mode === "approve"
                ? "✓ Approve & dispatch"
                : mode === "rework"
                  ? "↻ Send back for rework"
                  : confirmStage === 0
                    ? "✕ Reject slab"
                    : confirmStage === 1
                      ? "✕ Yes, reject"
                      : "🛑 REALLY reject"}
          </button>
        </div>
      </form>
      {/* Inline keyframes for the stage-2 reject pulse. Plain
          <style> tag (not styled-jsx) so it doesn't depend on
          compiler config — vanilla DOM CSS works everywhere. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes rejectPulse {
            0%, 100% { box-shadow: 0 4px 14px rgba(220,38,38,0.25); }
            50% { box-shadow: 0 4px 24px rgba(220,38,38,0.6); }
          }`,
        }}
      />
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
          : status === "carving_on_hold"
            ? { fg: "#475569", bg: "rgba(100,116,139,0.14)" }
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

// ── Dispatch-station pick-or-create combobox (Mig 145) ────────────
// Themed dropdown (not native chrome) matching the app. Type to filter
// the curated stations, click/keyboard-select, or type a brand-new name
// (the "Use new …" row) which the server creates on approve.
function DispatchStationCombobox({
  value,
  onChange,
  stations,
}: {
  value: string;
  onChange: (v: string) => void;
  stations: { id: string; name: string; is_default: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const all = useMemo(
    () =>
      [...stations].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [stations],
  );
  const q = value.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? all.filter((s) => s.name.toLowerCase().includes(q)) : all),
    [all, q],
  );
  const exactMatch = all.some((s) => s.name.toLowerCase() === q);
  const showCreate = q.length > 0 && !exactMatch;
  const rows: Array<{ kind: "opt" | "new"; name: string; isDefault: boolean }> = [
    ...filtered.map((s) => ({ kind: "opt" as const, name: s.name, isDefault: s.is_default })),
    ...(showCreate ? [{ kind: "new" as const, name: value.trim(), isDefault: false }] : []),
  ];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(Math.max(a, 0), Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  function choose(row: { kind: "opt" | "new"; name: string }) {
    onChange(row.name);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              if (open && rows[active]) {
                e.preventDefault();
                choose(rows[active]);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          autoComplete="off"
          placeholder="Pick a station or type a new one…"
          style={{
            width: "100%",
            padding: "10px 36px 10px 12px",
            fontSize: 14,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
            minHeight: 44,
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle station list"
          onClick={() => setOpen((o) => !o)}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            height: "100%",
            width: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--muted)",
            fontSize: 11,
          }}
        >
          ▼
        </button>
      </div>

      {open && rows.length > 0 && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 60,
            maxHeight: 240,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            padding: 4,
          }}
        >
          {rows.map((row, i) => {
            const isActive = i === active;
            const isNew = row.kind === "new";
            return (
              <div
                key={`${row.kind}:${row.name}`}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(row);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 14,
                  color: "var(--text)",
                  background: isActive ? "var(--gold-soft, rgba(232,197,114,0.18))" : "transparent",
                }}
              >
                {isNew ? (
                  <>
                    <span style={{ fontSize: 13 }}>＋</span>
                    <span>
                      Use new: <strong style={{ color: "var(--gold-dark)" }}>{row.name}</strong>
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 13, opacity: 0.7 }}>📦</span>
                    <span style={{ flex: 1 }}>{row.name}</span>
                    {row.isDefault && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#1d4ed8",
                          background: "rgba(29,78,216,0.10)",
                          padding: "2px 6px",
                          borderRadius: 999,
                        }}
                      >
                        default
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

