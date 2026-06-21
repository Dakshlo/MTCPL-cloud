"use client";

/**
 * Slab Transfer dispatch UI.
 *
 * Four buckets stacked top-down with strong visual separation so
 * each section reads as its own surface:
 *
 *   1. 🚧 Claimed by me   — BLUE accent. The runner's active work.
 *      Each row: 3D thumb · slab info · From → To route · Mark
 *      delivered (with optional note) · Release claim.
 *
 *   2. 📦 Available       — AMBER accent. Unclaimed pickups.
 *      Each row: 3D thumb · slab info · From → To route · Claim.
 *
 *   3. ✅ Delivered today  — GREEN accent. Last 48h of deliveries
 *      by THIS runner. Collapsed by default — it's there as
 *      success confirmation + history, not an action surface.
 *
 *   4. 👥 Claimed by other runners — MUTED. Hidden when empty.
 *      Awareness only. carving_head + above can release.
 *
 * Mobile-first: From → To layout uses a CSS grid that collapses to
 * a single column on screens under 600px (arrow rotates to point
 * down). All buttons are 44px tap targets minimum.
 */

import { useEffect, useState, useRef, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  claimSlabTransferAction,
  claimSlabTransferBatchAction,
  unclaimSlabTransferAction,
  unclaimSlabTransferBatchAction,
  acknowledgeReceiptAction,
  acknowledgeReceiptBatchAction,
  claimDispatchBatchAction,
  deliverToDispatchBatchAction,
  unclaimDispatchBatchAction,
} from "../actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { batchTint } from "@/lib/batch-colours";

export type TransferRow = {
  id: string;
  slab_id: string;
  temple: string;
  slab_label: string | null;
  slab_description: string | null;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  stock_location: string | null;
  vendor_id: string;
  vendor_name: string;
  vendor_type: "CNC" | "Outsource";
  vendor_dropoff: string | null;
  vendor_phone: string | null;
  urgency: "normal" | "urgent";
  assigned_at: string;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  /** Mig 065 — runners can claim up to 10 slabs in one click;
   *  every slab in the same claim shares this id so the "Claimed
   *  by me" section groups them as one truck-load. */
  claim_batch_id: string | null;
  is_lathe: boolean;
  /** Migration 026 — shared across slabs assigned together in a
   *  bulk assignment. Drives the coloured left stripe so the
   *  runner spots "these came together". */
  batch_id: string | null;
};

export type DeliveredRow = {
  id: string;
  slab_id: string;
  temple: string;
  slab_label: string | null;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  vendor_name: string;
  vendor_dropoff: string | null;
  delivered_at: string;
  dropoff_note: string | null;
  urgency: "normal" | "urgent";
  is_lathe: boolean;
};

// Phase 5 — a carving-done slab waiting to be brought in to its dispatch
// station (the Carving → Dispatch tab).
export type DispatchTransferRow = {
  id: string;
  slab_id: string;
  temple: string;
  slab_label: string | null;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  /** Carving vendor that finished it — the FROM of the dispatch leg. */
  vendor_name: string;
  /** Dispatch station chosen at approval — the TO of the dispatch leg. */
  station_name: string | null;
  ready_at: string | null;
  /** Two-step claim (reuses the cutting→carving claim columns). */
  claimed_by: string | null;
  claim_batch_id: string | null;
  truck_name: string | null;
};

// Single source of truth for the responsive breakpoint. Used by the
// route-visual grid and the button rows so they all collapse at the
// same width.
const MOBILE_CSS = `
  @keyframes mtcpl-transfer-flow {
    0%   { background-position: -40px 0; }
    100% { background-position: 40px 0; }
  }
  @keyframes mtcpl-spin { to { transform: rotate(360deg); } }
  @media (max-width: 600px) {
    .mtcpl-route-grid {
      grid-template-columns: 1fr !important;
      grid-template-rows: auto auto auto;
    }
    .mtcpl-route-arrow {
      transform: rotate(90deg);
      width: 60px !important;
      margin: 0 auto;
    }
  }
`;

export type TruckOption = { id: string; name: string; driver?: string | null; busy: boolean };

// Spinning logo for in-flight actions. `currentColor` so it inherits the
// button's text colour on any accent.
function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "mtcpl-spin 0.7s linear infinite",
        verticalAlign: "-3px",
      }}
    />
  );
}

// Submit button that shows a spinner + disables itself while its server
// action is in flight. Must live INSIDE the <form> (useFormStatus reads
// the nearest form's pending state).
function SubmitSpinnerButton({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      style={{
        ...style,
        opacity: pending ? 0.7 : style?.opacity,
        cursor: pending ? "wait" : style?.cursor,
      }}
    >
      {pending ? <Spinner /> : children}
    </button>
  );
}

export function TransferDispatchList({
  rows,
  delivered,
  currentUserId,
  canUnclaimOthers,
  stoneTypes,
  trucks,
  dispatchRows,
  initialTab = "carving",
  toast,
}: {
  rows: TransferRow[];
  delivered: DeliveredRow[];
  currentUserId: string;
  canUnclaimOthers: boolean;
  stoneTypes: StoneTypeDef[];
  /** Mig 144 — fleet for the claim truck picker; `busy` = carrying an
   *  active undelivered claim already. */
  trucks: TruckOption[];
  /** Phase 5 — carving-done slabs awaiting the carving→dispatch bring-in. */
  dispatchRows: DispatchTransferRow[];
  /** Phase 5 — which tab to open first (from ?tab=). */
  initialTab?: "carving" | "dispatch";
  toast: string | null;
}) {
  const router = useRouter();
  // Phase 5 — two lanes: Cutting→Carving (existing) and Carving→Dispatch.
  const [activeTab, setActiveTab] = useState<"carving" | "dispatch">(initialTab);
  // Selected ids for the Carving→Dispatch "bring in" batch.
  const [dispatchSelected, setDispatchSelected] = useState<Set<string>>(new Set());
  // Mig 144 — truck for the carving→dispatch run. Shares the same fleet
  // (and busy state) as the cutting→carving claim picker.
  const [dispatchTruckName, setDispatchTruckName] = useState("");
  // EN/HI toggle for the floor. The storekeeper has low vision and reads
  // Hindi more easily; the language sticks across reloads via localStorage.
  // t(en, hi) returns the active-language string inline (no separate map).
  const [lang, setLang] = useState<"en" | "hi">("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mtcpl_transfer_lang");
      if (saved === "hi" || saved === "en") setLang(saved);
    } catch {
      /* localStorage blocked — stay on English */
    }
  }, []);
  function setLangPersist(l: "en" | "hi") {
    setLang(l);
    try {
      localStorage.setItem("mtcpl_transfer_lang", l);
    } catch {
      /* ignore */
    }
  }
  const t = (en: string, hi: string) => (lang === "hi" ? hi : en);
  const [toastMsg, setToastMsg] = useState<string | null>(toast);
  // Mig 065 — multi-select state for batch claim. Clearing rules:
  //   • Initial render → empty Set
  //   • Toggle a checkbox → add/remove
  //   • Submit → cleared by full reload (toast triggers nav refresh)
  // Capped at 10 selections (the batch cap); UI grays out further
  // checkboxes once you hit the cap.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const CLAIM_BATCH_MAX = 10;
  // Available section — vendor groups are collapsible (tap the header).
  // Default expanded; collapsing a vendor hides its slab cards.
  // Vendor sections start COLLAPSED (Daksh) — the runner expands the
  // shade they're working. Empty set = every vendor collapsed; a name
  // in the set = that vendor is open.
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  // Daksh — per-batch "Deliver all" expanded mode. Holds claim_batch_ids
  // currently showing the shared dropoff-note input + confirm button.
  // Multiple batches can be expanded at once (different vendors); the
  // Set keeps state local to this component without a per-group hook.
  const [deliverAllOpen, setDeliverAllOpen] = useState<Set<string>>(new Set());
  // Mig 144 — which truck the runner is loading this claim onto. One
  // pick applies to the whole batch; submitted as `truck_name` (the
  // server find-or-creates). Required before claiming.
  const [truckName, setTruckName] = useState("");
  // Compact "Claimed by me" — collapsed to a single tappable card by
  // default; tapping expands the full deliver / release controls.
  const [claimedOpen, setClaimedOpen] = useState(false);
  // Claim-time truck picker. Pressing Claim opens a modal of available
  // trucks (or "claim without truck") instead of an always-on dropdown.
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const claimFormRef = useRef<HTMLFormElement>(null);
  const claimTruckRef = useRef<HTMLInputElement>(null);
  const submitClaimWithTruck = (truck: string) => {
    if (claimTruckRef.current) claimTruckRef.current.value = truck;
    setClaimModalOpen(false);
    setClaimSubmitting(true);
    claimFormRef.current?.requestSubmit();
  };
  // Live ticker for the "⏱ claimed Xm ago" timer on Mine cards.
  // 15-second cadence keeps the display feel real without spamming
  // re-renders — slab transfers are minute-to-hour scale, not seconds.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Auto-clear toast after 4 seconds.
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Strip ?toast=… so reload doesn't replay.
  useEffect(() => {
    if (toast && typeof window !== "undefined" && window.location.search) {
      const url = new URL(window.location.href);
      if (url.searchParams.has("toast")) {
        url.searchParams.delete("toast");
        router.replace(url.pathname + url.search);
      }
    }
  }, [toast, router]);

  // CNC only — Manual vendors don't physically receive slabs.
  const cncRows = rows.filter((r) => r.vendor_type === "CNC");

  const mineRows = cncRows.filter((r) => r.claimed_by === currentUserId);
  const availableRows = cncRows.filter((r) => !r.claimed_by);
  const othersRows = cncRows.filter((r) => r.claimed_by && r.claimed_by !== currentUserId);

  // One-active-claim limit. While the runner has at least one slab
  // claimed (and not yet delivered), all Claim buttons on Available
  // rows are disabled with a hint to finish or release the current
  // one first. Server-side enforcement in claimSlabTransferAction is
  // the source of truth; this is the UX cue so the runner doesn't
  // even try to click.
  const hasActiveClaim = mineRows.length > 0;

  const sortByUrgency = (a: TransferRow, b: TransferRow) => {
    if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
    return new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime();
  };
  mineRows.sort(sortByUrgency);
  availableRows.sort(sortByUrgency);
  othersRows.sort(sortByUrgency);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <style>{MOBILE_CSS}</style>

      {/* EN/HI language toggle — small, top-right. Sticks via localStorage. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ display: "inline-flex", border: "1.5px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
          {(["en", "hi"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLangPersist(l)}
              aria-pressed={lang === l}
              style={{
                padding: "5px 14px",
                fontSize: 14,
                fontWeight: 800,
                border: "none",
                cursor: "pointer",
                background: lang === l ? "#1d4ed8" : "var(--surface)",
                color: lang === l ? "#fff" : "var(--muted)",
              }}
            >
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27 }}>🚧 {t("Slab Transfer", "स्लैब ट्रांसफर")}</h1>
          <p className="muted" style={{ margin: "5px 0 0", fontSize: 15.5 }}>
            {activeTab === "carving"
              ? t("Yard → vendor shade", "यार्ड → वेंडर शेड")
              : t("Carving done → dispatch station", "नक्काशी → डिस्पैच स्टेशन")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {activeTab === "carving" ? (
            <>
              <StatTile label={t("Mine", "मेरे")} value={mineRows.length} fg="#1d4ed8" />
              <StatTile label={t("To claim", "उपलब्ध")} value={availableRows.length} fg="#b45309" />
              <StatTile label={t("Delivered", "पहुँचाया")} value={delivered.length} fg="#15803d" />
            </>
          ) : (
            <StatTile label={t("To bring in", "लाना है")} value={dispatchRows.length} fg="#4f46e5" />
          )}
        </div>
      </div>

      {toastMsg && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            background: "rgba(22,163,74,0.10)",
            border: "1px solid rgba(22,163,74,0.35)",
            color: "#15803d",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          ✓ {toastMsg}
        </div>
      )}

      {/* Carving → Dispatch lane is parked for now (will return); only
          the Cutting → Carving flow renders. activeTab stays "carving". */}
      {activeTab === "carving" && (
        <>
      {/* CLAIMED BY ME — primary actionable section.
          Mig 065 — when multiple slabs share a claim_batch_id, render
          them inside a single batch wrapper with a small header so the
          truck-load reads as one unit. Single-batch claims (or legacy
          NULL-batch rows from before mig 065) render as a group of 1. */}
      {mineRows.length > 0 && (
      <SectionShell
        kind="mine"
        title={t("🚧 Claimed by me", "🚧 मेरे क्लेम किए")}
        subtitle={t(`${mineRows.length} slab(s) to deliver`, `${mineRows.length} स्लैब पहुँचानी है`)}
      >
        {!claimedOpen ? (
          <button
            type="button"
            onClick={() => setClaimedOpen(true)}
            style={{
              width: "100%", textAlign: "left", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px", borderRadius: 12, minHeight: 58,
              background: "rgba(29,78,216,0.06)", border: "1.5px solid #1d4ed8", color: "var(--text)",
            }}
          >
            <span style={{ fontSize: 24 }}>🚚</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: "#1d4ed8" }}>
                {t(`${mineRows.length} slab(s) claimed`, `${mineRows.length} स्लैब क्लेम की`)}
              </span>
              <span style={{ fontSize: 13.5, color: "var(--muted)" }}>
                {t("Tap to deliver or release", "पहुँचाने या छोड़ने के लिए टैप करें")}
              </span>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 18, color: "#1d4ed8", fontWeight: 800 }}>▸</span>
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <button
              type="button"
              onClick={() => setClaimedOpen(false)}
              className="ghost-button"
              style={{ alignSelf: "flex-start", fontSize: 13, padding: "6px 12px" }}
            >
              ▾ {t("Collapse", "बंद करें")}
            </button>
            {(() => {
              // Group mineRows by claim_batch_id (legacy NULL rows
              // become their own per-row "batches").
              type Group = { batchId: string | null; rows: TransferRow[] };
              const groups: Group[] = [];
              const indexByKey = new Map<string, number>();
              for (const r of mineRows) {
                const key = r.claim_batch_id ?? `legacy::${r.id}`;
                const idx = indexByKey.get(key);
                if (idx == null) {
                  indexByKey.set(key, groups.length);
                  groups.push({ batchId: r.claim_batch_id, rows: [r] });
                } else {
                  groups[idx].rows.push(r);
                }
              }
              return groups.map((g, gIdx) => (
                <div
                  key={g.batchId ?? `legacy-${gIdx}`}
                  style={{
                    border: g.rows.length > 1 ? "1.5px solid #1d4ed8" : "none",
                    background: g.rows.length > 1 ? "rgba(29,78,216,0.04)" : "transparent",
                    borderRadius: g.rows.length > 1 ? 12 : 0,
                    padding: g.rows.length > 1 ? "10px 10px 12px" : 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {g.rows.length > 1 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#1d4ed8",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        flexWrap: "wrap",
                      }}
                    >
                      <span>🚛 Batch of {g.rows.length}</span>
                      {g.batchId && (
                        <code
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 10,
                            color: "rgba(29,78,216,0.6)",
                            fontWeight: 600,
                          }}
                        >
                          #{g.batchId.slice(0, 8)}
                        </code>
                      )}
                    </div>
                  )}
                  {/* Daksh — batch-level Release All + Deliver All.
                      Only rendered when the group has more than one
                      slab AND a claim_batch_id is set (legacy NULL-batch
                      rows fall back to per-row controls below). Saves
                      the runner ten clicks when the whole truck-load
                      lands at the same shade. */}
                  {g.rows.length > 1 && g.batchId && (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        padding: "8px 10px",
                        background: "rgba(29,78,216,0.06)",
                        border: "1px dashed rgba(29,78,216,0.35)",
                        borderRadius: 8,
                      }}
                    >
                      {!deliverAllOpen.has(g.batchId) && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setDeliverAllOpen((prev) => {
                                const next = new Set(prev);
                                next.add(g.batchId!);
                                return next;
                              });
                            }}
                            style={{
                              flex: "1 1 180px",
                              fontSize: 16,
                              padding: "12px 18px",
                              fontWeight: 800,
                              background: "#16a34a",
                              color: "#fff",
                              border: "none",
                              borderRadius: 8,
                              cursor: "pointer",
                              minHeight: 48,
                              boxShadow: "0 2px 8px rgba(22,163,74,0.25)",
                            }}
                          >
                            ✅ {t("Deliver all", "सब पहुँचाएँ")} {g.rows.length}
                          </button>
                          <form
                            action={unclaimSlabTransferBatchAction}
                            onSubmit={(e) => {
                              if (
                                !window.confirm(
                                  t(
                                    `Release all ${g.rows.length} slabs back to the yard?\n\nAnother runner can then claim them. Use this if you changed plans or someone else is doing this trip.`,
                                    `सभी ${g.rows.length} स्लैब वापस यार्ड में छोड़ें?\n\nफिर कोई और रनर इन्हें क्लेम कर सकता है। प्लान बदलने या कोई और यह फेरा करने पर इसका उपयोग करें।`,
                                  ),
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="claim_batch_id" value={g.batchId} />
                            <input type="hidden" name="redirect_to" value="/carving/transfer" />
                            <SubmitSpinnerButton
                              className="ghost-button danger-ghost"
                              style={{ fontSize: 15, padding: "12px 16px", minHeight: 48 }}
                            >
                              🛑 {t("Release all", "सब छोड़ें")}
                            </SubmitSpinnerButton>
                          </form>
                        </>
                      )}
                      {deliverAllOpen.has(g.batchId) && (
                        <form
                          action={acknowledgeReceiptBatchAction}
                          onSubmit={(e) => {
                            if (
                              !window.confirm(
                                t(
                                  `Mark all ${g.rows.length} slabs as delivered to ${g.rows[0].vendor_name}?\n\nThis closes the whole batch in one shot.`,
                                  `सभी ${g.rows.length} स्लैब ${g.rows[0].vendor_name} को पहुँचाई हुई मार्क करें?\n\nइससे पूरा बैच एक साथ बंद हो जाएगा।`,
                                ),
                              )
                            ) {
                              e.preventDefault();
                              return;
                            }
                            setDeliverAllOpen((prev) => {
                              const next = new Set(prev);
                              next.delete(g.batchId!);
                              return next;
                            });
                          }}
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "stretch",
                            flex: 1,
                            flexWrap: "wrap",
                          }}
                        >
                          <input type="hidden" name="claim_batch_id" value={g.batchId} />
                          <input type="hidden" name="redirect_to" value="/carving/transfer" />
                          <input
                            type="text"
                            name="dropoff_note"
                            placeholder={t(`Shared dropoff (empty = ${g.rows[0].vendor_dropoff ?? "standard spot"})`, `साझा जगह (खाली = ${g.rows[0].vendor_dropoff ?? "सामान्य जगह"})`)}
                            style={{
                              fontSize: 15,
                              padding: "11px 12px",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              background: "var(--bg)",
                              color: "var(--text)",
                              flex: "1 1 200px",
                              minWidth: 160,
                              minHeight: 48,
                            }}
                          />
                          <SubmitSpinnerButton
                            style={{
                              fontSize: 16,
                              padding: "11px 18px",
                              fontWeight: 800,
                              background: "#16a34a",
                              color: "#fff",
                              border: "none",
                              borderRadius: 8,
                              cursor: "pointer",
                              minHeight: 48,
                            }}
                          >
                            ✅ {t("Deliver all", "सब पहुँचाएँ")} {g.rows.length}
                          </SubmitSpinnerButton>
                          <button
                            type="button"
                            onClick={() =>
                              setDeliverAllOpen((prev) => {
                                const next = new Set(prev);
                                next.delete(g.batchId!);
                                return next;
                              })
                            }
                            className="ghost-button"
                            style={{ fontSize: 14, padding: "11px 14px", minHeight: 48 }}
                          >
                            {t("Cancel", "रद्द")}
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                  {g.rows.map((r) => (
                    <TransferCard
                      key={r.id}
                      row={r}
                      kind="mine"
                      stoneTypes={stoneTypes}
                      now={now}
                      t={t}
                    />
                  ))}
                </div>
              ));
            })()}
          </div>
        )}
      </SectionShell>
      )}

      {/* AVAILABLE — no section header (Daksh): the vendor groups speak
          for themselves. Pick a shade, select slabs, and the Claim bar
          appears only once something is selected. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {availableRows.length === 0 && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            ✓ {t("Yard is clear — nothing pending.", "यार्ड खाली है — कुछ बाकी नहीं।")}
          </p>
        )}
        {hasActiveClaim && availableRows.length > 0 && (
          <div
            style={{
              padding: "10px 12px",
              marginBottom: 10,
              background: "rgba(180,115,51,0.10)",
              border: "1.5px solid rgba(180,115,51,0.4)",
              borderRadius: 8,
              fontSize: 13,
              color: "#7c2d12",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 18 }}>🏗️</span>
            <span style={{ fontSize: 14 }}>
              {t(
                "Finish your current claim first — deliver or release it above.",
                "पहले मौजूदा क्लेम पूरा करें — ऊपर पहुँचाएँ या छोड़ें।",
              )}
            </span>
          </div>
        )}
        {/* Mig 065 — batch claim action bar. Surfaces ONLY once a slab
            is selected (Daksh) and sticks to the top while the runner
            scrolls the vendor list. Claim opens the truck-pick modal. */}
        {!hasActiveClaim && selectedIds.size > 0 && (
          <div
            style={{
              position: "sticky",
              top: 8,
              zIndex: 6,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              background: "#dbeafe",
              border: "1.5px solid #1d4ed8",
              borderRadius: 10,
              flexWrap: "wrap",
              boxShadow: "0 6px 18px rgba(29,78,216,0.18)",
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: "#1d4ed8" }}>
              {t(`${selectedIds.size} / ${CLAIM_BATCH_MAX} selected`, `${selectedIds.size} / ${CLAIM_BATCH_MAX} चुनी`)}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSelectedIds(new Set())}
                style={{ fontSize: 14, padding: "8px 14px", minHeight: 44 }}
              >
                {t("Clear", "हटाएँ")}
              </button>
              {/* The claim posts via this (button-less) form; the truck
                  modal sets the truck on the hidden input + requestSubmit()s
                  it. onSubmit clears the selection optimistically. */}
              <form
                ref={claimFormRef}
                action={claimSlabTransferBatchAction}
                onSubmit={() => setSelectedIds(new Set())}
              >
                <input type="hidden" name="carving_item_ids" value={JSON.stringify([...selectedIds])} />
                <input type="hidden" name="redirect_to" value="/carving/transfer" />
                <input type="hidden" name="truck_name" ref={claimTruckRef} defaultValue="" />
              </form>
              <button
                type="button"
                className="primary-button"
                disabled={claimSubmitting}
                onClick={() => setClaimModalOpen(true)}
                style={{
                  fontSize: 16,
                  padding: "11px 22px",
                  fontWeight: 800,
                  minHeight: 48,
                  opacity: claimSubmitting ? 0.6 : 1,
                  cursor: claimSubmitting ? "wait" : "pointer",
                }}
              >
                {claimSubmitting ? <Spinner /> : <>📦 {t("Claim", "क्लेम")} {selectedIds.size}</>}
              </button>
            </div>
          </div>
        )}
        {/* Mig 065 follow-on (Daksh) — group Available rows by
            carving vendor. Runners drive to one shade at a time;
            seeing slabs bucketed by destination makes it obvious
            which 1-N to pick for the next trip. Vendors are
            sorted alphabetically; urgent rows still bubble to the
            top within each vendor section. */}
        {availableRows.length > 0 && (() => {
          // Bucket by vendor_name (stable display) but tag with
          // vendor_id so we can render a small sub-header showing
          // the dropoff label too.
          type AvailGroup = {
            vendorName: string;
            vendorDropoff: string | null;
            vendorPhone: string | null;
            rows: TransferRow[];
          };
          const byVendor = new Map<string, AvailGroup>();
          for (const r of availableRows) {
            const key = r.vendor_name;
            const g = byVendor.get(key);
            if (g) g.rows.push(r);
            else byVendor.set(key, {
              vendorName: r.vendor_name,
              vendorDropoff: r.vendor_dropoff,
              vendorPhone: r.vendor_phone,
              rows: [r],
            });
          }
          const groups = [...byVendor.values()].sort((a, b) =>
            a.vendorName.localeCompare(b.vendorName),
          );
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {groups.map((g) => {
                const collapsed = !expandedVendors.has(g.vendorName);
                const selectedInGroup = g.rows.filter((r) => selectedIds.has(r.id)).length;
                // Oldest-waiting slab → the header's "waiting" summary.
                const oldest = g.rows.reduce(
                  (acc, r) => (new Date(r.assigned_at).getTime() < new Date(acc.assigned_at).getTime() ? r : acc),
                  g.rows[0],
                );
                return (
                  <div key={g.vendorName} style={{ border: "1.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                    {/* Collapsible vendor header — name · phone · count · waiting */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedVendors((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.vendorName)) next.delete(g.vendorName);
                          else next.add(g.vendorName);
                          return next;
                        })
                      }
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        padding: "12px 14px", background: "var(--surface-alt)", border: "none",
                        cursor: "pointer", textAlign: "left", minHeight: 56,
                      }}
                    >
                      <span style={{ fontSize: 13, color: "var(--muted)", width: 12 }}>{collapsed ? "▶" : "▼"}</span>
                      <span style={{ fontSize: 18 }}>🏭</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 15, color: "var(--text)" }}>{g.vendorName}</strong>
                        {g.vendorPhone && (
                          <a
                            href={`tel:${g.vendorPhone}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontSize: 13, color: "#1d4ed8", fontFamily: "ui-monospace, monospace", textDecoration: "none", fontWeight: 700 }}
                          >
                            📞 {g.vendorPhone}
                          </a>
                        )}
                      </span>
                      <span style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: selectedInGroup > 0 ? "#1d4ed8" : "var(--text)" }}>
                          {g.rows.length} {t("slab", "स्लैब")}{g.rows.length === 1 ? "" : t("s", "")}
                          {selectedInGroup > 0 && <span style={{ color: "#1d4ed8" }}> · {selectedInGroup} {t("selected", "चुनी")}</span>}
                        </span>
                        <span style={{ fontSize: 11.5, color: "#b45309", fontWeight: 600 }}>
                          ⏱ {t("waiting", "रुकी")} {waitLabel(oldest.assigned_at, now)}
                        </span>
                      </span>
                    </button>
                    {/* Full-detail slab cards — same rectangle card grid
                        as the Carving Jobs › Unassigned tab. */}
                    {!collapsed && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                          gap: 10,
                          padding: 10,
                        }}
                      >
                        {g.rows.map((r) => {
                          const isSelected = selectedIds.has(r.id);
                          const atCap = selectedIds.size >= CLAIM_BATCH_MAX && !isSelected;
                          return (
                            <AvailableSlabCard
                              key={r.id}
                              row={r}
                              stoneTypes={stoneTypes}
                              t={t}
                              now={now}
                              selected={isSelected}
                              disabled={hasActiveClaim || atCap}
                              disabledReason={
                                hasActiveClaim
                                  ? t("Deliver or release your current batch first", "पहले मौजूदा बैच पहुँचाएँ या छोड़ें")
                                  : atCap
                                    ? t(`Max ${CLAIM_BATCH_MAX} per batch`, `एक बैच में ज़्यादा से ज़्यादा ${CLAIM_BATCH_MAX}`)
                                    : null
                              }
                              onToggle={() =>
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.id)) next.delete(r.id);
                                  else if (next.size < CLAIM_BATCH_MAX) next.add(r.id);
                                  return next;
                                })
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* DELIVERED TODAY — success confirmation, collapsed by default. */}
      {delivered.length > 0 && (
        <SectionShell
          kind="delivered"
          title={t("✅ Delivered today", "✅ आज पहुँचाई")}
          subtitle={t(`${delivered.length} slab(s) delivered in the last 48 hours`, `पिछले 48 घंटे में ${delivered.length} स्लैब पहुँचाई`)}
          collapsible
          defaultOpen={false}
        >
          {(() => {
            // Group by vendor, like Available — the runner sees what landed
            // at each shade today.
            const byVendor = new Map<string, DeliveredRow[]>();
            for (const d of delivered) {
              const g = byVendor.get(d.vendor_name);
              if (g) g.push(d);
              else byVendor.set(d.vendor_name, [d]);
            }
            const groups = [...byVendor.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {groups.map(([vendor, drows]) => (
                  <div key={vendor} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", borderBottom: "1px solid var(--border)", marginBottom: 2 }}>
                      <span style={{ fontSize: 14 }}>🏭</span>
                      <strong style={{ fontSize: 13, color: "var(--text)" }}>{vendor}</strong>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                        {drows.length} {t("slab", "स्लैब")}{drows.length === 1 ? "" : t("s", "")}
                      </span>
                    </div>
                    {drows.map((d) => (
                      <DeliveredCard key={d.id} row={d} stoneTypes={stoneTypes} />
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionShell>
      )}

      {/* CLAIMED BY OTHERS — hidden when empty. Same compact row
          format as Available since this is awareness-only. */}
      {othersRows.length > 0 && (
        <SectionShell
          kind="others"
          title={t("👥 Claimed by other runners", "👥 दूसरों के क्लेम")}
          subtitle={t("Already grabbed — visible for awareness only.", "पहले ही ले लिए — सिर्फ जानकारी के लिए।")}
          collapsible
          defaultOpen={false}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {othersRows.map((r) => (
              <CompactRow
                key={r.id}
                row={r}
                kind="others"
                canUnclaim={canUnclaimOthers}
                stoneTypes={stoneTypes}
                t={t}
              />
            ))}
          </div>
        </SectionShell>
      )}
        </>
      )}

      {activeTab === "dispatch" && (
        <DispatchTransferTab
          rows={dispatchRows}
          currentUserId={currentUserId}
          selected={dispatchSelected}
          setSelected={setDispatchSelected}
          stoneTypes={stoneTypes}
          trucks={trucks}
          t={t}
        />
      )}

      {claimModalOpen && (
        <TruckPickModal
          trucks={trucks}
          t={t}
          onClose={() => setClaimModalOpen(false)}
          onPick={submitClaimWithTruck}
        />
      )}
    </div>
  );
}

// ── Truck-pick modal (Mig 144) — opened from a Claim / Bring-in button.
// Lists free trucks (uppercase plate + driver) as big tap targets, plus a
// "without truck" escape hatch. onPick("") = claim without a truck.
function TruckPickModal({
  trucks,
  onPick,
  onClose,
  t,
}: {
  trucks: TruckOption[];
  onPick: (truckName: string) => void;
  onClose: () => void;
  t: (en: string, hi: string) => string;
}) {
  const free = trucks.filter((tr) => !tr.busy);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 14,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--surface)",
          borderRadius: 16,
          padding: 16,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 22 }}>🚚</span>
          <strong style={{ fontSize: 18 }}>{t("Pick the truck", "ट्रक चुनें")}</strong>
          <button
            type="button"
            onClick={onClose}
            className="ghost-button"
            style={{ marginLeft: "auto", fontSize: 13, padding: "6px 12px" }}
          >
            {t("Cancel", "रद्द")}
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {free.length === 0 && (
            <div className="muted" style={{ fontSize: 13, padding: "6px 2px" }}>
              {t(
                "No free trucks — add trucks in Settings → Transfer trucks, or claim without one.",
                "कोई फ्री ट्रक नहीं — सेटिंग → ट्रांसफर ट्रक में जोड़ें, या बिना ट्रक क्लेम करें।",
              )}
            </div>
          )}
          {free.map((tr) => (
            <button
              key={tr.id}
              type="button"
              onClick={() => onPick(tr.name)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 14px",
                minHeight: 58,
                borderRadius: 12,
                border: "1.5px solid var(--border)",
                background: "var(--surface-alt)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 20 }}>🚛</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 16 }}>
                  {tr.name.toUpperCase()}
                </code>
                {tr.driver && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{tr.driver}</span>}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPick("")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "13px 14px",
              minHeight: 52,
              borderRadius: 12,
              border: "1.5px dashed var(--border)",
              background: "transparent",
              cursor: "pointer",
              color: "var(--muted)",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ⏭ {t("Claim without truck", "बिना ट्रक क्लेम करें")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Carving → Dispatch bring-in tab (Phase 5) ─────────────────────
// Lists approved slabs waiting to be brought in to their dispatch
// station. Selecting + "Bring in" stamps received_at_dispatch_at so the
// slab becomes clickable on the Dispatch board.
function DispatchTransferTab({
  rows,
  currentUserId,
  selected,
  setSelected,
  stoneTypes,
  trucks,
  t,
}: {
  rows: DispatchTransferRow[];
  currentUserId: string;
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  stoneTypes: StoneTypeDef[];
  trucks: TruckOption[];
  t: (en: string, hi: string) => string;
}) {
  // Two-step lane (mirrors cutting→carving): claim → deliver.
  const mineRows = rows.filter((r) => r.claimed_by === currentUserId);
  const availableRows = rows.filter((r) => !r.claimed_by);
  const hasActiveClaim = mineRows.length > 0;

  // Available grouped by carving vendor (the FROM); each row shows → station.
  const byVendor = new Map<string, DispatchTransferRow[]>();
  for (const r of availableRows) {
    const g = byVendor.get(r.vendor_name);
    if (g) g.push(r);
    else byVendor.set(r.vendor_name, [r]);
  }
  const availGroups = [...byVendor.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const availIds = availableRows.map((r) => r.id);
  const allSelected = availIds.length > 0 && availIds.every((id) => selected.has(id));

  // My claims grouped by claim_batch_id (every claim sets one).
  type Batch = { batchId: string | null; rows: DispatchTransferRow[] };
  const mineBatches: Batch[] = [];
  const idxByKey = new Map<string, number>();
  for (const r of mineRows) {
    const key = r.claim_batch_id ?? `legacy::${r.id}`;
    const idx = idxByKey.get(key);
    if (idx == null) {
      idxByKey.set(key, mineBatches.length);
      mineBatches.push({ batchId: r.claim_batch_id, rows: [r] });
    } else {
      mineBatches[idx].rows.push(r);
    }
  }

  const [claimedOpen, setClaimedOpen] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const claimFormRef = useRef<HTMLFormElement>(null);
  const claimTruckRef = useRef<HTMLInputElement>(null);
  const submitClaimWithTruck = (truck: string) => {
    if (claimTruckRef.current) claimTruckRef.current.value = truck;
    setClaimModalOpen(false);
    setSelected(() => new Set());
    setClaimSubmitting(true);
    claimFormRef.current?.requestSubmit();
  };

  return (
    <>
      {/* CLAIMED FOR DISPATCH — compact card → expand to deliver / release. */}
      {mineRows.length > 0 && (
        <SectionShell
          kind="mine"
          title={t("🚚 Claimed for dispatch", "🚚 डिस्पैच के लिए क्लेम")}
          subtitle={t(`${mineRows.length} slab(s) to deliver`, `${mineRows.length} स्लैब पहुँचानी`)}
        >
          {!claimedOpen ? (
            <button
              type="button"
              onClick={() => setClaimedOpen(true)}
              style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12,
                padding: "14px 16px", borderRadius: 12, minHeight: 58,
                background: "rgba(29,78,216,0.06)", border: "1.5px solid #1d4ed8", color: "var(--text)",
              }}
            >
              <span style={{ fontSize: 24 }}>🚚</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "#1d4ed8" }}>
                  {t(`${mineRows.length} slab(s) claimed`, `${mineRows.length} स्लैब क्लेम की`)}
                </span>
                <span style={{ fontSize: 13.5, color: "var(--muted)" }}>
                  {t("Tap to deliver or release", "पहुँचाने या छोड़ने के लिए टैप करें")}
                </span>
              </span>
              <span style={{ marginLeft: "auto", fontSize: 18, color: "#1d4ed8", fontWeight: 800 }}>▸</span>
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <button
                type="button"
                onClick={() => setClaimedOpen(false)}
                className="ghost-button"
                style={{ alignSelf: "flex-start", fontSize: 13, padding: "6px 12px" }}
              >
                ▾ {t("Collapse", "बंद करें")}
              </button>
              {mineBatches.map((b, gIdx) => (
                <div
                  key={b.batchId ?? `legacy-${gIdx}`}
                  style={{
                    border: "1.5px solid #1d4ed8",
                    background: "rgba(29,78,216,0.04)",
                    borderRadius: 12,
                    padding: "10px 10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, fontWeight: 800, color: "#1d4ed8" }}>
                    <span>🚛 {t(`Batch of ${b.rows.length}`, `${b.rows.length} का बैच`)}</span>
                    {b.rows[0].truck_name && (
                      <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                        {b.rows[0].truck_name.toUpperCase()}
                      </code>
                    )}
                  </div>
                  {b.batchId && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <form
                        action={deliverToDispatchBatchAction}
                        onSubmit={(e) => {
                          if (!window.confirm(t(`Mark all ${b.rows.length} slab(s) delivered to dispatch?`, `सभी ${b.rows.length} स्लैब डिस्पैच पर पहुँचाई मार्क करें?`))) {
                            e.preventDefault();
                          }
                        }}
                        style={{ flex: "1 1 180px" }}
                      >
                        <input type="hidden" name="claim_batch_id" value={b.batchId} />
                        <input type="hidden" name="redirect_to" value="/carving/transfer?tab=dispatch" />
                        <SubmitSpinnerButton style={{ width: "100%", fontSize: 16, padding: "12px 18px", fontWeight: 800, background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", minHeight: 48 }}>
                          ✅ {t("Deliver all", "सब पहुँचाएँ")} {b.rows.length}
                        </SubmitSpinnerButton>
                      </form>
                      <form
                        action={unclaimDispatchBatchAction}
                        onSubmit={(e) => {
                          if (!window.confirm(t("Release this batch back to the queue?", "यह बैच वापस कतार में छोड़ें?"))) e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="claim_batch_id" value={b.batchId} />
                        <input type="hidden" name="redirect_to" value="/carving/transfer?tab=dispatch" />
                        <SubmitSpinnerButton className="ghost-button danger-ghost" style={{ fontSize: 15, padding: "12px 16px", minHeight: 48 }}>
                          🛑 {t("Release all", "सब छोड़ें")}
                        </SubmitSpinnerButton>
                      </form>
                    </div>
                  )}
                  {b.rows.map((r) => (
                    <DispatchBringInRow key={r.id} row={r} stoneTypes={stoneTypes} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </SectionShell>
      )}

      {/* AVAILABLE — grouped by carving vendor (FROM) → station (TO). */}
      <SectionShell
        kind="available"
        title={t("📦 Carving → Dispatch", "📦 नक्काशी → डिस्पैच")}
        subtitle={
          availableRows.length === 0
            ? t("Nothing waiting to claim.", "क्लेम के लिए कुछ बाकी नहीं।")
            : t(`${availableRows.length} carved slab(s) to claim`, `${availableRows.length} तैयार स्लैब क्लेम करने को`)
        }
      >
        {hasActiveClaim && availableRows.length > 0 && (
          <div style={{ padding: "10px 12px", marginBottom: 10, background: "rgba(180,115,51,0.10)", border: "1.5px solid rgba(180,115,51,0.4)", borderRadius: 8, fontSize: 14, color: "#7c2d12", fontWeight: 600 }}>
            🏗️ {t("Finish your current claim first — deliver or release it above.", "पहले मौजूदा क्लेम पूरा करें — ऊपर पहुँचाएँ या छोड़ें।")}
          </div>
        )}
        {!hasActiveClaim && availableRows.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", marginBottom: 10, background: selected.size > 0 ? "#dbeafe" : "var(--surface-alt)", border: `1.5px solid ${selected.size > 0 ? "#1d4ed8" : "var(--border)"}`, borderRadius: 10, flexWrap: "wrap" }}>
            <button type="button" className="ghost-button" onClick={() => setSelected(() => (allSelected ? new Set() : new Set(availIds)))} style={{ fontSize: 14, padding: "8px 14px", minHeight: 44 }}>
              {allSelected ? t("Clear all", "सब हटाएँ") : t("Select all", "सब चुनें")}
            </button>
            <span style={{ fontSize: 15, fontWeight: 700, color: selected.size > 0 ? "#1d4ed8" : "var(--muted)" }}>
              {selected.size === 0 ? t("Select slabs to claim", "क्लेम के लिए स्लैब चुनें") : t(`${selected.size} selected`, `${selected.size} चुनी`)}
            </span>
            <div style={{ marginLeft: "auto" }}>
              <form ref={claimFormRef} action={claimDispatchBatchAction}>
                <input type="hidden" name="carving_item_ids" value={JSON.stringify([...selected])} />
                <input type="hidden" name="redirect_to" value="/carving/transfer?tab=dispatch" />
                <input type="hidden" name="truck_name" ref={claimTruckRef} defaultValue="" />
              </form>
              <button type="button" className="primary-button" disabled={selected.size === 0 || claimSubmitting} onClick={() => setClaimModalOpen(true)} style={{ fontSize: 16, padding: "11px 22px", fontWeight: 800, minHeight: 48, opacity: selected.size === 0 || claimSubmitting ? 0.6 : 1, cursor: selected.size === 0 ? "not-allowed" : claimSubmitting ? "wait" : "pointer" }}>
                {claimSubmitting ? <Spinner /> : <>📦 {t("Claim", "क्लेम")} {selected.size > 0 ? selected.size : ""}</>}
              </button>
            </div>
          </div>
        )}
        {availableRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {availGroups.map(([vendor, grows]) => (
              <div key={vendor} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", borderBottom: "1px solid var(--border)", marginBottom: 2 }}>
                  <span style={{ fontSize: 15 }}>🏭</span>
                  <strong style={{ fontSize: 15, color: "var(--text)" }}>{vendor}</strong>
                  <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
                    {grows.length} {t("slab", "स्लैब")}{grows.length === 1 ? "" : t("s", "")}
                  </span>
                </div>
                {grows.map((r) => (
                  <DispatchBringInRow
                    key={r.id}
                    row={r}
                    stoneTypes={stoneTypes}
                    selected={!hasActiveClaim && selected.has(r.id)}
                    onToggle={
                      hasActiveClaim
                        ? undefined
                        : () =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </SectionShell>

      {claimModalOpen && (
        <TruckPickModal trucks={trucks} t={t} onClose={() => setClaimModalOpen(false)} onPick={submitClaimWithTruck} />
      )}
    </>
  );
}

function DispatchBringInRow({
  row,
  stoneTypes,
  selected = false,
  onToggle,
}: {
  row: DispatchTransferRow;
  stoneTypes: StoneTypeDef[];
  selected?: boolean;
  onToggle?: () => void;
}) {
  const L = row.length_ft;
  const W = row.width_ft;
  const T = row.thickness_ft;
  const selectable = !!onToggle;
  return (
    <div
      onClick={onToggle}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle!();
              }
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        border: selected ? "2px solid #1d4ed8" : "1px solid var(--border)",
        background: selected ? "rgba(29,78,216,0.06)" : "var(--surface)",
        borderRadius: 10,
        cursor: selectable ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {selectable && (
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            flexShrink: 0,
            border: selected ? "none" : "2px solid var(--border)",
            background: selected ? "#1d4ed8" : "transparent",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 900,
          }}
        >
          {selected ? "✓" : ""}
        </span>
      )}
      <div style={{ flexShrink: 0 }}>
        <SlabThumb l={L} w={W} t={T} stone={row.stone} stoneTypes={stoneTypes} size={48} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 16 }}>
            {row.slab_id}
          </code>
          <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{row.temple}</span>
        </div>
        {/* FROM → TO: carving vendor → dispatch station. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: "var(--text)" }}>🏭 {row.vendor_name}</span>
          <span style={{ color: "var(--muted)" }}>→</span>
          <span style={{ fontWeight: 700, color: "#1d4ed8" }}>📦 {row.station_name ?? "—"}</span>
          {row.truck_name && (
            <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>
              · 🚚 {row.truck_name.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
          {L}×{W}×{T} in · {row.stone ?? "—"}
        </div>
      </div>
    </div>
  );
}

// ── Section shell — strong visual differentiation per kind ────────

type SectionKind = "mine" | "available" | "delivered" | "others";

const SECTION_TINTS: Record<
  SectionKind,
  { bg: string; border: string; titleFg: string; subtitleFg: string }
> = {
  mine: {
    bg: "linear-gradient(180deg, rgba(37,99,235,0.07) 0%, rgba(37,99,235,0.02) 100%)",
    border: "rgba(37,99,235,0.40)",
    titleFg: "#1d4ed8",
    subtitleFg: "#1e3a8a",
  },
  available: {
    bg: "var(--surface)",
    border: "var(--border)",
    titleFg: "#b45309",
    subtitleFg: "var(--muted)",
  },
  delivered: {
    bg: "rgba(22,163,74,0.06)",
    border: "rgba(22,163,74,0.35)",
    titleFg: "#15803d",
    subtitleFg: "var(--muted)",
  },
  others: {
    bg: "var(--surface-alt)",
    border: "var(--border)",
    titleFg: "var(--muted)",
    subtitleFg: "var(--muted)",
  },
};

function SectionShell({
  kind,
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  kind: SectionKind;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  const tint = SECTION_TINTS[kind];
  return (
    <section
      style={{
        background: tint.bg,
        border: `1.5px solid ${tint.border}`,
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: kind === "mine" ? "0 2px 12px rgba(37,99,235,0.08)" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: isOpen ? 12 : 0,
          flexWrap: "wrap",
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
          <span style={{ fontSize: 12, color: tint.titleFg, width: 14, display: "inline-block" }}>
            {isOpen ? "▼" : "▶"}
          </span>
        )}
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: tint.titleFg }}>{title}</h2>
        <span style={{ fontSize: 14, color: tint.subtitleFg }}>{subtitle}</span>
      </div>
      {isOpen && children}
    </section>
  );
}

// ── Transfer card — actionable row in Mine / Available / Others ───

function TransferCard({
  row,
  kind,
  canUnclaim,
  stoneTypes,
  disabledReason,
  now,
  t,
}: {
  row: TransferRow;
  kind: "mine" | "available" | "others";
  canUnclaim?: boolean;
  stoneTypes: StoneTypeDef[];
  t: (en: string, hi: string) => string;
  /** When set, the Claim button on an Available row is disabled
   *  and shows this hint as a tooltip + greyed out style. Used to
   *  enforce the one-active-claim-per-runner rule. */
  disabledReason?: string | null;
  /** Wall-clock millis. Drives the live "claimed Xm ago" ticker on
   *  Mine cards. Only required when kind === "mine". */
  now?: number;
}) {
  const [deliverOpen, setDeliverOpen] = useState(false);
  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const isUrgent = row.urgency === "urgent";
  // Migration 026 — slabs assigned together share a colour stripe.
  const tint = batchTint(row.batch_id);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        background: "var(--surface)",
        border: `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderLeft: tint
          ? `5px solid ${tint.border}`
          : `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderRadius: 10,
        boxShadow: isUrgent ? "0 0 0 2px rgba(220,38,38,0.08)" : "none",
      }}
      title={tint ? "Part of a batch — these slabs were assigned together" : undefined}
    >
      {/* Top row — slab info + chips */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0 }}>
          <SlabThumb
            stone={row.stone}
            l={row.length_ft}
            w={row.width_ft}
            t={row.thickness_ft}
            stoneTypes={stoneTypes}
            size={64}
            height={64}
          />
        </div>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            {isUrgent && <ChipUrgent />}
            {row.is_lathe && <ChipLathe />}
            <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
              {row.slab_id}
            </code>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
            {row.temple}
            {row.slab_label && ` · ${row.slab_label}`}
            <div style={{ marginTop: 2, fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>
              {dims}
            </div>
          </div>
          {kind === "others" && row.claimed_by_name && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Claimed by <strong>{row.claimed_by_name}</strong>
              {row.claimed_at && ` · ${formatRelative(row.claimed_at)} ago`}
            </div>
          )}
        </div>
      </div>

      {/* Live "claimed Xm ago" timer — only for Mine rows. Turns
          amber after 15min and red after 30min as a "did the
          runner get distracted?" nudge. Uses `now` from the parent
          ticker so it refreshes every 15s without local state. */}
      {kind === "mine" && now != null && row.claimed_at && (
        <ClaimedTimer claimedAt={row.claimed_at} now={now} />
      )}

      {/* Route visualisation */}
      <RouteVisual
        from={row.stock_location}
        toVendor={row.vendor_name}
        toDropoff={row.vendor_dropoff}
        active={kind === "mine"}
      />

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        {kind === "available" && (
          <form action={claimSlabTransferAction} style={{ flex: 1, minWidth: 120 }}>
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <button
              type="submit"
              className="primary-button"
              disabled={!!disabledReason}
              title={disabledReason ?? undefined}
              style={{
                width: "100%",
                fontSize: 16,
                padding: "13px 20px",
                fontWeight: 800,
                minHeight: 48,
                opacity: disabledReason ? 0.45 : 1,
                cursor: disabledReason ? "not-allowed" : "pointer",
              }}
            >
              {disabledReason ? t("🏗️ Deliver current first", "🏗️ पहले मौजूदा पहुँचाएँ") : t("📦 Claim this slab", "📦 यह स्लैब क्लेम करें")}
            </button>
          </form>
        )}
        {kind === "mine" && !deliverOpen && (
          <>
            <button
              type="button"
              onClick={() => setDeliverOpen(true)}
              style={{
                flex: 1,
                minWidth: 160,
                fontSize: 16,
                padding: "13px 20px",
                fontWeight: 800,
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                minHeight: 48,
                boxShadow: "0 2px 8px rgba(22,163,74,0.25)",
              }}
            >
              ✅ {t("Mark delivered", "पहुँचा दिया")}
            </button>
            <form action={unclaimSlabTransferAction}>
              <input type="hidden" name="carving_item_id" value={row.id} />
              <input type="hidden" name="redirect_to" value="/carving/transfer" />
              <SubmitSpinnerButton
                className="ghost-button"
                style={{ fontSize: 14, padding: "11px 14px", minHeight: 48 }}
              >
                {t("Release claim", "क्लेम छोड़ें")}
              </SubmitSpinnerButton>
            </form>
          </>
        )}
        {kind === "mine" && deliverOpen && (
          <form
            action={acknowledgeReceiptAction}
            style={{ display: "flex", gap: 6, alignItems: "stretch", flex: 1, flexWrap: "wrap" }}
          >
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <input
              type="text"
              name="dropoff_note"
              placeholder={t(`Where? (empty = ${row.vendor_dropoff ?? "standard spot"})`, `कहाँ रखा? (खाली = ${row.vendor_dropoff ?? "सामान्य जगह"})`)}
              style={{
                fontSize: 15,
                padding: "11px 12px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg)",
                color: "var(--text)",
                flex: "1 1 180px",
                minWidth: 140,
                minHeight: 48,
              }}
            />
            <SubmitSpinnerButton
              style={{
                fontSize: 15,
                padding: "11px 18px",
                fontWeight: 800,
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                minHeight: 48,
              }}
            >
              ✅ {t("Done", "हो गया")}
            </SubmitSpinnerButton>
            <button
              type="button"
              onClick={() => setDeliverOpen(false)}
              className="ghost-button"
              style={{ fontSize: 14, padding: "11px 14px", minHeight: 48 }}
            >
              {t("Cancel", "रद्द")}
            </button>
          </form>
        )}
        {kind === "others" && canUnclaim && (
          <form action={unclaimSlabTransferAction}>
            <input type="hidden" name="carving_item_id" value={row.id} />
            <input type="hidden" name="redirect_to" value="/carving/transfer" />
            <SubmitSpinnerButton
              className="ghost-button danger-ghost"
              style={{ fontSize: 14, padding: "9px 14px" }}
            >
              {t("Release their claim", "उनका क्लेम छोड़ें")}
            </SubmitSpinnerButton>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Compact row — single-line layout for Available + Others ──────
//
// Tight Excel-style row: small thumb · chips · slab id · temple ·
// dims · 📍 from → 🏭 vendor · action button.
// Wraps to multi-line on narrow screens (CSS gap + flex-wrap), but
// stays one line per slab on desktop so the runner can scan a long
// yard list at a glance. The big card with the animated arrow
// route is reserved for "Claimed by me" — the active work.
function CompactRow({
  row,
  kind,
  canUnclaim,
  stoneTypes,
  disabledReason,
  selected,
  onToggleSelect,
  selectDisabled,
  t,
}: {
  row: TransferRow;
  kind: "available" | "others";
  canUnclaim?: boolean;
  stoneTypes: StoneTypeDef[];
  t: (en: string, hi: string) => string;
  disabledReason?: string | null;
  /** Mig 065 — for `kind="available"`, the row renders a checkbox
   *  instead of an inline Claim button. Parent owns the selected-set
   *  state; the row just toggles entries via this callback. */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** When the user has already hit the batch cap (10) or has an
   *  active claim, the checkbox is disabled. Tooltip explains. */
  selectDisabled?: boolean;
}) {
  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const isUrgent = row.urgency === "urgent";
  // Migration 026 — slabs assigned together share a colour stripe.
  const tint = batchTint(row.batch_id);
  return (
    <div
      style={{
        // Locked 3-column layout: [thumb] [info, grows] [button].
        // The middle column has min-width: 0 so long temple names
        // truncate with ellipsis instead of pushing the button to a
        // new line. This keeps every Claim button vertically aligned
        // down the right edge of the list.
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "var(--surface)",
        border: `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderLeft: tint
          ? `5px solid ${tint.border}`
          : `1px solid ${isUrgent ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
        borderRadius: 8,
        boxShadow: isUrgent ? "0 0 0 2px rgba(220,38,38,0.06)" : "none",
      }}
      title={tint ? "Part of a batch — these slabs were assigned together" : undefined}
    >
      {/* Thumb */}
      <div style={{ flexShrink: 0 }}>
        <SlabThumb
          stone={row.stone}
          l={row.length_ft}
          w={row.width_ft}
          t={row.thickness_ft}
          stoneTypes={stoneTypes}
          size={56}
          height={56}
        />
      </div>

      {/* Middle column: three info lines, all left-aligned. Truncates
          on overflow so the button never gets pushed off the row. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* Line 1 — chips + slab id + dims (the prominent line) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isUrgent && <ChipUrgent />}
          {row.is_lathe && <ChipLathe small />}
          <code
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 800,
              fontSize: 18,
              color: "var(--text)",
            }}
          >
            {row.slab_id}
          </code>
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              fontSize: 14,
              color: "var(--text)",
              background: "var(--surface-alt)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            {dims}
          </span>
        </div>

        {/* Line 2 — temple + label, secondary */}
        <div
          style={{
            fontSize: 13.5,
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 600,
          }}
          title={`${row.temple}${row.slab_label ? " · " + row.slab_label : ""}`}
        >
          🏛 {row.temple}
          {row.slab_label && ` · ${row.slab_label}`}
        </div>

        {/* Line 3 — from → to route, monospace */}
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            flexWrap: "wrap",
            color: "var(--muted)",
          }}
        >
          <span style={{ color: "#7c2d12", fontWeight: 700 }}>
            📍 {row.stock_location ?? "—"}
          </span>
          <span style={{ color: "var(--muted-light)", fontWeight: 700 }}>→</span>
          <span style={{ color: "#15803d", fontWeight: 700 }}>
            🏭 {row.vendor_name}
            {row.vendor_dropoff && (
              <span style={{ color: "#15803d", fontWeight: 400 }}> · {row.vendor_dropoff}</span>
            )}
          </span>
          {kind === "others" && row.claimed_by_name && (
            <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>
              · {t("Claimed by", "क्लेम:")} <strong>{row.claimed_by_name}</strong>
              {row.claimed_at && ` · ${formatRelative(row.claimed_at)} ${t("ago", "पहले")}`}
            </span>
          )}
        </div>
      </div>

      {/* Right column — Mig 065: checkbox replaces the per-row
          Claim button. Selection feeds the batch-claim action bar
          above (max 10 per batch). When the user has an active
          claim OR the cap is reached, the checkbox disables with
          a tooltip explaining. */}
      {kind === "available" && (
        <label
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            minWidth: 44,
            minHeight: 44,
            padding: "0 12px",
            border: `1.5px solid ${selected ? "#1d4ed8" : "var(--border)"}`,
            background: selected ? "#dbeafe" : "var(--surface)",
            borderRadius: 8,
            cursor: selectDisabled ? "not-allowed" : "pointer",
            opacity: selectDisabled && !selected ? 0.4 : 1,
            transition: "background 0.12s, border-color 0.12s",
          }}
          title={
            selectDisabled && !selected
              ? disabledReason ?? "Cap reached — claim what's selected first"
              : selected
                ? "Tap to deselect"
                : "Tap to add to claim batch"
          }
        >
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelect}
            disabled={!!selectDisabled && !selected}
            style={{ width: 20, height: 20, cursor: "inherit" }}
            aria-label={`${selected ? "Deselect" : "Select"} slab ${row.slab_id} for batch claim`}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: selected ? "#1d4ed8" : "var(--muted)",
              whiteSpace: "nowrap",
            }}
          >
            {selected ? "Selected" : "Select"}
          </span>
        </label>
      )}
      {kind === "others" && canUnclaim && (
        <form action={unclaimSlabTransferAction} style={{ flexShrink: 0 }}>
          <input type="hidden" name="carving_item_id" value={row.id} />
          <input type="hidden" name="redirect_to" value="/carving/transfer" />
          <SubmitSpinnerButton
            className="ghost-button danger-ghost"
            style={{ fontSize: 12, padding: "8px 12px", whiteSpace: "nowrap" }}
          >
            Release
          </SubmitSpinnerButton>
        </form>
      )}
    </div>
  );
}

// ── Delivered card — success confirmation row ─────────────────────

function DeliveredCard({ row, stoneTypes }: { row: DeliveredRow; stoneTypes: StoneTypeDef[] }) {
  const dims = `${row.length_ft}×${row.width_ft}×${row.thickness_ft}″`;
  const deliveredAt = new Date(row.delivered_at);
  const ist = deliveredAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ageMin = (Date.now() - deliveredAt.getTime()) / 60000;
  const isFresh = ageMin < 60;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "10px 12px",
        background: "var(--surface)",
        border: `1px solid ${isFresh ? "rgba(22,163,74,0.45)" : "var(--border)"}`,
        borderRadius: 8,
        alignItems: "center",
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <SlabThumb
          stone={row.stone}
          l={row.length_ft}
          w={row.width_ft}
          t={row.thickness_ft}
          stoneTypes={stoneTypes}
          size={44}
          height={44}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 16,
              color: "#15803d",
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            ✓
          </span>
          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13 }}>
            {row.slab_id}
          </code>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {row.temple}
            {row.slab_label && ` · ${row.slab_label}`}
            {" · "}
            {dims}
          </span>
          {row.is_lathe && <ChipLathe small />}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 4,
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          <span>
            🏭 <strong style={{ color: "var(--text)" }}>{row.vendor_name}</strong>
            {row.dropoff_note ? (
              <span style={{ color: "#15803d" }}> · 📍 {row.dropoff_note}</span>
            ) : row.vendor_dropoff ? (
              <span> · {row.vendor_dropoff}</span>
            ) : null}
          </span>
          <span style={{ color: "#15803d", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
            ✅ {ist}
            {isFresh && ageMin < 60 && <span style={{ marginLeft: 4 }}>· just now</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Route visualisation — From → To, animated when claimed ────────

function RouteVisual({
  from,
  toVendor,
  toDropoff,
  active,
}: {
  from: string | null;
  toVendor: string;
  toDropoff: string | null;
  active: boolean;
}) {
  return (
    <div
      className="mtcpl-route-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 60px 1fr",
        gap: 8,
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          background: "rgba(180,115,51,0.10)",
          border: "1px solid rgba(180,115,51,0.35)",
          borderRadius: 8,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: "#92400e",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          📍 From (where it is)
        </span>
        <strong
          style={{
            fontSize: 13,
            color: "#7c2d12",
            fontFamily: "ui-monospace, monospace",
            wordBreak: "break-word",
          }}
        >
          {from ?? "(no location set)"}
        </strong>
      </div>

      <div
        className="mtcpl-route-arrow"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          height: 44,
        }}
      >
        <div
          style={{
            width: "100%",
            height: 6,
            borderRadius: 3,
            background: active
              ? "repeating-linear-gradient(90deg, #16a34a 0 10px, #86efac 10px 20px)"
              : "var(--border)",
            backgroundSize: active ? "40px 6px" : undefined,
            animation: active ? "mtcpl-transfer-flow 0.8s linear infinite" : undefined,
          }}
        />
        <span
          style={{
            position: "absolute",
            fontSize: 20,
            color: active ? "#15803d" : "var(--muted)",
            background: "var(--surface)",
            padding: "0 6px",
            fontWeight: 800,
          }}
        >
          →
        </span>
      </div>

      <div
        style={{
          background: "rgba(22,163,74,0.10)",
          border: "1px solid rgba(22,163,74,0.35)",
          borderRadius: 8,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: "#15803d",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          🏭 To (deliver to)
        </span>
        <strong
          style={{
            fontSize: 13,
            color: "#14532d",
            fontFamily: "ui-monospace, monospace",
            wordBreak: "break-word",
          }}
        >
          {toVendor}
        </strong>
        {toDropoff && (
          <span style={{ fontSize: 11, color: "#15803d" }}>{toDropoff}</span>
        )}
      </div>
    </div>
  );
}

// ── Live timer for "Claimed by me" rows ───────────────────────────
//
// Counts up from claimed_at. Tone changes based on duration so the
// runner sees a visual nudge if they've been on this slab too long:
//   < 15 min — green   (normal, all good)
//   15-30 min — amber  (taking a while, double-check the route)
//   > 30 min — red     (probably forgot or got pulled into something)
function ClaimedTimer({ claimedAt, now }: { claimedAt: string; now: number }) {
  const elapsedMin = Math.max(0, (now - new Date(claimedAt).getTime()) / 60000);
  const tone =
    elapsedMin >= 30
      ? { fg: "#991b1b", bg: "rgba(220,38,38,0.10)", border: "rgba(220,38,38,0.4)", icon: "⚠" }
      : elapsedMin >= 15
        ? { fg: "#92400e", bg: "rgba(217,119,6,0.10)", border: "rgba(217,119,6,0.4)", icon: "⏳" }
        : { fg: "#15803d", bg: "rgba(22,163,74,0.10)", border: "rgba(22,163,74,0.4)", icon: "⏱" };
  const label = fmtElapsed(elapsedMin);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "6px 10px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        color: tone.fg,
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <span>
        {tone.icon} Claimed {label} ago
      </span>
      {elapsedMin >= 15 && (
        <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>
          {elapsedMin >= 30 ? "taking long — check?" : "in transit"}
        </span>
      )}
    </div>
  );
}

function fmtElapsed(mins: number): string {
  const m = Math.floor(mins);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

// ── Tiny chips + helpers ──────────────────────────────────────────

function ChipUrgent() {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        padding: "2px 7px",
        borderRadius: 999,
        background: "#dc2626",
        color: "#fff",
        letterSpacing: "0.05em",
      }}
    >
      ⚡ URGENT
    </span>
  );
}

function ChipLathe({ small = false }: { small?: boolean }) {
  return (
    <span
      style={{
        fontSize: small ? 8 : 9,
        fontWeight: 800,
        padding: small ? "1px 5px" : "2px 6px",
        borderRadius: 3,
        background: "rgba(124,58,237,0.15)",
        color: "#7c3aed",
        letterSpacing: "0.05em",
      }}
    >
      🌀 LATHE
    </span>
  );
}

function StatTile({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div
      style={{
        padding: "8px 14px",
        background: "var(--surface-alt)",
        borderRadius: 8,
        textAlign: "center",
        minWidth: 70,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: fg,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// Live "how long waiting" label (ticks with the `now` state).
function waitLabel(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

// ── Available slab card (Mig — vendor-grouped, full detail) ────────
// A full-detail card for a slab pending pickup: thumb, code, urgency /
// lathe badges, how long it's been waiting, temple · label · dims ·
// stone, and the 📍 stock-location → 🏭 vendor route. Tap to select.
function AvailableSlabCard({
  row,
  stoneTypes,
  t,
  now,
  selected,
  disabled,
  disabledReason,
  onToggle,
}: {
  row: TransferRow;
  stoneTypes: StoneTypeDef[];
  t: (en: string, hi: string) => string;
  now: number;
  selected: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onToggle: () => void;
}) {
  const L = row.length_ft;
  const W = row.width_ft;
  const T = row.thickness_ft;
  const clickable = !disabled;
  const tint = row.batch_id ? batchTint(row.batch_id) : null;
  // Waiting tone: fresh (green) → ageing (amber) → stale (red), by hours.
  const waitMin = Math.max(0, Math.floor((now - new Date(row.assigned_at).getTime()) / 60000));
  const waitTone =
    waitMin >= 8 * 60
      ? { fg: "#991b1b", bg: "rgba(220,38,38,0.08)", icon: "⚠" }
      : waitMin >= 2 * 60
        ? { fg: "#b45309", bg: "rgba(217,119,6,0.08)", icon: "⏳" }
        : { fg: "#15803d", bg: "rgba(22,163,74,0.08)", icon: "⏱" };
  return (
    <div
      onClick={clickable ? onToggle : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={disabledReason ?? undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 8,
        border: `2px solid ${
          selected ? "#1d4ed8" : row.urgency === "urgent" ? "rgba(220,38,38,0.25)" : "var(--border)"
        }`,
        borderLeft: tint && !selected ? `5px solid ${tint.border}` : undefined,
        background: selected
          ? "rgba(29,78,216,0.06)"
          : row.urgency === "urgent"
            ? "rgba(220,38,38,0.04)"
            : "var(--surface)",
        cursor: clickable ? "pointer" : "not-allowed",
        opacity: disabled ? 0.5 : 1,
        userSelect: "none",
        transition: "border-color 0.12s, background 0.12s",
      }}
    >
      {/* Selection checkbox — top-right overlay (like the Unassigned tab). */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 24,
          height: 24,
          borderRadius: 6,
          zIndex: 1,
          border: selected ? "2px solid #1d4ed8" : "2px solid var(--border)",
          background: selected ? "#1d4ed8" : "var(--surface)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 900,
          boxShadow: selected ? "0 2px 6px rgba(29,78,216,0.4)" : "none",
        }}
      >
        {selected ? "✓" : ""}
      </span>
      <SlabThumb l={L} w={W} t={T} stone={row.stone} stoneTypes={stoneTypes} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.urgency === "urgent" && "⚡ "}
          {row.slab_id}
        </code>
        {row.stone && (
          <span className="role-pill" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>
            {row.stone}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {row.urgency === "urgent" && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: "#dc2626", borderRadius: 4, padding: "1px 6px" }}>
            ⚡ {t("URGENT", "अर्जेंट")}
          </span>
        )}
        {row.is_lathe && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: "#7c3aed", background: "rgba(124,58,237,0.12)", borderRadius: 4, padding: "1px 6px" }}>
            🌀 {t("LATHE", "लेथ")}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.temple}>
        🏛 {row.temple}
      </div>
      {row.slab_label && (
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.slab_label}>
          {row.slab_label}
        </div>
      )}
      {row.slab_description && (
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
          title={row.slab_description}
        >
          {row.slab_description}
        </div>
      )}
      <div style={{ fontSize: 10, color: "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>
        {L}×{W}×{T}&Prime;
      </div>
      {/* Route chip — FROM (stock location) → TO (vendor shade), so the
          runner reads at a glance where to pick up and where to drop. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          flexWrap: "wrap",
          fontSize: 10.5,
          fontWeight: 700,
          padding: "3px 7px",
          borderRadius: 5,
          alignSelf: "flex-start",
          background: "rgba(180,115,51,0.08)",
          border: "1px solid rgba(180,115,51,0.25)",
          fontFamily: "ui-monospace, monospace",
        }}
        title={`${row.stock_location ?? "—"} → ${row.vendor_name}`}
      >
        <span style={{ color: "#7c2d12" }}>📍 {row.stock_location ?? "—"}</span>
        <span style={{ color: "var(--muted)" }}>→</span>
        <span style={{ color: "#1d4ed8" }}>🏭 {row.vendor_name}</span>
      </div>
      {/* Waiting-since pill — how long this slab has sat in pending stock. */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: waitTone.fg,
          background: waitTone.bg,
          padding: "3px 7px",
          borderRadius: 5,
          alignSelf: "flex-start",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {waitTone.icon} {t("waiting", "रुकी")} {waitLabel(row.assigned_at, now)}
      </div>
    </div>
  );
}

// ── Truck pick-or-create combobox (Mig 144) ───────────────────────
// Themed dropdown matching the app (not native chrome). Type to filter
// the fleet, click/keyboard-select a free truck, or type a brand-new
// name (the "Use new …" row) which the server creates on claim. Busy
// trucks (already carrying an undelivered load) are shown but locked.
function TruckCombobox({
  value,
  onChange,
  trucks,
}: {
  value: string;
  onChange: (v: string) => void;
  trucks: TruckOption[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const all = useMemo(
    () =>
      [...trucks].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [trucks],
  );
  const q = value.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all),
    [all, q],
  );
  // Choose-only (Jun 2026): trucks are managed in Settings, so there's no
  // "create new" row — the runner can only pick an existing truck.
  const rows: Array<{ name: string; busy: boolean }> = filtered.map((t) => ({
    name: t.name,
    busy: t.busy,
  }));

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

  function choose(row: { name: string; busy: boolean }) {
    if (row.busy) return; // can't load onto a truck already out on a run
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
          placeholder="Pick a truck…"
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
          aria-label="Toggle truck list"
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

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 240,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            padding: 4,
          }}
        >
          {rows.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--muted)" }}>
              No trucks yet — add one in Settings → Transfer trucks.
            </div>
          ) : (
            rows.map((row, i) => {
              const isActive = i === active;
              const disabled = row.busy;
              return (
                <div
                  key={row.name}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={disabled}
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
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontSize: 14,
                    color: disabled ? "var(--muted)" : "var(--text)",
                    opacity: disabled ? 0.6 : 1,
                    background:
                      isActive && !disabled ? "var(--gold-soft, rgba(232,197,114,0.18))" : "transparent",
                  }}
                >
                  <span style={{ fontSize: 13, opacity: 0.7 }}>🚚</span>
                  <span style={{ flex: 1 }}>{row.name}</span>
                  {row.busy && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#b45309",
                        background: "rgba(180,115,51,0.12)",
                        padding: "2px 6px",
                        borderRadius: 999,
                      }}
                    >
                      busy
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
