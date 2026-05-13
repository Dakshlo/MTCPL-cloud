"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadSlabOnMachineAction,
  loadTwoSlabsOnMultiHeadAction,
  completeAndUnloadAction,
  flagMaintenanceAction,
  resolveMaintenanceAction,
  updateTemporaryLocationAction,
  acknowledgeReceiptAction,
  unloadWithProblemAction,
  getMachineHistory,
  type MachineHistory,
} from "../carving/actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { batchTint } from "@/lib/batch-colours";

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

// Each status has its own visual identity so a glance across the
// cockpit immediately reads the floor. Idle stays low-key (no
// information to act on); carving is the most prominent (the floor's
// active work); maintenance pops red so it can't be missed.
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
    bgAccent: "rgba(22,163,74,0.06)",
    border: "var(--border)",
    accent: "#16a34a",
    fg: "#15803d",
    label: "FREE",
    icon: "○",
  },
  carving: {
    bg: "linear-gradient(180deg, rgba(37,99,235,0.12) 0%, rgba(37,99,235,0.05) 100%)",
    bgAccent: "rgba(37,99,235,0.18)",
    border: "rgba(37,99,235,0.55)",
    accent: "#2563eb",
    fg: "#1d4ed8",
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
  recent,
  otherVendors,
  isStaffView,
  toast,
  stoneTypes,
}: {
  vendor: Vendor;
  machines: CncMachineLive[];
  queue: CarvingJobLite[];
  recent: Array<{
    id: string;
    slab_id: string;
    completed_at: string | null;
    temporary_location: string | null;
    review_approved_at: string | null;
    review_notes: string | null;
    slab: SlabLite | null;
  }>;
  otherVendors: Vendor[];
  isStaffView: boolean;
  toast: string | null;
  /** Stone palette for the 3D slab thumbs on machine cards + queue rows. */
  stoneTypes: StoneTypeDef[];
}) {
  const router = useRouter();
  const [now, setNow] = useState<number>(Date.now());

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

  // After a server-action redirects back to /vendor with a
  // success toast (e.g. "Slab loaded", "Both slabs loaded",
  // "Marked complete"), close any open modal so the user sees the
  // refreshed cockpit grid. Without this the LoadModal stays open
  // showing "No slabs ready to load" because the slab it was for
  // is no longer in the queue — confusing.
  useEffect(() => {
    if (!toast) return;
    const lower = toast.toLowerCase();
    const successy =
      lower.includes("loaded") ||
      lower.includes("marked complete") ||
      lower.includes("marked received") ||
      lower.includes("flagged") ||
      lower.includes("back online") ||
      lower.includes("location saved");
    if (successy) {
      setLoadFor(null);
      setCompleteFor(null);
      setMaintenanceFor(null);
      setEditLocFor(null);
      setProblemFor(null);
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

  return (
    <div style={{ paddingBottom: 80 }}>
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
              onChange={(e) => router.push(`/vendor?vendor_id=${e.target.value}`)}
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
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <Stat label="Idle" value={totals.idle} fg="#22c55e" />
          <Stat label="Carving" value={totals.carving} fg="#60a5fa" />
          <Stat label="Maintenance" value={totals.maintenance} fg="#f87171" />
          <Stat label="Pending stock" value={pendingStock.length} fg="#fbbf24" />
          <Stat label="Ready to load" value={readyToLoad.length} fg="#fbbf24" />
        </div>
      </div>

      {/* Pending stock — slabs assigned but not yet delivered to
          this vendor's shade. Read-only view; transfer person
          handles delivery on /carving/transfer. Collapsed by
          default — vendor doesn't act on these. Migration 023/025. */}
      <Section
        title="Pending stock"
        subtitle={
          pendingStock.length === 0
            ? "No slabs awaiting transfer to your shade."
            : `${pendingStock.length} slab${pendingStock.length !== 1 ? "s" : ""} being transferred from the yard`
        }
        collapsible
        defaultOpen={false}
      >
        {pendingStock.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingStock.map((job) => (
              <PendingStockRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </Section>

      {/* Ready to load — slabs physically at the shade, ready for a
          CNC. Collapsible at user's request; defaults to OPEN since
          this is the actionable list (Load button lives here). */}
      <Section
        title="Ready to load"
        subtitle={`${readyToLoad.length} slab${readyToLoad.length !== 1 ? "s" : ""} ready to load on a CNC`}
        collapsible
        defaultOpen
      >
        {readyToLoad.length === 0 ? (
          <Empty text={pendingStock.length > 0 ? "Waiting for the transfer runner to deliver. See Pending stock above." : "Queue is clear. Carving head will assign more as slabs become available."} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {readyToLoad.map((job) => (
              <QueueRow
                key={job.id}
                job={job}
                hasIdleMachine={totals.idle > 0}
                onLoad={() => {
                  // Pick first idle machine as the default selection
                  const firstIdle = machines.find((m) => m.status === "idle");
                  if (firstIdle) setLoadFor({ machine: firstIdle });
                }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Machine grid */}
      <Section title="Machines" subtitle={`${machines.length} CNC${machines.length !== 1 ? "s" : ""}`}>
        {machines.length === 0 ? (
          <Empty text="No machines configured for this vendor. Add some in Manage Vendors." />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {machines.map((m) => (
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
                stoneTypes={stoneTypes}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Recent completed */}
      {recent.length > 0 && (
        <Section
          title="Recently completed"
          subtitle="Last 10 unloaded — awaiting team review unless approved"
          collapsible
          defaultOpen={false}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recent.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: "10px 12px",
                  background: r.review_notes
                    ? "rgba(220,38,38,0.05)"
                    : r.review_approved_at
                      ? "rgba(22,163,74,0.05)"
                      : "var(--surface)",
                  border: `1px solid ${r.review_notes ? "rgba(220,38,38,0.2)" : "var(--border)"}`,
                  borderRadius: 8,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
                    {r.slab_id}
                  </div>
                  {r.slab && (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {r.slab.temple} · {dimStr(r.slab)}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 2 }}>
                    📍 {r.temporary_location ?? "—"}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {r.review_approved_at ? (
                    <span style={{ color: "#15803d", fontWeight: 600 }}>✔ approved</span>
                  ) : r.review_notes ? (
                    <span style={{ color: "#b91c1c", fontWeight: 600 }}>✗ rejected</span>
                  ) : (
                    "in review"
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditLocFor({
                      id: r.id,
                      slab_id: r.slab_id,
                      temporary_location: r.temporary_location,
                    })
                  }
                  className="ghost-button"
                  style={{ fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
                >
                  Edit location
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Modals ── */}
      {loadFor && (
        <LoadModal
          machine={loadFor.machine}
          machines={machines}
          /* Only "ready to load" rows can actually be loaded — pending
             stock is in transit. Phase 4 follow-up. */
          queue={readyToLoad}
          stoneTypes={stoneTypes}
          onClose={() => setLoadFor(null)}
        />
      )}
      {completeFor && completeFor.current_jobs[0] && (
        <CompleteModal
          machine={completeFor}
          job={completeFor.current_jobs[0]}
          onClose={() => setCompleteFor(null)}
        />
      )}
      {maintenanceFor && (
        <MaintenanceModal machine={maintenanceFor} onClose={() => setMaintenanceFor(null)} />
      )}
      {historyFor && (
        <MachineHistoryModal machine={historyFor} onClose={() => setHistoryFor(null)} />
      )}
      {editLocFor && (
        <EditLocationModal
          itemId={editLocFor.id}
          slabId={editLocFor.slab_id}
          currentLocation={editLocFor.temporary_location}
          onClose={() => setEditLocFor(null)}
        />
      )}
      {problemFor && (
        <ProblemModal
          job={problemFor}
          otherVendorsForTransfer={otherVendors}
          currentVendorId={vendor.id}
          onClose={() => setProblemFor(null)}
        />
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
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2>
        {subtitle && (
          <span className="muted" style={{ fontSize: 12 }}>
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

function Stat({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div
      style={{
        padding: "8px 14px",
        background: "rgba(255,255,255,0.08)",
        borderRadius: 8,
        minWidth: 64,
      }}
    >
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: fg, lineHeight: 1.1, marginTop: 2 }}>
        {value}
      </div>
    </div>
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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "rgba(217,119,6,0.04)",
        border: "1px dashed rgba(217,119,6,0.4)",
        borderLeft: tint
          ? `5px solid ${tint.border}`
          : "1px dashed rgba(217,119,6,0.4)",
        borderRadius: 8,
        flexWrap: "wrap",
      }}
      title={tint ? "Part of a batch — these slabs were assigned together" : undefined}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isUrgent && (
            <span
              style={{
                fontSize: 10, fontWeight: 800, padding: "2px 8px",
                borderRadius: 999, background: "#dc2626", color: "#fff",
                letterSpacing: "0.05em",
              }}
            >
              ⚡ URGENT
            </span>
          )}
          {isLathe && (
            <span
              style={{
                fontSize: 9, fontWeight: 800, padding: "2px 6px",
                borderRadius: 3, background: "rgba(124,58,237,0.15)",
                color: "#7c3aed", letterSpacing: "0.05em",
              }}
              title="Cylindrical — lathe required"
            >
              🌀 LATHE
            </span>
          )}
          <span
            style={{
              fontSize: 9, fontWeight: 800, padding: "2px 6px",
              borderRadius: 3, background: "rgba(217,119,6,0.18)",
              color: "#b45309", letterSpacing: "0.05em",
            }}
          >
            🚚 IN TRANSIT
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
        {job.slab?.stock_location && (
          <div
            style={{
              fontSize: 11, color: "#7c2d12", marginTop: 2,
              fontFamily: "ui-monospace, monospace", fontWeight: 700,
            }}
          >
            📍 Currently at: {job.slab.stock_location}
          </div>
        )}
        <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 4 }}>
          Transfer runner will deliver to your shade. Click ✅ Mark received once it arrives.
        </div>
      </div>
    </div>
  );
}

// ── Queue row ───────────────────────────────────────────────────────

function QueueRow({
  job,
  hasIdleMachine,
  onLoad,
}: {
  job: CarvingJobLite;
  hasIdleMachine: boolean;
  onLoad: () => void;
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
        {job.note && (
          <div style={{ fontSize: 11, color: "var(--text)", marginTop: 4, fontStyle: "italic" }}>
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
      </div>
    </div>
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
        remainingColor = remaining <= 15 ? "#b45309" : "#1d4ed8";
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

  // Lathe machines get a heavily-rounded pill shape so they're
  // unmistakable next to the rectangular CNC cards on the cockpit
  // grid. We can't make the whole card a true circle (way too much
  // content — header, slab thumb, action buttons), but a 28px
  // border-radius is round enough to read as "the rounder one =
  // lathe" at a glance.
  const isLathe = machine.machine_type === "lathe";
  return (
    <div
      style={{
        padding: 0,
        background: tint.bg,
        border: `2px solid ${tint.border}`,
        borderRadius: isLathe ? 28 : 10,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        // Carving cards lift slightly to telegraph "this is active work"
        boxShadow:
          machine.status === "carving"
            ? "0 4px 14px rgba(37,99,235,0.18)"
            : machine.status === "maintenance"
              ? "0 4px 14px rgba(220,38,38,0.18)"
              : "none",
      }}
    >
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
                  <div style={{ flexShrink: 0 }}>
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
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#2563eb" }}>
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
                        background: "rgba(37,99,235,0.15)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${progressPct}%`,
                          background: progressPct > 100 ? "#dc2626" : "#2563eb",
                          transition: "width 0.5s",
                        }}
                      />
                    </div>
                  )}
                  {/* Per-slab Problem button — opens a modal where
                      the operator can flag (broken, design issue) or
                      request a transfer. Stops propagation so the
                      card click doesn't fire. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onProblem(slabJob);
                    }}
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      padding: "5px 10px",
                      background: "rgba(220,38,38,0.08)",
                      color: "#991b1b",
                      border: "1px solid rgba(220,38,38,0.3)",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                    title="Flag a problem (broken slab / carving issue) or transfer this slab to another vendor"
                  >
                    ⚠ Problem / transfer this slab
                  </button>
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
          </>
        )}

        {machine.status === "maintenance" && (
          <>
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
                Flagged {new Date(machine.maintenance_flagged_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
          <form
            action={resolveMaintenanceAction}
            onSubmit={(e) => {
              if (!confirm(`Mark ${machine.machine_code} as back online?`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="cnc_machine_id" value={machine.id} />
            <button
              type="submit"
              className="primary-button"
              style={{ fontSize: 13, padding: "10px 14px", fontWeight: 700, width: "100%" }}
            >
              ✓ Back online
            </button>
          </form>
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc closes
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
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 0 0 0",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px 12px 0 0",
          boxShadow: "0 -18px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: 520,
          maxHeight: "92vh",
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
  // For 2-head machines, the vendor can choose pair mode (default,
  // both heads running on identical slabs) OR single mode (only one
  // head loaded, second turned off — rare but real). Single mode
  // routes through loadSlabOnMachineAction, pair mode through
  // loadTwoSlabsOnMultiHeadAction.
  const [loadMode, setLoadMode] = useState<"pair" | "single">("pair");
  const effectiveIsPair = machineIsTwoHead && loadMode === "pair";

  const [carvingItemId, setCarvingItemId] = useState<string>(queue[0]?.id ?? "");
  // Second slab id for 2-head pair loads. Filtered to "matches first"
  // so the vendor can't accidentally pair non-identical slabs.
  const [carvingItemBId, setCarvingItemBId] = useState<string>("");
  const selectedJob = queue.find((q) => q.id === carvingItemId) ?? null;
  const idleMachines = machines.filter((m) => m.status === "idle");
  // Days + hours pickers — carving runs span hours to multiple days,
  // so days is a more useful primary unit than minutes.
  const [days, setDays] = useState<string>("");
  const [hours, setHours] = useState<string>("");
  const totalMinutes = (Number(days) || 0) * 60 * 24 + (Number(hours) || 0) * 60;

  // Slabs that match the primary one's L×W×T + temple + label —
  // these are the only valid second-head pairings on a 2-head load.
  const matchingPair = effectiveIsPair && selectedJob?.slab
    ? queue.filter(
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

  // Reset pair selection when primary changes, machine type changes,
  // or the vendor switches between pair and single mode.
  useEffect(() => {
    setCarvingItemBId("");
  }, [carvingItemId, effectiveIsPair]);

  // Switching to a non-2-head machine forces single mode.
  useEffect(() => {
    if (!machineIsTwoHead) setLoadMode("pair"); // benign default; pair logic gated by machineIsTwoHead anyway
  }, [machineIsTwoHead]);

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
          : machineIsTwoHead
            ? "Load 1 slab onto 2-head CNC (single mode)"
            : "Load slab onto CNC"
      }
      subtitle={
        effectiveIsPair
          ? "Both heads carve the same shape — pick two slabs with identical L×W×T + temple + label."
          : machineIsTwoHead
            ? "Second head will be turned off. Pick the slab to load on head 1."
            : "Pick the slab and machine, then enter your tighter ETA."
      }
      onClose={onClose}
    >
      {queue.length === 0 ? (
        <Empty text="No slabs ready to load. Check the Pending stock list — slabs need to be delivered by the transfer runner first." />
      ) : (
        <form
          action={effectiveIsPair ? loadTwoSlabsOnMultiHeadAction : loadSlabOnMachineAction}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
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
              one matching slab. */}
          {machineIsTwoHead && (
            <div>
              <Label>Mode</Label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setLoadMode("pair")}
                  style={{
                    flex: "1 1 200px",
                    padding: "10px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: loadMode === "pair" ? "rgba(37,99,235,0.10)" : "var(--surface)",
                    border: `1.5px solid ${loadMode === "pair" ? "#2563eb" : "var(--border)"}`,
                    color: loadMode === "pair" ? "#1d4ed8" : "var(--text)",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  ▶▶ Pair mode (2 slabs, both heads)
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, fontWeight: 400 }}>
                    Default. Both heads carve identical slabs.
                  </div>
                </button>
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
              </div>
            </div>
          )}

          {/* Primary slab picker — 3D card grid instead of list rows.
              Vendor sees a thumbnail + slab id + temple + dims and
              can tap a card to select. */}
          <div>
            <Label>{effectiveIsPair ? "Slab A (head 1)" : "Slab to load"}</Label>
            <input
              type="hidden"
              name={effectiveIsPair ? "carving_item_a_id" : "carving_item_id"}
              value={carvingItemId}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 8,
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {queue.map((q) => (
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

          {/* Pair picker — only shows when in PAIR mode on a 2-head
              machine. Filtered to slabs that have IDENTICAL geometry
              + temple + label as the primary, since the heads run
              the same toolpath. Single mode skips this entirely. */}
          {effectiveIsPair && (
            <div>
              <Label>Slab B (head 2 — must match A)</Label>
              <input type="hidden" name="carving_item_b_id" value={carvingItemBId} />
              {matchingPair.length === 0 ? (
                <div
                  style={{
                    padding: "8px 12px",
                    background: "rgba(217,119,6,0.06)",
                    border: "1px solid rgba(217,119,6,0.25)",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#b45309",
                  }}
                >
                  No matching slab in the queue. 2-head loads need a second
                  slab with the same dimensions, temple, and label.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                    gap: 8,
                    maxHeight: 280,
                    overflowY: "auto",
                  }}
                >
                  {matchingPair.map((q) => (
                    <SlabPickerCard
                      key={q.id}
                      job={q}
                      selected={q.id === carvingItemBId}
                      onSelect={() => setCarvingItemBId(q.id)}
                      stoneTypes={stoneTypes}
                    />
                  ))}
                </div>
              )}
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

          <button
            type="submit"
            className="primary-button"
            disabled={effectiveIsPair && !carvingItemBId}
            style={{
              fontSize: 14,
              padding: "12px 16px",
              fontWeight: 700,
              opacity: effectiveIsPair && !carvingItemBId ? 0.5 : 1,
            }}
          >
            {effectiveIsPair ? "▶ Load both heads" : "▶ Load now"}
          </button>
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
            placeholder="e.g. Polishing area · Yard 2 · vendor's truck"
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
            placeholder="e.g. Polishing area · Yard 2"
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
  const when = new Date(event.created_at).toLocaleString("en-IN", {
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
