"use client";

/**
 * Dispatch picker — v2 UI (Daksh, Aug 2026). DEVELOPER ONLY for now.
 *
 * The June-2026 picker worked but read like a wall: tiny 9.5px category
 * lines, no way to see WHAT you had ticked without scrolling the whole grid
 * hunting for gold borders. Loading a truck is a cross-checking job — you
 * pick, then you read the list back to the person at the trailer.
 *
 * So this rebuild changes two things and deliberately nothing else:
 *
 *   ① Cards say more, legibly. Category 1 › Category 2 › 🏷 Label ›
 *     description › + additional, at sizes a person can read across a desk,
 *     with size / CFT / stone on their own foot row.
 *   ② A review drawer on the right. Press the ‹ arrow and it swipes in,
 *     listing every ticked slab IN THE ORDER IT WAS TICKED (#1, #2, #3 …)
 *     with an ✕ on each to untick. Tapping a row scrolls its card into view
 *     and flashes it, so "is that the right one?" takes one tap.
 *
 * Step 2 (weights → createDispatchAction) is a faithful copy of the old
 * picker's — same fields, same hidden inputs, same action. Nothing about
 * what gets written changed; only how the slabs are chosen.
 *
 * This lives in its own file, rendered instead of TempleDispatchPeek only
 * when role === "developer" (dispatch-client's `newUi`). The old path is
 * untouched for everyone else until Daksh says roll it out.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createDispatchAction, parkDispatchSlabsAction, fetchTempleStorageSlabsAction } from "./actions";
import { FormPendingOverlay } from "@/components/form-pending-overlay";
import { timeAgoLabel } from "./time-ago";
import type { ReadySlab, SiteInfo, TempleGroup } from "./dispatch-client";

/* ── shared bits ─────────────────────────────────────────────────────── */

const overlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1500, background: "rgba(15,12,6,0.62)",
  backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
};
const panelFull: CSSProperties = {
  width: "100vw", height: "100dvh", display: "flex", flexDirection: "column",
  background: "var(--bg)", border: "none", borderRadius: 0, overflow: "hidden",
};

const REVIEW_W = 400;

/** Search matcher — every space-separated token must hit SOMETHING on the
 *  slab. Superset of the old one: both category levels and the additional
 *  description are searchable too, because on the floor a piece is known by
 *  what it is ("dod bhumiya jali") at least as often as by its code. Sizes
 *  match loosely: "44x48", "44 48", "44×48×29" all find a 44×48×29 slab. */
function matchSlab(s: ReadySlab, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const dimNorm = s.dimensions.toLowerCase().replace(/[×x]/g, "x").replace(/\s|in/g, "");
  const hay = [
    s.id, s.label, s.description, s.additional_description,
    s.component_section, s.component_element, s.stone, s.quality,
  ].filter(Boolean).join(" ").toLowerCase();
  return q.split(/\s+/).every((tok) => {
    const tokDim = tok.replace(/[×x*]/g, "x");
    return hay.includes(tok) || dimNorm.includes(tokDim);
  });
}

/** How long it has been waiting → the colour everything else keys off. */
function agePalette(since: string | null) {
  if (!since) return { c: "var(--muted)", bg: "var(--bg)", b: "var(--border)", days: 0 };
  const days = (Date.now() - new Date(since).getTime()) / 86400000;
  if (days >= 5) return { c: "#b91c1c", bg: "rgba(220,38,38,0.09)", b: "rgba(220,38,38,0.35)", days };
  if (days >= 2) return { c: "#92400e", bg: "rgba(180,83,9,0.1)", b: "rgba(180,83,9,0.35)", days };
  return { c: "#15803d", bg: "rgba(22,163,74,0.09)", b: "rgba(22,163,74,0.3)", days };
}

function Timer({ since, reworked }: { since: string | null; reworked: boolean }) {
  if (!since) return null;
  const pal = agePalette(since);
  return (
    <span
      title={reworked ? "Ready since rework was completed" : "Ready since carving was approved"}
      style={{ fontSize: 10.5, fontWeight: 800, color: pal.c, background: pal.bg, border: `1px solid ${pal.b}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}
    >
      ⏱ {timeAgoLabel(since)}{reworked ? " · 🛠" : ""}
    </span>
  );
}

/* ── Make Dispatch — temple card ─────────────────────────────────────── */

/**
 * One temple on the Make Dispatch board. The old card said "N slabs · X CFT"
 * and stopped there, so every temple looked the same and you had to open one
 * to learn anything. This one answers, before you open it: what is in there
 * (top components), how long the oldest piece has been waiting, whether
 * anything is urgent — and whether you already started picking for this
 * temple and walked away (`draft`, from the saved selection).
 */
export function TempleCardV2({
  group, matched, draft, onOpen,
}: {
  group: TempleGroup;
  /** The slabs currently matching the board's search (may be a subset). */
  matched: ReadySlab[];
  /** Slabs already ticked for this temple in an earlier, unfinished visit. */
  draft: number;
  onOpen: () => void;
}) {
  const totalCft = matched.reduce((sum, s) => sum + s.cft, 0);
  const urgent = matched.filter((s) => s.priority).length;
  const hasMarble = matched.some((s) => s.isMarble);
  const blocked = matched.filter((s) => s.cancelPending).length;

  // Oldest waiting slab drives the card's accent — a temple sitting on a
  // 9-day-old piece should not look like one whose slabs arrived today.
  const oldest = matched.reduce<string | null>((acc, s) => {
    if (!s.readySince) return acc;
    if (!acc) return s.readySince;
    return new Date(s.readySince) < new Date(acc) ? s.readySince : acc;
  }, null);
  const pal = agePalette(oldest);

  // Top three components by count — "what is actually sitting here".
  const top = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of matched) {
      const k = (s.label || s.component_element || s.component_section || "—").trim().toUpperCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [matched]);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderTop: `4px solid ${pal.c}`,
        borderRadius: 16, padding: "14px 15px 13px",
        display: "flex", flexDirection: "column", gap: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 15.5, fontWeight: 800, lineHeight: 1.25, minWidth: 0, flex: 1 }}>🏛 {group.temple}</span>
        {urgent > 0 && (
          <span title={`${urgent} urgent`} style={{ fontSize: 10.5, fontWeight: 900, color: "#fff", background: "#dc2626", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
            ⚡ {urgent}
          </span>
        )}
      </div>

      {/* The two numbers that decide whether a truck is worth calling. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 24, fontWeight: 900, lineHeight: 1 }}>{matched.length}</span>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>slab{matched.length === 1 ? "" : "s"}</span>
        <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginLeft: "auto" }}>{totalCft.toFixed(2)}</span>
        <span className="muted" style={{ fontSize: 11, fontWeight: 700 }}>CFT</span>
      </div>

      {/* What is in there. */}
      {top.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {top.map(([name, n]) => (
            <span key={name} title={name} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 7px", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name} <span className="muted" style={{ fontWeight: 800 }}>×{n}</span>
            </span>
          ))}
          {hasMarble && (
            <span title="This temple has marble slabs too — all stones go in one dispatch list." style={{ fontSize: 9.5, fontWeight: 800, color: "#b45309", background: "rgba(180,83,9,0.12)", padding: "2px 7px", borderRadius: 6, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
              + MARBLE
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 20 }}>
        {oldest && (
          <span style={{ fontSize: 10.5, fontWeight: 800, color: pal.c, background: pal.bg, border: `1px solid ${pal.b}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
            ⏱ oldest {timeAgoLabel(oldest)}
          </span>
        )}
        {blocked > 0 && (
          <span title="Cancel requested — these can't go on a truck yet" style={{ fontSize: 10, fontWeight: 800, color: "#b91c1c", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.3)", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
            🚫 {blocked} locked
          </span>
        )}
      </div>

      {/* An unfinished pick from an earlier visit — otherwise invisible until
          you open the temple and wonder why things are already ticked. */}
      {draft > 0 && (
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--gold-dark)", background: "rgba(184,115,51,0.09)", border: "1px solid rgba(184,115,51,0.3)", borderRadius: 8, padding: "5px 9px" }}>
          ✓ {draft} already picked — pick up where you left off
        </div>
      )}

      <button
        type="button"
        onClick={onOpen}
        style={{
          marginTop: "auto", background: "var(--gold-dark)", color: "#fff", border: "none",
          borderRadius: 11, padding: "12px 16px", fontSize: 14.5, fontWeight: 800, cursor: "pointer", width: "100%",
        }}
      >
        🚚 Dispatch
      </button>
    </div>
  );
}

/* ── the slab card ───────────────────────────────────────────────────── */

function SlabCardV2({
  s, selected, order, flash, onToggle, carvingDispatchTransfer,
}: {
  s: ReadySlab;
  selected: boolean;
  /** 1-based position in the pick order — shown in the tick box when ticked. */
  order: number | null;
  flash: boolean;
  onToggle: () => void;
  carvingDispatchTransfer?: boolean;
}) {
  const awaitingTransfer = !!carvingDispatchTransfer && s.hasCarving && !s.receivedAtDispatch;
  const locked = s.cancelPending || awaitingTransfer;
  const accent = s.cancelPending ? "#b91c1c"
    : awaitingTransfer ? "#4f46e5"
    : selected ? "var(--gold-dark)"
    : s.storageSource === "carving" ? "#7c3aed"
    : s.storageSource === "dispatch" ? "#2563eb"
    : s.isMarble ? "#b45309" : "#0d9488";

  const c1 = s.component_section?.trim();
  const c2 = s.component_element?.trim();
  const lbl = s.label?.trim();
  const desc = s.description?.trim();
  const add = s.additional_description?.trim();

  return (
    <div
      id={`v2slab-${s.id}`}
      onClick={locked ? undefined : onToggle}
      role={locked ? undefined : "button"}
      tabIndex={locked ? undefined : 0}
      onKeyDown={locked ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      title={
        s.cancelPending ? "Cancel requested — locked until the owner decides"
          : awaitingTransfer ? "Awaiting carving→dispatch transfer — bring it in on the Slab Transfer page"
          : undefined
      }
      style={{
        background: s.cancelPending ? "rgba(185,28,28,0.06)"
          : awaitingTransfer ? "rgba(79,70,229,0.05)"
          : selected ? "rgba(184,115,51,0.09)" : "var(--surface)",
        border: `1px solid ${selected ? "var(--gold-dark)" : locked ? accent : "var(--border)"}`,
        borderLeft: `5px solid ${accent}`,
        borderRadius: 12, padding: "10px 12px 9px",
        display: "flex", flexDirection: "column", gap: 6,
        opacity: awaitingTransfer ? 0.85 : 1,
        cursor: locked ? "not-allowed" : "pointer", userSelect: "none",
        boxShadow: flash ? "0 0 0 3px rgba(184,115,51,0.55)" : selected ? "0 1px 4px rgba(184,115,51,0.18)" : "none",
        transition: "box-shadow .18s ease, background .12s ease, border-color .12s ease",
      }}
    >
      {/* code row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {!locked && (
          <span
            aria-hidden
            style={{
              width: 22, height: 22, borderRadius: 7, flexShrink: 0,
              border: selected ? "none" : "2px solid var(--border)",
              background: selected ? "var(--gold-dark)" : "transparent",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: order && order > 9 ? 10.5 : 12, fontWeight: 900, fontFamily: order ? "ui-monospace, monospace" : "inherit",
            }}
          >
            {selected ? (order ?? "✓") : ""}
          </span>
        )}
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.01em" }}>{s.id}</code>
        {s.priority && <span title="Urgent" style={{ fontSize: 13 }}>⚡</span>}
        {s.storageSource && (
          <span title={s.storageSource === "carving" ? "From storage (cut-done)" : "From storage (ready)"} style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: s.storageSource === "carving" ? "#7c3aed" : "#2563eb", borderRadius: 4, padding: "1px 6px", letterSpacing: "0.03em" }}>
            📦 STORAGE
          </span>
        )}
        <span style={{ marginLeft: "auto" }}><Timer since={s.readySince} reworked={s.reworked} /></span>
      </div>

      {s.cancelPending && (
        <div style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: "#b91c1c", borderRadius: 4, padding: "2px 7px", alignSelf: "flex-start", letterSpacing: "0.03em" }}>
          🚫 CANCEL REQUESTED — waiting for owner
        </div>
      )}
      {awaitingTransfer && !s.cancelPending && (
        <div style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: "#4f46e5", borderRadius: 4, padding: "2px 7px", alignSelf: "flex-start", letterSpacing: "0.03em" }}>
          🚚 AWAITING DISPATCH TRANSFER — bring in on Slab Transfer
        </div>
      )}

      {/* what it IS — the part the old card whispered at 9.5px */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        {(c1 || c2) && (
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={[c1, c2].filter(Boolean).join(" › ")}>
            {c1}{c1 && c2 ? " › " : ""}{c2}
          </div>
        )}
        {lbl && (
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lbl}>
            {lbl}
          </div>
        )}
        {desc && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.35 }} title={desc}>{desc}</div>
        )}
        {add && (
          <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--muted-light)", lineHeight: 1.3 }} title={add}>+ {add}</div>
        )}
      </div>

      {/* foot row — size, CFT, stone, quality */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: 11.5, borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{s.dimensions}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "var(--gold-dark)" }}>{s.cft.toFixed(2)} CFT</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <span className="muted">{s.stone ?? "—"}</span>
          {s.quality && (
            <span style={{ fontSize: 10, fontWeight: 800, color: s.quality === "A" ? "#15803d" : "#b45309", background: s.quality === "A" ? "rgba(22,163,74,0.1)" : "rgba(180,83,9,0.1)", borderRadius: 999, padding: "1px 8px" }}>
              {s.quality}
            </span>
          )}
          {s.isMarble && (
            <span style={{ fontSize: 9.5, fontWeight: 800, color: "#b45309", background: "rgba(180,83,9,0.1)", borderRadius: 4, padding: "1px 6px", letterSpacing: "0.04em" }}>MARBLE</span>
          )}
        </span>
      </div>
    </div>
  );
}

/* ── the picker ──────────────────────────────────────────────────────── */

export function DispatchPickerV2({
  group, siteInfo, handlingMan, onClose, carvingDispatchTransfer,
}: {
  group: TempleGroup;
  siteInfo: SiteInfo | null;
  handlingMan: { name?: string; phone?: string } | null;
  onClose: () => void;
  /** Carving→Dispatch lane (developer Settings) — greys un-brought-in slabs. */
  carvingDispatchTransfer?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [parking, setParking] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mig 163 — weigh per slab (default) OR one whole-truck weight.
  const [weightMode, setWeightMode] = useState<"slab" | "truck">("slab");
  const [truckKg, setTruckKg] = useState("");
  // Mig 130 — optional per-slab weight (kg). Keyed by slab id; "" = not entered.
  const [weights, setWeights] = useState<Record<string, string>>({});

  // Keep the pick while the user steps away and comes back — same key and
  // same semantics as the v1 picker, so a draft started in either UI is
  // picked up by the other. The stored ARRAY order is the pick order, and
  // Set preserves insertion order, so #1..#N survives a reopen.
  const selKey = `dispatch-sel:${group.temple}`;
  // Restore the saved pick. MUST be declared above the persist effect below —
  // effects fire in declaration order and that one writes on mount too, so
  // from second place it would only ever see a key it had just emptied.
  //
  // Aug 2026 fix: the old restore intersected the saved ids with `group.slabs`
  // right here, but that is only the temple's READY list — storage slabs are
  // fetched lazily and are not in it yet, so every storage slab the user had
  // ticked was silently dropped on reopen while the ready ones survived. An id
  // that is NOT in the ready list can only have come from Storage, so keep it,
  // switch Storage on, and do the pruning once that list has actually landed.
  const [pendingPrune, setPendingPrune] = useState(false);
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(selKey) : null;
      if (!raw) return;
      const ids = (JSON.parse(raw) as string[]).filter((id) => typeof id === "string");
      if (ids.length === 0) return;
      const readyIds = new Set(group.slabs.map((s) => s.id));
      setSelected(new Set(ids));
      setReviewOpen(true);
      if (ids.some((id) => !readyIds.has(id))) {
        setInclStorage(true);
        setPendingPrune(true);
        void ensureStorage();
      }
    } catch {
      /* ignore corrupt/blocked storage */
    }
    // Restore once when the picker opens; `group` is fixed for this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (selected.size === 0) window.sessionStorage.removeItem(selKey);
      else window.sessionStorage.setItem(selKey, JSON.stringify([...selected]));
    } catch {
      /* ignore */
    }
  }, [selected, selKey]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Mig 125 follow-on — optionally pull this temple's storage slabs into the
  // picker: carving storage (parked cut-done) + dispatch storage (parked
  // completed). Lazily loaded the first time the toggle goes on.
  const [inclStorage, setInclStorage] = useState(false);
  const [storage, setStorage] = useState<{ carving: ReadySlab[]; dispatch: ReadySlab[] }>({ carving: [], dispatch: [] });
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [loadingStorage, setLoadingStorage] = useState(false);
  async function ensureStorage() {
    if (storageLoaded || loadingStorage) return;
    setLoadingStorage(true);
    try {
      const res = await fetchTempleStorageSlabsAction(group.temple);
      setStorage({ carving: res.carving, dispatch: res.dispatch });
      setStorageLoaded(true);
    } catch { /* leave empty — user can retry the toggle */ }
    finally { setLoadingStorage(false); }
  }

  // …and the prune, once the storage list has actually landed. An id that is
  // in neither list is genuinely gone (dispatched, cancelled) and drops out,
  // which is what made the picker self-refreshing in the first place. If
  // nothing storage-sourced survived, the toggle goes back off so a stale
  // saved id does not leave Storage switched on for no reason.
  useEffect(() => {
    if (!pendingPrune || !storageLoaded) return;
    const readyIds = new Set(group.slabs.map((s) => s.id));
    const storageIds = new Set([...storage.carving, ...storage.dispatch].map((s) => s.id));
    const kept = [...selected].filter((id) => readyIds.has(id) || storageIds.has(id));
    setPendingPrune(false);
    if (kept.length !== selected.size) setSelected(new Set(kept));
    if (!kept.some((id) => !readyIds.has(id))) setInclStorage(false);
  }, [pendingPrune, storageLoaded, selected, storage, group.slabs]);

  const allSlabs = useMemo(
    () => [...group.slabs, ...(inclStorage ? [...storage.carving, ...storage.dispatch] : [])],
    [group.slabs, inclStorage, storage],
  );
  const matched = useMemo(() => allSlabs.filter((s) => matchSlab(s, query)), [allSlabs, query]);

  // Only count/post/park slabs that are actually VISIBLE now. A storage slab
  // selected then hidden (Storage toggle off) must not be dispatched — raw
  // `selected` is kept for the per-card tick + the re-toggle restore.
  const selSlabs = useMemo(() => allSlabs.filter((s) => selected.has(s.id)), [allSlabs, selected]);
  const selCft = selSlabs.reduce((sum, s) => sum + s.cft, 0);
  const selCount = selSlabs.length;

  // The review list — SELECTION order, first ticked to last. Set iteration
  // order is insertion order, so this needs no extra state to maintain.
  const orderedSel = useMemo(() => {
    const byId = new Map(allSlabs.map((s) => [s.id, s] as const));
    return [...selected].map((id) => byId.get(id)).filter((s): s is ReadySlab => !!s);
  }, [selected, allSlabs]);
  const orderOf = useMemo(() => {
    const m = new Map<string, number>();
    orderedSel.forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [orderedSel]);
  const selectedIds = orderedSel.map((s) => s.id);

  // Cards: ticked first (so the pick stays together) unless searching.
  const displaySlabs = useMemo(() => {
    if (query.trim()) return matched;
    const sel = matched.filter((s) => selected.has(s.id));
    const rest = matched.filter((s) => !selected.has(s.id));
    return [...sel, ...rest];
  }, [matched, selected, query]);

  // "Send → storage" only parks FRESH ready slabs; storage-sourced ones are
  // already parked and would silently no-op.
  const parkableSlabs = selSlabs.filter((s) => !s.storageSource);
  const parkableIds = parkableSlabs.map((s) => s.id);
  const parkCount = parkableSlabs.length;

  // Per-slab weight is entered in KG (blank rows skipped); challan totals in tonnes.
  const weightsParsed: Record<string, number> = {};
  for (const s of selSlabs) {
    const n = Number(weights[s.id]);
    if (Number.isFinite(n) && n > 0) weightsParsed[s.id] = n;
  }
  const totalKg = Object.values(weightsParsed).reduce((a, b) => a + b, 0);
  const totalTonnes = totalKg / 1000;
  const truckKgNum = Math.max(0, Number(truckKg) || 0);
  const truckTonnes = truckKgNum / 1000;

  // Identical slabs (same label + description + size) weigh the same — one
  // weight entry fills the whole group.
  const weightGroups: Array<{ key: string; sample: ReadySlab; ids: string[] }> = [];
  {
    const m = new Map<string, { key: string; sample: ReadySlab; ids: string[] }>();
    for (const s of selSlabs) {
      const key = `${(s.label ?? "").trim().toLowerCase()}|${(s.description ?? "").trim().toLowerCase()}|${s.dimensions}`;
      const g = m.get(key);
      if (g) g.ids.push(s.id);
      else m.set(key, { key, sample: s, ids: [s.id] });
    }
    weightGroups.push(...m.values());
  }
  function setGroupWeight(ids: string[], val: string) {
    setWeights((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = val;
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Review row → find the card. Scrolls it into the middle of the grid and
   *  flashes the border, so cross-checking is one tap, not a hunt. */
  function locate(id: string) {
    const el = typeof document !== "undefined" ? document.getElementById(`v2slab-${id}`) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1300);
  }

  // Mig 132 — pending-cancel slabs can't go on a truck; Select-all skips them.
  // Carving→Dispatch lane ON → also skip carving slabs not yet brought in.
  const selectableMatched = matched.filter(
    (s) => !s.cancelPending && !(carvingDispatchTransfer && s.hasCarving && !s.receivedAtDispatch),
  );
  const allMatchedSelected = selectableMatched.length > 0 && selectableMatched.every((s) => selected.has(s.id));

  return (
    <div style={overlay}>
      <div style={panelFull} role="dialog" aria-modal="true" aria-label={`Dispatch from ${group.temple}`}>
        {/* ── header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", background: "var(--surface)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={step === 2 ? () => setStep(1) : onClose}
            disabled={submitting}
            style={{ background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 800, cursor: submitting ? "not-allowed" : "pointer", color: "var(--text)", whiteSpace: "nowrap" }}
          >
            ← {step === 2 ? "Slabs" : "Temples"}
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>🏛 {group.temple}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>
              {step === 1
                ? "Step 1 of 2 — tick the slabs going on the truck · जो slab भेजनी है उन्हें छुएँ"
                : "Step 2 of 2 — weight & notes · वज़न भरें"}
            </div>
          </div>

          {/* Live tally — the one number that must always be on screen. */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, background: selCount > 0 ? "rgba(184,115,51,0.1)" : "var(--bg)", border: `1.5px solid ${selCount > 0 ? "var(--gold-dark)" : "var(--border)"}`, borderRadius: 10, padding: "6px 12px", whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: selCount > 0 ? "var(--gold-dark)" : "var(--muted)" }}>{selCount}</span>
              <span className="muted" style={{ fontSize: 11, fontWeight: 700 }}>picked</span>
              <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, monospace", marginLeft: 4 }}>{selCft.toFixed(2)}</span>
              <span className="muted" style={{ fontSize: 10.5, fontWeight: 700 }}>CFT</span>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" style={{ background: "none", border: "none", fontSize: 26, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }}>×</button>
          </div>
        </div>

        {step === 1 ? (
          <>
            {/* ── toolbar ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 18px", background: "var(--surface)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 520 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.6 }}>🔍</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search code / label / category / description / size…"
                  style={{ width: "100%", padding: "10px 12px 10px 36px", fontSize: 14, border: "1.5px solid var(--border)", borderRadius: 11, background: "var(--bg)", color: "var(--text)" }}
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", background: "var(--border)", border: "none", borderRadius: 999, width: 22, height: 22, fontSize: 11, fontWeight: 800, cursor: "pointer", color: "var(--text)" }}>✕</button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (allMatchedSelected) for (const s of selectableMatched) next.delete(s.id);
                    else for (const s of selectableMatched) next.add(s.id);
                    return next;
                  });
                }}
                style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 800, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {allMatchedSelected ? "✕ Clear shown" : `✓ Select all (${selectableMatched.length})`}
              </button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "#6d28d9", border: "1.5px solid rgba(109,40,217,0.3)", background: "rgba(109,40,217,0.05)", borderRadius: 10, padding: "9px 12px", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={inclStorage} onChange={(e) => { setInclStorage(e.target.checked); if (e.target.checked) ensureStorage(); }} />
                📦 Storage
                {loadingStorage ? <span className="muted" style={{ fontWeight: 600 }}>…</span>
                  : storageLoaded && <span className="muted" style={{ fontWeight: 700 }}>· {storage.carving.length + storage.dispatch.length}</span>}
              </label>
              <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", marginLeft: "auto" }}>
                {query.trim() ? `${matched.length} match${matched.length === 1 ? "" : "es"}` : `${matched.length} slab${matched.length === 1 ? "" : "s"}`}
              </span>
            </div>

            {/* ── grid + review drawer ──
                The drawer is a grid COLUMN that animates from 0 → 400px, so
                opening it slides the panel in from the right and reflows the
                cards rather than covering them. */}
            <div
              style={{
                flex: 1, minHeight: 0, display: "grid",
                gridTemplateColumns: reviewOpen ? `1fr ${REVIEW_W}px` : "1fr 0px",
                transition: "grid-template-columns .28s cubic-bezier(.4,0,.2,1)",
              }}
            >
              {/* cards */}
              <div style={{ minWidth: 0, overflowY: "auto", padding: "14px 18px 18px", position: "relative" }}>
                {matched.length === 0 ? (
                  <div className="muted" style={{ padding: "40px 0", textAlign: "center", fontSize: 14 }}>
                    {query.trim() ? `No slab matches “${query}”.` : "Nothing here."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 11 }}>
                    {displaySlabs.map((s) => (
                      <SlabCardV2
                        key={s.id}
                        s={s}
                        selected={selected.has(s.id)}
                        order={orderOf.get(s.id) ?? null}
                        flash={flashId === s.id}
                        onToggle={() => toggle(s.id)}
                        carvingDispatchTransfer={carvingDispatchTransfer}
                      />
                    ))}
                  </div>
                )}

                {/* the arrow — opens the review drawer */}
                {!reviewOpen && (
                  <button
                    type="button"
                    onClick={() => setReviewOpen(true)}
                    title="Review what you have picked"
                    style={{
                      position: "sticky", bottom: 14, float: "right", marginTop: 10,
                      display: "inline-flex", alignItems: "center", gap: 8,
                      background: selCount > 0 ? "var(--gold-dark)" : "var(--surface)",
                      color: selCount > 0 ? "#fff" : "var(--text)",
                      border: `1.5px solid ${selCount > 0 ? "var(--gold-dark)" : "var(--border)"}`,
                      borderRadius: 999, padding: "10px 16px", fontSize: 13.5, fontWeight: 800,
                      cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.18)", zIndex: 2,
                    }}
                  >
                    ‹ Review <span style={{ fontFamily: "ui-monospace, monospace" }}>{selCount}</span>
                  </button>
                )}
              </div>

              {/* review drawer */}
              <aside
                aria-label="Selected slabs — review"
                style={{
                  minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column",
                  background: "var(--surface)",
                }}
              >
                <div style={{ width: REVIEW_W, boxSizing: "border-box", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800 }}>✓ Review your pick</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>In the order you ticked them</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReviewOpen(false)}
                      title="Hide review"
                      style={{ marginLeft: "auto", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 9, padding: "7px 11px", fontSize: 13, fontWeight: 800, cursor: "pointer", color: "var(--text)" }}
                    >
                      ›
                    </button>
                  </div>

                  <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                    {orderedSel.length === 0 ? (
                      <div className="muted" style={{ padding: "34px 10px", textAlign: "center", fontSize: 12.5, lineHeight: 1.6 }}>
                        Nothing picked yet.<br />Tick slabs on the left and they will line up here, first to last.
                      </div>
                    ) : (
                      orderedSel.map((s, i) => (
                        <div
                          key={s.id}
                          onClick={() => locate(s.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); locate(s.id); } }}
                          title="Show this slab in the grid"
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 9,
                            background: flashId === s.id ? "rgba(184,115,51,0.14)" : "var(--bg)",
                            border: "1px solid var(--border)", borderLeft: `4px solid ${s.isMarble ? "#b45309" : "#0d9488"}`,
                            borderRadius: 10, padding: "8px 9px", cursor: "pointer",
                            transition: "background .15s ease",
                          }}
                        >
                          <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: "var(--gold-dark)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: i + 1 > 9 ? 10 : 11.5, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>
                            {i + 1}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12 }}>{s.id}</code>
                              {s.priority && <span title="Urgent" style={{ fontSize: 11 }}>⚡</span>}
                              {s.storageSource && <span title="From storage" style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", background: s.storageSource === "carving" ? "#7c3aed" : "#2563eb", borderRadius: 3, padding: "1px 5px" }}>📦</span>}
                            </div>
                            {(s.label || s.component_element || s.component_section) && (
                              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {s.label || s.component_element || s.component_section}
                              </div>
                            )}
                            {(s.component_section || s.description) && (
                              <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={[s.component_section, s.component_element, s.description].filter(Boolean).join(" · ")}>
                                {[s.component_section, s.description].filter(Boolean).join(" · ")}
                              </div>
                            )}
                            <div style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace", color: "var(--muted)", marginTop: 2 }}>
                              {s.dimensions} · {s.cft.toFixed(2)} CFT
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggle(s.id); }}
                            aria-label={`Untick ${s.id}`}
                            title="Untick this slab"
                            style={{ flexShrink: 0, background: "transparent", border: "1.5px solid var(--border)", color: "#b91c1c", borderRadius: 7, width: 26, height: 26, fontSize: 13, fontWeight: 900, cursor: "pointer", lineHeight: 1 }}
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                      {selCount} slab{selCount === 1 ? "" : "s"} · <span style={{ fontFamily: "ui-monospace, monospace" }}>{selCft.toFixed(2)}</span> CFT
                    </span>
                    {selCount > 0 && (
                      <button
                        type="button"
                        onClick={() => { setSelected(new Set()); try { window.sessionStorage.removeItem(selKey); } catch { /* ignore */ } }}
                        style={{ marginLeft: "auto", padding: "6px 11px", fontSize: 11.5, fontWeight: 800, borderRadius: 8, border: "1.5px solid #b91c1c", background: "rgba(185,28,28,0.06)", color: "#b91c1c", cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        ✕ Clear all
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            </div>

            {/* ── footer ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", background: "var(--surface)", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <button type="button" className="ghost-button" onClick={onClose} style={{ fontSize: 13.5 }}>Cancel</button>
              <button
                type="button"
                disabled={parkCount === 0 || parking}
                onClick={async () => {
                  if (parkCount === 0) return;
                  if (!window.confirm(`Send ${parkCount} slab${parkCount !== 1 ? "s" : ""} to storage (out of Make Dispatch)?`)) return;
                  setParking(true);
                  try {
                    const res = await parkDispatchSlabsAction(parkableIds);
                    if (res.ok) { onClose(); router.refresh(); }
                    else window.alert(res.error);
                  } finally { setParking(false); }
                }}
                style={{ fontSize: 13, fontWeight: 800, padding: "11px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: parkCount === 0 ? "var(--muted)" : "var(--text)", cursor: parkCount === 0 || parking ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
              >
                {parking ? "Moving…" : `🗄 Send ${parkCount || ""} → storage`}
              </button>
              <button
                type="button"
                disabled={selCount === 0}
                onClick={() => setStep(2)}
                style={{
                  marginLeft: "auto", background: selCount === 0 ? "var(--border)" : "var(--gold-dark)",
                  color: selCount === 0 ? "var(--muted)" : "#fff", border: "none", borderRadius: 12,
                  padding: "13px 26px", fontSize: 15.5, fontWeight: 800, cursor: selCount === 0 ? "not-allowed" : "pointer",
                }}
              >
                Weight &amp; send → ({selCount} slab{selCount === 1 ? "" : "s"})
              </button>
            </div>
          </>
        ) : (
          /* ── Step 2: weight + notes (vehicle/driver come at Check & verify) ── */
          <form
            action={(fd) => {
              setSubmitting(true);
              // these slabs are leaving the ready list — drop the saved selection
              try { window.sessionStorage.removeItem(selKey); } catch { /* ignore */ }
              return createDispatchAction(fd);
            }}
            style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          >
            <FormPendingOverlay label="Sending for approval…" />
            <input type="hidden" name="temple" value={group.temple} />
            <input type="hidden" name="slab_ids" value={JSON.stringify(selectedIds)} />
            <input type="hidden" name="slab_weights" value={JSON.stringify(weightsParsed)} />
            <input type="hidden" name="weight_mode" value={weightMode} />
            <input type="hidden" name="truck_weight" value={weightMode === "truck" ? String(truckTonnes) : ""} />

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, WebkitOverflowScrolling: "touch" }}>
              {/* Mig 130 — site info that will print on the challan. */}
              <div style={{ background: "rgba(184,115,51,0.06)", border: "1.5px solid rgba(184,115,51,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.6 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  📍 Site info — prints on the challan
                </div>
                {siteInfo?.site_location || siteInfo?.site_incharge_name || siteInfo?.installer_name ? (
                  <>
                    {siteInfo.site_location && <div><strong>Site:</strong> {siteInfo.site_location}</div>}
                    {siteInfo.site_incharge_name && (
                      <div><strong>Client incharge:</strong> {siteInfo.site_incharge_name}{siteInfo.site_incharge_phone ? ` · ${siteInfo.site_incharge_phone}` : ""}</div>
                    )}
                    {siteInfo.installer_name && (
                      <div><strong>Installation by:</strong> {siteInfo.installer_name}{siteInfo.installer_phone ? ` · ${siteInfo.installer_phone}` : ""}</div>
                    )}
                  </>
                ) : (
                  <div className="muted">
                    No site info saved for this temple yet — add it in <strong>Settings → Temple Codes</strong> (site location, client incharge, installer) and it will auto-print on every challan.
                  </div>
                )}
                {handlingMan?.name && (
                  <div><strong>Dispatch incharge (MTCPL):</strong> {handlingMan.name}{handlingMan.phone ? ` · ${handlingMan.phone}` : ""}</div>
                )}
              </div>

              <div style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.25)", borderRadius: 10, padding: "9px 13px", fontSize: 12, color: "var(--muted)" }}>
                🚚 Vehicle no. &amp; driver are added later on the <strong>Check &amp; verify</strong> page, when the truck is loaded.
              </div>

              <label className="stack">
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Notes (optional)</span>
                <textarea name="notes" rows={2} style={{ resize: "vertical", fontFamily: "inherit", fontSize: 14 }} />
              </label>

              {/* Weight — entered ONCE per identical group (same label + size). */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    ⚖ Weight <span style={{ fontWeight: 600, textTransform: "none" }}>(kg · optional)</span>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {selSlabs.length} slab{selSlabs.length === 1 ? "" : "s"} · {selCft.toFixed(2)} CFT
                    {weightMode === "truck"
                      ? truckKgNum > 0 && <span style={{ color: "#0d9488" }}> · 🚚 {Math.round(truckKgNum).toLocaleString("en-IN")} kg ({truckTonnes.toFixed(3)} T)</span>
                      : totalKg > 0 && <span style={{ color: "#15803d" }}> · {Math.round(totalKg).toLocaleString("en-IN")} kg ({totalTonnes.toFixed(3)} T)</span>}
                  </span>
                </div>
                <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
                  {([["slab", "Per slab"], ["truck", "Whole truck"]] as const).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setWeightMode(m)}
                      style={{
                        padding: "6px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", border: "none",
                        background: weightMode === m ? (m === "truck" ? "#0d9488" : "#2563eb") : "var(--bg)",
                        color: weightMode === m ? "#fff" : "var(--muted)",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
                  {weightMode === "truck"
                    ? "Enter ONE weight for the whole truck load. Challan totals in tonnes."
                    : "Enter the weight of ONE slab — same-size slabs auto-fill. Challan totals in tonnes."}
                </div>
                {weightMode === "truck" ? (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
                    🚚 Truck load weight
                    <input
                      type="text"
                      inputMode="numeric"
                      value={truckKg}
                      onChange={(e) => setTruckKg(e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="kg"
                      style={{ width: 130, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 14, padding: "9px 11px" }}
                    />
                    <span style={{ color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{truckKgNum > 0 ? `= ${truckTonnes.toFixed(3)} T` : "kg"}</span>
                  </label>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {weightGroups.map((g) => {
                      const each = Number((weights[g.ids[0]] ?? "").replace(/[^\d]/g, "")) || 0;
                      const lineKg = each > 0 ? each * g.ids.length : 0;
                      const multi = g.ids.length > 1;
                      return (
                        <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 11px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, flexWrap: "wrap" }}>
                          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>
                              {g.sample.label || "—"}
                              <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--muted)", fontWeight: 500 }}> · {g.sample.dimensions}</span>
                            </div>
                            {g.sample.description && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{g.sample.description}</div>}
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                              {g.ids.map((id) => (
                                <span key={id} style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 7px" }}>{id}</span>
                              ))}
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                value={weights[g.ids[0]] ?? ""}
                                onChange={(e) => setGroupWeight(g.ids, e.target.value.replace(/[^\d]/g, ""))}
                                style={{ width: 92, fontSize: 14, padding: "8px 10px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}
                              />
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>kg{multi ? " / slab" : ""}</span>
                            </label>
                            {lineKg > 0 && multi && (
                              <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{g.ids.length} × {each.toLocaleString("en-IN")} = {lineKg.toLocaleString("en-IN")} kg</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", background: "var(--surface)", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <button type="button" className="ghost-button" onClick={() => setStep(1)} disabled={submitting} style={{ fontSize: 14 }}>
                ← Change slabs
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  marginLeft: "auto", background: submitting ? "var(--border)" : "#15803d", color: "#fff",
                  border: "none", borderRadius: 12, padding: "13px 26px", fontSize: 15.5, fontWeight: 800,
                  cursor: submitting ? "wait" : "pointer",
                }}
              >
                {submitting ? "Creating dispatch…" : `🚚 Send for approval (${selCount})`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
