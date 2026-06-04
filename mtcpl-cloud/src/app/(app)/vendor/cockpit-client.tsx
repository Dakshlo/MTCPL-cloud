"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadSlabOnMachineAction,
  loadTwoSlabsOnMultiHeadAction,
  completeAndUnloadAction,
  flagMaintenanceAction,
  resolveMaintenanceAction,
  flagPowerCutAction,
  resolvePowerCutAction,
  updateTemporaryLocationAction,
  acknowledgeReceiptAction,
  unloadWithProblemAction,
  holdSlabOnVendorAction,
  reloadHeldSlabAction,
  reloadTwoHeldSlabsOnMultiHeadAction,
  sendHeldSlabBackToReadyAction,
  completeHeldSlabAction,
  acceptTransferReceiptAction,
  flagTransferIssueAction,
  transferReadySlabAction,
  getMachineHistory,
  // Mig 080 — Rework Pending window helpers. The signed-URL helper
  // mints a 5-min URL for the reviewer's photo (private bucket).
  // completeReworkSlabAction lets the vendor mark a rework slab done
  // from the bench (no CNC re-load) — sends it straight back to the
  // review queue.
  getSignedReviewMediaUrl,
  completeReworkSlabAction,
  type MachineHistory,
} from "../carving/actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { batchTint } from "@/lib/batch-colours";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import { POWER_CUT_REASON } from "@/lib/carving-power-cut";

/**
 * Daksh May 2026 — branded spinner overlay for vendor-cockpit form
 * submissions (Mark complete, Hold, Problem/transfer, Load, Reload,
 * Maintenance). Mounts INSIDE the <form> so it can read the form's
 * pending state via useFormStatus; the overlay itself is
 * position:fixed so the visible spinner is full-viewport regardless
 * of where it lives in the DOM tree.
 *
 * Stays inert when the form isn't submitting. No props beyond the
 * label so it can drop into any of our cockpit forms with one line.
 */
function FormPendingOverlay({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label={label} />;
}

// ── Types — kept here so server page can import them ──────────────

export type SlabLite = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_in: number;
  width_in: number;
  thickness_in: number;
  /** Migration 020 — last known physical location set by the cutter
   *  at finish-block time. Surfaced on in-transit queue rows so the
   *  vendor knows where to pick the slab up. */
  stock_location?: string | null;
};

/** Mig 069 — a slab the vendor parked mid-carve. Smaller shape
 *  than CarvingJobLite because the on-hold tray only needs to show
 *  slab identity + how long it's been held + the machine to reload
 *  back to. Action buttons (Reload / Mark done) live on the row. */
export type HeldSlabLite = {
  id: string;
  slab_id: string;
  urgency: "normal" | "urgent";
  requires_machine_type: string | null;
  held_at: string | null;
  held_reason: string | null;
  /** The CNC the slab was last loaded on. Reload modal defaults
   *  here; vendor can override to any compatible idle CNC. NULL
   *  if the held row pre-dates mig 069. */
  held_from_machine_id: string | null;
  slab: SlabLite | null;
};

/** Mig 080 — a slab the reviewer hit "Rework Needed" on. Status
 *  reverts to carving_in_progress + cnc_machine_id is cleared, so it
 *  would otherwise be invisible in the cockpit (not assigned, not on
 *  a machine, not on hold). Surfaced in a dedicated tray with the
 *  reviewer's image + reason; vendor can reload it onto a CNC (same
 *  Load flow as the regular Ready-to-load queue) or, less commonly,
 *  re-mark it complete from a stash bench. */
export type ReworkPendingItem = {
  id: string;
  slab_id: string;
  urgency: "normal" | "urgent";
  requires_machine_type: string | null;
  review_reworked_at: string | null;
  /** Storage key in the carving_review_media private bucket. The
   *  cockpit mints a 5-min signed URL via getSignedReviewMediaUrl
   *  to render the thumbnail. NULL only if a future flow lets the
   *  reviewer skip the photo — today the action enforces mandatory. */
  review_image_path: string | null;
  /** Reviewer's free-form reason. Mandatory on rework + reject. */
  review_notes: string | null;
  slab: SlabLite | null;
};

/** Mig 080 — a slab the reviewer hit "Reject" on. Slab status is
 *  flipped to 'carving_rejected' (new enum value) so it's out of the
 *  active loop entirely. Read-only on the vendor cockpit — the
 *  vendor sees what they got rejected for + the photo so they can
 *  avoid the same issue on future slabs. No action buttons. */
export type RejectedItem = {
  id: string;
  slab_id: string;
  review_rejected_at: string | null;
  review_image_path: string | null;
  review_notes: string | null;
  slab: SlabLite | null;
};

export type CarvingJobLite = {
  id: string;
  slab_id: string;
  status: string;
  urgency: "normal" | "urgent";
  estimated_minutes: number | null;
  vendor_estimated_minutes: number | null;
  cnc_machine_id: string | null;
  loaded_at: string | null;
  assigned_at: string;
  note: string | null;
  slab: SlabLite | null;
  /** Migration 023 — timestamp when the slab physically arrived at
   *  the vendor's shade. NULL while still in transit. */
  received_at_vendor_at?: string | null;
  /** Migration 024 — work-type tag. 'lathe' = cylindrical. */
  requires_machine_type?: string | null;
  /** Migration 026 — batch grouping when slabs were assigned
   *  together in a single bulk-assign. Shared across all slabs in
   *  the batch; drives the coloured stripe on cards. */
  batch_id?: string | null;
  /** Mig 070 — when the slab arrived via Problem/transfer from
   *  another vendor, these capture the source. NULL for normal
   *  carving-assigner deliveries. Drive the "Transferred from X"
   *  badge + Accept / Flag buttons in Pending stock. */
  transferred_from_vendor_id?: string | null;
  transferred_from_vendor_name?: string | null;
  transferred_at?: string | null;
};

export type CncMachineLive = {
  id: string;
  machine_code: string;
  operator_name: string | null;
  status: "idle" | "carving" | "maintenance" | "inactive";
  /** ALL active jobs on this machine. 1 for single-head + lathe;
   *  up to 2 for multi_head_2 in pair-load mode. Lets the cockpit
   *  show both slabs side-by-side and act on either one
   *  independently (e.g. unload one mid-carving). */
  current_jobs: CarvingJobLite[];
  maintenance_reason: string | null;
  maintenance_flagged_at: string | null;
  /** Migration 021: 'single_head' (default), 'multi_head_2' (loads
   *  two identical slabs in lockstep), or 'lathe' (turning machine). */
  machine_type: "single_head" | "multi_head_2" | "lathe";
};

type Vendor = { id: string; name: string; vendor_type?: string };

// ── Helpers ─────────────────────────────────────────────────────────

// Daksh May 2026 — swapped palette so the active work is the
// confident green and the idle pool is a low-key light blue / nearly
// no colour. Before: idle=green (felt like "good, leave alone"),
// carving=blue (felt cold). Now: idle=light-blue (waiting state),
// carving=green (good, healthy progress), maintenance still red.
// Inactive (offline) stays neutral grey.
const STATUS_TINT: Record<
  string,
  {
    bg: string;
    bgAccent: string;
    border: string;
    accent: string;
    fg: string;
    label: string;
    icon: string;
  }
> = {
  idle: {
    bg: "var(--surface)",
    bgAccent: "rgba(56,189,248,0.08)",
    border: "var(--border)",
    accent: "#38bdf8",
    fg: "#0369a1",
    label: "FREE",
    icon: "○",
  },
  carving: {
    bg: "linear-gradient(180deg, rgba(22,163,74,0.14) 0%, rgba(22,163,74,0.05) 100%)",
    bgAccent: "rgba(22,163,74,0.18)",
    border: "rgba(22,163,74,0.55)",
    accent: "#16a34a",
    fg: "#15803d",
    label: "RUNNING",
    icon: "▶",
  },
  maintenance: {
    bg: "linear-gradient(180deg, rgba(220,38,38,0.12) 0%, rgba(220,38,38,0.05) 100%)",
    bgAccent: "rgba(220,38,38,0.18)",
    border: "rgba(220,38,38,0.55)",
    accent: "#dc2626",
    fg: "#b91c1c",
    label: "DOWN",
    icon: "🔧",
  },
  inactive: {
    bg: "var(--surface-alt)",
    bgAccent: "var(--surface-alt)",
    border: "var(--border)",
    accent: "var(--muted)",
    fg: "var(--muted)",
    label: "OFFLINE",
    icon: "—",
  },
};

const MAINTENANCE_REASONS: Array<{ value: string; label: string }> = [
  { value: "tool_change", label: "Tool change" },
  { value: "spindle_issue", label: "Spindle issue" },
  { value: "electrical", label: "Electrical" },
  { value: "coolant", label: "Coolant / cleaning" },
  { value: "scheduled_service", label: "Scheduled service" },
  { value: "other", label: "Other (write detail below)" },
];

// Format minutes as a human-readable duration that can scale from
// minutes up to several days. Carving runs in this shop range from
// "30 min finishing pass" to "3-day complex temple piece", so we need
// the same formatter to read sensibly across all of them.
function fmtDuration(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  }
  const d = Math.floor(m / (60 * 24));
  const remH = Math.floor((m % (60 * 24)) / 60);
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
}

function dimStr(s: SlabLite | null): string {
  if (!s) return "—";
  return `${s.length_in}×${s.width_in}×${s.thickness_in}″`;
}

// ── Main client component ───────────────────────────────────────────

export function VendorCockpitClient({
  vendor,
  machines,
  queue,
  held,
  reworkPending,
  rejected,
  recent,
  carvedThisMonth,
  carvedLastMonth,
  thisMonthLabel,
  lastMonthLabel,
  powerCutActive,
  powerCutSince,
  otherVendors,
  transferVendors,
  isStaffView,
  readOnly = false,
  toast,
  stoneTypes,
}: {
  vendor: Vendor;
  machines: CncMachineLive[];
  queue: CarvingJobLite[];
  /** Mig 069 — slabs the vendor parked mid-carve. Rendered in a
   *  dedicated tray (header launcher tile + center-peek modal).
   *  Empty array when no slabs are held. */
  held: HeldSlabLite[];
  /** Mig 080 — slabs the reviewer sent back for rework. Status is
   *  carving_assigned with cnc_machine_id null, so the existing Load
   *  flow accepts them — we route them out of the regular Ready-to-
   *  load tray and into their own window with the reviewer's photo
   *  + reason. Empty array when no rework slabs exist. */
  reworkPending: ReworkPendingItem[];
  /** Mig 080 — read-only "look what you got rejected for" window.
   *  Empty array when the vendor has no rejections; tile is hidden
   *  in that case too. */
  rejected: RejectedItem[];
  recent: Array<{
    id: string;
    slab_id: string;
    completed_at: string | null;
    temporary_location: string | null;
    review_approved_at: string | null;
    review_notes: string | null;
    slab: SlabLite | null;
  }>;
  /** Daksh June 2026 — this vendor's APPROVED carved output, by
   *  calendar month. Current month shows by default; a small button
   *  toggles to last month. Approval-only (reworked / rejected slabs
   *  excluded). */
  carvedThisMonth: { sft: number; cft: number; slabs: number };
  carvedLastMonth: { sft: number; cft: number; slabs: number };
  thisMonthLabel: string;
  lastMonthLabel: string;
  /** Daksh June 2026 — power-cut state. TRUE when the global "all
   *  machines down" button has paused this vendor's machines; the
   *  header then shows a "Power's back — resume all" control. */
  powerCutActive: boolean;
  powerCutSince: string | null;
  otherVendors: Vendor[];
  /** Daksh June 2026 — full list of every active CNC + Manual vendor
   *  (except the one being viewed) for the Problem/transfer
   *  destination dropdown. Separate from `otherVendors`, which is
   *  narrowed to the cockpit-switcher allow-list: a vendor user with
   *  managed access (e.g. Manthan → Alkesh) could otherwise only
   *  transfer to their managed vendors, not everyone. */
  transferVendors: Vendor[];
  isStaffView: boolean;
  /** Mig 076 — TRUE when carving_head / senior_incharge is viewing as
   *  a "Global My Jobs" oversight tour. Hides every action button (Load,
   *  Hold, Mark received, Problem/transfer, Maintenance, Complete +
   *  every modal CTA). Read-only-by-construction so the role can't
   *  intervene from this surface, only observe. */
  readOnly?: boolean;
  toast: string | null;
  /** Stone palette for the 3D slab thumbs on machine cards + queue rows. */
  stoneTypes: StoneTypeDef[];
}) {
  const router = useRouter();
  const [now, setNow] = useState<number>(Date.now());
  // Daksh June 2026 — header carved-output stat shows the current month
  // by default; this flips it to last month.
  const [statsShowLast, setStatsShowLast] = useState(false);

  // Tick every 30s so countdown timers refresh without a page reload.
  // 30s is plenty — these are real-world hours-long carves, not seconds.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Modal state — only one open at a time.
  const [loadFor, setLoadFor] = useState<{ machine: CncMachineLive } | null>(null);
  const [completeFor, setCompleteFor] = useState<CncMachineLive | null>(null);
  const [maintenanceFor, setMaintenanceFor] = useState<CncMachineLive | null>(null);
  const [historyFor, setHistoryFor] = useState<CncMachineLive | null>(null);
  const [editLocFor, setEditLocFor] = useState<{
    id: string;
    slab_id: string;
    temporary_location: string | null;
  } | null>(null);
  // Per-slab "Problem / transfer" modal — opened from a running
  // machine card. Tracks the carving_item the operator is acting on.
  const [problemFor, setProblemFor] = useState<CarvingJobLite | null>(null);
  // Mig 069 — per-slab Hold modal (healthy-path mid-carve pause).
  // Same shape as problemFor but a different surface so the reason
  // list stays distinct from problem-side reasons.
  const [holdFor, setHoldFor] = useState<CarvingJobLite | null>(null);
  // Daksh May 2026 — pending stock / ready to load / recent completed
  // moved out of inline sections into a centered peek modal. The
  // header KPI tiles now act as launchers — tap "Pending stock" to
  // see the in-transit list, tap "Ready to load" to see the
  // actionable queue (with Load buttons inline), tap "Recently
  // completed" to see the last 10 with approval status. Single state
  // covers all three because only one peek is open at a time.
  const [peekOpen, setPeekOpen] = useState<
    null | "pending" | "ready" | "recent" | "hold" | "rework" | "rejected"
  >(null);
  // Mig 069 — which held slab is being reloaded right now? When set,
  // we render a small picker modal showing the default machine
  // (held_from_machine_id) + a list of any other idle compatible
  // CNCs the vendor can pick instead.
  const [reloadFor, setReloadFor] = useState<HeldSlabLite | null>(null);
  // Mig 069 — which held slab is being directly marked complete?
  // Opens a tiny form prompting for an optional temporary location
  // (matches the complete-from-machine flow).
  const [completeHeldFor, setCompleteHeldFor] = useState<HeldSlabLite | null>(null);
  // Daksh May 2026 — pair-reload of two held slabs onto a 2-head CNC
  // in one atomic step. State holds both slabs of the pair so the
  // modal can show them side-by-side + post to the new
  // reloadTwoHeldSlabsOnMultiHeadAction.
  const [reloadPairFor, setReloadPairFor] = useState<{
    a: HeldSlabLite;
    b: HeldSlabLite;
  } | null>(null);

  // After a server-action redirects back to /vendor with a
  // success toast (e.g. "Slab loaded", "Both slabs loaded",
  // "Marked complete"), close any open modal so the user sees the
  // refreshed cockpit grid. Without this the LoadModal stays open
  // showing "No slabs ready to load" because the slab it was for
  // is no longer in the queue — confusing.
  //
  // Daksh May 2026 round 3 — added the reload-from-hold setters
  // (setReloadFor, setReloadPairFor, setCompleteHeldFor). They were
  // missing from the closer, so after a successful reload-from-hold
  // the modal stayed open showing the (now-empty) machine picker.
  // If the user tapped Load a second time, the slab loaded again
  // and the cockpit ended up with a duplicate carving_item on the
  // CNC. Closing every action modal here is the canonical fix —
  // the success redirect drops back to /vendor with no query state
  // so the modal has nothing left to act on anyway.
  useEffect(() => {
    if (!toast) return;
    const lower = toast.toLowerCase();
    const successy =
      lower.includes("loaded") ||
      lower.includes("marked complete") ||
      lower.includes("marked received") ||
      lower.includes("flagged") ||
      lower.includes("back online") ||
      lower.includes("location saved") ||
      lower.includes("reloaded") ||
      lower.includes("sent back") ||
      lower.includes("transferred") ||
      lower.includes("on hold");
    if (successy) {
      setLoadFor(null);
      setCompleteFor(null);
      setMaintenanceFor(null);
      setEditLocFor(null);
      setProblemFor(null);
      setReloadFor(null);
      setReloadPairFor(null);
      setCompleteHeldFor(null);
      setHoldFor(null);
      setHistoryFor(null);
    }
  }, [toast]);

  const totals = useMemo(() => {
    let idle = 0,
      carving = 0,
      maintenance = 0;
    for (const m of machines) {
      if (m.status === "idle") idle++;
      else if (m.status === "carving") carving++;
      else if (m.status === "maintenance") maintenance++;
    }
    return { idle, carving, maintenance, total: machines.length };
  }, [machines]);

  // Migration 023/025 — split queue into "Pending stock" (assigned
  // but not yet delivered to this vendor's shade — transfer runner
  // is responsible) and "Ready to load" (physically here, can be
  // loaded on a CNC). The vendor's old single Queue list mixed these
  // together; splitting them surfaces the in-transit gap clearly.
  const { pendingStock, readyToLoad } = useMemo(() => {
    const pending: CarvingJobLite[] = [];
    const ready: CarvingJobLite[] = [];
    for (const j of queue) {
      if (j.received_at_vendor_at) ready.push(j);
      else pending.push(j);
    }
    return { pendingStock: pending, readyToLoad: ready };
  }, [queue]);

  // Mig 080 — slabs the LoadModal can offer. ReadyToLoad is the
  // primary list (fresh assignments physically here); we ALSO merge
  // rework-pending slabs in so the vendor can load a rework piece on
  // a CNC from the standard machine-card → Load flow. Each rework
  // item is mapped to a minimal CarvingJobLite shape because that's
  // what the LoadModal + QueueRow expect. We keep them out of the
  // Ready-to-load peek (count stays clean) but they appear inside
  // the LoadModal picker with a 🔁 REWORK tag so the operator can
  // tell them apart.
  const loadable = useMemo<CarvingJobLite[]>(() => {
    const reworkAsJobs: CarvingJobLite[] = reworkPending.map((r) => ({
      id: r.id,
      slab_id: r.slab_id,
      status: "carving_assigned",
      urgency: r.urgency,
      estimated_minutes: null,
      vendor_estimated_minutes: null,
      cnc_machine_id: null,
      loaded_at: null,
      // assigned_at fallback — use review_reworked_at so the sort
      // by oldest-assigned-first puts the slab in a sensible spot.
      assigned_at: r.review_reworked_at ?? new Date().toISOString(),
      note: r.review_notes,
      slab: r.slab,
      received_at_vendor_at: r.review_reworked_at,
      requires_machine_type: r.requires_machine_type,
      batch_id: null,
      transferred_from_vendor_id: null,
      transferred_from_vendor_name: null,
      transferred_at: null,
    }));
    return [...readyToLoad, ...reworkAsJobs];
  }, [readyToLoad, reworkPending]);

  return (
    <div
      className={readOnly ? "cockpit-readonly" : undefined}
      style={{ paddingBottom: 80 }}
    >
      {/* Daksh May 2026 — floating sidebar toggle. Cockpit hides the
          global sidebar by default for a focused full-screen feel,
          but Mohit (carving-head-vendor) needs to reach /carving +
          /slabs without leaving the cockpit first. The toggle owns
          the body class + sessionStorage so the same component can
          live on /carving too and keep state in sync. */}
      <CockpitSidebarToggle />

      {/* Mig 076 — read-only oversight banner. Shown to carving_head /
          senior_incharge when they're viewing the global cockpit. The
          scoped CSS below disables every <form> submit button (Mark
          received, Load, Hold, Problem, Complete, Maintenance, etc.)
          and visually dims them so the role can browse the floor +
          flip vendors but can't act. Peek toggles + the vendor picker
          are <button type="button"> and stay enabled — that's
          intentional, they're navigation, not actions. */}
      {readOnly && (
        <>
          <style>{`
            .cockpit-readonly form button[type="submit"],
            .cockpit-readonly form input[type="submit"],
            .cockpit-readonly form button:not([type]) {
              pointer-events: none !important;
              opacity: 0.4 !important;
              filter: grayscale(70%) !important;
              cursor: not-allowed !important;
            }
          `}</style>
          <div
            style={{
              padding: "10px 14px",
              marginBottom: 12,
              background: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.35)",
              borderRadius: 8,
              color: "#1e40af",
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>👁</span>
            Oversight view — actions disabled. Use the vendor switcher above to
            tour other vendors&apos; cockpits.
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            margin: "-12px 0 12px",
            padding: "10px 14px",
            background: "rgba(22,163,74,0.12)",
            border: "1px solid rgba(22,163,74,0.4)",
            borderRadius: 8,
            color: "#15803d",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ✓ {decodeURIComponent(toast)}
        </div>
      )}

      {/* Header card — vendor + totals */}
      <div
        style={{
          background: "linear-gradient(135deg, #1a1a1a 0%, #2D2410 60%, #6b4f18 100%)",
          borderRadius: 12,
          padding: "18px 20px",
          color: "#fff",
          marginBottom: 16,
          boxShadow: "0 4px 16px rgba(45,36,16,0.2)",
        }}
      >
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
          CNC Cockpit
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>
            {vendor.name}
          </div>
          {isStaffView && otherVendors.length > 0 && (
            <select
              value={vendor.id}
              onChange={(e) => {
                // Daksh May 2026 — server-action redirects all land on
                // /vendor (without ?vendor_id=), so the selected vendor
                // would snap back to the alphabetical first (ALKESH)
                // after every action. Pinning the choice in a cookie
                // lets vendor/page.tsx fall back to the cookie when
                // no query param is present. 7-day TTL is plenty —
                // longer than dev/owner spend reviewing a vendor in
                // one stretch, short enough that it doesn't hang
                // around forever.
                if (typeof document !== "undefined") {
                  document.cookie = `mtcpl_vendor_pick=${e.target.value}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax`;
                }
                router.push(`/vendor?vendor_id=${e.target.value}`);
              }}
              style={{
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 12,
              }}
            >
              <option value={vendor.id}>{vendor.name}</option>
              {otherVendors.map((v) => (
                <option key={v.id} value={v.id} style={{ color: "#000" }}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {/* Daksh May 2026 — header strip split into two visually
            distinct groups:
              GROUP 1: Idle / Carving / Maintenance — read-only status
                pills (compact <Stat>, no chevron, no border).
              GROUP 2: Pending stock / Ready to load — clickable
                launchers (chunky <StatButton>, ▸ chevron, accent
                border, hover lift). The operator's eye gets pulled
                to what's actionable; the status totals stay as
                background info.
              Recently done moved OUT of this header and lives at the
              bottom of the page as the "after stage" surface. */}
        <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap", alignItems: "stretch" }}>
          {/* Status group */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: 6,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
            }}
          >
            {/* Daksh May 2026 — palette swap so the header counters
                match the machine cards: idle = light blue, carving =
                green, maintenance unchanged red. */}
            <Stat label="Idle" value={totals.idle} fg="#38bdf8" />
            <Stat label="Carving" value={totals.carving} fg="#4ade80" />
            <Stat label="Maintenance" value={totals.maintenance} fg="#f87171" />
          </div>
          {/* Launcher group */}
          <div style={{ display: "flex", gap: 10, flex: "1 1 auto", flexWrap: "wrap" }}>
            <StatButton
              label="Pending stock"
              value={pendingStock.length}
              fg="#fbbf24"
              onClick={() => setPeekOpen("pending")}
              title="Slabs assigned but still being transferred to your shade"
            />
            <StatButton
              label="Ready to load"
              value={readyToLoad.length}
              fg="#fbbf24"
              onClick={() => setPeekOpen("ready")}
              title="Slabs physically here and ready to load on a CNC"
              emphasize
            />
            {/* Mig 069 — On Hold launcher. Pulses violet when there
                are held slabs because they're often time-sensitive
                (waiting for a flip, a tool change, or power to
                come back). Hidden tile shows '0' so it doesn't
                clutter the header when nothing's parked. */}
            <StatButton
              label="On hold"
              value={held.length}
              fg="#a78bfa"
              onClick={() => setPeekOpen("hold")}
              title="Slabs parked mid-carve — reload onto a CNC or mark done"
              emphasize={held.length > 0}
            />
            {/* Mig 080 — Rework Pending launcher. Amber-700 accent so
                it reads as "needs attention" without screaming red.
                Pulses when there are slabs because the reviewer sent
                them back expecting a re-do, not a parking spot. */}
            <StatButton
              label="Rework pending"
              value={reworkPending.length}
              fg="#f59e0b"
              onClick={() => setPeekOpen("rework")}
              title="Reviewer sent these slabs back for rework — reload onto a CNC or mark done"
              emphasize={reworkPending.length > 0}
            />
            {/* Mig 080 — Rejected launcher. Read-only window; we still
                surface it so the vendor can see what they got
                rejected for + the photo, to avoid the same issue
                next time. Hidden when there are no rejections so
                the tile doesn't clutter the header. */}
            {rejected.length > 0 && (
              <StatButton
                label="Rejected"
                value={rejected.length}
                fg="#dc2626"
                onClick={() => setPeekOpen("rejected")}
                title="Slabs rejected by the reviewer — read-only, for reference"
              />
            )}
          </div>
        </div>

        {/* Daksh June 2026 — carved-output stat (calendar month, current
            by default; button peeks last month). APPROVAL-ONLY
            (review_approved_at; reworked/rejected slabs excluded), same
            sft/cft basis as the CNC cost report. */}
        {(() => {
          const stat = statsShowLast ? carvedLastMonth : carvedThisMonth;
          const statLabel = statsShowLast ? lastMonthLabel : thisMonthLabel;
          return (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                padding: "10px 14px",
                background: "rgba(74,222,128,0.10)",
                border: "1px solid rgba(74,222,128,0.28)",
                borderRadius: 10,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#86efac",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                ✅ Carved · {statLabel}
              </span>
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
                <strong style={{ fontSize: 19, fontFamily: "ui-monospace, monospace", color: "#fff" }}>
                  {stat.sft.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                </strong>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>sft</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
                <strong style={{ fontSize: 19, fontFamily: "ui-monospace, monospace", color: "#fff" }}>
                  {stat.cft.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                </strong>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>cft</span>
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                {stat.slabs} slab{stat.slabs === 1 ? "" : "s"} approved
              </span>
              <button
                type="button"
                onClick={() => setStatsShowLast((v) => !v)}
                title={statsShowLast ? "Back to this month" : "See last month"}
                style={{
                  marginLeft: "auto",
                  padding: "5px 11px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: "rgba(255,255,255,0.10)",
                  color: "#86efac",
                  border: "1px solid rgba(74,222,128,0.45)",
                  borderRadius: 999,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {statsShowLast ? `← ${thisMonthLabel}` : `${lastMonthLabel} →`}
              </button>
            </div>
          );
        })()}

        {/* Daksh June 2026 — Power-cut control. One button downs every
            running/idle machine (loaded slabs' timers freeze); when
            power's back, one button resumes them (timers continue from
            where they stopped). Hidden in read-only oversight view. */}
        {!readOnly &&
          (powerCutActive ? (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                padding: "10px 14px",
                background: "rgba(248,113,113,0.14)",
                border: "1px solid rgba(248,113,113,0.5)",
                borderRadius: 10,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 800, color: "#fca5a5" }}>
                ⚡ Power cut — all machines paused
                {powerCutSince && (
                  <span
                    style={{
                      fontWeight: 600,
                      color: "rgba(255,255,255,0.7)",
                      marginLeft: 6,
                    }}
                  >
                    since{" "}
                    {new Date(powerCutSince).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                )}
              </span>
              <form action={resolvePowerCutAction} style={{ marginLeft: "auto" }}>
                <input type="hidden" name="vendor_id" value={vendor.id} />
                <button
                  type="submit"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "9px 16px",
                    fontSize: 13,
                    fontWeight: 800,
                    background: "#16a34a",
                    color: "#fff",
                    border: "1px solid #15803d",
                    borderRadius: 10,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  🔌 Power&apos;s back — resume all
                </button>
              </form>
            </div>
          ) : (
            // Compact + corner-tucked (top-right) + confirm-gated so it
            // can't be hit by accident in the middle of the cockpit.
            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <form
                action={flagPowerCutAction}
                onSubmit={(e) => {
                  if (
                    !window.confirm(
                      "Power cut / breakdown — pause ALL machines?\n\nEvery loaded slab's timer will freeze until you press “Power's back — resume all”.",
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="vendor_id" value={vendor.id} />
                <button
                  type="submit"
                  title="Power cut / breakdown — pause every machine at once (loaded slab timers freeze). Resume them all when power's back."
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(252,165,165,0.92)",
                    border: "1px solid rgba(248,113,113,0.4)",
                    borderRadius: 999,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⚡ Power cut — pause all
                </button>
              </form>
            </div>
          ))}
      </div>

      {/* Daksh May 2026 — Pending stock / Ready to load lists moved
          OUT of inline sections and INTO the centered peek modal
          (launched from the header KPI tiles). The vendor cockpit
          is now machine-first; the slab lists are one tap away
          when the operator wants them. */}

      {/* Machine grid — Mig follow-on (Daksh, May 2026): lathes
          split into their own section below the CNC grid so they
          read as a distinct group instead of being mixed into
          the rectangular CNC cards. Same MachineCard component,
          same grid template — just two grids stacked. */}
      {(() => {
        const cncMachines = machines.filter((m) => m.machine_type !== "lathe");
        const latheMachines = machines.filter((m) => m.machine_type === "lathe");

        const renderGrid = (list: typeof machines) => (
          <div
            style={{
              display: "grid",
              // 240px floor gives the cards more breathing room on
              // an 11" tablet (typical 1080-1366 wide → 4-5 cols)
              // and stops the slab-row inside running cards from
              // wrapping awkwardly. Gap up from 10 → 12 to match.
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {list.map((m) => (
              <MachineCard
                key={m.id}
                machine={m}
                queueLength={queue.length}
                now={now}
                onLoad={() => setLoadFor({ machine: m })}
                onComplete={() => setCompleteFor(m)}
                onMaintenance={() => setMaintenanceFor(m)}
                onHistory={() => setHistoryFor(m)}
                onProblem={(job) => setProblemFor(job)}
                onHold={(job) => setHoldFor(job)}
                stoneTypes={stoneTypes}
              />
            ))}
          </div>
        );

        if (machines.length === 0) {
          return (
            <Section title="Machines" subtitle="0">
              <Empty text="No machines configured for this vendor. Add some in Manage Vendors." />
            </Section>
          );
        }

        return (
          <>
            {cncMachines.length > 0 && (
              <Section
                title="CNC Machines"
                subtitle={`${cncMachines.length} machine${cncMachines.length !== 1 ? "s" : ""}`}
              >
                {renderGrid(cncMachines)}
              </Section>
            )}
            {latheMachines.length > 0 && (
              <Section
                title="Lathe Machines"
                subtitle={`${latheMachines.length} lathe${latheMachines.length !== 1 ? "s" : ""} · round work`}
              >
                {renderGrid(latheMachines)}
              </Section>
            )}
          </>
        );
      })()}

      {/* Daksh May 2026 — Recently completed lives at the BOTTOM of
          the cockpit, after all the machine grids. It's the
          after-stage surface (slabs already unloaded, awaiting team
          review or already approved), so the operator should glance
          at it last, not first. Rendered as a launcher tile + a
          status breakdown so they see "X approved · Y in review · Z
          needs rework" at a glance and tap in for the full list. */}
      {recent.length > 0 && (() => {
        let approved = 0;
        let rejected = 0;
        let inReview = 0;
        for (const r of recent) {
          if (r.review_notes) rejected++;
          else if (r.review_approved_at) approved++;
          else inReview++;
        }
        return (
          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              onClick={() => setPeekOpen("recent")}
              title="Open the full list of recently completed slabs"
              style={{
                width: "100%",
                padding: "14px 16px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                cursor: "pointer",
                color: "inherit",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                transition: "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
                touchAction: "manipulation",
                boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.08)";
                e.currentTarget.style.borderColor = "rgba(120,120,120,0.55)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 1px 0 rgba(0,0,0,0.04)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                  }}
                >
                  Recently completed
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "var(--text)",
                    lineHeight: 1.1,
                    marginTop: 4,
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {recent.length} slab{recent.length === 1 ? "" : "s"}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginTop: 8,
                    flexWrap: "wrap",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {approved > 0 && (
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "rgba(22,163,74,0.15)",
                        color: "#15803d",
                        border: "1px solid rgba(22,163,74,0.4)",
                      }}
                    >
                      ✔ {approved} approved
                    </span>
                  )}
                  {inReview > 0 && (
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "rgba(217,119,6,0.15)",
                        color: "#b45309",
                        border: "1px solid rgba(217,119,6,0.4)",
                      }}
                    >
                      ⏳ {inReview} in review
                    </span>
                  )}
                  {rejected > 0 && (
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "rgba(220,38,38,0.15)",
                        color: "#b91c1c",
                        border: "1px solid rgba(220,38,38,0.45)",
                      }}
                    >
                      ✗ {rejected} needs rework
                    </span>
                  )}
                </div>
              </div>
              <span
                aria-hidden
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--muted)",
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                ›
              </span>
            </button>
          </div>
        );
      })()}

      {/* ── Peek modal ── one of pending / ready / recent / hold ── */}
      {peekOpen && (
        <CenterPeekModal
          title={
            peekOpen === "pending"
              ? "Pending stock"
              : peekOpen === "ready"
                ? "Ready to load"
                : peekOpen === "hold"
                  ? "⏸ On hold"
                  : peekOpen === "rework"
                    ? "🔁 Rework pending"
                    : peekOpen === "rejected"
                      ? "✗ Rejected"
                      : "Recently completed"
          }
          subtitle={
            peekOpen === "pending"
              ? `${pendingStock.length} slab${pendingStock.length !== 1 ? "s" : ""} in transit to your shade`
              : peekOpen === "ready"
                ? `${readyToLoad.length} slab${readyToLoad.length !== 1 ? "s" : ""} physically here, ready to load`
                : peekOpen === "hold"
                  ? `${held.length} slab${held.length !== 1 ? "s" : ""} parked — reload onto a CNC or mark done`
                  : peekOpen === "rework"
                    ? `${reworkPending.length} slab${reworkPending.length !== 1 ? "s" : ""} sent back by reviewer — reload onto a CNC or mark done`
                    : peekOpen === "rejected"
                      ? `${rejected.length} slab${rejected.length !== 1 ? "s" : ""} rejected by reviewer — read only, for reference`
                      : `Last ${recent.length} unloaded — awaiting team review unless approved`
          }
          onClose={() => setPeekOpen(null)}
        >
          {peekOpen === "pending" &&
            (pendingStock.length === 0 ? (
              <Empty text="No slabs awaiting transfer to your shade." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingStock.map((job) => (
                  <PendingStockRow key={job.id} job={job} />
                ))}
              </div>
            ))}
          {peekOpen === "ready" &&
            (readyToLoad.length === 0 ? (
              <Empty
                text={
                  pendingStock.length > 0
                    ? "Waiting for the transfer runner to deliver. Open Pending stock to see what's in transit."
                    : "Queue is clear. Carving head will assign more as slabs become available."
                }
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {readyToLoad.map((job) => (
                  <QueueRow
                    key={job.id}
                    job={job}
                    hasIdleMachine={totals.idle > 0}
                    onLoad={() => {
                      // Pick first idle machine as the default selection.
                      // Close the peek so the LoadModal isn't stacked on
                      // top of it.
                      const firstIdle = machines.find((m) => m.status === "idle");
                      if (firstIdle) {
                        setLoadFor({ machine: firstIdle });
                        setPeekOpen(null);
                      }
                    }}
                    otherVendorsForTransfer={transferVendors}
                  />
                ))}
              </div>
            ))}
          {peekOpen === "recent" &&
            (recent.length === 0 ? (
              <Empty text="Nothing finished yet — completed slabs land here for ~24h." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recent.map((r) => (
                  <RecentCompletedRow
                    key={r.id}
                    row={r}
                    onEditLocation={() =>
                      setEditLocFor({
                        id: r.id,
                        slab_id: r.slab_id,
                        temporary_location: r.temporary_location,
                      })
                    }
                  />
                ))}
              </div>
            ))}
          {peekOpen === "rework" &&
            (reworkPending.length === 0 ? (
              <Empty text="No slabs sent back for rework. When the reviewer hits 'Rework needed' on a finished slab it lands here with the reason + photo." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {reworkPending.map((r) => (
                  <ReworkSlabRow
                    key={r.id}
                    item={r}
                    stoneTypes={stoneTypes}
                    hasIdleMachine={totals.idle > 0}
                    onReload={() => {
                      // Pick first idle compatible machine, same as
                      // the Ready-to-load button does. Close peek so
                      // LoadModal isn't stacked on top.
                      const firstIdle = machines.find((m) => m.status === "idle");
                      if (firstIdle) {
                        setLoadFor({ machine: firstIdle });
                        setPeekOpen(null);
                      }
                    }}
                  />
                ))}
              </div>
            ))}
          {peekOpen === "rejected" &&
            (rejected.length === 0 ? (
              <Empty text="No rejected slabs — great." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rejected.map((r) => (
                  <RejectedSlabRow
                    key={r.id}
                    item={r}
                    stoneTypes={stoneTypes}
                  />
                ))}
              </div>
            ))}
          {peekOpen === "hold" &&
            (held.length === 0 ? (
              <Empty text="No slabs on hold. Use the Hold button on a loaded slab to park it for later." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Daksh May 2026 — pair-reload. Detect pairs in the
                    held list: two slabs from the same source machine
                    with matching dims/temple/label can be reloaded
                    together onto a 2-head CNC. Surface each detected
                    pair as a pinned callout above the per-slab rows
                    so the vendor doesn't have to load one, then fail
                    on the second because the machine is no longer
                    idle. */}
                {detectHeldPairs(held).map((pair) => (
                  <HeldPairCallout
                    key={`${pair.a.id}__${pair.b.id}`}
                    pair={pair}
                    stoneTypes={stoneTypes}
                    onPairReload={() => {
                      setReloadPairFor(pair);
                      setPeekOpen(null);
                    }}
                  />
                ))}
                {held.map((h) => (
                  <HeldSlabRow
                    key={h.id}
                    held={h}
                    machines={machines}
                    stoneTypes={stoneTypes}
                    now={now}
                    onReload={() => {
                      setReloadFor(h);
                      setPeekOpen(null);
                    }}
                    onComplete={() => {
                      setCompleteHeldFor(h);
                      setPeekOpen(null);
                    }}
                  />
                ))}
              </div>
            ))}
        </CenterPeekModal>
      )}
      {/* Mig 069 — Reload-from-hold picker. Defaults to held_from
          machine; vendor can override to any compatible idle CNC. */}
      {reloadFor && !readOnly && (
        <ReloadHeldModal
          held={reloadFor}
          machines={machines}
          stoneTypes={stoneTypes}
          onClose={() => setReloadFor(null)}
        />
      )}
      {/* Mig 069 — Mark-done-from-hold. Tiny form with temp location. */}
      {/* Mig 076 — readOnly mode (carving_head / senior_incharge
          oversight tour) suppresses every modal that triggers an
          action. Click handlers may still fire and set state, but
          the modal never mounts so the user can't submit. Machine
          History modal stays open in readOnly (it's pure view). */}
      {completeHeldFor && !readOnly && (
        <CompleteHeldModal
          held={completeHeldFor}
          stoneTypes={stoneTypes}
          onClose={() => setCompleteHeldFor(null)}
        />
      )}
      {/* Daksh May 2026 — pair-reload picker (2-head CNCs only). */}
      {reloadPairFor && !readOnly && (
        <ReloadPairModal
          pair={reloadPairFor}
          machines={machines}
          stoneTypes={stoneTypes}
          onClose={() => setReloadPairFor(null)}
        />
      )}

      {/* ── Modals ── */}
      {loadFor && !readOnly && (
        <LoadModal
          machine={loadFor.machine}
          machines={machines}
          /* Mig 080 — pass `loadable` (readyToLoad + rework slabs)
             not just readyToLoad, so a rework slab can be picked
             from the standard Load flow. Rework rows are tagged in
             the picker with a 🔁 REWORK badge. */
          queue={loadable}
          stoneTypes={stoneTypes}
          onClose={() => setLoadFor(null)}
        />
      )}
      {completeFor && completeFor.current_jobs[0] && !readOnly && (
        <CompleteModal
          machine={completeFor}
          job={completeFor.current_jobs[0]}
          onClose={() => setCompleteFor(null)}
        />
      )}
      {maintenanceFor && !readOnly && (
        <MaintenanceModal machine={maintenanceFor} onClose={() => setMaintenanceFor(null)} />
      )}
      {historyFor && (
        <MachineHistoryModal machine={historyFor} onClose={() => setHistoryFor(null)} />
      )}
      {editLocFor && !readOnly && (
        <EditLocationModal
          itemId={editLocFor.id}
          slabId={editLocFor.slab_id}
          currentLocation={editLocFor.temporary_location}
          onClose={() => setEditLocFor(null)}
        />
      )}
      {problemFor && !readOnly && (
        <ProblemModal
          job={problemFor}
          otherVendorsForTransfer={transferVendors}
          currentVendorId={vendor.id}
          onClose={() => setProblemFor(null)}
        />
      )}
      {holdFor && !readOnly && (
        <HoldModal job={holdFor} onClose={() => setHoldFor(null)} />
      )}
    </div>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** When true, renders a click-to-toggle chevron in the header.
   *  Used on Pending stock + Recently completed so they don't take
   *  up screen real estate by default. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  return (
    <section style={{ marginBottom: 18 }}>
      <div
        style={{
          marginBottom: 8,
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          cursor: collapsible ? "pointer" : "default",
          userSelect: collapsible ? "none" : "auto",
        }}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
      >
        {collapsible && (
          <span style={{ fontSize: 12, color: "var(--muted)", width: 14, display: "inline-block" }}>
            {isOpen ? "▼" : "▶"}
          </span>
        )}
        {/* Daksh May 2026 — heavier section headers so "CNC Machines"
            / "Lathe Machines" pop on the tablet against the dense
            machine grid below. Bumped 15→18px, weight 700→800,
            tighter tracking. */}
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            color: "var(--text)",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
            {subtitle}
          </span>
        )}
      </div>
      {isOpen && children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "20px 16px",
        textAlign: "center",
        color: "var(--muted-light)",
        fontSize: 13,
        background: "var(--surface)",
        border: "1px dashed var(--border)",
        borderRadius: 8,
      }}
    >
      {text}
    </div>
  );
}

// Status pill — Daksh May 2026: re-tuned to read as a passive
// indicator next to the actionable launcher buttons. Compact,
// borderless, label-above-number. Three of these live inside a
// shared "tray" container so they read as one status group rather
// than three independent cards.
function Stat({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        minWidth: 56,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "rgba(255,255,255,0.5)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: fg,
          lineHeight: 1.05,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// Launcher button — Daksh May 2026: visually distinct from <Stat>.
// Bigger, with a gold accent border, a prominent ▸ chevron, and a
// hover lift so the operator knows "tap this to drill in". When
// `emphasize` is set + value > 0, the tile glows amber so the most
// actionable surface pulls the eye.
function StatButton({
  label,
  value,
  fg,
  onClick,
  title,
  emphasize,
}: {
  label: string;
  value: number;
  fg: string;
  onClick: () => void;
  title?: string;
  emphasize?: boolean;
}) {
  const hot = emphasize && value > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        position: "relative",
        padding: "10px 16px 10px 14px",
        background: hot
          ? "linear-gradient(135deg, rgba(251,191,36,0.22) 0%, rgba(180,128,11,0.28) 100%)"
          : "rgba(255,255,255,0.06)",
        border: `1.5px solid ${hot ? "rgba(251, 191, 36, 0.75)" : "rgba(251, 191, 36, 0.35)"}`,
        borderRadius: 10,
        minWidth: 130,
        textAlign: "left",
        cursor: "pointer",
        color: "inherit",
        boxShadow: hot
          ? "0 4px 14px rgba(251,191,36,0.22), inset 0 1px 0 rgba(255,255,255,0.08)"
          : "0 1px 0 rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.05)",
        transition: "transform 0.12s ease, background 0.12s ease, border-color 0.12s ease",
        touchAction: "manipulation",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.7)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 700,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: fg,
            lineHeight: 1.05,
            marginTop: 2,
            fontFeatureSettings: '"tnum"',
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </div>
      </div>
      {/* Chevron — bigger, off to the right, gives the button a
          clear "drill in" affordance vs the borderless Stat tiles. */}
      <span
        aria-hidden
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: hot ? "rgba(251, 191, 36, 1)" : "rgba(251, 191, 36, 0.7)",
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ›
      </span>
    </button>
  );
}

// Center-peek modal — the launcher tiles open this. Centred on screen
// (not a bottom-sheet like ModalShell — the operator on a tablet wants
// the list at eye-level rather than thumb-level). Escape + click-
// outside closes. Mirrors ModalShell's behaviour otherwise.
function CenterPeekModal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
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
    // Lock body scroll while the peek is open so the cockpit
    // doesn't scroll behind the overlay on tablet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
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
        inset: 0,
        background: "rgba(15,12,6,0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: "24px 16px",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: 640,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
            {subtitle && (
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontSize: 18,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--muted)",
              padding: 4,
              touchAction: "manipulation",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 18px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Recently completed row — Daksh May 2026 visual pass: a chunky
// left rail + a big status chip make "approved" vs "in review" vs
// "rejected" readable at arm's length. Previously the only
// differentiator was a faint tinted background + a tiny right-side
// label which blended together on the tablet.
function RecentCompletedRow({
  row,
  onEditLocation,
}: {
  row: {
    id: string;
    slab_id: string;
    completed_at: string | null;
    temporary_location: string | null;
    review_approved_at: string | null;
    review_notes: string | null;
    slab: SlabLite | null;
  };
  onEditLocation: () => void;
}) {
  // Three states. Rejected (review_notes set) wins regardless of
  // whether an approved_at also exists — that combination means the
  // approver flagged something for the operator to redo.
  const state: "approved" | "rejected" | "review" = row.review_notes
    ? "rejected"
    : row.review_approved_at
      ? "approved"
      : "review";
  const tone = {
    approved: {
      rail: "#16a34a",
      bg: "rgba(22,163,74,0.07)",
      border: "rgba(22,163,74,0.35)",
      chipBg: "rgba(22,163,74,0.18)",
      chipFg: "#15803d",
      chipBorder: "rgba(22,163,74,0.5)",
      label: "✔ APPROVED",
      sub: "Cleared by carving team",
    },
    rejected: {
      rail: "#dc2626",
      bg: "rgba(220,38,38,0.08)",
      border: "rgba(220,38,38,0.4)",
      chipBg: "rgba(220,38,38,0.18)",
      chipFg: "#b91c1c",
      chipBorder: "rgba(220,38,38,0.55)",
      label: "✗ NEEDS REWORK",
      sub: row.review_notes ?? "Re-check requested",
    },
    review: {
      rail: "#d97706",
      bg: "rgba(217,119,6,0.07)",
      border: "rgba(217,119,6,0.35)",
      chipBg: "rgba(217,119,6,0.18)",
      chipFg: "#b45309",
      chipBorder: "rgba(217,119,6,0.5)",
      label: "⏳ AWAITING REVIEW",
      sub: "Pending team sign-off",
    },
  }[state];
  return (
    <div
      style={{
        padding: "12px 14px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderLeft: `6px solid ${tone.rail}`,
        borderRadius: 10,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: "3px 8px",
              borderRadius: 999,
              background: tone.chipBg,
              color: tone.chipFg,
              border: `1px solid ${tone.chipBorder}`,
              letterSpacing: "0.04em",
            }}
          >
            {tone.label}
          </span>
          <code
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            {row.slab_id}
          </code>
        </div>
        {row.slab && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {row.slab.temple} · {dimStr(row.slab)}
          </div>
        )}
        {/* Daksh May 2026 round 3 — slab label surfaced on the
            recently-completed row too. Vendor identifies the slab
            by its label more often than by the autogen id. */}
        {row.slab?.label && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text)",
              marginTop: 3,
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title="Slab label (set at cut time)"
          >
            🏷 {row.slab.label}
          </div>
        )}
        <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 4 }}>
          📍 {row.temporary_location ?? "—"}
        </div>
        {/* Approver note / status detail. For rejected this is the
            actual review_notes string; for approved/review it's a
            short caption. */}
        <div
          style={{
            fontSize: 11,
            color: tone.chipFg,
            marginTop: 6,
            fontWeight: state === "rejected" ? 600 : 500,
            fontStyle: state === "rejected" ? "normal" : "italic",
          }}
        >
          {tone.sub}
        </div>
      </div>
      <button
        type="button"
        onClick={onEditLocation}
        className="ghost-button"
        style={{ fontSize: 11, padding: "6px 12px", flexShrink: 0, touchAction: "manipulation" }}
      >
        Edit location
      </button>
    </div>
  );
}

// ── On-hold row (mig 069) ─────────────────────────────────────────
//
// Daksh's "park this slab" pattern. Rendered inside the On Hold
// center-peek modal. Each row carries:
//   • Slab thumb + identity + dims (so the operator recognises it)
//   • Held-for chip ("Held 2h 14m") with the chosen reason underneath
//   • From-machine chip — the CNC it was last on, so the operator
//     knows where to put it back
//   • [▶ Reload here] / [↻ Reload elsewhere] / [✅ Mark done]
//     primary actions. The "Reload here" button is a one-tap default
//     when the original machine is idle; if it's busy, the label
//     swaps to "Pick a CNC" so the picker modal does the work.

function HeldSlabRow({
  held,
  machines,
  stoneTypes,
  now,
  onReload,
  onComplete,
}: {
  held: HeldSlabLite;
  machines: CncMachineLive[];
  stoneTypes: StoneTypeDef[];
  now: number;
  onReload: () => void;
  onComplete: () => void;
}) {
  const isUrgent = held.urgency === "urgent";
  const isLathe = held.requires_machine_type === "lathe";
  const fromMachine = held.held_from_machine_id
    ? machines.find((m) => m.id === held.held_from_machine_id)
    : null;
  const fromIsIdle = fromMachine?.status === "idle";
  const elapsedMin =
    held.held_at != null
      ? Math.max(0, (now - new Date(held.held_at).getTime()) / 60000)
      : null;
  return (
    <div
      style={{
        padding: 12,
        background: "rgba(167,139,250,0.06)",
        border: "1.5px solid rgba(167,139,250,0.45)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Top row — slab identity */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {held.slab && (
          <SlabThumb
            stone={held.slab.stone}
            l={held.slab.length_in}
            w={held.slab.width_in}
            t={held.slab.thickness_in}
            stoneTypes={stoneTypes}
            size={48}
            height={48}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {isUrgent && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "#dc2626",
                  color: "#fff",
                  letterSpacing: "0.05em",
                }}
              >
                ⚡ URGENT
              </span>
            )}
            {isLathe && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "rgba(124,58,237,0.15)",
                  color: "#7c3aed",
                }}
              >
                🌀 LATHE
              </span>
            )}
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {held.slab_id}
            </span>
          </div>
          {held.slab && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              {held.slab.temple} · {dimStr(held.slab)}
            </div>
          )}
          {/* Daksh May 2026 round 3 — slab label surfaced on the held
              card too, matches the running CNC card + queue/pending
              rows. Same identity info everywhere in the cockpit. */}
          {held.slab?.label && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text)",
                marginTop: 3,
                fontWeight: 600,
                wordBreak: "break-word",
              }}
              title="Slab label (set at cut time)"
            >
              🏷 {held.slab.label}
            </div>
          )}
        </div>
        {elapsedMin != null && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#6d28d9",
              background: "rgba(167,139,250,0.18)",
              border: "1px solid rgba(167,139,250,0.5)",
              padding: "4px 8px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              fontFamily: "ui-monospace, monospace",
            }}
            title="Held for"
          >
            ⏱ {fmtDuration(elapsedMin)}
          </div>
        )}
      </div>

      {/* Reason + from-machine row */}
      {(held.held_reason || fromMachine) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          {held.held_reason && (
            <span
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                padding: "3px 8px",
                borderRadius: 6,
              }}
              title="Reason given when slab was held"
            >
              💭 {held.held_reason}
            </span>
          )}
          {fromMachine && (
            <span
              style={{
                background: fromIsIdle ? "rgba(34,197,94,0.12)" : "var(--surface)",
                border: `1px solid ${fromIsIdle ? "rgba(34,197,94,0.45)" : "var(--border)"}`,
                color: fromIsIdle ? "#15803d" : "var(--text)",
                padding: "3px 8px",
                borderRadius: 6,
                fontWeight: 600,
              }}
              title={
                fromIsIdle
                  ? `${fromMachine.machine_code} is idle — Reload sends it back here`
                  : `${fromMachine.machine_code} is busy — Reload will pick a different CNC`
              }
            >
              🏭 from {fromMachine.machine_code}
              {fromIsIdle ? " · ready" : " · busy"}
            </span>
          )}
        </div>
      )}

      {/* Actions row — Reload (purple, primary), Back-to-queue
          (amber-ghost), Mark done (green-ghost). Daksh May 2026:
          added Back-to-queue so a held slab can re-enter the
          regular Ready-to-load queue without forcing a machine
          pick right now (used when priorities reshuffle or the
          slab is going to be loaded as a pair later). */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onReload}
          style={{
            flex: "1 1 180px",
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 700,
            background: "#7c3aed",
            color: "#fff",
            border: "1px solid #6d28d9",
            borderRadius: 8,
            cursor: "pointer",
            minHeight: 44,
            touchAction: "manipulation",
          }}
        >
          {fromIsIdle ? `▶ Reload on ${fromMachine?.machine_code}` : "▶ Reload — pick CNC"}
        </button>
        {/* Back-to-Ready-to-load — confirms before flipping so an
            accidental tap on a tablet can't bounce a slab out of
            the On Hold tray. */}
        <form
          action={sendHeldSlabBackToReadyAction}
          onSubmit={(e) => {
            const msg = [
              `Send ${held.slab_id} back to Ready to load?`,
              "",
              "The slab leaves the On Hold tray and rejoins the regular",
              "queue. You can load it on any compatible CNC from there.",
              "",
              "All hold metadata (reason, time held) is cleared.",
            ].join("\n");
            if (!window.confirm(msg)) e.preventDefault();
          }}
          style={{ margin: 0 }}
        >
          <FormPendingOverlay label="Sending back to queue…" />
          <input type="hidden" name="carving_item_id" value={held.id} />
          <input type="hidden" name="redirect_to" value="/vendor" />
          <button
            type="submit"
            className="ghost-button"
            style={{
              padding: "10px 14px",
              fontSize: 13,
              minHeight: 44,
              touchAction: "manipulation",
              color: "#b45309",
              borderColor: "rgba(180,115,51,0.45)",
            }}
            title="Move this slab back into the Ready to load queue without picking a machine yet"
          >
            ↩ Back to queue
          </button>
        </form>
        <button
          type="button"
          onClick={onComplete}
          className="ghost-button"
          style={{
            padding: "10px 14px",
            fontSize: 13,
            minHeight: 44,
            touchAction: "manipulation",
          }}
          title="Mark this slab done without re-loading (side-1 carve was enough)"
        >
          ✅ Mark done
        </button>
      </div>
    </div>
  );
}

/** Mig 080 — shared component to render the reviewer's photo for a
 *  rework / rejected slab. Fetches a 5-min signed URL on mount
 *  (private bucket, no public access). Falls back to a "📷 no photo"
 *  pill when the path is missing (legacy rows / future flows). */
function ReviewMediaImage({
  path,
  alt,
  maxHeight = 160,
}: {
  path: string | null;
  alt: string;
  maxHeight?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) return;
    (async () => {
      try {
        const signed = await getSignedReviewMediaUrl(path);
        if (!cancelled) setUrl(signed);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!path) {
    return (
      <span
        style={{
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
        }}
      >
        📷 no photo
      </span>
    );
  }
  if (err) {
    return (
      <span
        style={{
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          background: "rgba(220,38,38,0.1)",
          border: "1px solid rgba(220,38,38,0.4)",
          color: "#b91c1c",
        }}
        title={err}
      >
        ⚠ photo load failed
      </span>
    );
  }
  if (!url) {
    return (
      <span
        style={{
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
        }}
      >
        Loading photo…
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      style={{
        maxWidth: "100%",
        maxHeight,
        borderRadius: 8,
        border: "1px solid var(--border)",
        objectFit: "contain",
        background: "rgba(0,0,0,0.04)",
      }}
    />
  );
}

/** Mig 080 — Rework Pending row. Amber accent so it reads as "needs
 *  attention" but not panic-red. Two actions: Reload (pulls the
 *  vendor into the regular Load flow — slab is already at
 *  status='carving_assigned' so the Load modal accepts it directly),
 *  or Mark done from bench (calls completeReworkSlabAction). */
function ReworkSlabRow({
  item,
  stoneTypes,
  hasIdleMachine,
  onReload,
}: {
  item: ReworkPendingItem;
  stoneTypes: StoneTypeDef[];
  hasIdleMachine: boolean;
  onReload: () => void;
}) {
  const isUrgent = item.urgency === "urgent";
  const isLathe = item.requires_machine_type === "lathe";
  return (
    <div
      style={{
        padding: 12,
        background: "rgba(245,158,11,0.06)",
        border: "1.5px solid rgba(245,158,11,0.45)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Top row — slab identity */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {item.slab && (
          <SlabThumb
            stone={item.slab.stone}
            l={item.slab.length_in}
            w={item.slab.width_in}
            t={item.slab.thickness_in}
            stoneTypes={stoneTypes}
            size={48}
            height={48}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {isUrgent && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "#dc2626",
                  color: "#fff",
                  letterSpacing: "0.05em",
                }}
              >
                ⚡ URGENT
              </span>
            )}
            {isLathe && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "rgba(124,58,237,0.15)",
                  color: "#7c3aed",
                }}
              >
                🌀 LATHE
              </span>
            )}
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {item.slab_id}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(245,158,11,0.18)",
                color: "#b45309",
                border: "1px solid rgba(245,158,11,0.45)",
                letterSpacing: "0.05em",
              }}
            >
              🔁 REWORK
            </span>
          </div>
          {item.slab && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              {item.slab.temple} · {dimStr(item.slab)}
            </div>
          )}
          {item.slab?.label && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text)",
                marginTop: 3,
                fontWeight: 600,
                wordBreak: "break-word",
              }}
              title="Slab label (set at cut time)"
            >
              🏷 {item.slab.label}
            </div>
          )}
        </div>
        {item.review_reworked_at && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#b45309",
              background: "rgba(245,158,11,0.18)",
              border: "1px solid rgba(245,158,11,0.5)",
              padding: "4px 8px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              fontFamily: "ui-monospace, monospace",
            }}
            title="Sent back at"
          >
            ⏱ {new Date(item.review_reworked_at).toLocaleString()}
          </div>
        )}
      </div>

      {/* Reviewer's reason */}
      {item.review_notes && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--text)",
            lineHeight: 1.4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Reviewer's reason
          </div>
          {item.review_notes}
        </div>
      )}

      {/* Reviewer's photo */}
      <ReviewMediaImage path={item.review_image_path} alt="Rework reason photo" />

      {/* Actions — Reload (amber primary) + Mark done (ghost). The
          Reload button just hands off to onReload(); the parent picks
          the first idle CNC and opens the standard LoadModal. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onReload}
          disabled={!hasIdleMachine}
          style={{
            flex: "1 1 180px",
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 700,
            background: hasIdleMachine ? "#b45309" : "var(--surface-alt)",
            color: hasIdleMachine ? "#fff" : "var(--muted)",
            border: `1px solid ${hasIdleMachine ? "#92400e" : "var(--border)"}`,
            borderRadius: 8,
            cursor: hasIdleMachine ? "pointer" : "not-allowed",
            minHeight: 44,
            touchAction: "manipulation",
          }}
          title={
            hasIdleMachine
              ? "Open the Load picker with this slab pre-selected"
              : "No idle CNC available — wait for one to free up"
          }
        >
          ▶ Reload on CNC
        </button>
        {/* Mark done from bench. Tiny inline form so we don't need
            a second modal. Vendor-side confirm to avoid accidental
            taps (this skips the CNC step, which is a meaningful call). */}
        <form
          action={completeReworkSlabAction}
          onSubmit={(e) => {
            const msg = [
              `Mark ${item.slab_id} done from bench?`,
              "",
              "The slab leaves the Rework Pending tray and goes",
              "straight back to the review queue without re-loading",
              "on a CNC. Use this when the bench fix was enough.",
            ].join("\n");
            if (!window.confirm(msg)) e.preventDefault();
          }}
          style={{ margin: 0 }}
        >
          <FormPendingOverlay label="Marking complete…" />
          <input type="hidden" name="carving_item_id" value={item.id} />
          <input type="hidden" name="redirect_to" value="/vendor" />
          <button
            type="submit"
            className="ghost-button"
            style={{
              padding: "10px 14px",
              fontSize: 13,
              minHeight: 44,
              touchAction: "manipulation",
            }}
            title="Skip the CNC step — send straight back to review queue"
          >
            ✅ Mark done
          </button>
        </form>
      </div>
    </div>
  );
}

/** Mig 080 — Rejected row. Read-only: photo + reason + slab info.
 *  No action buttons. Red tint to mirror the reviewer's intent
 *  ("this carving cannot be salvaged") without screaming. */
function RejectedSlabRow({
  item,
  stoneTypes,
}: {
  item: RejectedItem;
  stoneTypes: StoneTypeDef[];
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "rgba(220,38,38,0.06)",
        border: "1.5px solid rgba(220,38,38,0.45)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Top row — slab identity */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {item.slab && (
          <SlabThumb
            stone={item.slab.stone}
            l={item.slab.length_in}
            w={item.slab.width_in}
            t={item.slab.thickness_in}
            stoneTypes={stoneTypes}
            size={48}
            height={48}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {item.slab_id}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(220,38,38,0.18)",
                color: "#b91c1c",
                border: "1px solid rgba(220,38,38,0.45)",
                letterSpacing: "0.05em",
              }}
            >
              ✗ REJECTED
            </span>
          </div>
          {item.slab && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              {item.slab.temple} · {dimStr(item.slab)}
            </div>
          )}
          {item.slab?.label && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text)",
                marginTop: 3,
                fontWeight: 600,
                wordBreak: "break-word",
              }}
              title="Slab label (set at cut time)"
            >
              🏷 {item.slab.label}
            </div>
          )}
        </div>
        {item.review_rejected_at && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#b91c1c",
              background: "rgba(220,38,38,0.18)",
              border: "1px solid rgba(220,38,38,0.5)",
              padding: "4px 8px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              fontFamily: "ui-monospace, monospace",
            }}
            title="Rejected at"
          >
            ⏱ {new Date(item.review_rejected_at).toLocaleString()}
          </div>
        )}
      </div>

      {/* Reviewer's reason */}
      {item.review_notes && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--text)",
            lineHeight: 1.4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Reviewer's reason
          </div>
          {item.review_notes}
        </div>
      )}

      {/* Reviewer's photo */}
      <ReviewMediaImage path={item.review_image_path} alt="Rejection reason photo" />
    </div>
  );
}

/** Reload picker — shows the default (held_from) CNC on top + any
 *  other compatible idle CNCs. One tap submits via a server form
 *  action so we don't need to manage pending state. */
function ReloadHeldModal({
  held,
  machines,
  stoneTypes,
  onClose,
}: {
  held: HeldSlabLite;
  machines: CncMachineLive[];
  stoneTypes: StoneTypeDef[];
  onClose: () => void;
}) {
  // Compatible CNCs: same vendor's machines, currently idle, work-
  // type matches (lathe slabs → lathe machines, others → non-lathe).
  const isCompatibleType = (m: CncMachineLive) =>
    held.requires_machine_type === "lathe"
      ? m.machine_type === "lathe"
      : m.machine_type !== "lathe";
  const compatibleIdle = machines.filter((m) => m.status === "idle" && isCompatibleType(m));

  // Daksh May 2026 — pair-join candidates. A 2-head CNC currently
  // running exactly ONE slab whose geometry (L×W×T) + temple + label
  // match the held slab can accept the held one as the second head.
  // Server re-validates the match before loading, so this UI filter
  // is just to avoid offering hopeless options.
  const pairJoinCandidates = machines.filter((m) => {
    if (m.status !== "carving") return false;
    if (m.machine_type !== "multi_head_2") return false;
    if (held.requires_machine_type === "lathe") return false; // lathes don't pair
    if (!held.slab) return false;
    const active = m.current_jobs;
    if (active.length !== 1) return false;
    const partner = active[0]?.slab;
    if (!partner) return false;
    return (
      partner.length_in === held.slab.length_in &&
      partner.width_in === held.slab.width_in &&
      partner.thickness_in === held.slab.thickness_in &&
      (partner.temple ?? "") === (held.slab.temple ?? "") &&
      (partner.label ?? "") === (held.slab.label ?? "")
    );
  });

  // Default machine = the one the slab was held from, IF still idle.
  // Otherwise fall back to the first compatible idle, then the first
  // pair-join candidate (so the modal opens with a sensible default).
  const defaultMachine =
    compatibleIdle.find((m) => m.id === held.held_from_machine_id) ??
    compatibleIdle[0] ??
    pairJoinCandidates[0] ??
    null;
  const anyTarget = compatibleIdle.length > 0 || pairJoinCandidates.length > 0;

  return (
    <ModalShell
      title={`▶ Reload ${held.slab_id}`}
      subtitle={
        defaultMachine
          ? `Default: ${defaultMachine.machine_code}${defaultMachine.id === held.held_from_machine_id ? " (same machine it was held from)" : ""}`
          : "No idle machines available — finish a carve first, then try again"
      }
      onClose={onClose}
    >
      {!anyTarget ? (
        <div
          style={{
            padding: 16,
            background: "rgba(220,38,38,0.06)",
            border: "1px dashed rgba(220,38,38,0.4)",
            borderRadius: 8,
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {held.requires_machine_type === "lathe"
            ? "No idle lathe machines right now. Unload a running lathe first."
            : "No idle CNC machines right now (and no running 2-head CNC is carving a matching slab to pair with). Unload a running CNC first."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {held.slab && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 8,
                background: "var(--surface-alt)",
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <SlabThumb
                stone={held.slab.stone}
                l={held.slab.length_in}
                w={held.slab.width_in}
                t={held.slab.thickness_in}
                stoneTypes={stoneTypes}
                size={42}
                height={42}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {held.slab.temple}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {dimStr(held.slab)}
                </div>
              </div>
            </div>
          )}
          <p
            className="muted"
            style={{ fontSize: 12, margin: "4px 0 6px" }}
          >
            Pick a machine to reload onto:
          </p>
          {compatibleIdle.map((m) => {
            const isDefault = m.id === held.held_from_machine_id;
            return (
              <form
                key={m.id}
                action={reloadHeldSlabAction}
                onSubmit={(e) => {
                  // Daksh May 2026 — confirm before sending. Reload
                  // locks a machine + restarts the carving clock; an
                  // accidental tap from the held tray was costly. The
                  // confirm spells out which slab is going onto which
                  // CNC so the vendor reads it before saying OK.
                  const sameMachine = m.id === held.held_from_machine_id;
                  const lines = [
                    `Reload ${held.slab_id} onto ${m.machine_code}?`,
                    "",
                    sameMachine
                      ? `Same CNC it was held from. The carving clock resets to 0.`
                      : `Different CNC (was held from ${held.held_from_machine_id ?? "unknown"}). The carving clock resets to 0.`,
                  ];
                  if (!window.confirm(lines.join("\n"))) {
                    e.preventDefault();
                  }
                }}
                style={{ width: "100%" }}
              >
                <FormPendingOverlay
                  label={`Reloading on ${m.machine_code}…`}
                />
                <input type="hidden" name="carving_item_id" value={held.id} />
                <input type="hidden" name="target_machine_id" value={m.id} />
                <input type="hidden" name="redirect_to" value="/vendor" />
                <button
                  type="submit"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    fontSize: 14,
                    fontWeight: 700,
                    background: isDefault ? "#7c3aed" : "var(--surface)",
                    color: isDefault ? "#fff" : "var(--text)",
                    border: `1.5px solid ${isDefault ? "#6d28d9" : "var(--border)"}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    touchAction: "manipulation",
                    minHeight: 52,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{isDefault ? "★" : "▶"}</span>
                  <span style={{ flex: 1 }}>
                    {m.machine_code}
                    {m.operator_name && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          opacity: 0.7,
                          fontWeight: 500,
                        }}
                      >
                        ({m.operator_name})
                      </span>
                    )}
                  </span>
                  {isDefault && (
                    <span style={{ fontSize: 10, opacity: 0.85, fontWeight: 600 }}>
                      same as before
                    </span>
                  )}
                  <span style={{ fontSize: 16 }}>›</span>
                </button>
              </form>
            );
          })}

          {/* Daksh May 2026 — pair-join candidates: 2-head CNCs
              currently running a slab whose dimensions + temple +
              label match the held one. The held slab joins as the
              second head; partner's clock keeps running. Distinct
              green tint so the operator knows this is a different
              load mode (the partner is still mid-carve). */}
          {pairJoinCandidates.length > 0 && (
            <>
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: "1px dashed var(--border)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#15803d",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                ⇄ Or join a running pair
              </div>
              <p
                className="muted"
                style={{ fontSize: 11, margin: "2px 0 4px" }}
              >
                These 2-head CNCs already have a matching slab
                running. The held one drops in as the second head.
              </p>
              {pairJoinCandidates.map((m) => {
                const partnerJob = m.current_jobs[0];
                const partnerLabel = partnerJob?.slab_id ?? "running slab";
                return (
                  <form
                    key={`pair-${m.id}`}
                    action={reloadHeldSlabAction}
                    onSubmit={(e) => {
                      const lines = [
                        `Add ${held.slab_id} to ${m.machine_code} as the second head?`,
                        "",
                        `Partner ${partnerLabel} keeps running. The held slab's clock starts now.`,
                      ];
                      if (!window.confirm(lines.join("\n"))) {
                        e.preventDefault();
                      }
                    }}
                    style={{ width: "100%" }}
                  >
                    <FormPendingOverlay label={`Joining ${m.machine_code}…`} />
                    <input type="hidden" name="carving_item_id" value={held.id} />
                    <input type="hidden" name="target_machine_id" value={m.id} />
                    <input type="hidden" name="redirect_to" value="/vendor" />
                    <button
                      type="submit"
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        fontSize: 14,
                        fontWeight: 700,
                        background: "#15803d",
                        color: "#fff",
                        border: "1.5px solid #166534",
                        borderRadius: 10,
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        touchAction: "manipulation",
                        minHeight: 52,
                      }}
                    >
                      <span style={{ fontSize: 16 }}>⇄</span>
                      <span style={{ flex: 1 }}>
                        Pair with {m.machine_code}
                        {m.operator_name && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              opacity: 0.85,
                              fontWeight: 500,
                            }}
                          >
                            ({m.operator_name})
                          </span>
                        )}
                        <div style={{ fontSize: 10, opacity: 0.9, fontWeight: 500, marginTop: 2 }}>
                          partner: {partnerLabel}
                        </div>
                      </span>
                      <span style={{ fontSize: 16 }}>›</span>
                    </button>
                  </form>
                );
              })}
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}

/** Mark-done-from-hold form. Optional temporary location to match
 *  the regular complete-and-unload flow. */
function CompleteHeldModal({
  held,
  stoneTypes,
  onClose,
}: {
  held: HeldSlabLite;
  stoneTypes: StoneTypeDef[];
  onClose: () => void;
}) {
  return (
    <ModalShell
      title={`✅ Mark ${held.slab_id} done`}
      subtitle="Confirms the carve is finished. Slab moves to Recently completed for team review."
      onClose={onClose}
    >
      <form
        action={completeHeldSlabAction}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <FormPendingOverlay label="Marking complete…" />
        <input type="hidden" name="carving_item_id" value={held.id} />
        <input type="hidden" name="redirect_to" value="/vendor" />
        {held.slab && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 8,
              background: "var(--surface-alt)",
              borderRadius: 8,
            }}
          >
            <SlabThumb
              stone={held.slab.stone}
              l={held.slab.length_in}
              w={held.slab.width_in}
              t={held.slab.thickness_in}
              stoneTypes={stoneTypes}
              size={42}
              height={42}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {held.slab.temple}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {dimStr(held.slab)}
              </div>
            </div>
          </div>
        )}
        <label className="stack" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
            Where is the slab now?
          </span>
          <input
            type="text"
            name="temporary_location"
            placeholder="e.g. Shade-A rack 3"
            style={{
              padding: "10px 12px",
              fontSize: 14,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--text)",
              minHeight: 44,
            }}
          />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Optional. Helps the carving team find it for review.
          </span>
        </label>
        <button
          type="submit"
          style={{
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 700,
            background: "#16a34a",
            color: "#fff",
            border: "1px solid #15803d",
            borderRadius: 8,
            cursor: "pointer",
            minHeight: 48,
            touchAction: "manipulation",
          }}
        >
          ✅ Mark done
        </button>
      </form>
    </ModalShell>
  );
}

// ── Pair-reload detection + modal (Daksh May 2026) ─────────────────
//
// A "held pair" is two held slabs that:
//   - came off the SAME source machine (same held_from_machine_id),
//   - have identical L×W×T + temple + label,
//   - and the source machine was a 2-head CNC (we can't be sure of
//     the source's current type without re-fetching, so the
//     dimensional + same-source check is our heuristic and the server
//     re-validates the target machine is multi_head_2 anyway).
//
// Returns one entry per pair; if 4 held slabs came off the same
// machine in two distinct geometries, you get two pairs. If 3
// identical slabs are held (rare — would need a manual oddity), only
// the first two pair up and the third lives as a regular row.
function detectHeldPairs(
  held: HeldSlabLite[],
): Array<{ a: HeldSlabLite; b: HeldSlabLite; source: string }> {
  const pairs: Array<{ a: HeldSlabLite; b: HeldSlabLite; source: string }> = [];
  const claimed = new Set<string>();
  for (let i = 0; i < held.length; i++) {
    const a = held[i];
    if (claimed.has(a.id)) continue;
    if (!a.slab || !a.held_from_machine_id) continue;
    // Only flat-panel work pairs on a 2-head CNC — lathes are
    // single-head, so a lathe-tagged held slab can never pair.
    if (a.requires_machine_type === "lathe") continue;
    for (let j = i + 1; j < held.length; j++) {
      const b = held[j];
      if (claimed.has(b.id)) continue;
      if (!b.slab || !b.held_from_machine_id) continue;
      if (b.requires_machine_type === "lathe") continue;
      if (a.held_from_machine_id !== b.held_from_machine_id) continue;
      if (
        a.slab.length_in !== b.slab.length_in ||
        a.slab.width_in !== b.slab.width_in ||
        a.slab.thickness_in !== b.slab.thickness_in
      )
        continue;
      if ((a.slab.temple ?? "") !== (b.slab.temple ?? "")) continue;
      if ((a.slab.label ?? "") !== (b.slab.label ?? "")) continue;
      pairs.push({ a, b, source: a.held_from_machine_id });
      claimed.add(a.id);
      claimed.add(b.id);
      break;
    }
  }
  return pairs;
}

/** Pinned callout above the held list when a pair is detected.
 *  Single tap opens the pair-reload modal — no need to chase down
 *  each row individually. */
function HeldPairCallout({
  pair,
  stoneTypes,
  onPairReload,
}: {
  pair: { a: HeldSlabLite; b: HeldSlabLite };
  stoneTypes: StoneTypeDef[];
  onPairReload: () => void;
}) {
  const { a, b } = pair;
  return (
    <div
      style={{
        padding: 12,
        background:
          "linear-gradient(180deg, rgba(37,99,235,0.10) 0%, rgba(37,99,235,0.04) 100%)",
        border: "1.5px solid rgba(37,99,235,0.45)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "#1d4ed8",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        ▶▶ Pair-reload available
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          alignItems: "stretch",
        }}
      >
        {[a, b].map((h) => (
          <div
            key={h.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 8,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            {h.slab && (
              <SlabThumb
                stone={h.slab.stone}
                l={h.slab.length_in}
                w={h.slab.width_in}
                t={h.slab.thickness_in}
                stoneTypes={stoneTypes}
                size={36}
                height={36}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {h.slab_id}
              </div>
              {h.slab && (
                <div style={{ fontSize: 10, color: "var(--muted)" }}>
                  {dimStr(h.slab)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onPairReload}
        style={{
          padding: "12px 14px",
          fontSize: 14,
          fontWeight: 800,
          background: "#1d4ed8",
          color: "#fff",
          border: "1px solid #1e40af",
          borderRadius: 10,
          cursor: "pointer",
          minHeight: 48,
          touchAction: "manipulation",
        }}
      >
        ▶▶ Reload both on a 2-head CNC
      </button>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        Both came off the same machine and have matching dimensions —
        load them back as a pair in one tap.
      </div>
    </div>
  );
}

/** Pair-reload picker — list of idle 2-head CNCs belonging to this
 *  vendor. Tapping a machine button submits the new server action
 *  with both carving_item ids + the target machine id. */
function ReloadPairModal({
  pair,
  machines,
  stoneTypes,
  onClose,
}: {
  pair: { a: HeldSlabLite; b: HeldSlabLite };
  machines: CncMachineLive[];
  stoneTypes: StoneTypeDef[];
  onClose: () => void;
}) {
  const { a, b } = pair;
  // Eligible targets: this vendor's idle multi_head_2 machines.
  // Default = the source machine if still idle (vendors usually
  // reload onto the same machine they came off of).
  const eligible = machines.filter(
    (m) => m.status === "idle" && m.machine_type === "multi_head_2",
  );
  const defaultMachine =
    eligible.find((m) => m.id === a.held_from_machine_id) ??
    eligible[0] ??
    null;

  return (
    <ModalShell
      title={`▶▶ Pair-reload ${a.slab_id} + ${b.slab_id}`}
      subtitle={
        defaultMachine
          ? `Default: ${defaultMachine.machine_code}${defaultMachine.id === a.held_from_machine_id ? " (same machine they were held from)" : ""}`
          : "No idle 2-head CNCs right now — finish or hold one first"
      }
      onClose={onClose}
    >
      {eligible.length === 0 ? (
        <div
          style={{
            padding: 16,
            background: "rgba(220,38,38,0.06)",
            border: "1px dashed rgba(220,38,38,0.4)",
            borderRadius: 8,
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          No idle 2-head CNC machines right now. Unload or hold a
          running one first, then try again.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Show both slabs as a confirmation summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            {[a, b].map((h) => (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 8,
                  background: "var(--surface-alt)",
                  borderRadius: 8,
                }}
              >
                {h.slab && (
                  <SlabThumb
                    stone={h.slab.stone}
                    l={h.slab.length_in}
                    w={h.slab.width_in}
                    t={h.slab.thickness_in}
                    stoneTypes={stoneTypes}
                    size={40}
                    height={40}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {h.slab?.temple}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {h.slab ? dimStr(h.slab) : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 6px" }}>
            Pick a 2-head CNC to load both onto:
          </p>
          {eligible.map((m) => {
            const isDefault = m.id === a.held_from_machine_id;
            return (
              <form
                key={m.id}
                action={reloadTwoHeldSlabsOnMultiHeadAction}
                onSubmit={(e) => {
                  const sameMachine = m.id === a.held_from_machine_id;
                  const lines = [
                    `Pair-reload ${a.slab_id} + ${b.slab_id} onto ${m.machine_code}?`,
                    "",
                    sameMachine
                      ? "Same 2-head CNC both were held from. Carving clock resets to 0."
                      : "Different 2-head CNC. Carving clock resets to 0.",
                  ];
                  if (!window.confirm(lines.join("\n"))) {
                    e.preventDefault();
                  }
                }}
                style={{ width: "100%" }}
              >
                <FormPendingOverlay
                  label={`Reloading pair on ${m.machine_code}…`}
                />
                <input type="hidden" name="carving_item_a_id" value={a.id} />
                <input type="hidden" name="carving_item_b_id" value={b.id} />
                <input type="hidden" name="target_machine_id" value={m.id} />
                <input type="hidden" name="redirect_to" value="/vendor" />
                <button
                  type="submit"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    fontSize: 14,
                    fontWeight: 700,
                    background: isDefault ? "#1d4ed8" : "var(--surface)",
                    color: isDefault ? "#fff" : "var(--text)",
                    border: `1.5px solid ${isDefault ? "#1e40af" : "var(--border)"}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    touchAction: "manipulation",
                    minHeight: 52,
                  }}
                >
                  <span style={{ fontSize: 16 }}>
                    {isDefault ? "★" : "▶▶"}
                  </span>
                  <span style={{ flex: 1 }}>
                    {m.machine_code}
                    {m.operator_name && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          opacity: 0.7,
                          fontWeight: 500,
                        }}
                      >
                        ({m.operator_name})
                      </span>
                    )}
                  </span>
                  {isDefault && (
                    <span
                      style={{
                        fontSize: 10,
                        opacity: 0.85,
                        fontWeight: 600,
                      }}
                    >
                      same as before
                    </span>
                  )}
                  <span style={{ fontSize: 16 }}>›</span>
                </button>
              </form>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}

// ── Pending stock row — assigned, not yet delivered ─────────────────
//
// Read-only. The transfer runner physically moves the slab from the
// stock location to this vendor's shade and then marks it received
// (which flips it into the "Ready to load" list). Migration 023/025.
function PendingStockRow({ job }: { job: CarvingJobLite }) {
  const isUrgent = job.urgency === "urgent";
  const isLathe = job.requires_machine_type === "lathe";
  // Migration 026 — slabs assigned together share a colour stripe.
  const tint = batchTint(job.batch_id);
  // Mig 070 — inter-vendor transfer. When set, this slab came from
  // another CNC vendor via Problem/Transfer; the receiving vendor
  // can self-receive (Accept) or refuse (Flag), no slab_transfer
  // runner required.
  const isTransfer = Boolean(job.transferred_from_vendor_name);
  // Distinct tint when it's a transfer so the receiving vendor sees
  // it stand out from the yard-runner-delivered ones.
  const accent = isTransfer
    ? { bg: "rgba(20,184,166,0.06)", border: "rgba(20,184,166,0.45)", fg: "#0f766e" }
    : { bg: "rgba(217,119,6,0.04)", border: "rgba(217,119,6,0.4)", fg: "#b45309" };
  // Daksh May 2026 — compacted to match the QueueRow shape: single
  // horizontal row, slab info left, action(s) on the right. The
  // previous column layout + multi-line helper text made each row
  // tall and the list felt sparse on tablet/desktop.
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: accent.bg,
        border: `1px ${isTransfer ? "solid" : "dashed"} ${accent.border}`,
        borderLeft: tint
          ? `5px solid ${tint.border}`
          : `1px ${isTransfer ? "solid" : "dashed"} ${accent.border}`,
        borderRadius: 8,
        flexWrap: "wrap",
      }}
      title={tint ? "Part of a batch — these slabs were assigned together" : undefined}
    >
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {isUrgent && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#dc2626",
                color: "#fff",
                letterSpacing: "0.05em",
              }}
            >
              ⚡ URGENT
            </span>
          )}
          {isLathe && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: 3,
                background: "rgba(124,58,237,0.15)",
                color: "#7c3aed",
                letterSpacing: "0.05em",
              }}
              title="Cylindrical — lathe required"
            >
              🌀 LATHE
            </span>
          )}
          {isTransfer ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: 3,
                background: "rgba(20,184,166,0.18)",
                color: accent.fg,
                letterSpacing: "0.04em",
              }}
              title={
                job.transferred_at
                  ? `Transferred ${new Date(job.transferred_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : "Inter-vendor transfer"
              }
            >
              ↔ FROM {(job.transferred_from_vendor_name ?? "?").toUpperCase()}
            </span>
          ) : (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: 3,
                background: "rgba(217,119,6,0.18)",
                color: accent.fg,
                letterSpacing: "0.05em",
              }}
            >
              🚚 IN TRANSIT
            </span>
          )}
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {job.slab_id}
          </span>
        </div>
        {job.slab && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {job.slab.temple} · {dimStr(job.slab)}
          </div>
        )}
        {/* Daksh May 2026 round 3 — surface label + carving-head note
            on every peek row, not just the running CNC card. The
            vendor needs the full slab identity ("Jagti dodiya thar
            (mohit)") and any drop-off instructions before they
            decide what to do with the slab. */}
        {job.slab?.label && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text)",
              marginTop: 3,
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title="Slab label (set at cut time)"
          >
            🏷 {job.slab.label}
          </div>
        )}
        {job.note && (
          <div
            style={{
              fontSize: 10.5,
              color: "#475569",
              marginTop: 3,
              fontStyle: "italic",
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
            title="Note from the carving head when assigning"
          >
            “{job.note}”
          </div>
        )}
        {job.slab?.stock_location && (
          <div
            style={{
              fontSize: 11,
              color: "#7c2d12",
              marginTop: 2,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
            }}
            title="Last known pickup location for the transfer runner"
          >
            📍 {job.slab.stock_location}
          </div>
        )}
      </div>
      {/* Mig 070 — Accept / Flag controls for inter-vendor transfers
          (right side, compact). Non-transfer pending rows have no
          right-side action because the runner delivers; once they
          mark received it moves to Ready to load on its own. */}
      {isTransfer && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <form
            action={acceptTransferReceiptAction}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  `Accept ${job.slab_id} from ${job.transferred_from_vendor_name}?\n\nMoves it from Pending stock to Ready to load.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <FormPendingOverlay label="Accepting transfer…" />
            <input type="hidden" name="carving_item_id" value={job.id} />
            <input type="hidden" name="redirect_to" value="/vendor" />
            <button
              type="submit"
              style={{
                fontSize: 11,
                padding: "6px 12px",
                background: accent.fg,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                cursor: "pointer",
                width: "100%",
              }}
            >
              ✅ Accept
            </button>
          </form>
          <FlagTransferButton job={job} />
        </div>
      )}
    </div>
  );
}

/** Flag-transfer button + inline reason picker. Opens a small
 *  controlled form on tap so the vendor picks a refuse-reason
 *  (wrong machine / wrong design / overbooked / other) before
 *  the slab gets sent back. */
function FlagTransferButton({ job }: { job: CarvingJobLite }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const requiresNotes = reason === "other";
  const canSubmit =
    !!reason && (!requiresNotes || notes.trim().length >= 3);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          flex: "1 1 140px",
          padding: "10px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: "transparent",
          color: "#b91c1c",
          border: "1.5px solid rgba(220,38,38,0.45)",
          borderRadius: 8,
          cursor: "pointer",
          minHeight: 44,
          touchAction: "manipulation",
        }}
      >
        🚩 Flag issue
      </button>
    );
  }

  return (
    <form
      action={flagTransferIssueAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Flag this transfer and send ${job.slab_id} back to ${job.transferred_from_vendor_name}?`,
          )
        ) {
          e.preventDefault();
        }
      }}
      style={{
        flex: "1 1 100%",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        background: "rgba(220,38,38,0.05)",
        border: "1.5px dashed rgba(220,38,38,0.45)",
        borderRadius: 8,
      }}
    >
      <FormPendingOverlay label="Flagging transfer…" />
      <input type="hidden" name="carving_item_id" value={job.id} />
      <input type="hidden" name="redirect_to" value="/vendor" />
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "#b91c1c",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        🚩 Why are you flagging this transfer?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {[
          { v: "wrong_machine", label: "🛠 Wrong machine type for our setup" },
          { v: "wrong_design", label: "📐 Wrong design / file" },
          { v: "overbooked", label: "📅 Overbooked — can't take it" },
          { v: "other", label: "⚠ Other (notes required)" },
        ].map((opt) => {
          const checked = reason === opt.v;
          return (
            <label
              key={opt.v}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: checked ? "rgba(220,38,38,0.10)" : "var(--surface)",
                border: `1px solid ${checked ? "rgba(220,38,38,0.5)" : "var(--border)"}`,
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                touchAction: "manipulation",
              }}
            >
              <input
                type="radio"
                name="reason"
                value={opt.v}
                checked={checked}
                onChange={() => setReason(opt.v)}
              />
              {opt.label}
            </label>
          );
        })}
      </div>
      {requiresNotes && (
        <textarea
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What's wrong? (min 3 chars)"
          rows={2}
          style={{
            padding: "8px 10px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 700,
            background: canSubmit ? "#dc2626" : "var(--surface-alt)",
            color: canSubmit ? "#fff" : "var(--muted)",
            border: `1px solid ${canSubmit ? "#b91c1c" : "var(--border)"}`,
            borderRadius: 6,
            cursor: canSubmit ? "pointer" : "not-allowed",
            minHeight: 40,
            touchAction: "manipulation",
          }}
        >
          🚩 Send back
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
            setNotes("");
          }}
          className="ghost-button"
          style={{ padding: "8px 12px", fontSize: 12 }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Queue row ───────────────────────────────────────────────────────

function QueueRow({
  job,
  hasIdleMachine,
  onLoad,
  otherVendorsForTransfer,
}: {
  job: CarvingJobLite;
  hasIdleMachine: boolean;
  onLoad: () => void;
  otherVendorsForTransfer: Vendor[];
}) {
  const isUrgent = job.urgency === "urgent";
  const received = !!job.received_at_vendor_at;
  const isLathe = job.requires_machine_type === "lathe";
  // Migration 026 — slabs assigned together share a colour stripe.
  const tint = batchTint(job.batch_id);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: isUrgent ? "rgba(220,38,38,0.04)" : "var(--surface)",
        border: `1px solid ${isUrgent ? "rgba(220,38,38,0.3)" : "var(--border)"}`,
        borderLeft: tint
          ? `5px solid ${tint.border}`
          : `1px solid ${isUrgent ? "rgba(220,38,38,0.3)" : "var(--border)"}`,
        borderRadius: 8,
        flexWrap: "wrap",
      }}
      title={tint ? "Part of a batch — these slabs were assigned together" : undefined}
    >
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isUrgent && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#dc2626",
                color: "#fff",
                letterSpacing: "0.05em",
              }}
            >
              ⚡ URGENT
            </span>
          )}
          {isLathe && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: 3,
                background: "rgba(124,58,237,0.15)",
                color: "#7c3aed",
                letterSpacing: "0.05em",
              }}
              title="Cylindrical work — must go on a lathe"
            >
              🌀 LATHE
            </span>
          )}
          {/* Migration 023 — receipt pill: green when at-shade, amber while in transit. */}
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              padding: "2px 6px",
              borderRadius: 3,
              background: received ? "rgba(22,163,74,0.12)" : "rgba(217,119,6,0.12)",
              color: received ? "#15803d" : "#b45309",
              letterSpacing: "0.05em",
            }}
            title={received ? "Slab confirmed at vendor shade" : "Slab still in transit from cutting"}
          >
            {received ? "📦 AT SHADE" : "🚚 IN TRANSIT"}
          </span>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
            {job.slab_id}
          </span>
        </div>
        {job.slab && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {job.slab.temple} · {dimStr(job.slab)}
          </div>
        )}
        {/* Where the slab currently is (stock_location set by the cutter
            at finish-block time, migration 020). Only relevant while the
            slab is in transit — once received it's at the shade and the
            line just adds noise. */}
        {!received && job.slab?.stock_location && (
          <div
            style={{
              fontSize: 11,
              color: "#7c2d12",
              marginTop: 2,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
            }}
          >
            📍 {job.slab.stock_location}
          </div>
        )}
        {job.estimated_minutes && (
          <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 2 }}>
            ETA from carving head: {fmtDuration(job.estimated_minutes)}
          </div>
        )}
        {/* Daksh May 2026 round 3 — slab label surfaced on every row,
            not just the running CNC card. */}
        {job.slab?.label && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text)",
              marginTop: 3,
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title="Slab label (set at cut time)"
          >
            🏷 {job.slab.label}
          </div>
        )}
        {job.note && (
          <div
            style={{
              fontSize: 10.5,
              color: "#475569",
              marginTop: 3,
              fontStyle: "italic",
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
            title="Note from the carving head when assigning"
          >
            “{job.note}”
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        {!received && (
          <form action={acknowledgeReceiptAction}>
            <input type="hidden" name="carving_item_id" value={job.id} />
            <input type="hidden" name="redirect_to" value="/vendor" />
            <button
              type="submit"
              style={{
                fontSize: 11,
                padding: "6px 12px",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                cursor: "pointer",
                width: "100%",
              }}
              title="Confirm slab physically arrived at your shade"
            >
              ✅ Mark received
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={onLoad}
          disabled={!hasIdleMachine}
          className="primary-button"
          style={{
            fontSize: 12,
            padding: "8px 14px",
            opacity: hasIdleMachine ? 1 : 0.5,
            cursor: hasIdleMachine ? "pointer" : "not-allowed",
          }}
          title={hasIdleMachine ? "Load to a CNC" : "All machines busy or in maintenance"}
        >
          Load to CNC →
        </button>
        <TransferReadyButton
          job={job}
          otherVendorsForTransfer={otherVendorsForTransfer}
        />
      </div>
    </div>
  );
}

/** Inline transfer form on a Ready-to-load row. Lets a vendor (or
 *  developer / owner / carving head) shoot a not-yet-loaded slab to
 *  another vendor without touching a CNC. Mirrors FlagTransferButton's
 *  open-state pattern — collapsed button → expanded form with vendor
 *  picker + optional notes + confirm-before-submit. */
function TransferReadyButton({
  job,
  otherVendorsForTransfer,
}: {
  job: CarvingJobLite;
  otherVendorsForTransfer: Vendor[];
}) {
  const [open, setOpen] = useState(false);
  const [newVendorId, setNewVendorId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const destVendor = otherVendorsForTransfer.find((v) => v.id === newVendorId);
  const canSubmit = !!newVendorId;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 11,
          padding: "6px 12px",
          background: "transparent",
          color: "#7c2d12",
          border: "1.5px solid rgba(217,119,6,0.45)",
          borderRadius: 6,
          fontWeight: 700,
          cursor: "pointer",
          width: "100%",
          minHeight: 32,
          touchAction: "manipulation",
        }}
        title="Send this slab to another vendor without loading it"
      >
        ↔ Transfer
      </button>
    );
  }

  return (
    <form
      action={transferReadySlabAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Transfer ${job.slab_id} to ${destVendor?.name ?? "another vendor"}?`,
          )
        ) {
          e.preventDefault();
        }
      }}
      style={{
        flex: "1 1 100%",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        background: "rgba(217,119,6,0.05)",
        border: "1.5px dashed rgba(217,119,6,0.45)",
        borderRadius: 8,
      }}
    >
      <FormPendingOverlay label="Transferring slab…" />
      <input type="hidden" name="carving_item_id" value={job.id} />
      <input type="hidden" name="redirect_to" value="/vendor" />
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "#7c2d12",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        ↔ Transfer this slab to
      </div>
      <select
        name="new_vendor_id"
        value={newVendorId}
        onChange={(e) => setNewVendorId(e.target.value)}
        required
        style={{
          fontSize: 13,
          padding: "10px 12px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--text)",
          width: "100%",
        }}
      >
        <option value="">Pick a vendor…</option>
        {otherVendorsForTransfer.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.vendor_type === "Manual" ? " (Manual)" : ""}
          </option>
        ))}
      </select>
      <textarea
        name="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Why? (optional — shown to receiving vendor)"
        rows={2}
        style={{
          padding: "8px 10px",
          fontSize: 12,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--text)",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 700,
            background: canSubmit ? "#d97706" : "var(--surface-alt)",
            color: canSubmit ? "#fff" : "var(--muted)",
            border: `1px solid ${canSubmit ? "#b45309" : "var(--border)"}`,
            borderRadius: 6,
            cursor: canSubmit ? "pointer" : "not-allowed",
            minHeight: 40,
            touchAction: "manipulation",
          }}
        >
          ↔ Send
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setNewVendorId("");
            setNotes("");
          }}
          className="ghost-button"
          style={{ padding: "8px 12px", fontSize: 12 }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Machine card ────────────────────────────────────────────────────

function MachineCard({
  machine,
  queueLength,
  now,
  onLoad,
  onComplete,
  onMaintenance,
  onHistory,
  onProblem,
  onHold,
  stoneTypes,
}: {
  machine: CncMachineLive;
  queueLength: number;
  now: number;
  onLoad: () => void;
  onComplete: () => void;
  onMaintenance: () => void;
  onHistory: () => void;
  /** Per-slab "Problem / transfer" button — opens a modal where the
   *  operator picks a reason (broken slab / carving issue / design
   *  problem / transfer to another vendor / other) and either
   *  unloads back to their own queue or transfers to a different
   *  vendor. Lets them act on ONE slab of a 2-head pair without
   *  unloading the other. */
  onProblem: (job: CarvingJobLite) => void;
  /** Mig 069 — per-slab "Hold" button. Healthy-path mid-carve
   *  pause (two-side flip, scheduling). Routes to a dedicated Hold
   *  modal with the four canonical reasons. */
  onHold: (job: CarvingJobLite) => void;
  /** Phase 4 follow-up — used to colour the 3D slab thumb on
   *  running cards so the operator sees a stone-matched preview. */
  stoneTypes: StoneTypeDef[];
}) {
  const tint = STATUS_TINT[machine.status];
  // Primary job — first one loaded. Used for the timer + the
  // top-level complete-unload action. Second job (if 2-head pair)
  // is rendered as an extra slab block below.
  const job = machine.current_jobs[0] ?? null;

  // Countdown + elapsed timers for in-progress jobs. We show BOTH —
  // running-for tells the supervisor "how long has this slab been
  // on the machine?", remaining tells "how much longer until ETA".
  let runningForLabel: string | null = null;
  let remainingLabel: string | null = null;
  let remainingColor: string | null = null;
  let progressPct: number | null = null;
  if (machine.status === "carving" && job?.loaded_at) {
    const eta = job.vendor_estimated_minutes ?? job.estimated_minutes ?? null;
    const elapsedMin = (now - new Date(job.loaded_at).getTime()) / 60_000;
    runningForLabel = `running for ${fmtDuration(elapsedMin)}`;
    if (eta) {
      const remaining = eta - elapsedMin;
      progressPct = Math.max(0, Math.min(100, (elapsedMin / eta) * 100));
      if (remaining >= 0) {
        remainingLabel = `${fmtDuration(remaining)} left`;
        // Daksh May 2026 — green for normal remaining (carving palette),
        // amber for last-15-minute warning, red handled below.
        remainingColor = remaining <= 15 ? "#b45309" : "#15803d";
      } else {
        remainingLabel = `${fmtDuration(remaining)} over`;
        remainingColor = "#b91c1c";
      }
    }
  }

  // Downtime timer for maintenance. Same `now` tick as the countdown
  // so it refreshes every 30s along with everything else.
  let downtimeLabel: string | null = null;
  if (machine.status === "maintenance" && machine.maintenance_flagged_at) {
    const downMin = (now - new Date(machine.maintenance_flagged_at).getTime()) / 60_000;
    downtimeLabel = `Down for ${fmtDuration(downMin)}`;
  }

  // Daksh May 2026 — lathe cards used to render as a chunky 60px
  // pill to call out "this one spins round work" at a glance. Daksh
  // found it visually noisy next to the rectangular CNC cards. Now
  // both shapes share the same 10px-rounded rectangle, and the
  // violet "chuck mark" decoration in the upper-right corner is
  // the sole signal that the card is a lathe. Easier to scan, less
  // alignment chaos in the grid.
  const isLathe = machine.machine_type === "lathe";
  return (
    <div
      style={{
        padding: 0,
        background: tint.bg,
        border: `2px solid ${tint.border}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        // Carving cards lift slightly to telegraph "this is active work"
        // Daksh May 2026 — green shadow on carving (was blue).
        boxShadow:
          machine.status === "carving"
            ? "0 4px 14px rgba(22,163,74,0.18)"
            : machine.status === "maintenance"
              ? "0 4px 14px rgba(220,38,38,0.18)"
              : "none",
      }}
    >
      {/* Mig follow-on (Daksh) — chuck-mark decoration on lathe
          cards. Three nested rings + a small spinning dot in the
          top-right corner so a glance instantly reads "lathe =
          round work". Decorative only — no click, no semantic
          meaning beyond shape. */}
      {isLathe && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 10,
            right: 14,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(124,58,237,0.35) 0%, rgba(124,58,237,0.10) 60%, rgba(124,58,237,0) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "1.5px solid rgba(124,58,237,0.55)",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 1,
                left: "50%",
                width: 2,
                height: 2,
                marginLeft: -1,
                borderRadius: "50%",
                background: "#7c3aed",
              }}
            />
          </div>
        </div>
      )}
      {/* Top accent bar — colour the entire card edge so cards are
          distinguishable at a glance even when scanning fast.
          Skipped for lathes since the pill-shape would clip the
          straight 4px bar. */}
      {!isLathe && (
        <div
          style={{
            height: 4,
            background: tint.accent,
            opacity: machine.status === "idle" ? 0.4 : 1,
          }}
        />
      )}

      <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Header: BIG machine code + prominent status pill */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 800,
                fontSize: 18,
                color: "var(--text)",
                lineHeight: 1,
              }}
            >
              {machine.machine_code}
            </span>
            {/* Machine type — small pill so the supervisor can tell
                a 2-head from a single-head from a lathe at a glance.
                Single-head is the default and stays unlabelled to
                keep the card uncluttered. */}
            {machine.machine_type !== "single_head" && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: machine.machine_type === "lathe" ? "rgba(124,58,237,0.15)" : "rgba(180,115,51,0.15)",
                  color: machine.machine_type === "lathe" ? "#7c3aed" : "#b45309",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  fontFamily: "ui-monospace, monospace",
                }}
                title={
                  machine.machine_type === "multi_head_2"
                    ? "2-head CNC: loads two identical slabs in lockstep"
                    : "Lathe: turning machine for round work"
                }
              >
                {machine.machine_type === "multi_head_2" ? "2× HEAD" : "LATHE"}
              </span>
            )}
            {machine.operator_name && (
              <span style={{ fontSize: 10, color: "var(--muted)" }}>· {machine.operator_name}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* History button — always visible regardless of status.
                Opens a modal with the machine's event timeline +
                rolled-up totals (carving / downtime / sessions). */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onHistory();
              }}
              title="View this machine's history"
              style={{
                background: "rgba(0,0,0,0.05)",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                width: 24,
                height: 24,
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              📊
            </button>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "3px 10px",
                borderRadius: 999,
                color: "#fff",
                background: tint.accent,
                letterSpacing: "0.07em",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                opacity: machine.status === "idle" ? 0.85 : 1,
              }}
            >
              <span style={{ fontSize: 9 }}>{tint.icon}</span>
              {tint.label}
            </span>
          </div>
        </div>

        {/* Body — depends on status */}
        {machine.status === "idle" && (
          <>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                padding: "12px 0",
                textAlign: "center",
                fontStyle: "italic",
              }}
            >
              {queueLength > 0
                ? `${queueLength} slab${queueLength !== 1 ? "s" : ""} waiting`
                : "Nothing in queue"}
            </div>
            <button
              type="button"
              onClick={onLoad}
              disabled={queueLength === 0}
              className="primary-button"
              style={{
                fontSize: 13,
                padding: "9px 14px",
                fontWeight: 700,
                opacity: queueLength > 0 ? 1 : 0.5,
              }}
            >
              ▶ Load slab
            </button>
            <button
              type="button"
              onClick={onMaintenance}
              className="ghost-button"
              style={{ fontSize: 11, padding: "6px 10px" }}
            >
              🔧 Flag maintenance
            </button>
          </>
        )}

        {machine.status === "carving" && job && (
          <>
            {/* Per-slab info blocks — usually 1, but 2 for a 2-head
                pair load. Each has its own ⚠ Problem button so the
                operator can flag or unload just that slab while the
                other keeps running. */}
            {machine.current_jobs.map((slabJob, idx) => (
              <div
                key={slabJob.id}
                style={{
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.85)",
                  border: "1px solid rgba(37,99,235,0.25)",
                  borderRadius: 6,
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                {slabJob.slab && (
                  <div
                    style={{
                      flexShrink: 0,
                      // Mig follow-on (Daksh) — lathe = round work,
                      // so visually clip the slab thumb into a circle
                      // for lathe machines. Iso-block SVG inside
                      // still renders normally; the wrapper masks it
                      // with overflow: hidden + 50% radius + a soft
                      // violet ring matching the chuck mark.
                      ...(isLathe
                        ? {
                            width: 56,
                            height: 56,
                            borderRadius: "50%",
                            overflow: "hidden",
                            boxShadow:
                              "inset 0 0 0 2px rgba(124,58,237,0.35)",
                            background: "var(--surface-alt)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }
                        : {}),
                    }}
                  >
                    <SlabThumb
                      stone={slabJob.slab.stone}
                      l={slabJob.slab.length_in}
                      w={slabJob.slab.width_in}
                      t={slabJob.slab.thickness_in}
                      stoneTypes={stoneTypes}
                      size={56}
                      height={56}
                    />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {/* HEAD pill on 2-head pair loads so the operator
                        can tell which head a slab is on. Single
                        loads don't need it. */}
                    {machine.machine_type === "multi_head_2" && machine.current_jobs.length > 1 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: "rgba(37,99,235,0.15)",
                          color: "#1d4ed8",
                          letterSpacing: "0.05em",
                        }}
                      >
                        HEAD {idx + 1}
                      </span>
                    )}
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
                      {slabJob.slab_id}
                    </span>
                  </div>
                  {slabJob.slab && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {slabJob.slab.temple} · {dimStr(slabJob.slab)}
                    </div>
                  )}
                  {/* Daksh May 2026 — surface label + note on the
                      running card so the operator sees the full
                      slab identity (e.g. "Jagti dodiya thar (mohit)")
                      and any carving-head instructions without
                      having to open the detail panel. */}
                  {slabJob.slab?.label && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text)",
                        marginTop: 3,
                        fontWeight: 600,
                        wordBreak: "break-word",
                      }}
                      title="Slab label (set at cut time)"
                    >
                      🏷 {slabJob.slab.label}
                    </div>
                  )}
                  {slabJob.note && (
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "#475569",
                        marginTop: 3,
                        fontStyle: "italic",
                        lineHeight: 1.35,
                        wordBreak: "break-word",
                      }}
                      title="Note from the carving head when assigning"
                    >
                      “{slabJob.note}”
                    </div>
                  )}
                  {/* Timer + progress only shown on the first row
                      since the pair shares a loaded_at + ETA. */}
                  {idx === 0 && (runningForLabel || remainingLabel) && (
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                        gap: 8,
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      {runningForLabel && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>
                          ▶ {runningForLabel}
                        </span>
                      )}
                      {remainingLabel && (
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: remainingColor!,
                          }}
                        >
                          ⏱ {remainingLabel}
                        </span>
                      )}
                    </div>
                  )}
                  {idx === 0 && progressPct != null && (
                    <div
                      style={{
                        marginTop: 6,
                        height: 4,
                        background: "rgba(22,163,74,0.15)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${progressPct}%`,
                          // Daksh May 2026 — green progress fill
                          // (carving palette swapped from blue).
                          background: progressPct > 100 ? "#dc2626" : "#16a34a",
                          transition: "width 0.5s",
                        }}
                      />
                    </div>
                  )}
                  {/* Per-slab actions row (mig 069):
                        • ⏸ Hold — park the slab off-machine so another
                          one can run; reload later from the On Hold
                          tray. First-class because it's a HEALTHY-path
                          mid-carve action (two-side flip, power
                          schedule), not a problem-triggered one.
                        • ⚠ Problem / transfer — broken / design /
                          transfer flow.
                      Stop propagation so card click doesn't fire. */}
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onHold(slabJob);
                      }}
                      style={{
                        flex: "1 1 120px",
                        fontSize: 11,
                        padding: "6px 10px",
                        background: "rgba(167,139,250,0.10)",
                        color: "#6d28d9",
                        border: "1.5px solid rgba(167,139,250,0.5)",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 700,
                        touchAction: "manipulation",
                      }}
                      title="Park this slab off-machine so another can run. Reload from the ⏸ On Hold tray later."
                    >
                      ⏸ Hold this slab
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onProblem(slabJob);
                      }}
                      style={{
                        flex: "1 1 120px",
                        fontSize: 11,
                        padding: "6px 10px",
                        background: "rgba(220,38,38,0.08)",
                        color: "#991b1b",
                        border: "1px solid rgba(220,38,38,0.3)",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 700,
                        touchAction: "manipulation",
                      }}
                      title="Flag a problem (broken slab / carving issue) or transfer this slab to another vendor"
                    >
                      ⚠ Problem / transfer
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={onComplete}
              className="primary-button"
              style={{ fontSize: 13, padding: "10px 14px", fontWeight: 700 }}
            >
              ✓ Mark complete + unload {machine.current_jobs.length > 1 ? "both" : ""}
            </button>
            {/* Daksh May 2026 — Flag maintenance is now available
                even while the machine is running. Pauses the slab
                timer in place; resolving maintenance shifts loaded_at
                forward by the down-time so the slab clock picks up
                where it stopped. */}
            <button
              type="button"
              onClick={onMaintenance}
              className="ghost-button"
              style={{ fontSize: 11, padding: "6px 10px" }}
              title="Pause the slab timer + mark machine under maintenance. Resolving brings the slab timer back from where it stopped."
            >
              🔧 Flag maintenance (pauses slab)
            </button>
          </>
        )}

        {machine.status === "maintenance" && (
          <>
            {/* Daksh May 2026 — if the machine went into maintenance
                MID-CARVE, current_jobs is still populated. Surface a
                small "paused slab" card per loaded job so the operator
                knows which slab(s) are sitting on the machine while
                it's down. The slab elapsed displayed here is what we
                saw at pause time (now − loaded_at). resolveMaintenance
                shifts loaded_at forward by the pause duration so this
                value picks up correctly when the machine comes back. */}
            {machine.current_jobs.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "8px 10px",
                  background: "rgba(56,189,248,0.08)",
                  border: "1px dashed rgba(56,189,248,0.45)",
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: "#0369a1",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  ⏸ Slab timer paused
                </div>
                {machine.current_jobs.map((slabJob) => {
                  const pausedAt = slabJob.loaded_at
                    ? new Date(slabJob.loaded_at).getTime()
                    : null;
                  // If maintenance started AFTER loaded_at, pause-time
                  // elapsed = maintenance_flagged_at − loaded_at.
                  // Otherwise (edge) fall back to 0.
                  const flaggedAt = machine.maintenance_flagged_at
                    ? new Date(machine.maintenance_flagged_at).getTime()
                    : null;
                  const pausedElapsedMin =
                    pausedAt && flaggedAt && flaggedAt > pausedAt
                      ? (flaggedAt - pausedAt) / 60_000
                      : null;
                  return (
                    <div
                      key={slabJob.id}
                      style={{ display: "flex", flexDirection: "column", gap: 2 }}
                    >
                      <div
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#0c4a6e",
                        }}
                      >
                        {slabJob.slab_id}
                      </div>
                      {slabJob.slab && (
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>
                          {slabJob.slab.temple} · {dimStr(slabJob.slab)}
                        </div>
                      )}
                      {pausedElapsedMin != null && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "#0369a1",
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 600,
                          }}
                          title="Slab was this far when maintenance started — it resumes from here once back online"
                        >
                          ⏸ paused at {fmtDuration(pausedElapsedMin)} carved
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div
              style={{
                padding: "10px 12px",
                background: "rgba(255,255,255,0.85)",
                border: "1px solid rgba(220,38,38,0.25)",
                borderRadius: 6,
              }}
            >
              {downtimeLabel && (
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#b91c1c",
                    fontFamily: "ui-monospace, monospace",
                    marginBottom: 6,
                  }}
                >
                  ⏱ {downtimeLabel}
                </div>
              )}
              <div style={{ fontSize: 10, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Reason
              </div>
              <div style={{ fontSize: 12, color: "var(--text)", marginTop: 2 }}>
                {machine.maintenance_reason ?? "—"}
              </div>
            {machine.maintenance_flagged_at && (
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                Flagged {new Date(machine.maintenance_flagged_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
          {/* Daksh June 2026 — machines downed by the global power cut
              can ONLY be resumed by the "Power's back — resume all"
              button at the top (so they all come back together). Hide
              the per-machine "Back online" button for them; show a hint
              instead. Individually-flagged machines keep their button. */}
          {machine.maintenance_reason === POWER_CUT_REASON ? (
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                textAlign: "center",
                padding: "8px 4px",
                lineHeight: 1.4,
              }}
            >
              ⚡ Paused by power cut — bring it back with{" "}
              <strong>“Power&apos;s back — resume all”</strong> at the top.
            </div>
          ) : (
            <form
              action={resolveMaintenanceAction}
              onSubmit={(e) => {
                if (!confirm(`Mark ${machine.machine_code} as back online?`)) {
                  e.preventDefault();
                }
              }}
            >
              <FormPendingOverlay label="Bringing back online…" />
              <input type="hidden" name="cnc_machine_id" value={machine.id} />
              <button
                type="submit"
                className="primary-button"
                style={{ fontSize: 13, padding: "10px 14px", fontWeight: 700, width: "100%" }}
              >
                ✓ Back online
              </button>
            </form>
          )}
        </>
      )}

        {machine.status === "inactive" && (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0", textAlign: "center" }}>
            Machine deactivated
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  maxWidth = 520,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  /** Override the default 520px max width. Used by the LoadModal in
   *  pair mode so Slab A + Slab B can sit side-by-side instead of
   *  stacked, which Daksh hated on tablet + desktop. */
  maxWidth?: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc closes + lock background scroll. Daksh May 2026 — on tablet,
  // touch-scrolling the blurred backdrop was still scrolling the
  // page underneath. Locking body overflow stops that bleed; the
  // dialog's own content area still scrolls because it has its own
  // overflowY:auto. CenterPeekModal already does this; the
  // ModalShell variant did not.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
      onTouchMove={(e) => {
        // Daksh May 2026 — additional belt-and-braces for tablets:
        // if the touchmove originates on the backdrop (not the
        // dialog), preventDefault stops the OS-level page scroll
        // that body:overflow:hidden alone misses on iOS Safari.
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
          e.preventDefault();
        }
      }}
      style={{
        position: "fixed",
        /* Daksh May 2026 — was anchored to `left: var(--content-left)`
         * so the modal would sit over the working area on desktop
         * (i.e. start after the sidebar). On vendor cockpit the
         * sidebar is hidden via body.vendor-cockpit-fullscreen, and
         * globals.css now zeroes --content-left in that mode, so
         * `left: 0` here would also work — but using inset:0 is
         * simpler and explicitly anchors to the whole viewport,
         * leaving the centering math to flexbox below. */
        inset: 0,
        background: "rgba(15,12,6,0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
        display: "flex",
        /* Was alignItems: "flex-end" — a bottom-sheet style that on
         * tablet looked off-centre (skewed when the sidebar
         * gutter was still factored in). Centre the dialog
         * vertically so it reads as a proper peek modal on every
         * screen size. */
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          /* All-round 14px radius now (was 12px top-only because of
           * the bottom-sheet origin). Reads as a floating card. */
          borderRadius: 14,
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth,
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
            {subtitle && (
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                {subtitle}
              </p>
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
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 18px" }}>{children}</div>
      </div>
    </div>
  );
}

function LoadModal({
  machine,
  machines,
  queue,
  stoneTypes,
  onClose,
}: {
  machine: CncMachineLive;
  machines: CncMachineLive[];
  queue: CarvingJobLite[];
  stoneTypes: StoneTypeDef[];
  onClose: () => void;
}) {
  const [machineId, setMachineId] = useState(machine.id);
  const selectedMachine = machines.find((m) => m.id === machineId) ?? machine;
  const machineIsTwoHead = selectedMachine.machine_type === "multi_head_2";
  const machineIsLathe = selectedMachine.machine_type === "lathe";
  // For 2-head machines, the vendor can choose pair mode (default,
  // both heads running on identical slabs) OR single mode (only one
  // head loaded, second turned off — rare but real). Single mode
  // routes through loadSlabOnMachineAction, pair mode through
  // loadTwoSlabsOnMultiHeadAction.
  // Mig 081 follow-on (Daksh) — third mode added: "mismatch". For
  // the rare case the vendor needs to load 2 different slabs on a
  // 2-head CNC (different dims / temple / label). Hidden behind a
  // long-press on the Pair card so it never becomes the default
  // path; revealed mode keeps showing for the rest of the session
  // so the user can flip in + out while picking slabs.
  const [loadMode, setLoadMode] = useState<"pair" | "single" | "mismatch">("pair");
  const [mismatchRevealed, setMismatchRevealed] = useState(false);
  const effectiveIsPair = machineIsTwoHead && loadMode === "pair";
  // "Two-column slab picker" cases — pair (matched) AND mismatch
  // (anything-goes). Single mode is the only one that uses the
  // wide single-slab grid below.
  const effectiveIsTwoCol = machineIsTwoHead && (loadMode === "pair" || loadMode === "mismatch");
  const isMismatchMode = machineIsTwoHead && loadMode === "mismatch";

  // Daksh May 2026 — filter the slab queue to JUST those compatible
  // with the currently-selected machine type. Was unfiltered, which
  // let a vendor pick a flat slab when a lathe was selected (the
  // server now blocks it, but the picker should never even offer it).
  // Lathe machines see only lathe-tagged slabs; non-lathe machines
  // see only non-lathe-tagged slabs.
  const compatibleQueue = useMemo(
    () =>
      queue.filter((q) =>
        machineIsLathe
          ? q.requires_machine_type === "lathe"
          : q.requires_machine_type !== "lathe",
      ),
    [queue, machineIsLathe],
  );

  const [carvingItemId, setCarvingItemId] = useState<string>(
    compatibleQueue[0]?.id ?? "",
  );
  // Second slab id for 2-head pair loads. Filtered to "matches first"
  // so the vendor can't accidentally pair non-identical slabs.
  const [carvingItemBId, setCarvingItemBId] = useState<string>("");
  const selectedJob =
    compatibleQueue.find((q) => q.id === carvingItemId) ?? null;
  const idleMachines = machines.filter((m) => m.status === "idle");
  // Days + hours pickers — carving runs span hours to multiple days,
  // so days is a more useful primary unit than minutes.
  const [days, setDays] = useState<string>("");
  const [hours, setHours] = useState<string>("");
  const totalMinutes = (Number(days) || 0) * 60 * 24 + (Number(hours) || 0) * 60;

  // Slabs that match the primary one's L×W×T + temple + label —
  // these are the only valid second-head pairings on a 2-head load.
  const matchingPair = effectiveIsPair && selectedJob?.slab
    ? compatibleQueue.filter(
        (q) =>
          q.id !== carvingItemId &&
          q.slab &&
          q.slab.length_in === selectedJob.slab!.length_in &&
          q.slab.width_in === selectedJob.slab!.width_in &&
          q.slab.thickness_in === selectedJob.slab!.thickness_in &&
          (q.slab.temple ?? "") === (selectedJob.slab!.temple ?? "") &&
          (q.slab.label ?? "") === (selectedJob.slab!.label ?? ""),
      )
    : [];

  // Mig 081 follow-on — mismatch mode picker. Same compatible queue
  // (lathe / non-lathe filter still respected) but with NO geometry
  // / temple / label match required. Anything except the slab
  // already picked for head 1 is fair game.
  const anyCompatibleForB = isMismatchMode
    ? compatibleQueue.filter((q) => q.id !== carvingItemId)
    : [];

  // Reset pair selection when primary changes, machine type changes,
  // or the vendor switches between pair and single mode.
  useEffect(() => {
    setCarvingItemBId("");
  }, [carvingItemId, effectiveIsPair, isMismatchMode]);

  // Switching to a non-2-head machine forces single mode.
  useEffect(() => {
    if (!machineIsTwoHead) setLoadMode("pair"); // benign default; pair logic gated by machineIsTwoHead anyway
  }, [machineIsTwoHead]);

  // When the compatible queue changes (because the machine type
  // changed), make sure the currently-selected slab is still valid.
  // If not, drop it and default to the first compatible slab.
  useEffect(() => {
    if (carvingItemId && !compatibleQueue.some((q) => q.id === carvingItemId)) {
      setCarvingItemId(compatibleQueue[0]?.id ?? "");
    } else if (!carvingItemId && compatibleQueue[0]) {
      setCarvingItemId(compatibleQueue[0].id);
    }
  }, [compatibleQueue, carvingItemId]);

  // When user picks a different slab, prefill estimate from carving
  // head's number (vendor can adjust).
  useEffect(() => {
    if (selectedJob?.estimated_minutes) {
      const m = selectedJob.estimated_minutes;
      const d = Math.floor(m / (60 * 24));
      const h = Math.floor((m % (60 * 24)) / 60);
      setDays(d > 0 ? String(d) : "");
      setHours(h > 0 ? String(h) : "");
    } else {
      setDays("");
      setHours("");
    }
  }, [selectedJob?.id, selectedJob?.estimated_minutes]);

  return (
    <ModalShell
      title={
        effectiveIsPair
          ? "Load 2 identical slabs (2-head CNC)"
          : isMismatchMode
            ? "⚠ Load 2 MISMATCHED slabs (2-head CNC)"
            : machineIsTwoHead
              ? "Load 1 slab onto 2-head CNC (single mode)"
              : machineIsLathe
                ? "Load slab onto lathe"
                : "Load slab onto CNC"
      }
      subtitle={
        effectiveIsPair
          ? "Both heads carve the same shape — pick two slabs with identical L×W×T + temple + label."
          : isMismatchMode
            ? "Heads will carve different shapes. Use only when no matching pair exists. Two confirmations required."
            : machineIsTwoHead
              ? "Second head will be turned off. Pick the slab to load on head 1."
              : machineIsLathe
                ? "Only lathe-tagged (cylindrical) slabs are loadable here."
                : "Pick the slab and machine, then enter your tighter ETA."
      }
      onClose={onClose}
      // Daksh May 2026 round 2 — single mode at 560 was still too
      // narrow on tablet/desktop (lots of scroll, Load button below
      // fold). Both two-column modes (pair + mismatch) open at 920;
      // single mode at 760.
      maxWidth={effectiveIsTwoCol ? 920 : 760}
    >
      {compatibleQueue.length === 0 ? (
        <Empty
          text={
            machineIsLathe
              ? "No lathe-tagged slabs ready to load. Pick a different machine, or wait for a lathe slab to arrive."
              : queue.length > 0
                ? "No slabs ready for this machine type. Pick a different machine."
                : "No slabs ready to load. Check the Pending stock list — slabs need to be delivered by the transfer runner first."
          }
        />
      ) : (
        <form
          action={effectiveIsTwoCol ? loadTwoSlabsOnMultiHeadAction : loadSlabOnMachineAction}
          onSubmit={(e) => {
            // Mig 081 follow-on — mismatch mode requires DOUBLE
            // confirmation before the form actually fires (Daksh's
            // spec: "give 2 confirmation when long pressed going
            // for manual 2 head non mirror"). Pair + single modes
            // submit immediately.
            if (!isMismatchMode) return;
            const aId = carvingItemId || "(no slab A)";
            const bId = carvingItemBId || "(no slab B)";
            const first = window.confirm(
              [
                "⚠  MISMATCHED PAIR — both heads will carve DIFFERENT shapes.",
                "",
                `Head 1: ${aId}`,
                `Head 2: ${bId}`,
                "",
                "Are you sure you want to load two non-matching slabs?",
              ].join("\n"),
            );
            if (!first) {
              e.preventDefault();
              return;
            }
            const second = window.confirm(
              [
                "🛑  FINAL CHECK — REALLY load mismatched slabs?",
                "",
                "The two heads will run different toolpaths. This is",
                "the same flow as a normal pair load but the dimension",
                "match guard is bypassed. There is no undo from the",
                "machine — once carving starts you must finish or",
                "unload-with-problem each slab independently.",
              ].join("\n"),
            );
            if (!second) {
              e.preventDefault();
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <FormPendingOverlay
            label={effectiveIsTwoCol ? "Loading both slabs…" : "Loading slab…"}
          />
          {/* Mig 081 follow-on — sentinel for the server to bypass
              the identity check on this submit. Only present in
              mismatch mode; default pair loads omit it entirely. */}
          {isMismatchMode && (
            <input type="hidden" name="force_mismatched" value="true" />
          )}
          {/* Machine picker — first so the form layout reflects what
              the vendor's about to load onto. Switching to a 2-head
              machine swaps the slab picker into pair mode. */}
          <div>
            <Label>CNC machine</Label>
            <input type="hidden" name="cnc_machine_id" value={machineId} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {idleMachines.map((m) => {
                const isSelected = m.id === machineId;
                const typeLabel =
                  m.machine_type === "multi_head_2" ? "2× HEAD"
                    : m.machine_type === "lathe" ? "LATHE"
                      : null;
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => setMachineId(m.id)}
                    style={{
                      padding: "6px 12px",
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 700,
                      fontSize: 12,
                      border: `1.5px solid ${isSelected ? "var(--gold-dark)" : "var(--border)"}`,
                      background: isSelected ? "rgba(180,115,51,0.1)" : "var(--surface)",
                      color: "var(--text)",
                      borderRadius: 6,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {m.machine_code}
                    {typeLabel && (
                      <span
                        style={{
                          fontSize: 8,
                          fontWeight: 800,
                          padding: "0 5px",
                          borderRadius: 3,
                          background:
                            m.machine_type === "lathe"
                              ? "rgba(124,58,237,0.15)"
                              : "rgba(180,115,51,0.18)",
                          color: m.machine_type === "lathe" ? "#7c3aed" : "#b45309",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {typeLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pair/Single mode toggle — only on 2-head machines.
              99.9% of loads are pair mode; single mode is for the
              rare case where one head is broken or you only have
              one matching slab.
              Mig 081 follow-on (Daksh) — a third "Mismatch" mode is
              hidden by default; long-press (600ms) on the Pair card
              reveals it. From then on the third card stays visible
              while the modal is open. */}
          {machineIsTwoHead && (
            <div>
              <Label>Mode</Label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* Pair — primary CTA. doubles as the long-press
                    trigger for revealing the mismatch tile. We use
                    a ref + setTimeout so that a normal click
                    (release before 600ms) still works as a regular
                    setLoadMode("pair") tap. */}
                <LongPressableModeButton
                  onTap={() => setLoadMode("pair")}
                  onLongPress={() => {
                    setMismatchRevealed(true);
                    setLoadMode("mismatch");
                  }}
                  active={loadMode === "pair"}
                  activeBg="rgba(37,99,235,0.10)"
                  activeBorder="#2563eb"
                  activeFg="#1d4ed8"
                  ariaLabel="Pair mode (long-press for mismatch)"
                >
                  ▶▶ Pair mode (2 slabs, both heads)
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, fontWeight: 400 }}>
                    Default. Both heads carve identical slabs.
                    {!mismatchRevealed && " Long-press for advanced."}
                  </div>
                </LongPressableModeButton>
                <button
                  type="button"
                  onClick={() => setLoadMode("single")}
                  style={{
                    flex: "1 1 200px",
                    padding: "10px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: loadMode === "single" ? "rgba(180,115,51,0.10)" : "var(--surface)",
                    border: `1.5px solid ${loadMode === "single" ? "var(--gold-dark)" : "var(--border)"}`,
                    color: loadMode === "single" ? "var(--gold-dark)" : "var(--text)",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  ▶ Single mode (1 slab, second head off)
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, fontWeight: 400 }}>
                    Use when you don&apos;t have a matching pair.
                  </div>
                </button>
                {/* Mismatch — only visible after long-press */}
                {mismatchRevealed && (
                  <button
                    type="button"
                    onClick={() => setLoadMode("mismatch")}
                    style={{
                      flex: "1 1 200px",
                      padding: "10px 14px",
                      fontSize: 13,
                      fontWeight: 700,
                      background: loadMode === "mismatch" ? "rgba(220,38,38,0.10)" : "var(--surface)",
                      border: `1.5px solid ${loadMode === "mismatch" ? "#b91c1c" : "rgba(220,38,38,0.35)"}`,
                      color: loadMode === "mismatch" ? "#991b1b" : "#b91c1c",
                      borderRadius: 6,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    ⚠ Mismatch mode (advanced)
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, fontWeight: 400 }}>
                      Load 2 different slabs on the same CNC. Rare.
                    </div>
                  </button>
                )}
              </div>
              {/* Mig 081 — once mismatch mode is active, anchor a
                  prominent red warning above the slab pickers so the
                  vendor can never forget what they just opted into. */}
              {isMismatchMode && (
                <div
                  role="alert"
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    background: "rgba(220,38,38,0.08)",
                    border: "1.5px solid #b91c1c",
                    borderRadius: 8,
                    fontSize: 12.5,
                    color: "#7f1d1d",
                    lineHeight: 1.45,
                  }}
                >
                  <strong>⚠ Mismatched pair load.</strong> Head 1 and
                  Head 2 will carve different shapes. Use this only
                  when you genuinely have no matching pair and the
                  CNC would otherwise sit idle. You&apos;ll get two
                  confirmation prompts before the load fires.
                </div>
              )}
            </div>
          )}

          {/* Slab picker(s). Pair + mismatch modes lay Slab A and
              Slab B in two columns (side-by-side) on tablet/desktop;
              single mode is a single full-width grid. Each grid is
              independently scrollable, capped at ~360px so neither
              hogs the modal height. */}
          {effectiveIsTwoCol ? (
            <div
              style={{
                display: "grid",
                // Two columns on wide screens; falls back to 1 col on
                // narrow tablet portrait so cards don't get squashed.
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
              }}
            >
              {/* Slab A column */}
              <div>
                <Label>Slab A (head 1)</Label>
                <input
                  type="hidden"
                  name="carving_item_a_id"
                  value={carvingItemId}
                />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 8,
                    maxHeight: 360,
                    overflowY: "auto",
                    padding: 4,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface-alt, #fafaf7)",
                  }}
                >
                  {compatibleQueue.map((q) => (
                    <SlabPickerCard
                      key={q.id}
                      job={q}
                      selected={q.id === carvingItemId}
                      onSelect={() => setCarvingItemId(q.id)}
                      stoneTypes={stoneTypes}
                    />
                  ))}
                </div>
              </div>
              {/* Slab B column — matching-geometry subset in pair
                  mode; anything-goes (lathe filter still applies)
                  in mismatch mode. */}
              <div>
                <Label>
                  {isMismatchMode
                    ? "Slab B (head 2 — ANY compatible slab) ⚠"
                    : "Slab B (head 2 — must match A)"}
                </Label>
                <input
                  type="hidden"
                  name="carving_item_b_id"
                  value={carvingItemBId}
                />
                {(() => {
                  const bList = isMismatchMode ? anyCompatibleForB : matchingPair;
                  if (bList.length === 0) {
                    return (
                      <div
                        style={{
                          padding: "12px 14px",
                          background: "rgba(217,119,6,0.06)",
                          border: "1px solid rgba(217,119,6,0.25)",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "#b45309",
                          minHeight: 360,
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        {isMismatchMode
                          ? "No other compatible slab in the queue — pick a different machine or wait for more slabs."
                          : "No matching slab in the queue. 2-head loads need a second slab with the same dimensions, temple, and label."}
                      </div>
                    );
                  }
                  return (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(120px, 1fr))",
                        gap: 8,
                        maxHeight: 360,
                        overflowY: "auto",
                        padding: 4,
                        border: `1px solid ${isMismatchMode ? "rgba(220,38,38,0.35)" : "var(--border)"}`,
                        borderRadius: 8,
                        background: isMismatchMode
                          ? "rgba(220,38,38,0.04)"
                          : "var(--surface-alt, #fafaf7)",
                      }}
                    >
                      {bList.map((q) => (
                        <SlabPickerCard
                          key={q.id}
                          job={q}
                          selected={q.id === carvingItemBId}
                          onSelect={() => setCarvingItemBId(q.id)}
                          stoneTypes={stoneTypes}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div>
              <Label>Slab to load</Label>
              <input
                type="hidden"
                name="carving_item_id"
                value={carvingItemId}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 8,
                  maxHeight: 320,
                  overflowY: "auto",
                  padding: 4,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--surface-alt, #fafaf7)",
                }}
              >
                {compatibleQueue.map((q) => (
                  <SlabPickerCard
                    key={q.id}
                    job={q}
                    selected={q.id === carvingItemId}
                    onSelect={() => setCarvingItemId(q.id)}
                    stoneTypes={stoneTypes}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Vendor's estimated time — defaults from carving head.
              Days + hours range so it works for short pieces and
              multi-day complex carves alike. This is the moment
              the vendor commits to "I'll finish by ~X" — the timer
              on the cockpit machine card runs against this. Made
              prominent at Daksh's request: big inputs, clear label,
              live total readout, carving head's hint as a chip. */}
          <div
            style={{
              padding: "16px 18px",
              background: "linear-gradient(180deg, rgba(37,99,235,0.06) 0%, var(--surface) 100%)",
              border: "2px solid rgba(37,99,235,0.30)",
              borderRadius: 12,
              boxShadow: "0 2px 12px rgba(37,99,235,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#1d4ed8",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                ⏱ Your estimated time
              </span>
              {selectedJob?.estimated_minutes != null && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "rgba(180,115,51,0.12)",
                    color: "var(--gold-dark)",
                    whiteSpace: "nowrap",
                  }}
                  title="Estimate from the carving head when assigning. Adjust based on what you actually see when loading."
                >
                  Head's guess: {fmtDuration(selectedJob.estimated_minutes)}
                </span>
              )}
            </div>
            <input type="hidden" name="vendor_estimated_minutes" value={totalMinutes || ""} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder="0"
                  aria-label="Days"
                  style={{
                    width: 80,
                    padding: "12px 14px",
                    fontSize: 20,
                    fontWeight: 700,
                    border: "2px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg)",
                    color: "var(--text)",
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--muted)" }}>days</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="0"
                  aria-label="Hours"
                  style={{
                    width: 80,
                    padding: "12px 14px",
                    fontSize: 20,
                    fontWeight: 700,
                    border: "2px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg)",
                    color: "var(--text)",
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--muted)" }}>hours</span>
              </div>
              {totalMinutes > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    padding: "6px 12px",
                    background: "#1d4ed8",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 800,
                    borderRadius: 8,
                    fontFamily: "ui-monospace, monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  ≈ {fmtDuration(totalMinutes)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
              The machine timer on the cockpit will count down from this. You can
              still mark complete early or late.
            </div>
          </div>

          {/* Sticky Load button so it's always reachable, even when
              the slab grids are scrolled. Daksh May 2026 — vendors
              kept losing the button below the fold on tablet, hence
              the position:sticky + drop-shadow lift. */}
          <div
            style={{
              position: "sticky",
              // -18px matches ModalShell content padding so it sits
              // flush against the bottom edge of the scroll area.
              bottom: -18,
              marginTop: 4,
              marginLeft: -16,
              marginRight: -16,
              padding: "12px 16px",
              background: "var(--surface)",
              borderTop: "1px solid var(--border)",
              boxShadow: "0 -6px 12px rgba(15,12,6,0.06)",
              zIndex: 5,
            }}
          >
            <button
              type="submit"
              className="primary-button"
              disabled={
                !carvingItemId || (effectiveIsPair && !carvingItemBId)
              }
              style={{
                width: "100%",
                fontSize: 15,
                padding: "14px 16px",
                fontWeight: 800,
                opacity:
                  !carvingItemId || (effectiveIsPair && !carvingItemBId)
                    ? 0.5
                    : 1,
              }}
            >
              {effectiveIsPair ? "▶ Load both heads" : "▶ Load now"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

// 3D card for the load-modal slab picker. Reuses SlabThumb for the
// proportional preview. Selected state lights the border in gold.
function SlabPickerCard({
  job,
  selected,
  onSelect,
  stoneTypes,
}: {
  job: CarvingJobLite;
  selected: boolean;
  onSelect: () => void;
  stoneTypes: StoneTypeDef[];
}) {
  const isUrgent = job.urgency === "urgent";
  const isLathe = job.requires_machine_type === "lathe";
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left",
        padding: 8,
        background: selected ? "rgba(180,115,51,0.10)" : "var(--surface)",
        border: `2px solid ${selected ? "var(--gold-dark)" : "var(--border)"}`,
        borderRadius: 8,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "border-color 0.12s, background 0.12s",
      }}
    >
      {/* 3D thumb */}
      {job.slab && (
        <SlabThumb
          stone={job.slab.stone}
          l={job.slab.length_in}
          w={job.slab.width_in}
          t={job.slab.thickness_in}
          stoneTypes={stoneTypes}
          size={70}
          height={70}
        />
      )}
      {/* Chips */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {isUrgent && (
          <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 3, background: "#dc2626", color: "#fff", letterSpacing: "0.05em" }}>
            ⚡ URGENT
          </span>
        )}
        {isLathe && (
          <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 3, background: "rgba(124,58,237,0.15)", color: "#7c3aed", letterSpacing: "0.05em" }}>
            🌀 LATHE
          </span>
        )}
      </div>
      {/* Slab id + temple + dims */}
      <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--text)" }}>
        {job.slab_id}
      </div>
      {job.slab && (
        <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.3 }}>
          {job.slab.temple}
          <div style={{ marginTop: 2 }}>{dimStr(job.slab)}</div>
        </div>
      )}
    </button>
  );
}

function CompleteModal({
  machine,
  job,
  onClose,
}: {
  machine: CncMachineLive;
  job: CarvingJobLite;
  onClose: () => void;
}) {
  const [tempLocation, setTempLocation] = useState("");

  return (
    <ModalShell
      title="Mark complete + unload"
      subtitle={`Machine ${machine.machine_code} · ${job.slab_id}`}
      onClose={onClose}
    >
      <form action={completeAndUnloadAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormPendingOverlay label="Marking complete…" />
        <input type="hidden" name="carving_item_id" value={job.id} />

        {job.slab && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
          >
            <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
              {job.slab_id}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {job.slab.temple} · {dimStr(job.slab)}
            </div>
          </div>
        )}

        <div>
          <Label>Where is the slab now? *</Label>
          <input
            type="text"
            name="temporary_location"
            required
            autoFocus
            value={tempLocation}
            onChange={(e) => setTempLocation(e.target.value)}

            style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
          />
          <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 4 }}>
            Required so the team can find it for review. You can edit this later.
          </div>
        </div>

        <button type="submit" className="primary-button" style={{ fontSize: 14, padding: "12px 16px", fontWeight: 700 }}>
          ✓ Mark complete + unload
        </button>
      </form>
    </ModalShell>
  );
}

function MaintenanceModal({
  machine,
  onClose,
}: {
  machine: CncMachineLive;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [detail, setDetail] = useState<string>("");

  return (
    <ModalShell
      title="Flag for maintenance"
      subtitle={`Machine ${machine.machine_code} will go offline.`}
      onClose={onClose}
    >
      <form action={flagMaintenanceAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormPendingOverlay label="Flagging maintenance…" />
        <input type="hidden" name="cnc_machine_id" value={machine.id} />

        <div>
          <Label>Reason</Label>
          <input type="hidden" name="reason" value={reason} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {MAINTENANCE_REASONS.map((r) => {
              const isSelected = reason === r.value;
              return (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setReason(r.value)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    background: isSelected ? "rgba(220,38,38,0.06)" : "var(--surface)",
                    border: `1.5px solid ${isSelected ? "#dc2626" : "var(--border)"}`,
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: isSelected ? 700 : 500,
                    color: "var(--text)",
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Detail (optional)</Label>
          <textarea
            name="detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            placeholder="Anything specific the office should know"
            style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <button
          type="submit"
          className="primary-button"
          disabled={!reason}
          style={{
            fontSize: 14,
            padding: "12px 16px",
            fontWeight: 700,
            background: "#dc2626",
            opacity: reason ? 1 : 0.5,
          }}
        >
          🔧 Flag maintenance
        </button>
      </form>
    </ModalShell>
  );
}

// ── Problem / transfer modal ────────────────────────────────────
//
// Opens when the operator clicks "⚠ Problem / transfer" on a
// running machine card. Lets them pick a reason and either bounce
// the slab back into their own queue (broken / carving issue /
// design problem / other) OR transfer it to another vendor.
//
// On a 2-head pair load this acts on JUST the picked slab — the
// partner keeps running on the other head. Server action
// unloadWithProblemAction handles the machine state correctly
// (machine stays 'carving' as long as one slab is still on it).
function ProblemModal({
  job,
  otherVendorsForTransfer,
  currentVendorId: _currentVendorId,
  onClose,
}: {
  job: CarvingJobLite;
  otherVendorsForTransfer: Vendor[];
  currentVendorId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [transferVendorId, setTransferVendorId] = useState<string>("");

  const requiresNotes = reason === "other" || reason === "broken_slab";
  const requiresVendorPick = reason === "needs_transfer";
  const canSubmit =
    !!reason &&
    (!requiresNotes || notes.trim().length >= 3) &&
    (!requiresVendorPick || !!transferVendorId);

  return (
    <ModalShell
      title="⚠ Problem with this slab"
      subtitle={`${job.slab_id}${job.slab ? ` · ${job.slab.temple}` : ""}`}
      onClose={onClose}
    >
      <form action={unloadWithProblemAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormPendingOverlay label="Saving problem…" />
        <input type="hidden" name="carving_item_id" value={job.id} />
        <input type="hidden" name="redirect_to" value="/vendor" />

        <div>
          <Label>What&apos;s wrong?</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { v: "broken_slab", label: "🪨 Broken slab", help: "Cracked or chipped — can't continue. Team will triage." },
              { v: "carving_problem", label: "🛠 Carving problem", help: "Tool wear, run-out, mis-cut. Slab returns to your stock." },
              { v: "design_problem", label: "📐 Design problem", help: "Wrong file / toolpath. Slab returns to your stock." },
              { v: "needs_transfer", label: "↔ Needs transfer", help: "Hand off to another vendor (overbooked, wrong machine type, etc)." },
              { v: "other", label: "⚠ Other", help: "Anything else — notes required." },
            ].map((opt) => {
              const checked = reason === opt.v;
              return (
                <label
                  key={opt.v}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    background: checked ? "rgba(220,38,38,0.06)" : "var(--surface)",
                    border: `1.5px solid ${checked ? "rgba(220,38,38,0.5)" : "var(--border)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={opt.v}
                    checked={checked}
                    onChange={() => setReason(opt.v)}
                    style={{ marginTop: 2, cursor: "pointer", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{opt.help}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Transfer-destination picker — only when reason is needs_transfer */}
        {requiresVendorPick && (
          <div>
            <Label>Transfer to</Label>
            <select
              name="new_vendor_id"
              value={transferVendorId}
              onChange={(e) => setTransferVendorId(e.target.value)}
              required
              style={{
                fontSize: 13,
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg)",
                color: "var(--text)",
                width: "100%",
              }}
            >
              <option value="">Pick a vendor…</option>
              {otherVendorsForTransfer.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.vendor_type === "Manual" ? " (Manual)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label>Notes {requiresNotes && <span style={{ color: "#dc2626" }}>(required)</span>}</Label>
          <textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={
              reason === "broken_slab"
                ? "What broke? e.g. cracked along grain near corner"
                : reason === "carving_problem"
                  ? "What went wrong? e.g. tool snapped at 40%"
                  : reason === "design_problem"
                    ? "What's wrong with the design? e.g. toolpath inverted"
                    : reason === "needs_transfer"
                      ? "Why transfer? e.g. need lathe, our shop overbooked"
                      : "Anything the team should know"
            }
            style={{
              padding: "10px 12px",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--text)",
              resize: "vertical",
              fontFamily: "inherit",
              width: "100%",
            }}
          />
        </div>

        <div
          style={{
            padding: "8px 12px",
            fontSize: 11,
            background: "rgba(180,115,51,0.06)",
            border: "1px dashed rgba(180,115,51,0.3)",
            borderRadius: 6,
            color: "#7c2d12",
          }}
        >
          The machine state will update automatically: if this slab&apos;s
          partner is still running on the other head, the machine stays
          carving for the partner. Otherwise the machine flips to idle.
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              flex: 1,
              fontSize: 14,
              padding: "12px 18px",
              fontWeight: 700,
              background: canSubmit ? "#dc2626" : "var(--surface-alt)",
              color: canSubmit ? "#fff" : "var(--muted)",
              border: "none",
              borderRadius: 8,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            ⚠ Unload with this reason
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditLocationModal({
  itemId,
  slabId,
  currentLocation,
  onClose,
}: {
  itemId: string;
  slabId: string;
  currentLocation: string | null;
  onClose: () => void;
}) {
  const [loc, setLoc] = useState(currentLocation ?? "");

  return (
    <ModalShell
      title="Update slab location"
      subtitle={slabId}
      onClose={onClose}
    >
      <form action={updateTemporaryLocationAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input type="hidden" name="carving_item_id" value={itemId} />
        <div>
          <Label>Where is the slab now?</Label>
          <input
            type="text"
            name="temporary_location"
            autoFocus
            value={loc}
            onChange={(e) => setLoc(e.target.value)}

            style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
          />
        </div>
        <button type="submit" className="primary-button" style={{ fontSize: 14, padding: "12px 16px", fontWeight: 700 }}>
          Save
        </button>
      </form>
    </ModalShell>
  );
}

// ── Tiny presentational helpers ────────────────────────────────────

/** Mig 081 follow-on (Daksh) — used by the LoadModal's Pair card
 *  to reveal the hidden Mismatch mode tile on long-press. Falls
 *  through to onTap on a normal click (release before LONG_PRESS_MS).
 *  Cancels the long-press if the user moves their pointer out of
 *  the button before the timer fires — same behaviour as native
 *  long-press on iOS / Android.
 *
 *  Mig 081 round 2 (Daksh) — bumped to 4-second hold + added an
 *  inline progress bar so the user gets visible feedback while the
 *  timer is running. Without that affordance a 4-second press felt
 *  broken; with it, the bar reads as "the system is registering my
 *  press, keep holding" and the dangerous flow stays deliberate.
 */
const LONG_PRESS_MS = 4000;

function LongPressableModeButton({
  onTap,
  onLongPress,
  active,
  activeBg,
  activeBorder,
  activeFg,
  ariaLabel,
  children,
}: {
  onTap: () => void;
  onLongPress: () => void;
  active: boolean;
  activeBg: string;
  activeBorder: string;
  activeFg: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);
  // Progress driver — rAF loop. progress in [0..1]. null = not
  // pressing, just resting state.
  const [progress, setProgress] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pressStartRef = useRef<number>(0);

  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setProgress(null);
  };

  const startProgressLoop = () => {
    pressStartRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - pressStartRef.current;
      const pct = Math.min(1, elapsed / LONG_PRESS_MS);
      setProgress(pct);
      if (pct < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={() => {
        longFiredRef.current = false;
        cancel();
        startProgressLoop();
        timerRef.current = setTimeout(() => {
          longFiredRef.current = true;
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          setProgress(null);
          onLongPress();
        }, LONG_PRESS_MS);
      }}
      onPointerUp={() => {
        // If the long-press timer didn't fire, treat as a tap.
        const wasLong = longFiredRef.current;
        cancel();
        if (!wasLong) onTap();
      }}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        // Suppress the iOS / mobile long-press context menu so it
        // doesn't fight with our handler.
        e.preventDefault();
      }}
      style={{
        position: "relative",
        flex: "1 1 200px",
        padding: "10px 14px",
        fontSize: 13,
        fontWeight: 700,
        background: active ? activeBg : "var(--surface)",
        border: `1.5px solid ${active ? activeBorder : "var(--border)"}`,
        color: active ? activeFg : "var(--text)",
        borderRadius: 6,
        cursor: "pointer",
        textAlign: "left",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        overflow: "hidden",
      }}
    >
      {children}
      {/* Hold-progress overlay — shown only during an in-flight
          press. Fills bottom-to-top in a red wash so it can't be
          confused with the active-state tints (blue / gold). The
          remaining-seconds counter sits in the top-right corner so
          the vendor can pace the hold. */}
      {progress !== null && progress < 1 && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: `${Math.round(progress * 100)}%`,
              background:
                "linear-gradient(0deg, rgba(220,38,38,0.22) 0%, rgba(220,38,38,0.06) 100%)",
              pointerEvents: "none",
              transition: "height 0.05s linear",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 6,
              right: 8,
              fontSize: 10,
              fontWeight: 800,
              color: "#b91c1c",
              fontFamily: "ui-monospace, monospace",
              padding: "1px 6px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.85)",
              border: "1px solid rgba(220,38,38,0.35)",
              letterSpacing: "0.05em",
              pointerEvents: "none",
            }}
          >
            HOLD · {Math.max(0, Math.ceil((1 - progress) * (LONG_PRESS_MS / 1000)))}s
          </div>
        </>
      )}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

// ── Machine history modal ──────────────────────────────────────────
//
// Lazy-loads from the server action when opened. Shows top-line
// totals (carving / down / sessions / maint episodes) for the last
// 30d and a chronological event timeline beneath.
function MachineHistoryModal({
  machine,
  onClose,
}: {
  machine: CncMachineLive;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<MachineHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMachineHistory(machine.id, 30)
      .then((h) => {
        if (cancelled) return;
        if (!h) setError("Machine not found");
        else setHistory(h);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [machine.id]);

  return (
    <ModalShell
      title={`📊 ${machine.machine_code} · history`}
      subtitle="Last 30 days · sessions, maintenance, totals"
      onClose={onClose}
    >
      {loading ? (
        <div className="muted" style={{ fontSize: 13, padding: 24, textAlign: "center" }}>
          Loading history…
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.25)",
            color: "#991b1b",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : history ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Totals strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 10,
            }}
          >
            <HistoryStat label="Carving time" value={fmtDuration(history.totals.carvingMinutes)} fg="#1d4ed8" />
            <HistoryStat label="Sessions" value={String(history.totals.sessions)} fg="#1d4ed8" />
            <HistoryStat label="Down time" value={fmtDuration(history.totals.maintMinutes)} fg="#b91c1c" />
            <HistoryStat label="Maint episodes" value={String(history.totals.maintEpisodes)} fg="#b91c1c" />
          </div>

          {/* Event timeline */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}
            >
              Timeline · {history.events.length} event{history.events.length !== 1 ? "s" : ""}
            </div>
            {history.events.length === 0 ? (
              <div
                style={{
                  padding: "16px 12px",
                  textAlign: "center",
                  color: "var(--muted-light)",
                  fontSize: 12,
                  background: "var(--surface-alt)",
                  borderRadius: 8,
                }}
              >
                No events recorded in the last 30 days.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {history.events.map((e) => (
                  <HistoryEventRow key={e.id} event={e} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}

function HistoryStat({ label, value, fg }: { label: string; value: string; fg: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: fg, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function HistoryEventRow({ event }: { event: MachineHistory["events"][number] }) {
  const cfg: Record<string, { icon: string; label: string; color: string }> = {
    loaded: { icon: "▶", label: "Loaded", color: "#1d4ed8" },
    unloaded: { icon: "✓", label: "Unloaded", color: "#15803d" },
    maintenance_start: { icon: "🔧", label: "Maintenance start", color: "#b91c1c" },
    maintenance_end: { icon: "✓", label: "Back online", color: "#15803d" },
    created: { icon: "+", label: "Machine created", color: "var(--muted)" },
    reactivated: { icon: "↻", label: "Reactivated", color: "var(--muted)" },
    deactivated: { icon: "—", label: "Deactivated", color: "var(--muted)" },
  };
  const c = cfg[event.event_type] ?? { icon: "•", label: event.event_type.replace(/_/g, " "), color: "var(--muted)" };
  const when = new Date(event.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "8px 10px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          fontSize: 14,
          color: c.color,
          fontWeight: 800,
          flexShrink: 0,
          width: 22,
          textAlign: "center",
        }}
      >
        {c.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: c.color }}>{c.label}</span>
          <span
            style={{
              fontSize: 10,
              color: "var(--muted)",
              fontFamily: "ui-monospace, monospace",
              whiteSpace: "nowrap",
            }}
          >
            {when}
          </span>
        </div>
        {event.slab_id && (
          <div style={{ fontSize: 11, color: "var(--text)", marginTop: 2 }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
              {event.slab_id}
            </span>
          </div>
        )}
        {event.reason && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            Reason: <strong style={{ color: "var(--text)" }}>{event.reason}</strong>
          </div>
        )}
        {event.message && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>
            {event.message}
          </div>
        )}
        {event.user_name && (
          <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 2 }}>
            by {event.user_name}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Hold modal (mig 069) ────────────────────────────────────────
//
// Healthy-path mid-carve pause. Four canonical reasons + an Other.
// Submits to holdSlabOnVendorAction; the slab vanishes from the
// machine card and appears in the On Hold tray.
function HoldModal({
  job,
  onClose,
}: {
  job: CarvingJobLite;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const requiresNotes = reason === "other";
  const canSubmit =
    !!reason && (!requiresNotes || notes.trim().length >= 3);

  return (
    <ModalShell
      title="⏸ Hold this slab"
      subtitle={`${job.slab_id}${job.slab ? ` · ${job.slab.temple}` : ""}`}
      onClose={onClose}
    >
      <form
        action={holdSlabOnVendorAction}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <FormPendingOverlay label="Holding slab…" />
        <input type="hidden" name="carving_item_id" value={job.id} />
        <input type="hidden" name="redirect_to" value="/vendor" />

        <div>
          <Label>Why are you parking it?</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              {
                v: "two_side_flip",
                label: "🔄 Flip & carve other side",
                help: "Side 1 done. Free the machine for another slab; reload to flip later.",
              },
              {
                v: "no_power",
                label: "⚡ No power / scheduling",
                help: "Can't keep this CNC running right now. Park and reload when ready.",
              },
              {
                v: "tool_change",
                label: "🛠 Tool change",
                help: "Need a different bit. Reload after the swap.",
              },
              {
                v: "other",
                label: "⏸ Other reason",
                help: "Anything else — notes required.",
              },
            ].map((opt) => {
              const checked = reason === opt.v;
              return (
                <label
                  key={opt.v}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    background: checked
                      ? "rgba(167,139,250,0.10)"
                      : "var(--surface)",
                    border: `1.5px solid ${
                      checked ? "rgba(167,139,250,0.55)" : "var(--border)"
                    }`,
                    borderRadius: 8,
                    cursor: "pointer",
                    touchAction: "manipulation",
                  }}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={opt.v}
                    checked={checked}
                    onChange={() => setReason(opt.v)}
                    style={{ marginTop: 2, cursor: "pointer", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: "var(--text)",
                      }}
                    >
                      {opt.label}
                    </div>
                    <div
                      style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}
                    >
                      {opt.help}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <Label>
            Notes{" "}
            {requiresNotes && (
              <span style={{ color: "#dc2626" }}>(required)</span>
            )}
          </Label>
          <textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={
              reason === "two_side_flip"
                ? "e.g. side-1 carved, flip for back side later"
                : reason === "no_power"
                  ? "e.g. waiting on diesel delivery 6pm"
                  : reason === "tool_change"
                    ? "e.g. swapping to 6mm ball for finishing pass"
                    : "What's going on?"
            }
            style={{
              padding: "10px 12px",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--text)",
              resize: "vertical",
              fontFamily: "inherit",
              width: "100%",
            }}
          />
        </div>

        <div
          style={{
            padding: "8px 12px",
            fontSize: 11,
            background: "rgba(167,139,250,0.08)",
            border: "1px dashed rgba(167,139,250,0.4)",
            borderRadius: 6,
            color: "#5b21b6",
          }}
        >
          The machine will go idle (or stay carving if a partner is
          still on the other head). Find this slab later in the{" "}
          <strong>⏸ On hold</strong> tile.
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              flex: 1,
              padding: "12px 16px",
              fontSize: 14,
              fontWeight: 700,
              background: canSubmit ? "#7c3aed" : "var(--surface-alt)",
              color: canSubmit ? "#fff" : "var(--muted)",
              border: `1.5px solid ${canSubmit ? "#6d28d9" : "var(--border)"}`,
              borderRadius: 8,
              cursor: canSubmit ? "pointer" : "not-allowed",
              minHeight: 48,
              touchAction: "manipulation",
            }}
          >
            ⏸ Hold this slab
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ghost-button"
            style={{ padding: "12px 16px", fontSize: 13 }}
          >
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
