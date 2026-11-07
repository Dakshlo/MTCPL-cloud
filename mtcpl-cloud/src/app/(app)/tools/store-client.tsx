"use client";

/**
 * The tool store, for the one person who keeps it.
 *
 * Oct 2026 — this screen was doing four jobs and doing none of them
 * well: a vendor switcher, a paper-register typing grid, per-tool pages,
 * and five kinds of movement behind a ⋯ menu. Daksh: "the inventory
 * looks really cluttered and not attractive to useable, so drop all
 * other features."
 *
 * So there are now exactly two jobs in the whole module, and they live
 * on different screens:
 *
 *   HERE (keeper, logged in)    keep the shelf full — add a tool, add
 *                               stock, correct a count, see what is
 *                               running out, read the register.
 *   THE QR (taker, phone)       take something. Nothing else.
 *
 * Taking is deliberately NOT possible from this screen. If it were, the
 * register would quietly go back to being somebody typing in what he
 * thinks happened, which is the paper book we are replacing.
 */

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  KIND_LABEL,
  orderForTaking,
  shortages,
  type ToolMovement,
  type ToolRow,
} from "@/lib/cnc-tool-stock";
import { useLiveStock } from "@/lib/use-live-stock";
import {
  createToolAction,
  deleteToolAction,
  recordMovementAction,
  removeToolOperatorAction,
  undoMovementAction,
  updateToolAction,
} from "./actions";
import { MoveSheet, type MoveIntent } from "./move-sheet";
import { AddToolSheet } from "./add-tool-sheet";
import { UndoToast, TOOLS_CSS, ago, type Done } from "./ui-bits";

/** A man enrolled under a CNC vendor (mig 234). */
export type OperatorRow = {
  id: string;
  name: string;
  maskedPhone: string;
  vendorId: string;
  vendorName: string;
};

/** How often the keeper screen asks whether the shelf moved. Slower
 *  than the cupboard's: nobody is standing here about to take the last
 *  one, and a reload here costs a whole page of data. */
const OFFICE_POLL_MS = 6000;

export function StoreClient({
  tools, movements, movementsTruncated = false, stockSig, vendorNames, operators, canManage,
}: {
  tools: ToolRow[];
  movements: ToolMovement[];
  /** True when the register is showing only the most recent slice, so
   *  it can say so instead of quietly reporting a short month. */
  movementsTruncated?: boolean;
  /** The shelf as the server last rendered it (mig 236). */
  stockSig: string;
  /** vendor id → company name, for the register's group headings. */
  vendorNames: Record<string, string>;
  operators: OperatorRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"stock" | "register">("stock");

  // Somebody at the cupboard can empty a shelf while this screen sits
  // open. Poll the short signature; reload only when it differs.
  useLiveStock({ signature: stockSig, everyMs: OFFICE_POLL_MS });
  const [q, setQ] = useState("");
  const [intent, setIntent] = useState<MoveIntent | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ToolRow | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Set by the History chip on a card — the register, one tool only. */
  const [onlyTool, setOnlyTool] = useState<string | null>(null);
  /** The tool whose Delete has been pressed once. Deleting is rare and
   *  permanent-looking, so it asks — but inside the menu, not behind a
   *  browser confirm() the phone renders as a grey box. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [optimistic, applyOptimistic] = useOptimistic(
    tools,
    (state: ToolRow[], patch: { toolId: string; delta: number }) =>
      state.map((t) => (t.id === patch.toolId ? { ...t, stock: t.stock + patch.delta } : t)),
  );

  const short = useMemo(() => shortages(optimistic), [optimistic]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = orderForTaking(optimistic);
    if (!needle) return base;
    return base.filter(
      (t) => t.name.toLowerCase().includes(needle) || (t.spec ?? "").toLowerCase().includes(needle),
    );
  }, [optimistic, q]);

  const takenToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return movements
      .filter((m) => !m.undone_at && m.kind === "issue" && new Date(m.created_at).getTime() >= start.getTime())
      .reduce((n, m) => n + Math.abs(Number(m.delta)), 0);
  }, [movements]);

  function run(
    fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>,
    after?: (msg?: string) => void,
  ) {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { setErr(r.error); return; }
      after?.(r.message);
      router.refresh();
    });
  }

  function submitMove(fd: FormData) {
    const toolId = String(fd.get("tool_id"));
    const kind = String(fd.get("kind"));
    const qty = Number(fd.get("qty"));
    const signed = kind === "receive" ? qty : String(fd.get("direction")) === "down" ? -qty : qty;
    const tool = optimistic.find((t) => t.id === toolId);
    setIntent(null);
    startTransition(async () => {
      applyOptimistic({ toolId, delta: signed });
      const r = await recordMovementAction(fd);
      if (!r.ok) { setErr(r.error); router.refresh(); return; }
      setDone({
        at: Date.now(),
        // The one path that writes a movement, so the one path that
        // may be taken back.
        undoable: true,
        text: kind === "receive"
          ? `Added ${qty} × ${tool?.name ?? "tool"}`
          : `Count fixed · ${tool?.name ?? "tool"}`,
      });
      router.refresh();
    });
  }

  const outCount = short.filter((t) => t.stock <= 0).length;

  return (
    <section className="page-fluid tc-page allow-portrait" style={{ paddingBottom: 110 }}>
      <style>{TOOLS_CSS}</style>

      {/* ── hero ──────────────────────────────────────────────── */}
      <header className="tc-hero">
        <div className="tc-hero-row">
          <div className="tc-hero-id">
            <span className="tc-hero-icon" aria-hidden>🧰</span>
            <div style={{ minWidth: 0 }}>
              <div className="tc-eyebrow">CNC tool store</div>
              <h1 className="tc-title">The store</h1>
            </div>
          </div>
          {canManage && (
            <div className="tc-hero-actions">
              <Link href="/tools/qr" className="tc-btn tc-btn-ghost">
                <span aria-hidden>▦</span> Wardrobe QR
              </Link>
              <button
                type="button"
                className="tc-btn tc-btn-solid"
                onClick={() => { setEditing(null); setAddOpen(true); }}
              >
                <span aria-hidden>＋</span> Add tool
              </button>
            </div>
          )}
        </div>

        <div className="tc-stats">
          <div className="tc-stat" data-tone="blue">
            <b>{optimistic.length}</b>
            <span>tool{optimistic.length === 1 ? "" : "s"} on the shelf</span>
          </div>
          <div className="tc-stat" data-tone="green">
            <b>{takenToday}</b>
            <span>taken today</span>
          </div>
          <div className="tc-stat" data-tone={outCount > 0 ? "red" : short.length > 0 ? "amber" : "grey"}>
            <b>{short.length}</b>
            <span>{outCount > 0 ? `running out · ${outCount} empty` : "running low"}</span>
          </div>
        </div>
      </header>

      {/* The three "how it works" cards that used to sit here are gone
          — Daksh, Nov 2026: "remove irrelevant info like that kpi card
          for you keep it full, they scan the cupboard, and that
          instruction, it's not needed." They were written for a screen
          nobody had used yet; the people who open it now have been
          running the cupboard for a month. */}

      {err && (
        <div className="tc-err" role="alert">
          <span>⚠ {err}</span>
          <button type="button" onClick={() => setErr(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {short.length > 0 && (
        <div className="tc-short">
          <div className="tc-short-head">
            <span className="tc-short-dot" />
            {outCount > 0
              ? `${outCount} finished${short.length > outCount ? `, ${short.length - outCount} running low` : ""}`
              : `${short.length} tool${short.length === 1 ? "" : "s"} running low`}
          </div>
          <div className="tc-short-list">
            {short.slice(0, 8).map((t) => (
              <button
                key={t.id} type="button" className="tc-short-pill"
                data-out={t.stock <= 0 ? "1" : undefined}
                onClick={() => canManage && setIntent({ tool: t, kind: "receive" })}
                title={canManage ? "Add stock" : undefined}
              >
                <strong>{t.name}</strong>
                <span>{t.stock <= 0 ? "empty" : `${t.stock} left`}</span>
              </button>
            ))}
            {short.length > 8 && <span className="tc-short-more">+{short.length - 8} more</span>}
          </div>
        </div>
      )}

      <div className="tc-tabs">
        <button type="button" className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>
          On the shelf
        </button>
        <button
          type="button"
          className={tab === "register" ? "on" : ""}
          onClick={() => { setTab("register"); setOnlyTool(null); }}
        >
          Register {movements.length > 0 && <i>{movements.length}</i>}
        </button>
      </div>

      {tab === "stock" ? (
        <>
          {optimistic.length > 4 && (
            <div className="tc-search">
              <span aria-hidden>🔍</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the store…" aria-label="Search tools" />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear">✕</button>}
            </div>
          )}

          {optimistic.length === 0 ? (
            <div className="tc-empty">
              <div className="tc-empty-icon">🧰</div>
              <h2>The store is empty</h2>
              <p>
                There is no fixed list of tools — you build it. Add the first one the way the men
                say it, like <strong>450mm tool</strong>, and put the stock you have in hand against
                it. It is on the cupboard QR the moment you save.
              </p>
              {canManage && (
                <button type="button" onClick={() => { setEditing(null); setAddOpen(true); }}>
                  + Add the first tool
                </button>
              )}
            </div>
          ) : visible.length === 0 ? (
            <div className="tc-empty-search">Nothing matches “{q}”.</div>
          ) : (
            <div className="tc-grid">
              {visible.map((t) => (
                <ToolCard
                  key={t.id} tool={t} canManage={canManage}
                  menuOpen={menuFor === t.id}
                  confirmingDelete={confirmDelete === t.id}
                  onMenu={() => { setMenuFor((m) => (m === t.id ? null : t.id)); setConfirmDelete(null); }}
                  onCloseMenu={() => { setMenuFor(null); setConfirmDelete(null); }}
                  onAddStock={() => { setMenuFor(null); setIntent({ tool: t, kind: "receive" }); }}
                  onFixCount={() => { setMenuFor(null); setIntent({ tool: t, kind: "adjust" }); }}
                  onEdit={() => { setMenuFor(null); setEditing(t); setAddOpen(true); }}
                  onHistory={() => { setMenuFor(null); setOnlyTool(t.id); setTab("register"); }}
                  onAskDelete={() => setConfirmDelete(t.id)}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onDelete={() => {
                    setMenuFor(null); setConfirmDelete(null);
                    const fd = new FormData();
                    fd.set("tool_id", t.id);
                    run(() => deleteToolAction(fd),
                        (msg) => setDone({ at: Date.now(), text: msg ?? "Deleted" }));
                  }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <Register
          movements={movements}
          tools={tools}
          vendorNames={vendorNames}
          operators={operators}
          canManage={canManage}
          truncated={movementsTruncated}
          onlyTool={onlyTool}
          onClearFilter={() => setOnlyTool(null)}
          onRemoveOperator={(id) => {
            const fd = new FormData();
            fd.set("operator_id", id);
            run(() => removeToolOperatorAction(fd),
                (msg) => setDone({ at: Date.now(), text: msg ?? "Removed" }));
          }}
        />
      )}

      <MoveSheet
        intent={intent}
        busy={pending}
        onClose={() => setIntent(null)}
        onSubmit={submitMove}
      />
      <AddToolSheet
        open={addOpen}
        editing={editing}
        busy={pending}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSubmit={(fd, mode) => {
          setAddOpen(false);
          run(() => (mode === "edit" ? updateToolAction(fd) : createToolAction(fd)),
              (msg) => setDone({ at: Date.now(), text: msg ?? "Saved" }));
          setEditing(null);
        }}
      />

      {/* On a phone the hero's Add tool is a long scroll away by the
          time you are looking at the shelf. Same action, put where the
          thumb already is. Phone only — on a desktop the hero button
          is right there and a floating one would just be in the way. */}
      {canManage && (
        <button
          type="button"
          className="tc-fab"
          onClick={() => { setEditing(null); setAddOpen(true); }}
        >
          <span aria-hidden>＋</span> Add tool
        </button>
      )}

      {done && (
        <UndoToast
          done={done} movements={movements}
          onDismiss={() => setDone(null)}
          onUndo={(id) => {
            const fd = new FormData();
            fd.set("movement_id", id);
            setDone(null);
            run(() => undoMovementAction(fd));
          }}
        />
      )}
    </section>
  );
}

// ── The register ───────────────────────────────────────────────────
//
// Daksh, Nov 2026: "make register more useful, so it's usable — which
// vendor took what tools, month wise, operator wise under vendor, and
// all."
//
// It was a roll of lines grouped by company. A line is the proof; it
// is not the answer. The questions actually asked of this screen are
//
//     what did Mohit's lot go through in November
//     which tool is it going on
//     which of his men is taking it
//
// and all three are sums, not lines. So the register leads with the
// sums and keeps the lines underneath, folded away, for the moment
// somebody disputes one.
//
// A MONTH AT A TIME, because that is how the question is asked and how
// the money is settled. Walk back with ‹ ›, or take the whole lot with
// All time. A month with nothing in it says so and offers the way out
// rather than looking broken.
//
// Three kinds of group, and the order is deliberate:
//
//   a vendor   takes belonging to a company, biggest taker first
//   Office     a take by someone with no company of their own
//   The store  stock added, scrapped, counts fixed — nobody took these

type Tally = { id: string; label: string; qty: number; lines: number };

type RegGroup = {
  key: string;
  title: string;
  /** Null for the Office and The store groups. */
  vendorId: string | null;
  rows: ToolMovement[];
  team: OperatorRow[];
  /** Units taken by this company in the period, voided lines ignored. */
  taken: number;
  byTool: Tally[];
  byPerson: Tally[];
  lastAt: number;
};

const STORE_KEY = "__store";
const OFFICE_KEY = "__office";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Which IST month a timestamp falls in. The cupboard is in Rajasthan;
 *  a take at 1am on the 1st belongs to that month, not the last one,
 *  and UTC would put it in the wrong one for five and a half hours
 *  every night. */
function istMonthOf(iso: string): { y: number; m: number } {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

function istNow(): { y: number; m: number } {
  return istMonthOf(new Date().toISOString());
}

type Period = { kind: "month"; y: number; m: number } | { kind: "all" };

function Register({
  movements, tools, vendorNames, operators, canManage, truncated,
  onlyTool, onClearFilter, onRemoveOperator,
}: {
  movements: ToolMovement[];
  tools: ToolRow[];
  vendorNames: Record<string, string>;
  operators: OperatorRow[];
  canManage: boolean;
  truncated: boolean;
  onlyTool: string | null;
  onClearFilter: () => void;
  onRemoveOperator: (operatorId: string) => void;
}) {
  const toolName = useMemo(() => new Map(tools.map((t) => [t.id, t.name])), [tools]);
  const [period, setPeriod] = useState<Period>(() => ({ kind: "month", ...istNow() }));
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});
  const [showTeam, setShowTeam] = useState<string | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);

  const scoped = onlyTool ? movements.filter((m) => m.tool_id === onlyTool) : movements;

  const rows = useMemo(() => {
    if (period.kind === "all") return scoped;
    return scoped.filter((m) => {
      const at = istMonthOf(m.created_at);
      return at.y === period.y && at.m === period.m;
    });
  }, [scoped, period]);

  /** Months that actually have something in them, newest first — so
   *  "nothing here" can point at the nearest month that does. */
  const monthsWithData = useMemo(() => {
    const seen = new Map<string, { y: number; m: number }>();
    for (const mv of scoped) {
      const at = istMonthOf(mv.created_at);
      seen.set(`${at.y}-${at.m}`, at);
    }
    return [...seen.values()].sort((a, b) => b.y - a.y || b.m - a.m);
  }, [scoped]);

  const groups = useMemo<RegGroup[]>(() => {
    const byKey = new Map<string, RegGroup>();
    const toolTally = new Map<string, Map<string, Tally>>();
    const personTally = new Map<string, Map<string, Tally>>();

    const ensure = (key: string, title: string, vendorId: string | null) => {
      let g = byKey.get(key);
      if (!g) {
        g = { key, title, vendorId, rows: [], team: [], taken: 0, byTool: [], byPerson: [], lastAt: 0 };
        byKey.set(key, g);
        toolTally.set(key, new Map());
        personTally.set(key, new Map());
      }
      return g;
    };

    const bump = (
      store: Map<string, Map<string, Tally>>,
      key: string, id: string, label: string, qty: number,
    ) => {
      const m = store.get(key)!;
      const t = m.get(id) ?? { id, label, qty: 0, lines: 0 };
      t.qty += qty;
      t.lines += 1;
      m.set(id, t);
    };

    // Every company that has men gets a group even before it has taken
    // anything, so the office can see who is enrolled.
    for (const o of operators) {
      ensure(o.vendorId, vendorNames[o.vendorId] ?? o.vendorName, o.vendorId).team.push(o);
    }

    for (const m of rows) {
      const storeSide = m.kind === "receive" || m.kind === "scrap" || m.kind === "adjust";
      const key = storeSide ? STORE_KEY : m.vendor_id ?? OFFICE_KEY;
      const title = storeSide
        ? "The store"
        : m.vendor_id
          ? vendorNames[m.vendor_id] ?? "Unknown company"
          : "Office";
      const g = ensure(key, title, storeSide ? null : m.vendor_id);
      g.rows.push(m);
      g.lastAt = Math.max(g.lastAt, new Date(m.created_at).getTime());

      if (!m.undone_at && m.kind === "issue") {
        const qty = Math.abs(Number(m.delta));
        g.taken += qty;
        bump(toolTally, key, m.tool_id, toolName.get(m.tool_id) ?? "—", qty);
        // The man, not the company: "Shyam, under Mohit" is the whole
        // point of asking operator-wise.
        const who = (m.taken_by || "").trim() || "Unsigned";
        bump(personTally, key, who.toLowerCase(), who, qty);
      }
    }

    const sortTally = (m: Map<string, Tally> | undefined) =>
      [...(m?.values() ?? [])].sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label));

    for (const g of byKey.values()) {
      g.byTool = sortTally(toolTally.get(g.key));
      g.byPerson = sortTally(personTally.get(g.key));
    }

    const all = [...byKey.values()];
    const rank = (g: RegGroup) => (g.key === STORE_KEY ? 2 : g.key === OFFICE_KEY ? 1 : 0);
    // Biggest taker first within the companies — the question is who is
    // going through the most, and that should not depend on who
    // happened to take something last.
    return all.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.taken - a.taken ||
        b.lastAt - a.lastAt ||
        a.title.localeCompare(b.title),
    );
  }, [rows, operators, vendorNames, toolName]);

  const periodTaken = groups.reduce((s, g) => s + g.taken, 0);
  const label =
    period.kind === "all" ? "All time" : `${MONTHS[period.m]} ${period.y}`;

  function stepMonth(by: number) {
    setPeriod((p) => {
      const base = p.kind === "month" ? p : { ...istNow() };
      const n = base.m + by;
      return { kind: "month", y: base.y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
    });
  }

  const hasAnythingAtAll = scoped.length > 0;

  return (
    <>
      {onlyTool && <OnlyToolChip name={toolName.get(onlyTool)} onClear={onClearFilter} />}

      {/* ── which month ──────────────────────────────────────── */}
      <div className="tc-period">
        <div className="tc-period-nav">
          <button
            type="button"
            onClick={() => stepMonth(-1)}
            aria-label="Previous month"
            disabled={period.kind === "all"}
          >
            ‹
          </button>
          <strong>{label}</strong>
          <button
            type="button"
            onClick={() => stepMonth(1)}
            aria-label="Next month"
            disabled={period.kind === "all"}
          >
            ›
          </button>
        </div>

        <div className="tc-period-right">
          {periodTaken > 0 && (
            <span className="tc-period-sum">
              <b>{periodTaken}</b> taken
            </span>
          )}
          <button
            type="button"
            className={`tc-period-all${period.kind === "all" ? " on" : ""}`}
            onClick={() =>
              setPeriod((p) => (p.kind === "all" ? { kind: "month", ...istNow() } : { kind: "all" }))
            }
          >
            {period.kind === "all" ? "Back to this month" : "All time"}
          </button>
        </div>
      </div>

      {truncated && period.kind === "all" && (
        <div className="tc-period-note">
          Showing the most recent 2,000 lines. Older ones are in the database but
          not on this screen.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="tc-empty-search">
          {!hasAnythingAtAll ? (
            <>Nothing has moved yet.</>
          ) : (
            <>
              Nothing in {label}.{" "}
              {monthsWithData[0] && (
                <button
                  type="button"
                  className="tc-period-jump"
                  onClick={() => setPeriod({ kind: "month", ...monthsWithData[0] })}
                >
                  Jump to {MONTHS[monthsWithData[0].m]} {monthsWithData[0].y}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="tc-reggroups">
          {groups.map((g) => {
            const linesOpen = openLines[g.key] === true;
            const teamOpen = showTeam === g.key;
            return (
              <section key={g.key} className="tc-reggroup" data-kind={g.vendorId ? "vendor" : g.key}>
                <header className="tc-rg-head">
                  <span className="tc-rg-title">
                    <span className="tc-rg-name">{g.title}</span>
                  </span>

                  <div className="tc-rg-facts">
                    {g.taken > 0 && <span className="tc-rg-took"><b>{g.taken}</b> taken</span>}
                    {g.rows.length > 0 && (
                      <span className="tc-rg-count">
                        {g.rows.length} {g.rows.length === 1 ? "line" : "lines"}
                      </span>
                    )}
                    {g.team.length > 0 && (
                      <button
                        type="button"
                        className="tc-rg-team"
                        onClick={() => { setShowTeam(teamOpen ? null : g.key); setDropping(null); }}
                        aria-expanded={teamOpen}
                      >
                        👷 {g.team.length} {g.team.length === 1 ? "man" : "men"}
                      </button>
                    )}
                  </div>
                </header>

                {/* Who this vendor has enrolled. The office can see the
                    whole list and take anybody off it — a man who has
                    left should not still be able to open the cupboard
                    because nobody told his boss to remove him. */}
                {teamOpen && g.team.length > 0 && (
                  <div className="tc-rg-roster">
                    {g.team.map((o) => (
                      <div key={o.id} className="tc-rg-man">
                        <span className="tc-rg-man-name">{o.name}</span>
                        <span className="tc-rg-man-phone">{o.maskedPhone}</span>
                        {canManage && (
                          dropping === o.id ? (
                            <span className="tc-rg-man-ask">
                              <button type="button" className="tc-rg-man-yes" onClick={() => { setDropping(null); onRemoveOperator(o.id); }}>
                                Remove
                              </button>
                              <button type="button" className="tc-rg-man-no" onClick={() => setDropping(null)}>
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="tc-rg-man-x"
                              onClick={() => setDropping(o.id)}
                              aria-label={`Take ${o.name} off the list`}
                            >
                              ✕
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── the answer ───────────────────────────────── */}
                {g.taken > 0 ? (
                  <div className="tc-rg-sums">
                    <TallyColumn
                      head={g.key === STORE_KEY ? "Tools" : "What they took"}
                      rows={g.byTool}
                      total={g.taken}
                    />
                    {g.key !== STORE_KEY && (
                      <TallyColumn head="Who took it" rows={g.byPerson} total={g.taken} />
                    )}
                  </div>
                ) : (
                  <div className="tc-rg-nothing">
                    {g.rows.length > 0 ? "No takes — stock movements only." : "Nothing taken."}
                  </div>
                )}

                {/* ── the proof, folded away ───────────────────── */}
                {g.rows.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="tc-rg-lines"
                      onClick={() => setOpenLines((c) => ({ ...c, [g.key]: !linesOpen }))}
                      aria-expanded={linesOpen}
                    >
                      {linesOpen ? "▾" : "▸"} every line ({g.rows.length})
                    </button>
                    {linesOpen && (
                      <div className="tc-reg">
                        {g.rows.map((m) => (
                          <RegisterRow key={m.id} m={m} toolName={toolName.get(m.tool_id)} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/** One side of a group's summary: a name, a bar, a number. The bar is
 *  against the group's own total, so it answers "how much of this
 *  company's month was this tool / this man" at a glance. */
function TallyColumn({ head, rows, total }: { head: string; rows: Tally[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="tc-tally">
      <div className="tc-tally-head">{head}</div>
      {rows.map((r) => (
        <div key={r.id} className="tc-tally-row">
          <span className="tc-tally-name" title={r.label}>{r.label}</span>
          <span className="tc-tally-bar" aria-hidden>
            <i style={{ width: `${total > 0 ? Math.max(3, (r.qty / total) * 100) : 0}%` }} />
          </span>
          <span className="tc-tally-qty">{r.qty}</span>
        </div>
      ))}
    </div>
  );
}

function OnlyToolChip({ name, onClear }: { name: string | undefined; onClear: () => void }) {
  return (
    <button type="button" className="tc-filter" onClick={onClear}>
      {name ?? "This tool"} only · <span>show everything ✕</span>
    </button>
  );
}

function RegisterRow({ m, toolName }: { m: ToolMovement; toolName: string | undefined }) {
  const voided = !!m.undone_at;
  const positive = Number(m.delta) > 0;
  // The company is already the heading above this row, so the row says
  // the PERSON — which is the whole point of "Shyam, under Mohit".
  const operator = !!m.taken_by_operator_id;

  return (
    <div className="tc-reg-row" data-void={voided ? "1" : undefined}>
      <div className="tc-reg-delta" data-up={positive ? "1" : undefined}>
        {positive ? "+" : ""}{m.delta}
      </div>
      <div className="tc-reg-main">
        <div className="tc-reg-title">
          {toolName ?? "—"}
          <span className="tc-reg-kind" data-kind={m.kind}>{KIND_LABEL[m.kind]}</span>
        </div>
        <div className="tc-reg-sub">
          {m.taken_by ? <strong>{m.taken_by}</strong> : <>Store</>}
          {operator && <span className="tc-reg-op" title="Works under this vendor">his man</span>}
          {m.guest_link_id && <span className="tc-reg-qr" title="Taken at the cupboard QR">▦</span>}
          {" · "}{ago(m.created_at)}
          {m.note && <> · {m.note}</>}
          {voided && <> · <strong style={{ color: "var(--danger)" }}>undone</strong></>}
        </div>
      </div>
    </div>
  );
}

// ── Tool card ──────────────────────────────────────────────────────

function ToolCard({
  tool, canManage, menuOpen, confirmingDelete,
  onMenu, onCloseMenu, onAddStock, onFixCount, onEdit, onHistory,
  onAskDelete, onCancelDelete, onDelete,
}: {
  tool: ToolRow; canManage: boolean; menuOpen: boolean; confirmingDelete: boolean;
  onMenu: () => void; onCloseMenu: () => void;
  onAddStock: () => void; onFixCount: () => void; onEdit: () => void; onHistory: () => void;
  onAskDelete: () => void; onCancelDelete: () => void; onDelete: () => void;
}) {
  const dotsRef = useRef<HTMLButtonElement | null>(null);
  /** Open the menu upwards when there is not room below it. Measured
   *  on the click rather than in an effect: it has to be decided
   *  before the menu paints, and useLayoutEffect warns on the server. */
  const [up, setUp] = useState(false);
  const MENU_H = 250;

  const level = tool.stock <= 0 ? "out" : tool.stock <= tool.lowLine ? "low" : "ok";
  // Stock against three times the warning line — a scale that means
  // something per tool, rather than a percentage of a maximum no tool
  // actually has.
  const full = Math.max(tool.lowLine * 3, tool.stock, 1);
  const pct = Math.max(tool.stock > 0 ? 5 : 0, Math.min(100, (tool.stock / full) * 100));

  return (
    <article className="tc-card" data-level={level}>
      <div className="tc-card-band" aria-hidden />

      <div className="tc-card-top">
        {/* Mig 233 — the photo, or the tool's initial in the level colour.
            Never an empty grey square: a missing photo should still read
            as a tool, not as a broken card. */}
        <div className="tc-thumb" data-empty={tool.imageUrl ? undefined : "1"}>
          {tool.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={tool.imageUrl} alt="" loading="lazy" />
            : <span aria-hidden>{tool.name.trim().charAt(0).toUpperCase() || "?"}</span>}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className="tc-name" title={tool.name}>{tool.name}</h2>
          <div className="tc-spec">{tool.spec ? tool.spec : `Counted in ${tool.unit}`}</div>
        </div>
        {canManage && (
          <div style={{ position: "relative", flex: "0 0 auto" }}>
            <button
              ref={dotsRef}
              type="button"
              className="tc-dots"
              aria-label="More"
              onClick={() => {
                const r = dotsRef.current?.getBoundingClientRect();
                setUp(!!r && r.bottom + MENU_H > window.innerHeight);
                onMenu();
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div className="tc-menu-scrim" onClick={onCloseMenu} />
                <div className="tc-menu" role="menu" data-up={up ? "1" : undefined}>
                  <button type="button" onClick={onFixCount}>⚖ Fix count</button>
                  <button type="button" onClick={onHistory}>📜 This tool&apos;s register</button>
                  <div className="tc-menu-sep" />
                  <button type="button" onClick={onEdit}>✎ Edit tool</button>

                  {/* Delete only shows at zero. Not greyed out at other
                      times — a disabled button people cannot press is a
                      question they have to ask somebody. The rule is
                      written where they can read it instead. */}
                  <div className="tc-menu-sep" />
                  {tool.stock <= 0 ? (
                    confirmingDelete ? (
                      <div className="tc-menu-ask">
                        <span>Delete {tool.name} from the store?</span>
                        <div>
                          <button type="button" className="tc-menu-yes" onClick={onDelete}>
                            Yes, delete
                          </button>
                          <button type="button" className="tc-menu-no" onClick={onCancelDelete}>
                            Keep it
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="tc-menu-danger" onClick={onAskDelete}>
                        🗑 Delete tool
                      </button>
                    )
                  ) : (
                    <div className="tc-menu-why">
                      Empty it to delete it — {tool.stock} {tool.unit} still on the shelf.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="tc-stockline">
        <div className="tc-stock">
          <span className="tc-stock-n">{tool.stock}</span>
          <span className="tc-stock-u">{tool.unit}</span>
        </div>
        <span className="tc-chip">
          {level === "out" ? "Empty" : level === "low" ? `Low · warns at ${tool.lowLine}` : "In stock"}
        </span>
      </div>

      <div className="tc-bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>

      <div className="tc-last">
        {tool.lastMovement
          ? <>{tool.lastMovement.taken_by ? `${tool.lastMovement.taken_by} took ${Math.abs(Number(tool.lastMovement.delta))}` : KIND_LABEL[tool.lastMovement.kind]} · {ago(tool.lastMovement.created_at)}</>
          : <>Nothing taken yet</>}
      </div>

      {canManage && (
        <button type="button" className="tc-addstock" onClick={onAddStock}>
          ＋ Add stock
        </button>
      )}
    </article>
  );
}
