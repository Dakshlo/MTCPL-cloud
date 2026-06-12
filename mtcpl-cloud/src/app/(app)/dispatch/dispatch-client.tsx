"use client";

/**
 * Dispatch Station client — June 2026 makeover (Daksh).
 *
 * Built for non-technical operators: big buttons, slab CARDS (not dense
 * rows), one obvious action per screen.
 *
 *   📦 Make Dispatch   temples collapsed by default → expand to browse
 *                      slab cards (label + description + ready-since
 *                      timer). One big "Dispatch" button per temple →
 *                      a centre peek: search + tap-to-select cards →
 *                      truck details (with recent-truck quick fill).
 *   🕒 Waiting OK      provisional dispatches for senior sign-off,
 *                      plus the 🚚 Truck history peek.
 *   🚛 On the road     print challan / mark delivered (2 proof photos
 *                      mandatory — mig 129).
 *   ✅ Delivered       archive with the proof photo thumbnails.
 *
 * The old "Needs work" band moved to its own page: /dispatch/rework
 * (the 🛠 Rework Tunnel button in the header).
 */

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeliverModal } from "./deliver-modal";
import { EditSlabsModal } from "./edit-slabs-modal";
import { createDispatchAction, undoDispatchAction, approveDispatchAction, cancelDispatchAction } from "./actions";
import { timeAgoLabel } from "./time-ago";

type Tab = "ready" | "provisional" | "out_for_delivery" | "delivered";

/** Format challan number as CHLN-0001. Falls back to UUID prefix if the
 *  row predates migration 011 (shouldn't happen — migration backfills). */
function chalanLabel(n: number | null, fallbackId: string): string {
  if (n != null) return `CHLN-${String(n).padStart(4, "0")}`;
  return `DISP-${fallbackId.slice(0, 8).toUpperCase()}`;
}

export type ReadySlab = {
  id: string;
  label: string | null;
  description: string | null;
  temple: string;
  stone: string | null;
  quality: string | null;
  dimensions: string;
  cft: number;
  priority: boolean;
  isMarble: boolean;
  /** Timer source — carving approval time, or rework-cleared time if the
   *  slab went through the Rework Tunnel. */
  readySince: string | null;
  reworked: boolean;
};

export type ProvisionalRow = {
  id: string;
  challan_number: number | null;
  temple: string;
  vehicle_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  dispatched_at: string;
  expected_delivery_date: string | null;
  dispatcher: string | null;
  notes: string | null;
  slabCount: number;
  slabCftTotal: number;
};

export type OutForDeliveryRow = ProvisionalRow;

export type DeliveredRow = OutForDeliveryRow & {
  delivered_at: string;
  delivered_by_name: string | null;
  receiver_name: string | null;
  delivery_note: string | null;
  /** Mig 129 — mandatory delivery proofs (older rows may be null). */
  proofSiteUrl: string | null;
  proofChallanUrl: string | null;
};

export type LegacyDispatch = {
  slab_id: string;
  dispatched_at: string;
  dispatched_by_name: string | null;
  note: string | null;
};

export type TruckTrip = {
  vehicle_no: string;
  driver_name: string | null;
  driver_phone: string | null;
  temple: string;
  dispatched_at: string;
  challan_number: number | null;
  status: "provisional" | "on_road" | "delivered";
};

/** Mig 130 — per-temple site info (Settings → Temple Codes). Auto-shown
 *  on the dispatch form and printed on the challan. */
export type SiteInfo = {
  site_location: string | null;
  site_incharge_name: string | null;
  site_incharge_phone: string | null;
  installer_name: string | null;
  installer_phone: string | null;
};

// ─── tiny shared bits ────────────────────────────────────────────────────

const peekOverlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1500, background: "rgba(15,12,6,0.6)",
  backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
};
const peekPanel: CSSProperties = {
  width: "100%", maxWidth: 980, maxHeight: "92vh", display: "flex", flexDirection: "column",
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18,
  boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden",
};
const bigSearch: CSSProperties = {
  flex: "1 1 260px", padding: "12px 16px", fontSize: 15, border: "1.5px solid var(--border)",
  borderRadius: 12, background: "var(--bg)", color: "var(--text)",
};

/** Search matcher — every space-separated token must hit code / label /
 *  description / stone / size. Sizes match loosely: "44x48", "44 48",
 *  "44×48×29" all find a 44×48×29 slab. */
function slabMatches(s: ReadySlab, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const dimNorm = s.dimensions.toLowerCase().replace(/[×x]/g, "x").replace(/\s|in/g, "");
  const hay = `${s.id} ${s.label ?? ""} ${s.description ?? ""} ${s.stone ?? ""} ${s.quality ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((tok) => {
    const tokDim = tok.replace(/[×x*]/g, "x");
    return hay.includes(tok) || dimNorm.includes(tokDim);
  });
}

/** Ready-since timer chip — green when fresh, amber after 2 days, red
 *  after 5. The 🛠 marks slabs that came through the Rework Tunnel. */
function ReadyTimer({ since, reworked }: { since: string | null; reworked: boolean }) {
  if (!since) return null;
  const days = (Date.now() - new Date(since).getTime()) / 86400000;
  const pal = days >= 5
    ? { c: "#b91c1c", bg: "rgba(220,38,38,0.09)", b: "rgba(220,38,38,0.35)" }
    : days >= 2
      ? { c: "#92400e", bg: "rgba(180,83,9,0.1)", b: "rgba(180,83,9,0.35)" }
      : { c: "#15803d", bg: "rgba(22,163,74,0.09)", b: "rgba(22,163,74,0.3)" };
  return (
    <span
      title={reworked ? "Ready since rework was completed" : "Ready since carving was approved"}
      style={{ fontSize: 10.5, fontWeight: 800, color: pal.c, background: pal.bg, border: `1px solid ${pal.b}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}
    >
      ⏱ {timeAgoLabel(since)}{reworked ? " · 🛠" : ""}
    </span>
  );
}

/** One slab card — used in the browse grid (read-only) and inside the
 *  dispatch peek (tap to select). */
function SlabCard({
  s, selected, onToggle,
}: {
  s: ReadySlab;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const selectable = !!onToggle;
  return (
    <div
      onClick={onToggle}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={selectable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle!(); } } : undefined}
      style={{
        background: selected ? "rgba(184,115,51,0.1)" : "var(--surface)",
        border: selected ? "2px solid var(--gold-dark)" : "1px solid var(--border)",
        borderLeft: selected ? "6px solid var(--gold-dark)" : `5px solid ${s.isMarble ? "#b45309" : "#0d9488"}`,
        borderRadius: 12, padding: "10px 12px",
        display: "flex", flexDirection: "column", gap: 5,
        cursor: selectable ? "pointer" : "default", userSelect: "none",
        transition: "border-color .12s ease, background .12s ease, transform .12s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {selectable && (
          <span
            aria-hidden
            style={{
              width: 21, height: 21, borderRadius: 7, flexShrink: 0,
              border: selected ? "none" : "2px solid var(--border)",
              background: selected ? "var(--gold-dark)" : "transparent",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 900,
            }}
          >
            {selected ? "✓" : ""}
          </span>
        )}
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5 }}>{s.id}</code>
        {s.priority && <span title="Urgent" style={{ fontSize: 13 }}>⚡</span>}
        <span style={{ marginLeft: "auto" }}><ReadyTimer since={s.readySince} reworked={s.reworked} /></span>
      </div>
      {(s.label || s.description) && (
        <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>
          <strong>{s.label ?? ""}</strong>
          {s.description && <span style={{ color: "var(--muted)" }}>{s.label ? " · " : ""}{s.description}</span>}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{s.dimensions} · {s.cft.toFixed(2)} CFT</span>
        <span className="muted">{s.stone ?? "—"}</span>
        {s.quality && (
          <span style={{ fontSize: 10, fontWeight: 800, color: s.quality === "A" ? "#15803d" : "#b45309", background: s.quality === "A" ? "rgba(22,163,74,0.1)" : "rgba(180,83,9,0.1)", borderRadius: 999, padding: "1px 8px" }}>
            {s.quality}
          </span>
        )}
        {s.isMarble && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: "#b45309", background: "rgba(180,83,9,0.1)", borderRadius: 4, padding: "1px 6px", letterSpacing: "0.04em" }}>
            MARBLE
          </span>
        )}
      </div>
    </div>
  );
}

// ─── main client ─────────────────────────────────────────────────────────

export function DispatchClient({
  readySlabs,
  siteInfoByTemple,
  handlingMan,
  provisional,
  provisionalSlabsByDispatch,
  outForDelivery,
  delivered,
  legacyDispatches,
  truckHistory,
  initialTab,
  toast,
  error,
}: {
  readySlabs: ReadySlab[];
  /** Mig 130 — temple name → site info, shown on the dispatch form. */
  siteInfoByTemple: Record<string, SiteInfo>;
  /** Mig 130 — fixed MTCPL site handling man (Settings-editable). */
  handlingMan: { name?: string; phone?: string } | null;
  provisional: ProvisionalRow[];
  provisionalSlabsByDispatch: Record<string, ReadySlab[]>;
  outForDelivery: OutForDeliveryRow[];
  delivered: DeliveredRow[];
  legacyDispatches: LegacyDispatch[];
  truckHistory: TruckTrip[];
  initialTab: Tab;
  toast: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = initialTab;

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dispatch_toast");
    params.delete("dispatch_error");
    if (next === "ready") params.delete("tab");
    else params.set("tab", next);
    const q = params.toString();
    router.replace(q ? `/dispatch?${q}` : "/dispatch");
  }

  const counts = {
    ready: readySlabs.length,
    provisional: provisional.length,
    out_for_delivery: outForDelivery.length,
    delivered: delivered.length,
  };

  return (
    <section className="page-card">
      <div className="record-head" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>🚚 Dispatch Station</h1>
          <p className="muted" style={{ fontSize: 13.5, maxWidth: 700 }}>
            Carving-approved slabs, ready to ship. Open a temple → press <strong>Dispatch</strong> → pick the
            slabs → truck details → done. जो slab भेजनी है, temple खोल कर चुनें।
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignSelf: "flex-start" }}>
          <Link
            href="/challan"
            style={{
              textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6,
              padding: "10px 16px", background: "var(--bg)", border: "1.5px solid var(--border)",
              borderRadius: 10, color: "var(--text)", fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap",
            }}
            title="Open the challan archive — every dispatch that's been finalised"
          >
            📋 Challan archive →
          </Link>
        </div>
      </div>

      {/* Toast / error banners */}
      {toast && (
        <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 10, color: "#15803d", fontSize: 14, fontWeight: 600 }}>
          {toast}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.3)", borderRadius: 10, color: "#b91c1c", fontSize: 14, fontWeight: 600 }}>
          ⚠ {error}
        </div>
      )}

      {/* Big friendly tabs */}
      <div style={{ display: "flex", gap: 8, margin: "20px 0 18px", flexWrap: "wrap" }}>
        {(
          [
            { key: "ready", label: "📦 Make Dispatch", count: counts.ready, color: "#b87333" },
            { key: "provisional", label: "🕒 Waiting approval", count: counts.provisional, color: "#D97706" },
            { key: "out_for_delivery", label: "🚛 On the road", count: counts.out_for_delivery, color: "#2563EB" },
            { key: "delivered", label: "✅ Delivered", count: counts.delivered, color: "#16A34A" },
          ] as const
        ).map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                background: active ? t.color : "var(--surface)",
                border: `1.5px solid ${active ? t.color : "var(--border)"}`,
                borderRadius: 12,
                padding: "11px 18px",
                fontSize: 14,
                fontWeight: 800,
                color: active ? "#fff" : "var(--text)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {t.label}
              <span
                style={{
                  background: active ? "rgba(255,255,255,0.25)" : "var(--bg)",
                  color: active ? "#fff" : "var(--muted)",
                  borderRadius: 999, fontSize: 12, fontWeight: 800, padding: "1px 9px", minWidth: 22, textAlign: "center",
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "ready" && (
        <ReadyTab slabs={readySlabs} truckHistory={truckHistory} siteInfoByTemple={siteInfoByTemple} handlingMan={handlingMan} />
      )}
      {tab === "provisional" && (
        <ProvisionalTab rows={provisional} slabsByDispatch={provisionalSlabsByDispatch} readySlabs={readySlabs} truckHistory={truckHistory} />
      )}
      {tab === "out_for_delivery" && <OutForDeliveryTab rows={outForDelivery} />}
      {tab === "delivered" && <DeliveredTab rows={delivered} legacy={legacyDispatches} />}
    </section>
  );
}

// ─── Make Dispatch tab ───────────────────────────────────────────────────
// Temples collapsed by default. Search opens matching groups. One big
// Dispatch button per temple opens the selection peek.

type TempleGroup = { key: string; temple: string; isMarble: boolean; slabs: ReadySlab[] };

function ReadyTab({
  slabs, truckHistory, siteInfoByTemple, handlingMan,
}: {
  slabs: ReadySlab[];
  truckHistory: TruckTrip[];
  siteInfoByTemple: Record<string, SiteInfo>;
  handlingMan: { name?: string; phone?: string } | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [peekGroup, setPeekGroup] = useState<TempleGroup | null>(null);

  const groups: TempleGroup[] = useMemo(() => {
    const map = new Map<string, TempleGroup>();
    for (const s of slabs) {
      const key = `${s.temple}::${s.isMarble ? "marble" : "sandstone"}`;
      if (!map.has(key)) map.set(key, { key, temple: s.temple, isMarble: s.isMarble, slabs: [] });
      map.get(key)!.slabs.push(s);
    }
    return [...map.values()].sort((a, b) => a.temple.localeCompare(b.temple) || (a.isMarble ? 1 : -1));
  }, [slabs]);

  const q = query.trim();
  const visibleGroups = useMemo(() => {
    if (!q) return groups.map((g) => ({ ...g, matched: g.slabs }));
    return groups
      .map((g) => ({ ...g, matched: g.slabs.filter((s) => slabMatches(s, q)) }))
      .filter((g) => g.matched.length > 0);
  }, [groups, q]);

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (slabs.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14, fontSize: 15 }}>
        🎉 Nothing to dispatch right now. When carving jobs are approved, their slabs will queue up here.
      </div>
    );
  }

  return (
    <>
      {/* Search bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 300px" }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: 0.6 }}>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search slab — code / label / description / size (e.g. 44x48)…"
            style={{ ...bigSearch, width: "100%", paddingLeft: 40 }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "var(--border)", border: "none", borderRadius: 999, width: 24, height: 24, fontSize: 12, fontWeight: 800, cursor: "pointer", color: "var(--text)" }}
            >
              ✕
            </button>
          )}
        </div>
        <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
          {q
            ? `${visibleGroups.reduce((n, g) => n + g.matched.length, 0)} match${visibleGroups.reduce((n, g) => n + g.matched.length, 0) === 1 ? "" : "es"}`
            : `${slabs.length} slabs · ${groups.length} group${groups.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="muted" style={{ padding: "30px 16px", textAlign: "center", fontSize: 14, background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12 }}>
          No slab matches “{q}”.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleGroups.map((g) => {
            const expanded = q ? true : open.has(g.key);
            const totalCft = g.matched.reduce((sum, s) => sum + s.cft, 0);
            const urgent = g.matched.filter((s) => s.priority).length;
            return (
              <div
                key={g.key}
                style={{
                  background: "var(--surface)",
                  border: `1.5px solid ${g.isMarble ? "rgba(180,83,9,0.35)" : "var(--border)"}`,
                  borderRadius: 14, overflow: "hidden",
                }}
              >
                {/* Temple header — tap anywhere to expand/collapse */}
                <div
                  onClick={() => toggleOpen(g.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(g.key); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                    background: g.isMarble ? "rgba(180,83,9,0.05)" : "var(--bg)", cursor: "pointer", flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--muted)", width: 14, flexShrink: 0, transition: "transform .15s ease", transform: expanded ? "rotate(90deg)" : "none", display: "inline-block" }}>▶</span>
                  <span style={{ fontSize: 16.5, fontWeight: 800 }}>
                    {g.isMarble ? "🗿" : "🏛"} {g.temple}
                  </span>
                  {g.isMarble && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#b45309", background: "rgba(180,83,9,0.12)", padding: "2px 9px", borderRadius: 5, letterSpacing: "0.04em" }}>
                      MARBLE
                    </span>
                  )}
                  <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                    {g.matched.length} slab{g.matched.length === 1 ? "" : "s"} · {totalCft.toFixed(2)} CFT
                    {urgent > 0 && <span style={{ color: "#dc2626", fontWeight: 800 }}> · ⚡ {urgent} urgent</span>}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPeekGroup(g); }}
                    style={{
                      marginLeft: "auto", background: "var(--gold-dark)", color: "#fff", border: "none",
                      borderRadius: 10, padding: "11px 22px", fontSize: 14.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    🚚 Dispatch
                  </button>
                </div>

                {/* Slab cards (browse-only — selection happens in the peek) */}
                {expanded && (
                  <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10, borderTop: "1px solid var(--border)" }}>
                    {g.matched.map((s) => <SlabCard key={s.id} s={s} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {peekGroup && (
        <TempleDispatchPeek
          group={peekGroup}
          truckHistory={truckHistory}
          siteInfo={siteInfoByTemple[peekGroup.temple] ?? null}
          handlingMan={handlingMan}
          onClose={() => setPeekGroup(null)}
        />
      )}
    </>
  );
}

// ─── Temple dispatch peek ────────────────────────────────────────────────
// Centre peek with two steps: ① tap-to-select slab cards (with full
// search), ② truck details (recent-truck quick fill) → create dispatch.

function TempleDispatchPeek({
  group, truckHistory, siteInfo, handlingMan, onClose,
}: {
  group: TempleGroup;
  truckHistory: TruckTrip[];
  siteInfo: SiteInfo | null;
  handlingMan: { name?: string; phone?: string } | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  // Mig 130 — optional per-slab weight (tonnes). Keyed by slab id;
  // empty string = not entered (stored NULL).
  const [weights, setWeights] = useState<Record<string, string>>({});

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  const matched = useMemo(
    () => group.slabs.filter((s) => slabMatches(s, query)),
    [group.slabs, query],
  );
  const selSlabs = group.slabs.filter((s) => selected.has(s.id));
  const selCft = selSlabs.reduce((sum, s) => sum + s.cft, 0);

  // Net weight = sum of the entered per-slab tonnes (blank rows skipped).
  const weightsParsed: Record<string, number> = {};
  for (const s of selSlabs) {
    const n = Number(weights[s.id]);
    if (Number.isFinite(n) && n > 0) weightsParsed[s.id] = n;
  }
  const totalTonnes = Object.values(weightsParsed).reduce((a, b) => a + b, 0);

  // Recent unique trucks (newest first) for one-tap fill.
  const recentTrucks = useMemo(() => {
    const seen = new Set<string>();
    const out: TruckTrip[] = [];
    for (const t of truckHistory) {
      if (seen.has(t.vehicle_no)) continue;
      seen.add(t.vehicle_no);
      out.push(t);
      if (out.length >= 6) break;
    }
    return out;
  }, [truckHistory]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allMatchedSelected = matched.length > 0 && matched.every((s) => selected.has(s.id));

  return (
    <div style={peekOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div style={peekPanel} role="dialog" aria-modal="true" aria-label={`Dispatch from ${group.temple}`}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              🚚 Dispatch — {group.isMarble ? "🗿" : "🏛"} {group.temple}
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {step === 1
                ? "Step 1 of 2 — tap the slabs going on the truck · जो slab भेजनी है उन्हें छुएँ"
                : "Step 2 of 2 — truck & driver details · गाड़ी की जानकारी भरें"}
            </div>
          </div>
          <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color: selected.size > 0 ? "var(--gold-dark)" : "var(--muted)", whiteSpace: "nowrap" }}>
            ✓ {selected.size} selected · {selCft.toFixed(2)} CFT
          </span>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {step === 1 ? (
          <>
            {/* Search + select all */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "1 1 240px" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.6 }}>🔍</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search code / label / description / size…"
                  style={{ ...bigSearch, width: "100%", paddingLeft: 36, padding: "10px 12px 10px 36px", fontSize: 14 }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (allMatchedSelected) for (const s of matched) next.delete(s.id);
                    else for (const s of matched) next.add(s.id);
                    return next;
                  });
                }}
                style={{ padding: "10px 16px", fontSize: 13, fontWeight: 800, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {allMatchedSelected ? "✕ Clear all" : `✓ Select all (${matched.length})`}
              </button>
            </div>

            {/* Cards */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
              {matched.length === 0 ? (
                <div className="muted" style={{ padding: "30px 0", textAlign: "center", fontSize: 14 }}>No slab matches “{query}”.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(245px, 1fr))", gap: 10 }}>
                  {matched.map((s) => (
                    <SlabCard key={s.id} s={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <button type="button" className="ghost-button" onClick={onClose} style={{ fontSize: 14 }}>Cancel</button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => setStep(2)}
                style={{
                  marginLeft: "auto", background: selected.size === 0 ? "var(--border)" : "var(--gold-dark)",
                  color: selected.size === 0 ? "var(--muted)" : "#fff", border: "none", borderRadius: 12,
                  padding: "13px 26px", fontSize: 15.5, fontWeight: 800, cursor: selected.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                Truck details → ({selected.size} slab{selected.size === 1 ? "" : "s"})
              </button>
            </div>
          </>
        ) : (
          /* ── Step 2: truck form ── */
          <form
            action={(fd) => {
              setSubmitting(true);
              return createDispatchAction(fd);
            }}
            style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          >
            <input type="hidden" name="temple" value={group.temple} />
            <input type="hidden" name="slab_ids" value={JSON.stringify([...selected])} />
            <input type="hidden" name="slab_weights" value={JSON.stringify(weightsParsed)} />

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Mig 130 — site info that will print on the challan,
                  pulled from Settings → Temple Codes. */}
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
                  <div><strong>MTCPL site handling:</strong> {handlingMan.name}{handlingMan.phone ? ` · ${handlingMan.phone}` : ""}</div>
                )}
              </div>

              {/* Recent trucks quick-fill */}
              {recentTrucks.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                    🚛 Recent trucks — tap to fill
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {recentTrucks.map((t) => (
                      <button
                        key={t.vehicle_no}
                        type="button"
                        onClick={() => {
                          setVehicleNo(t.vehicle_no);
                          setDriverName(t.driver_name ?? "");
                          setDriverPhone(t.driver_phone ?? "");
                        }}
                        style={{
                          fontSize: 12.5, fontWeight: 700, padding: "8px 13px", borderRadius: 999,
                          border: `1.5px solid ${vehicleNo === t.vehicle_no ? "var(--gold-dark)" : "var(--border)"}`,
                          background: vehicleNo === t.vehicle_no ? "rgba(184,115,51,0.1)" : "var(--bg)",
                          color: "var(--text)", cursor: "pointer",
                        }}
                        title={`Last trip: ${t.temple} · ${new Date(t.dispatched_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}`}
                      >
                        <span style={{ fontFamily: "ui-monospace, monospace" }}>{t.vehicle_no}</span>
                        {t.driver_name ? <span className="muted"> · {t.driver_name}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="stack">
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Vehicle No. <span style={{ color: "#DC2626" }}>*</span></span>
                <input
                  name="vehicle_no"
                  required
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="RJ24 GA 1234"
                  style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", fontSize: 15, padding: "11px 13px" }}
                />
              </label>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label className="stack" style={{ flex: "1 1 200px" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>Driver Name <span style={{ color: "#DC2626" }}>*</span></span>
                  <input name="driver_name" required value={driverName} onChange={(e) => setDriverName(e.target.value)} style={{ fontSize: 15, padding: "11px 13px" }} />
                </label>
                <label className="stack" style={{ flex: "1 1 170px" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>Driver Phone</span>
                  <input name="driver_phone" type="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} style={{ fontSize: 15, padding: "11px 13px" }} />
                </label>
              </div>

              <label className="stack">
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Expected Delivery Date</span>
                <input type="date" name="expected_delivery_date" defaultValue={tomorrowIso} style={{ fontFamily: "inherit", fontSize: 15, padding: "11px 13px" }} />
              </label>

              <label className="stack">
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Notes (optional)</span>
                <textarea name="notes" rows={2} style={{ resize: "vertical", fontFamily: "inherit", fontSize: 14 }} />
              </label>

              {/* Selected slab recap + per-slab weight (mig 130). Weight
                  is optional — filled rows sum into the challan's Net
                  Weight. */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: "10px 12px", maxHeight: 240, overflowY: "auto", fontSize: 12.5, fontFamily: "ui-monospace, monospace" }}>
                <div style={{ fontFamily: "inherit", fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Going on this truck — {selSlabs.length} slab{selSlabs.length === 1 ? "" : "s"} · {selCft.toFixed(2)} CFT
                  {totalTonnes > 0 && <span style={{ color: "#15803d" }}> · ⚖ {totalTonnes.toFixed(3)} T net</span>}
                </div>
                {selSlabs.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px dashed var(--border)", flexWrap: "wrap" }}>
                    <span style={{ minWidth: 0 }}>
                      <strong>{s.id}</strong>
                      {s.label && <span style={{ color: "var(--muted)" }}> · {s.label}</span>}
                      {" · "}{s.dimensions}
                      <span style={{ color: "var(--muted)" }}> · {s.cft.toFixed(2)} CFT</span>
                    </span>
                    <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
                      <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700 }}>⚖</span>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        placeholder="tonne"
                        value={weights[s.id] ?? ""}
                        onChange={(e) => setWeights((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        style={{ width: 78, fontSize: 12, padding: "4px 6px" }}
                      />
                      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>T</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
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
                {submitting ? "Creating dispatch…" : `🚚 Send for approval (${selected.size})`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Provisional tab ─────────────────────────────────────────────────────

function ProvisionalTab({
  rows,
  slabsByDispatch,
  readySlabs,
  truckHistory,
}: {
  rows: ProvisionalRow[];
  slabsByDispatch: Record<string, ReadySlab[]>;
  readySlabs: ReadySlab[];
  truckHistory: TruckTrip[];
}) {
  const [editing, setEditing] = useState<ProvisionalRow | null>(null);
  const [showTrucks, setShowTrucks] = useState(false);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <p className="muted" style={{ fontSize: 13, margin: 0, flex: "1 1 300px" }}>
          {rows.length === 0
            ? "No dispatches are waiting for approval."
            : <><strong>{rows.length}</strong> dispatch{rows.length !== 1 ? "es" : ""} waiting for senior approval. Approving sends the truck on the road.</>}
        </p>
        <button
          type="button"
          onClick={() => setShowTrucks(true)}
          style={{ padding: "10px 16px", fontSize: 13.5, fontWeight: 800, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" }}
          title="Every truck that has been sent — newest first"
        >
          🚛 Truck history
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="muted" style={{ padding: "32px 16px", textAlign: "center", fontSize: 14, background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12 }}>
          🕒 Create a dispatch on the <strong>Make Dispatch</strong> tab — it lands here for senior review before the truck leaves.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                border: "1px solid var(--border)", borderLeft: "5px solid #D97706", borderRadius: 12,
                padding: "14px 16px", background: "rgba(217,119,6,0.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#D97706", fontSize: 14.5 }}>
                      📋 {chalanLabel(r.challan_number, r.id)}
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{r.temple}</span>
                    <span style={{ background: "rgba(217,119,6,0.15)", color: "#D97706", border: "1px solid rgba(217,119,6,0.35)", fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "2px 9px" }}>
                      WAITING APPROVAL
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 5 }}>
                    {r.vehicle_no ? <>🚛 <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{r.vehicle_no}</strong> · </> : null}
                    {r.driver_name ?? "No driver"}
                    {r.driver_phone ? ` (${r.driver_phone})` : ""}
                    {" · "}
                    <strong style={{ color: "var(--text)" }}>
                      {r.slabCount} slab{r.slabCount !== 1 ? "s" : ""} · {r.slabCftTotal.toFixed(2)} CFT
                    </strong>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                    Created {new Date(r.dispatched_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {r.dispatcher ? ` by ${r.dispatcher}` : ""}
                    {r.expected_delivery_date ? ` · Expected ${r.expected_delivery_date}` : ""}
                  </div>
                  {r.notes && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 5, fontStyle: "italic" }}>“{r.notes}”</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="ghost-button" onClick={() => setEditing(r)} style={{ fontSize: 13 }}>
                    📝 Edit slabs
                  </button>
                  <form action={approveDispatchAction} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" style={{ fontSize: 13.5, padding: "10px 18px", fontWeight: 800, color: "#fff", background: "#15803d", border: "none", borderRadius: 10, cursor: "pointer" }}>
                      ✅ Approve — truck can leave
                    </button>
                  </form>
                  <form
                    action={cancelDispatchAction}
                    style={{ display: "inline" }}
                    onSubmit={(e) => {
                      if (!confirm(`Cancel ${chalanLabel(r.challan_number, r.id)}? Slabs will return to Make Dispatch.`)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="ghost-button danger-ghost" style={{ fontSize: 13 }}>✕ Cancel</button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditSlabsModal
          dispatchId={editing.id}
          challanLabel={chalanLabel(editing.challan_number, editing.id)}
          temple={editing.temple}
          currentSlabs={slabsByDispatch[editing.id] ?? []}
          availableToAdd={readySlabs.filter((s) => s.temple === editing.temple)}
          onClose={() => setEditing(null)}
        />
      )}

      {showTrucks && <TruckHistoryPeek trips={truckHistory} onClose={() => setShowTrucks(false)} />}
    </>
  );
}

// ─── Truck history peek ──────────────────────────────────────────────────
// Every trip ever sent, newest first, grouped per truck with a search box.

function TruckHistoryPeek({ trips, onClose }: { trips: TruckTrip[]; onClose: () => void }) {
  const [query, setQuery] = useState("");

  const trucks = useMemo(() => {
    const byVehicle = new Map<string, TruckTrip[]>();
    for (const t of trips) {
      const arr = byVehicle.get(t.vehicle_no) ?? [];
      arr.push(t);
      byVehicle.set(t.vehicle_no, arr);
    }
    return [...byVehicle.entries()].map(([vehicle, list]) => ({ vehicle, list }));
  }, [trips]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? trucks.filter(({ vehicle, list }) =>
        vehicle.toLowerCase().includes(q) ||
        list.some((t) => (t.driver_name ?? "").toLowerCase().includes(q) || t.temple.toLowerCase().includes(q)),
      )
    : trucks;

  const STATUS_CHIP: Record<TruckTrip["status"], { label: string; c: string; bg: string }> = {
    provisional: { label: "WAITING OK", c: "#D97706", bg: "rgba(217,119,6,0.12)" },
    on_road: { label: "ON THE ROAD", c: "#2563EB", bg: "rgba(37,99,235,0.1)" },
    delivered: { label: "DELIVERED", c: "#15803d", bg: "rgba(22,163,74,0.1)" },
  };

  return (
    <div style={peekOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...peekPanel, maxWidth: 760 }} role="dialog" aria-modal="true" aria-label="Truck history">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>🚛 Truck history</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              Every truck sent so far — {trips.length} trip{trips.length === 1 ? "" : "s"}, newest first.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Search vehicle / driver / temple…"
            style={{ ...bigSearch, width: "100%", fontSize: 14, padding: "10px 14px" }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {visible.length === 0 ? (
            <div className="muted" style={{ padding: "30px 0", textAlign: "center", fontSize: 14 }}>
              {trips.length === 0 ? "No trucks have been sent yet." : `No truck matches “${query}”.`}
            </div>
          ) : (
            visible.map(({ vehicle, list }) => (
              <div key={vehicle} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--bg)", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15 }}>🚛 {vehicle}</span>
                  {list[0].driver_name && (
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {list[0].driver_name}{list[0].driver_phone ? ` (${list[0].driver_phone})` : ""}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>
                    {list.length} trip{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div style={{ padding: "6px 14px 10px" }}>
                  {list.slice(0, 5).map((t, i) => {
                    const chip = STATUS_CHIP[t.status];
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < Math.min(list.length, 5) - 1 ? "1px dashed var(--border)" : "none", fontSize: 12.5, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--muted)", fontSize: 11.5 }}>
                          {chalanLabel(t.challan_number, "")}
                        </span>
                        <span style={{ fontWeight: 700 }}>🏛 {t.temple}</span>
                        <span className="muted">
                          {new Date(t.dispatched_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                        </span>
                        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: chip.c, background: chip.bg, borderRadius: 999, padding: "2px 9px", letterSpacing: "0.03em" }}>
                          {chip.label}
                        </span>
                      </div>
                    );
                  })}
                  {list.length > 5 && (
                    <div className="muted" style={{ fontSize: 11.5, paddingTop: 4 }}>…and {list.length - 5} older trip{list.length - 5 === 1 ? "" : "s"}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Out for delivery tab ────────────────────────────────────────────────

function OutForDeliveryTab({ rows }: { rows: OutForDeliveryRow[] }) {
  const [deliverRow, setDeliverRow] = useState<OutForDeliveryRow | null>(null);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14, fontSize: 15 }}>
        🛣 No trucks are on the road right now.
      </div>
    );
  }

  return (
    <>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        जब slab site पर पहुँच जाए: <strong>Reached — mark delivered</strong> दबाएँ और दो photo लगाएँ (truck on site + signed challan).
      </div>
      {rows.map((r) => (
        <DispatchRow key={r.id} row={r} onMarkDelivered={() => setDeliverRow(r)} />
      ))}
      {deliverRow && (
        <DeliverModal
          dispatchId={deliverRow.id}
          temple={deliverRow.temple}
          vehicleNo={deliverRow.vehicle_no}
          onClose={() => setDeliverRow(null)}
        />
      )}
    </>
  );
}

function DispatchRow({
  row,
  onMarkDelivered,
}: {
  row: OutForDeliveryRow;
  onMarkDelivered: () => void;
}) {
  const chalan = chalanLabel(row.challan_number, row.id);
  const dispatchedAt = new Date(row.dispatched_at);
  const expected = row.expected_delivery_date
    ? new Date(row.expected_delivery_date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div
      style={{
        padding: "14px 16px", marginBottom: 10, background: "var(--surface)",
        border: "1px solid var(--border)", borderLeft: "5px solid #2563EB", borderRadius: 12,
        display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between",
      }}
    >
      <div
        onClick={() => window.open(`/dispatch/${row.id}/print`, "_blank", "noopener")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            window.open(`/dispatch/${row.id}/print`, "_blank", "noopener");
          }
        }}
        role="link"
        tabIndex={0}
        style={{ flex: "1 1 300px", minWidth: 0, cursor: "pointer" }}
        title="Open the printed challan"
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{chalan}</span>
          <span style={{ fontSize: 16, fontWeight: 800 }}>🏛 {row.temple}</span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            · {row.slabCount} slab{row.slabCount !== 1 ? "s" : ""} · {row.slabCftTotal.toFixed(2)} CFT
          </span>
        </div>
        <div style={{ marginTop: 5, fontSize: 13, color: "var(--muted)" }}>
          {row.vehicle_no && (
            <>🚛 <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{row.vehicle_no}</strong></>
          )}
          {row.driver_name && (
            <>
              {" · "}
              <strong style={{ color: "var(--text)" }}>{row.driver_name}</strong>
              {row.driver_phone ? ` (${row.driver_phone})` : ""}
            </>
          )}
        </div>
        <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--muted)" }}>
          Left {dispatchedAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}{" "}
          at {dispatchedAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}
          {row.dispatcher ? ` by ${row.dispatcher}` : ""}
          {expected && ` · Expected ${expected}`}
        </div>
        {row.notes && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>“{row.notes}”</div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <Link
          href={`/dispatch/${row.id}/print`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            textDecoration: "none", fontSize: 13, padding: "10px 16px", background: "var(--bg)",
            border: "1.5px solid var(--border)", borderRadius: 10, color: "var(--text)", fontWeight: 700, whiteSpace: "nowrap",
          }}
        >
          🖨 Print challan
        </Link>
        <button
          type="button"
          onClick={onMarkDelivered}
          style={{
            background: "#16A34A", color: "#fff", border: "none", borderRadius: 10,
            padding: "11px 18px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          📸 Reached — mark delivered
        </button>
        <form
          action={undoDispatchAction}
          onSubmit={(e) => {
            if (!confirm(`Undo this dispatch to ${row.temple}? Slabs will return to Make Dispatch.`)) {
              e.preventDefault();
            }
          }}
          style={{ display: "inline" }}
        >
          <input type="hidden" name="dispatch_id" value={row.id} />
          <button
            type="submit"
            className="ghost-button danger-ghost"
            style={{ fontSize: 12, padding: "8px 12px" }}
            title="Revert this dispatch — slabs go back to Make Dispatch"
          >
            Undo
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Delivered tab ───────────────────────────────────────────────────────

function DeliveredTab({ rows, legacy }: { rows: DeliveredRow[]; legacy: LegacyDispatch[] }) {
  if (rows.length === 0 && legacy.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14, fontSize: 15 }}>
        📭 No deliveries have been recorded yet.
      </div>
    );
  }

  return (
    <>
      {rows.map((r) => {
        const chalan = chalanLabel(r.challan_number, r.id);
        const dispatchedAt = new Date(r.dispatched_at);
        const deliveredAt = new Date(r.delivered_at);
        return (
          <div
            key={r.id}
            style={{
              padding: "12px 16px", marginBottom: 8, background: "var(--surface)",
              border: "1px solid var(--border)", borderLeft: "5px solid #16A34A", borderRadius: 12,
              display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between",
            }}
          >
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>{chalan}</span>
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>🏛 {r.temple}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  · {r.slabCount} slab{r.slabCount !== 1 ? "s" : ""} · {r.slabCftTotal.toFixed(2)} CFT
                </span>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.12)", padding: "1px 9px", borderRadius: 999, letterSpacing: "0.04em" }}>
                  ✓ DELIVERED
                </span>
              </div>
              <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)" }}>
                {r.vehicle_no ? <>🚛 {r.vehicle_no} · </> : null}
                Left {dispatchedAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}
                {" · "}Delivered {deliveredAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                {r.delivered_by_name ? ` · confirmed by ${r.delivered_by_name}` : ""}
                {r.receiver_name ? ` · received by ${r.receiver_name}` : ""}
              </div>
              {r.delivery_note && (
                <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)", fontStyle: "italic" }}>“{r.delivery_note}”</div>
              )}
              {/* Mig 129 — proof photos */}
              {(r.proofSiteUrl || r.proofChallanUrl) && (
                <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  {r.proofSiteUrl && (
                    <a href={r.proofSiteUrl} target="_blank" rel="noopener noreferrer" title="Truck at site — proof photo" style={{ textDecoration: "none", textAlign: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.proofSiteUrl} alt="Truck at site" style={{ width: 76, height: 58, objectFit: "cover", borderRadius: 8, border: "1.5px solid var(--border)", display: "block" }} />
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)" }}>🚛 ON SITE</span>
                    </a>
                  )}
                  {r.proofChallanUrl && (
                    <a href={r.proofChallanUrl} target="_blank" rel="noopener noreferrer" title="Signed challan — proof photo" style={{ textDecoration: "none", textAlign: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.proofChallanUrl} alt="Signed challan" style={{ width: 76, height: 58, objectFit: "cover", borderRadius: 8, border: "1.5px solid var(--border)", display: "block" }} />
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)" }}>📝 SIGNED</span>
                    </a>
                  )}
                </div>
              )}
            </div>
            <Link
              href={`/dispatch/${r.id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: "none", fontSize: 12, padding: "8px 14px", background: "var(--bg)",
                border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", fontWeight: 700, flexShrink: 0,
              }}
            >
              🖨 Print challan
            </Link>
          </div>
        );
      })}

      {legacy.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary
            style={{
              cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--muted)",
              padding: "8px 4px", userSelect: "none", borderTop: "1px dashed var(--border)", listStyle: "none",
            }}
          >
            ▸ {legacy.length} legacy single-slab dispatch{legacy.length !== 1 ? "es" : ""} (from before the station was built)
          </summary>
          <div style={{ marginTop: 8 }}>
            {legacy.map((l, idx) => (
              <div
                key={idx}
                style={{
                  padding: "6px 12px", marginBottom: 4, background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 6, fontSize: 12, color: "var(--muted)", fontFamily: "ui-monospace, monospace",
                }}
              >
                <strong>{l.slab_id}</strong> · Dispatched{" "}
                {new Date(l.dispatched_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                {l.dispatched_by_name ? ` by ${l.dispatched_by_name}` : ""}
                {l.note ? ` · ${l.note}` : ""}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
