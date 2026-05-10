"use client";

import { useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────

export type FloorSlab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_in: number;
  width_in: number;
  thickness_in: number;
};

export type FloorMachine = {
  id: string;
  machine_code: string;
  operator_name: string | null;
  status: "idle" | "carving" | "maintenance" | "inactive";
  machine_type: "single_head" | "multi_head_2" | "lathe";
  maintenance_reason: string | null;
  maintenance_flagged_at: string | null;
  current_job: {
    id: string;
    slab_id: string;
    vendor_estimated_minutes: number | null;
    estimated_minutes: number | null;
    loaded_at: string | null;
    slab: FloorSlab | null;
  } | null;
};

export type FloorQueueItem = {
  id: string;
  slab_id: string;
  urgency: "urgent" | "normal";
  estimated_minutes: number | null;
  slab: FloorSlab | null;
};

export type FloorRecent = {
  slab_id: string;
  completed_at: string;
  slab: FloorSlab | null;
};

export type FloorVendor = {
  id: string;
  name: string;
  machines: FloorMachine[];
  queue: FloorQueueItem[];
  recentCompleted: FloorRecent[];
  totals: {
    total: number;
    idle: number;
    carving: number;
    maintenance: number;
    queue: number;
    today: number;
  };
};

// ── Helpers ────────────────────────────────────────────────────────

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

const STATUS_TINT: Record<FloorMachine["status"], { bg: string; border: string; fg: string; accent: string; label: string }> = {
  idle: { bg: "var(--surface)", border: "var(--border)", fg: "#15803d", accent: "#16a34a", label: "FREE" },
  carving: { bg: "rgba(37,99,235,0.06)", border: "rgba(37,99,235,0.5)", fg: "#1d4ed8", accent: "#2563eb", label: "RUNNING" },
  maintenance: { bg: "rgba(220,38,38,0.06)", border: "rgba(220,38,38,0.5)", fg: "#b91c1c", accent: "#dc2626", label: "DOWN" },
  inactive: { bg: "var(--surface-alt)", border: "var(--border)", fg: "var(--muted)", accent: "var(--muted)", label: "OFFLINE" },
};

// ── Main client component ─────────────────────────────────────────

export function FloorViewClient({
  vendors,
  initialMode,
  initialRotateSec,
  initialVendorId,
}: {
  vendors: FloorVendor[];
  initialMode: "grid" | "tv";
  initialRotateSec: number;
  initialVendorId: string | null;
}) {
  const [mode, setMode] = useState<"grid" | "tv">(initialMode);
  const [rotateSec, setRotateSec] = useState(initialRotateSec);
  const [tvIndex, setTvIndex] = useState(() => {
    if (initialVendorId) {
      const idx = vendors.findIndex((v) => v.id === initialVendorId);
      if (idx >= 0) return idx;
    }
    return 0;
  });
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(Date.now());
  // TV theme — light is the default but the user wanted a toggle so
  // the wall TV can adapt to ambient light. Persists in localStorage
  // so the choice survives a Vercel redeploy / browser restart.
  const [tvTheme, setTvTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("mtcpl_tv_theme") as "light" | "dark") || "light";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("mtcpl_tv_theme", tvTheme);
    }
  }, [tvTheme]);

  // 30s tick — keeps "Xh Ym remaining" + "Xh Ym down" timers fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // TV auto-rotate. Pauses if user clicks ⏸ or hovers.
  useEffect(() => {
    if (mode !== "tv" || paused || vendors.length <= 1) return;
    const t = setInterval(() => {
      setTvIndex((i) => (i + 1) % vendors.length);
    }, rotateSec * 1000);
    return () => clearInterval(t);
  }, [mode, paused, rotateSec, vendors.length]);

  // Aggregate fleet totals across all vendors — shown in the grid
  // header and on each TV slide for quick context.
  const fleetTotals = useMemo(() => {
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

  if (vendors.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
        No CNC vendors configured yet. Add one from{" "}
        <a href="/carving" style={{ color: "var(--gold-dark)" }}>
          Carving Jobs → Manage Vendors
        </a>
        .
      </div>
    );
  }

  // ── TV mode — single vendor full-screen, big text, auto-rotate ──
  // Renders as a position:fixed overlay that covers the entire
  // viewport, including the sidebar and topbar. Light theme so it
  // reads better on a wall TV under fluorescent lighting (the dark
  // gradient was washing out from a distance).
  if (mode === "tv") {
    const v = vendors[tvIndex];
    const isDark = tvTheme === "dark";
    return (
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: isDark
            ? "linear-gradient(180deg, #0f0c06 0%, #1a1a1a 100%)"
            : "linear-gradient(180deg, #fafaf5 0%, #f0ece1 100%)",
          color: isDark ? "#fff" : "#1a1a1a",
          padding: "16px 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          zIndex: 9999,
          overflowY: "auto",
        }}
      >
        <TvHeader
          mode={mode}
          setMode={setMode}
          rotateSec={rotateSec}
          setRotateSec={setRotateSec}
          paused={paused}
          setPaused={setPaused}
          tvIndex={tvIndex}
          setTvIndex={setTvIndex}
          vendors={vendors}
          fleetTotals={fleetTotals}
          tvTheme={tvTheme}
          setTvTheme={setTvTheme}
        />

        <VendorTvSlide vendor={v} now={now} slideKey={tvIndex} dark={isDark} />
      </div>
    );
  }

  // ── Grid mode — every vendor stacked on one page ────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 40 }}>
      <GridHeader
        setMode={setMode}
        fleetTotals={fleetTotals}
        vendorCount={vendors.length}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {vendors.map((v) => (
          <VendorGridSection key={v.id} vendor={v} now={now} />
        ))}
      </div>
    </div>
  );
}

// ── Headers ────────────────────────────────────────────────────────

function GridHeader({
  setMode,
  fleetTotals,
  vendorCount,
}: {
  setMode: (m: "grid" | "tv") => void;
  fleetTotals: FloorVendor["totals"];
  vendorCount: number;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #2D2410 0%, #4a3a1f 100%)",
        borderRadius: 12,
        padding: "16px 20px",
        color: "#fff",
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
          Carving Floor · Live
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>
          {vendorCount} operator{vendorCount !== 1 ? "s" : ""} · {fleetTotals.total} CNC{fleetTotals.total !== 1 ? "s" : ""}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Stat label="Free" value={fleetTotals.idle} fg="#22c55e" />
        <Stat label="Carving" value={fleetTotals.carving} fg="#60a5fa" />
        <Stat label="Maint" value={fleetTotals.maintenance} fg="#f87171" />
        <Stat label="Queue" value={fleetTotals.queue} fg="#fbbf24" />
        <Stat label="Today" value={fleetTotals.today} fg="#E8C572" />
      </div>
      <button
        type="button"
        onClick={() => setMode("tv")}
        style={{
          background: "rgba(255,255,255,0.12)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.25)",
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 700,
          borderRadius: 8,
          cursor: "pointer",
        }}
        title="Switch to TV mode — auto-rotates through vendors"
      >
        📺 TV mode
      </button>
    </div>
  );
}

function TvHeader({
  setMode,
  rotateSec,
  setRotateSec,
  paused,
  setPaused,
  tvIndex,
  setTvIndex,
  vendors,
  fleetTotals,
  tvTheme,
  setTvTheme,
}: {
  mode: "grid" | "tv";
  setMode: (m: "grid" | "tv") => void;
  rotateSec: number;
  setRotateSec: (n: number) => void;
  paused: boolean;
  setPaused: (b: boolean) => void;
  tvIndex: number;
  setTvIndex: (n: number) => void;
  vendors: FloorVendor[];
  fleetTotals: FloorVendor["totals"];
  tvTheme: "light" | "dark";
  setTvTheme: (t: "light" | "dark") => void;
}) {
  const isDark = tvTheme === "dark";
  // Theme-aware control colours so the chrome reads on either bg.
  const ctrlBg = isDark ? "rgba(255,255,255,0.08)" : "#fff";
  const ctrlFg = isDark ? "#fff" : "#1a1a1a";
  const ctrlBorder = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)";
  const muted = isDark ? "rgba(255,255,255,0.55)" : "#8a7a55";
  const dotInactive = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)";
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: 10,
        borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          📺 TV mode · {paused ? "paused" : `auto-rotate every ${rotateSec}s`}
        </span>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          style={{
            background: ctrlBg,
            color: ctrlFg,
            border: `1px solid ${ctrlBorder}`,
            padding: "5px 12px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <select
          value={rotateSec}
          onChange={(e) => setRotateSec(Number(e.target.value))}
          style={{
            background: ctrlBg,
            color: ctrlFg,
            border: `1px solid ${ctrlBorder}`,
            padding: "5px 10px",
            fontSize: 11,
            borderRadius: 6,
          }}
        >
          {[10, 15, 20, 30, 45, 60].map((s) => (
            <option key={s} value={s} style={{ color: "#000" }}>
              {s}s
            </option>
          ))}
        </select>
        {/* Theme toggle. The label always shows the OPPOSITE state so
            it reads as "tap to switch to X". Persists to localStorage. */}
        <button
          type="button"
          onClick={() => setTvTheme(isDark ? "light" : "dark")}
          style={{
            background: ctrlBg,
            color: ctrlFg,
            border: `1px solid ${ctrlBorder}`,
            padding: "5px 12px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            cursor: "pointer",
          }}
          title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? "☀ Light" : "🌙 Dark"}
        </button>
      </div>
      {/* Vendor dots — quick jump */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {vendors.map((v, i) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setTvIndex(i)}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              border: "none",
              cursor: "pointer",
              background: i === tvIndex ? "#b87333" : dotInactive,
              transition: "background 0.2s",
              padding: 0,
            }}
            title={v.name}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <TvStat label="Free" value={fleetTotals.idle} fg={isDark ? "#22c55e" : "#15803d"} dark={isDark} />
        <TvStat label="Carving" value={fleetTotals.carving} fg={isDark ? "#60a5fa" : "#1d4ed8"} dark={isDark} />
        <TvStat label="Maint" value={fleetTotals.maintenance} fg={isDark ? "#f87171" : "#b91c1c"} dark={isDark} />
        <TvStat label="Queue" value={fleetTotals.queue} fg={isDark ? "#fbbf24" : "#b45309"} dark={isDark} />
        <button
          type="button"
          onClick={() => setMode("grid")}
          style={{
            background: isDark ? "rgba(255,255,255,0.12)" : "#1a1a1a",
            color: "#fff",
            border: isDark ? "1px solid rgba(255,255,255,0.2)" : "none",
            padding: "7px 14px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          ▦ Exit TV
        </button>
      </div>
    </div>
  );
}

// ── Vendor sections ────────────────────────────────────────────────

export function VendorGridSection({ vendor, now }: { vendor: FloorVendor; now: number }) {
  // Subgroups by machine type — single → 2× head → lathe.
  const grouped = groupMachinesByType(vendor.machines);
  // Queue and "done last 24h" are collapsed by default per request;
  // expanded via per-section state. The carving head can pop them
  // open per-vendor without scrolling past noise.
  const [queueOpen, setQueueOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
            👷 Operator
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
            {vendor.name}
          </div>
        </div>
        <VendorStatRow totals={vendor.totals} />
      </div>

      {/* Machine subgroups — labelled when more than one type is in
          play so the carving head can scan single vs 2-head vs lathe
          at a glance. Single-type vendors stay flat. */}
      {grouped.map((g) => (
        <div key={g.type} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {grouped.length > 1 && (
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {g.label} · {g.machines.length}
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 8,
            }}
          >
            {g.machines.map((m) => (
              <CompactMachineTile key={m.id} machine={m} now={now} />
            ))}
          </div>
        </div>
      ))}

      {/* Collapsible queue + done lists. Headers stay visible with
          counts so the carving head sees the activity without the
          full row-by-row clutter. Click ▸ to expand. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <CollapsibleList
          title="📋 Queue"
          count={vendor.queue.length}
          accent={vendor.queue.length > 0 ? "#b45309" : "var(--muted)"}
          open={queueOpen}
          onToggle={() => setQueueOpen((o) => !o)}
        >
          <QueueList queue={vendor.queue} dark={false} noHeader />
        </CollapsibleList>
        <CollapsibleList
          title="✓ Done · last 24h"
          count={vendor.recentCompleted.length}
          accent={vendor.recentCompleted.length > 0 ? "#15803d" : "var(--muted)"}
          open={doneOpen}
          onToggle={() => setDoneOpen((o) => !o)}
        >
          <RecentList recent={vendor.recentCompleted} dark={false} noHeader />
        </CollapsibleList>
      </div>
    </section>
  );
}

// Header bar that shows title + count and toggles the children open
// or closed. Used for queue + done-24h sections on each vendor card.
function CollapsibleList({
  title,
  count,
  accent,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          textAlign: "left",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? "▾" : "▸"}</span>
          {title}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 8px",
              borderRadius: 999,
              background: count > 0 ? accent : "var(--border)",
              color: count > 0 ? "#fff" : "var(--muted)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {count}
          </span>
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 8px 8px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Queue list — small chips for each waiting slab. Urgent ones
// get a red tint. Truncates to 6 with a "+N more" affordance for
// the grid view; pass `compact={false}` to show all (TV mode).
// When `noHeader` is set the outer title pill is skipped — used
// when wrapped in CollapsibleList which renders its own header.
function QueueList({ queue, dark, compact = true, noHeader = false }: { queue: FloorQueueItem[]; dark: boolean; compact?: boolean; noHeader?: boolean }) {
  const visible = compact ? queue.slice(0, 6) : queue;
  const overflow = queue.length - visible.length;
  const titleColor = dark ? "rgba(255,255,255,0.55)" : "var(--muted)";
  const sectionBg = dark ? "rgba(255,255,255,0.05)" : "var(--surface-alt)";
  return (
    <div
      style={
        noHeader
          ? { display: "flex", flexDirection: "column", gap: 6 }
          : {
              background: sectionBg,
              borderRadius: 6,
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }
      }
    >
      {!noHeader && (
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: titleColor,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        📋 Queue
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 8px",
            borderRadius: 999,
            background: queue.length > 0 ? "#fbbf24" : (dark ? "rgba(255,255,255,0.15)" : "var(--border)"),
            color: queue.length > 0 ? "#1a1a1a" : titleColor,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {queue.length}
        </span>
        {queue.some((q) => q.urgency === "urgent") && (
          <span style={{ color: "#dc2626", fontSize: 10, fontWeight: 800 }}>
            ⚡ {queue.filter((q) => q.urgency === "urgent").length} URGENT
          </span>
        )}
      </div>
      )}
      {queue.length === 0 ? (
        <div style={{ fontSize: 11, color: titleColor, fontStyle: "italic" }}>
          Nothing queued
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {visible.map((q) => (
            <div
              key={q.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 6px",
                background: q.urgency === "urgent"
                  ? (dark ? "rgba(220,38,38,0.18)" : "rgba(220,38,38,0.08)")
                  : "transparent",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {q.urgency === "urgent" && (
                <span style={{ color: "#dc2626", fontWeight: 800 }}>⚡</span>
              )}
              <span style={{ fontWeight: 700, color: dark ? "#fff" : "var(--text)", flexShrink: 0 }}>
                {q.slab_id}
              </span>
              {q.slab && (
                <span
                  style={{
                    fontSize: 10,
                    color: titleColor,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  · {q.slab.temple} · {q.slab.length_in}×{q.slab.width_in}″
                  {(() => {
                    const cft = (q.slab.length_in * q.slab.width_in * q.slab.thickness_in) / 1728;
                    return cft > 0 ? ` · ${cft.toFixed(2)} CFT` : "";
                  })()}
                </span>
              )}
            </div>
          ))}
          {overflow > 0 && (
            <div style={{ fontSize: 10, color: titleColor, fontStyle: "italic", paddingLeft: 6 }}>
              + {overflow} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Recent (last 24h) completed list — same shape as QueueList for
// visual symmetry under the machine grid.
function RecentList({ recent, dark, compact = true, noHeader = false }: { recent: FloorRecent[]; dark: boolean; compact?: boolean; noHeader?: boolean }) {
  const visible = compact ? recent.slice(0, 6) : recent;
  const overflow = recent.length - visible.length;
  const titleColor = dark ? "rgba(255,255,255,0.55)" : "var(--muted)";
  const sectionBg = dark ? "rgba(255,255,255,0.05)" : "var(--surface-alt)";
  return (
    <div
      style={
        noHeader
          ? { display: "flex", flexDirection: "column", gap: 6 }
          : {
              background: sectionBg,
              borderRadius: 6,
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }
      }
    >
      {!noHeader && (
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: titleColor,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        ✓ Done · last 24h
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 8px",
            borderRadius: 999,
            background: recent.length > 0 ? "#16a34a" : (dark ? "rgba(255,255,255,0.15)" : "var(--border)"),
            color: recent.length > 0 ? "#fff" : titleColor,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {recent.length}
        </span>
      </div>
      )}
      {recent.length === 0 ? (
        <div style={{ fontSize: 11, color: titleColor, fontStyle: "italic" }}>
          Nothing finished in the last day
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {visible.map((r) => (
            <div
              key={r.slab_id + r.completed_at}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 6px",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              <span style={{ color: "#15803d", fontWeight: 800 }}>✓</span>
              <span style={{ fontWeight: 700, color: dark ? "#fff" : "var(--text)", flexShrink: 0 }}>
                {r.slab_id}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: titleColor,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {r.slab && `· ${r.slab.temple}`}
                {r.slab && (() => {
                  const cft = (r.slab!.length_in * r.slab!.width_in * r.slab!.thickness_in) / 1728;
                  return cft > 0 ? ` · ${cft.toFixed(2)} CFT` : "";
                })()}
                {" · "}
                {fmtAgo(Date.now() - new Date(r.completed_at).getTime())}
              </span>
            </div>
          ))}
          {overflow > 0 && (
            <div style={{ fontSize: 10, color: titleColor, fontStyle: "italic", paddingLeft: 6 }}>
              + {overflow} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fmtAgo(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  const remM = min % 60;
  if (h < 24) return remM > 0 ? `${h}h ${remM}m ago` : `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// TV slide — bigger machine cards, designed for distance viewing.
// `slideKey` forces a fresh React mount each rotation so the
// keyframe animation re-runs on every advance (CSS `animation`
// only fires once per mount).
function VendorTvSlide({ vendor, now, slideKey, dark }: { vendor: FloorVendor; now: number; slideKey: number; dark: boolean }) {
  const grouped = groupMachinesByType(vendor.machines);
  const muted = dark ? "rgba(255,255,255,0.55)" : "#8a7a55";
  return (
    <div
      key={slideKey}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        animation: "tv-slide-in 360ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <style>{`
        @keyframes tv-slide-in {
          from { transform: translateX(60px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 14 }}>
        <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.6px", color: dark ? "#fff" : "#1a1a1a" }}>
          {vendor.name}
        </span>
        <span style={{ fontSize: 14, color: muted, fontWeight: 600 }}>
          {vendor.totals.total} CNC{vendor.totals.total !== 1 ? "s" : ""}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <TvBigStat label="Free" value={vendor.totals.idle} fg={dark ? "#22c55e" : "#15803d"} dark={dark} />
          <TvBigStat label="Carving" value={vendor.totals.carving} fg={dark ? "#60a5fa" : "#1d4ed8"} dark={dark} />
          <TvBigStat label="Maint" value={vendor.totals.maintenance} fg={dark ? "#f87171" : "#b91c1c"} dark={dark} />
          <TvBigStat label="Queue" value={vendor.totals.queue} fg={dark ? "#fbbf24" : "#b45309"} dark={dark} />
          <TvBigStat label="Today" value={vendor.totals.today} fg={dark ? "#E8C572" : "#b87333"} dark={dark} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {grouped.map((g) => (
          <div key={g.type} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {grouped.length > 1 && (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {g.label} ({g.machines.length})
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              {g.machines.map((m) => (
                <TvMachineTile key={m.id} machine={m} now={now} dark={dark} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Queue + last-24h completed fills the lower part of the
          screen so the TV isn't a void below the cards. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginTop: 4,
        }}
      >
        <QueueList queue={vendor.queue} dark={dark} compact={false} />
        <RecentList recent={vendor.recentCompleted} dark={dark} compact={false} />
      </div>
    </div>
  );
}

// ── Machine tiles ──────────────────────────────────────────────────

function CompactMachineTile({ machine, now }: { machine: FloorMachine; now: number }) {
  const tint = STATUS_TINT[machine.status];
  return (
    <div
      style={{
        padding: "8px 10px",
        background: tint.bg,
        border: `1.5px solid ${tint.border}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        position: "relative",
      }}
    >
      <div
        style={{
          height: 3,
          background: tint.accent,
          borderRadius: 2,
          marginBottom: 4,
          opacity: machine.status === "idle" ? 0.4 : 1,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>
          {machine.machine_code}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            padding: "1px 6px",
            borderRadius: 999,
            color: "#fff",
            background: tint.accent,
            letterSpacing: "0.05em",
            opacity: machine.status === "idle" ? 0.85 : 1,
          }}
        >
          {tint.label}
        </span>
      </div>
      {machine.machine_type !== "single_head" && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 800,
            padding: "0 5px",
            borderRadius: 3,
            background:
              machine.machine_type === "lathe" ? "rgba(124,58,237,0.15)" : "rgba(180,115,51,0.15)",
            color: machine.machine_type === "lathe" ? "#7c3aed" : "#b45309",
            letterSpacing: "0.06em",
            alignSelf: "flex-start",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {machine.machine_type === "multi_head_2" ? "2× HEAD" : "LATHE"}
        </span>
      )}
      {machine.operator_name && (
        <div style={{ fontSize: 10, color: "var(--muted)" }}>👷 {machine.operator_name}</div>
      )}
      {machine.status === "carving" && machine.current_job && (
        <div style={{ fontSize: 10, color: "var(--muted)", paddingTop: 2, borderTop: "1px dashed var(--border)" }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "var(--text)" }}>
            {machine.current_job.slab_id}
          </span>
          {machine.current_job.loaded_at && (() => {
            const elapsed = (now - new Date(machine.current_job!.loaded_at!).getTime()) / 60000;
            const eta = machine.current_job!.vendor_estimated_minutes ?? machine.current_job!.estimated_minutes;
            const remaining = eta != null ? eta - elapsed : null;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                <span style={{ color: "#2563eb", fontWeight: 700 }}>
                  ▶ {fmtDuration(elapsed)}
                </span>
                {remaining != null && (
                  <span style={{ color: remaining < 0 ? "#dc2626" : remaining < 15 ? "#b45309" : "var(--muted)", fontWeight: 700 }}>
                    ⏱ {remaining < 0 ? `${fmtDuration(remaining)} over` : fmtDuration(remaining) + " left"}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {machine.status === "maintenance" && (
        <div style={{ fontSize: 10, color: "#b91c1c", fontWeight: 600 }}>
          🔧 {machine.maintenance_reason ?? "—"}
          {machine.maintenance_flagged_at && (() => {
            const downMin = (now - new Date(machine.maintenance_flagged_at).getTime()) / 60000;
            return <span style={{ marginLeft: 6 }}>· down {fmtDuration(downMin)}</span>;
          })()}
        </div>
      )}
    </div>
  );
}

function TvMachineTile({ machine, now, dark }: { machine: FloorMachine; now: number; dark: boolean }) {
  // Theme-aware palette. Dark uses translucent overlays on a black
  // bg; light uses soft pastel gradients. Accent colour matches in
  // both for consistency.
  const cardBg = dark
    ? machine.status === "carving"
      ? "rgba(37,99,235,0.18)"
      : machine.status === "maintenance"
        ? "rgba(220,38,38,0.18)"
        : machine.status === "idle"
          ? "rgba(22,163,74,0.12)"
          : "rgba(255,255,255,0.05)"
    : machine.status === "carving"
      ? "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)"
      : machine.status === "maintenance"
        ? "linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%)"
        : machine.status === "idle"
          ? "#fff"
          : "#f5f5f0";
  const cardBorder =
    machine.status === "carving"
      ? "#2563eb"
      : machine.status === "maintenance"
        ? "#dc2626"
        : machine.status === "idle"
          ? (dark ? "rgba(255,255,255,0.18)" : "#cbd5e1")
          : (dark ? "rgba(255,255,255,0.1)" : "#e5e7eb");
  const accent =
    machine.status === "carving"
      ? "#2563eb"
      : machine.status === "maintenance"
        ? "#dc2626"
        : machine.status === "idle"
          ? "#16a34a"
          : "#9ca3af";
  const label = STATUS_TINT[machine.status].label;
  const codeColor = dark ? "#fff" : "#1a1a1a";
  const subColor = dark ? "rgba(255,255,255,0.7)" : "#666";
  const sub2Color = dark ? "rgba(255,255,255,0.5)" : "#666";
  const dividerColor = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)";
  return (
    <div
      style={{
        padding: 18,
        background: cardBg,
        border: `2px solid ${cardBorder}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 150,
        boxShadow:
          machine.status === "carving" || machine.status === "maintenance"
            ? "0 2px 12px rgba(0,0,0,0.06)"
            : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span
          style={{
            fontFamily: "ui-monospace, monospace",
            fontWeight: 800,
            fontSize: 32,
            color: codeColor,
            letterSpacing: "-0.5px",
          }}
        >
          {machine.machine_code}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            padding: "4px 12px",
            borderRadius: 999,
            color: "#fff",
            background: accent,
            letterSpacing: "0.08em",
          }}
        >
          {label}
        </span>
      </div>
      {machine.machine_type !== "single_head" && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            padding: "3px 9px",
            borderRadius: 4,
            background: machine.machine_type === "lathe" ? "rgba(124,58,237,0.12)" : "rgba(180,115,51,0.15)",
            color: machine.machine_type === "lathe" ? (dark ? "#c4b5fd" : "#7c3aed") : (dark ? "#fbbf24" : "#b45309"),
            letterSpacing: "0.08em",
            alignSelf: "flex-start",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {machine.machine_type === "multi_head_2" ? "2× HEAD" : "LATHE"}
        </span>
      )}
      {machine.operator_name && (
        <div style={{ fontSize: 13, color: subColor }}>
          👷 {machine.operator_name}
        </div>
      )}
      {machine.status === "carving" && machine.current_job && (
        <div style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${dividerColor}` }}>
          <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 16, color: codeColor }}>
            {machine.current_job.slab_id}
          </div>
          {machine.current_job.slab && (
            <div style={{ fontSize: 12, color: sub2Color }}>
              {machine.current_job.slab.temple} · {machine.current_job.slab.length_in}×{machine.current_job.slab.width_in}″
              {(() => {
                const cft = (machine.current_job!.slab!.length_in * machine.current_job!.slab!.width_in * machine.current_job!.slab!.thickness_in) / 1728;
                return cft > 0 ? ` · ${cft.toFixed(2)} CFT` : "";
              })()}
            </div>
          )}
          {machine.current_job.loaded_at && (() => {
            const elapsed = (now - new Date(machine.current_job!.loaded_at!).getTime()) / 60000;
            const eta = machine.current_job!.vendor_estimated_minutes ?? machine.current_job!.estimated_minutes;
            const remaining = eta != null ? eta - elapsed : null;
            return (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  alignItems: "baseline",
                  fontFamily: "ui-monospace, monospace",
                  marginTop: 6,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 800, color: dark ? "#93c5fd" : "#1d4ed8" }}>
                  ▶ {fmtDuration(elapsed)}
                </span>
                {remaining != null && (
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: remaining < 0
                        ? (dark ? "#fca5a5" : "#dc2626")
                        : remaining < 15
                          ? (dark ? "#fbbf24" : "#b45309")
                          : (dark ? "#93c5fd" : "#1d4ed8"),
                    }}
                  >
                    ⏱ {remaining < 0 ? `${fmtDuration(remaining)} over` : fmtDuration(remaining) + " left"}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {machine.status === "maintenance" && (
        <div style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${dividerColor}` }}>
          {machine.maintenance_flagged_at && (() => {
            const downMin = (now - new Date(machine.maintenance_flagged_at).getTime()) / 60000;
            return (
              <div style={{ fontSize: 16, fontWeight: 800, color: dark ? "#fca5a5" : "#b91c1c", fontFamily: "ui-monospace, monospace" }}>
                ⏱ down for {fmtDuration(downMin)}
              </div>
            );
          })()}
          <div style={{ fontSize: 13, color: sub2Color, marginTop: 4 }}>
            {machine.maintenance_reason ?? "—"}
          </div>
        </div>
      )}
    </div>
  );
}

// Group machines by their type so the cockpit + TV slide can show
// "Single Head", "2× HEAD", "Lathe" subgroups instead of one
// undifferentiated grid. Sorted: single → 2× head → lathe.
function groupMachinesByType(machines: FloorMachine[]): Array<{ type: FloorMachine["machine_type"]; label: string; machines: FloorMachine[] }> {
  const buckets: Record<FloorMachine["machine_type"], FloorMachine[]> = {
    single_head: [],
    multi_head_2: [],
    lathe: [],
  };
  for (const m of machines) buckets[m.machine_type].push(m);
  const order: Array<{ type: FloorMachine["machine_type"]; label: string }> = [
    { type: "single_head", label: "Single head" },
    { type: "multi_head_2", label: "2× head" },
    { type: "lathe", label: "Lathe" },
  ];
  return order
    .map((o) => ({ type: o.type, label: o.label, machines: buckets[o.type] }))
    .filter((g) => g.machines.length > 0);
}

// ── Stat tiles ─────────────────────────────────────────────────────

function Stat({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div style={{ padding: "6px 12px", background: "rgba(255,255,255,0.08)", borderRadius: 8, minWidth: 60 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: fg, lineHeight: 1.1, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function TvStat({ label, value, fg, dark = false }: { label: string; value: number; fg: string; dark?: boolean }) {
  return (
    <div style={{
      padding: "6px 14px",
      background: dark ? "rgba(255,255,255,0.08)" : "#fff",
      border: `1px solid ${dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)"}`,
      borderRadius: 8,
      minWidth: 70,
      textAlign: "center",
    }}>
      <div style={{ fontSize: 11, color: dark ? "rgba(255,255,255,0.55)" : "#8a7a55", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: fg, lineHeight: 1.1, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function TvBigStat({ label, value, fg, dark = false }: { label: string; value: number; fg: string; dark?: boolean }) {
  return (
    <div style={{
      padding: "10px 18px",
      background: dark ? "rgba(255,255,255,0.08)" : "#fff",
      border: `1px solid ${dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)"}`,
      borderRadius: 10,
      textAlign: "center",
      minWidth: 88,
    }}>
      <div style={{ fontSize: 11, color: dark ? "rgba(255,255,255,0.55)" : "#8a7a55", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: fg, lineHeight: 1, marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
        {value}
      </div>
    </div>
  );
}

function VendorStatRow({ totals }: { totals: FloorVendor["totals"] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <Tile label="Free" value={totals.idle} fg="#16a34a" />
      <Tile label="Carving" value={totals.carving} fg="#2563eb" />
      <Tile label="Maint" value={totals.maintenance} fg="#dc2626" />
      <Tile label="Queue" value={totals.queue} fg="#b45309" />
      <Tile label="Today" value={totals.today} fg="#b87333" />
    </div>
  );
}

function Tile({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div
      style={{
        padding: "5px 11px",
        background: "var(--surface-alt)",
        borderRadius: 6,
        textAlign: "center",
        minWidth: 56,
      }}
    >
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: fg, lineHeight: 1.1, fontFamily: "ui-monospace, monospace" }}>
        {value}
      </div>
    </div>
  );
}
