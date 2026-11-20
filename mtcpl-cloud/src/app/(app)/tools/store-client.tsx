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
import { useLongPress } from "@/lib/use-long-press";
import {
  createToolAction,
  deleteToolAction,
  recordMovementAction,
  undoMovementAction,
  updateToolAction,
} from "./actions";
import { postToolBillAction } from "./bill-actions";
import { MoveSheet, type MoveIntent } from "./move-sheet";
import { AddToolSheet } from "./add-tool-sheet";
import { BillSheet } from "./bill-sheet";
import { ToolSheet } from "./tool-sheet";
import { UndoToast, TOOLS_CSS, ago, type Done } from "./ui-bits";

// The OperatorRow type and the register's roster of enrolled men went
// with the operator sign-in itself (Nov 2026). A vendor's man now takes
// a tool under his own boss's code, so there is no separate list of
// people for this screen to show or to prune.

/** How often the keeper screen asks whether the shelf moved. Slower
 *  than the cupboard's: nobody is standing here about to take the last
 *  one, and a reload here costs a whole page of data. */
const OFFICE_POLL_MS = 6000;

export function StoreClient({
  tools, movements, movementsTruncated = false, stockSig, vendorNames, usage, canManage,
  canScanBills = false, heldOut = 0,
}: {
  tools: ToolRow[];
  movements: ToolMovement[];
  /** True when the register is showing only the most recent slice, so
   *  it can say so instead of quietly reporting a short month. */
  movementsTruncated?: boolean;
  /** The shelf as the server last rendered it (mig 236). */
  stockSig: string;
  /** vendor id → company name, for the register's WHO chips. */
  vendorNames: Record<string, string>;
  /** Mig 238 — tools spent on a machine. The register carries these
   *  beside the shelf movements, because a man taking five and only
   *  ever being shown taking five is how a cupboard loses four. */
  usage: UsageLite[];
  canManage: boolean;
  /** May this person fill the shelf from a scanned supplier bill
   *  (mig 237)? Narrower than canManage on purpose. */
  canScanBills?: boolean;
  /** Mig 238 — pcs in the men's hands: taken, not yet reported used or
   *  given back. A badge on the link, because a pile that nobody has
   *  accounted for is the one number on this screen that asks to be
   *  chased. */
  heldOut?: number;
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
  const [billOpen, setBillOpen] = useState(false);
  /** The tool whose own sheet is open — reached by pressing its row
   *  rather than by picking a verb and then hunting for the tool. */
  const [sheetTool, setSheetTool] = useState<ToolRow | null>(null);
  const [editing, setEditing] = useState<ToolRow | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
    // orderForTaking puts the most-used first, which is right at the
    // cupboard where somebody is looking for the thing they always
    // take. This screen belongs to the person who REFILLS it, so what
    // is empty or running low rises to the top instead — and that is
    // why the separate "running low" strip above could go.
    const rank = (t: ToolRow) => (t.stock <= 0 ? 0 : t.level !== "ok" ? 1 : 2);
    const base = orderForTaking(optimistic).sort((x, y) => rank(x) - rank(y));
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

  /**
   * Post a reviewed supplier bill (mig 237).
   *
   * Its own submitter rather than `run`, for two reasons. A bill writes
   * MANY movements, so the undo toast must not offer to take "it" back —
   * there is no single it, and the register's per-line undo is the right
   * tool. And a bill can half-succeed: eleven lines in, one refused.
   * That is reported line by line instead of being flattened into one
   * cheerful message, because a man who thinks twelve arrived will not
   * go looking for the twelfth.
   */
  function submitBill(fd: FormData) {
    setErr(null);
    setBillOpen(false);
    startTransition(async () => {
      const r = await postToolBillAction(fd);
      if (!r.ok) { setErr(r.error); return; }
      if (r.failed.length > 0) {
        setErr(
          `${r.message}. These did NOT go in — add them by hand: ` +
          r.failed.join(" · "),
        );
      }
      setDone({ at: Date.now(), text: r.message });
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
  const lowCount = short.length - outCount;

  return (
    <section className="page-fluid tc-page allow-portrait" style={{ paddingBottom: 110 }}>
      <style>{TOOLS_CSS}</style>

      {/* ── page head ───────────────────────────────────────── */}
      {/* Nov 2026 — the gradient banner, the emoji tile and the three
          score tiles are gone. The men said the module felt like a game
          next to the rest of the app, and the banner was most of why.
          Two of the three tiles counted rows listed directly below them,
          so they are now one sentence instead. */}
      <header className="tc-head">
        <div className="tc-head-id">
          <h1 className="tc-title">Tool store</h1>
          <p className="tc-sub">
            <b>{optimistic.length}</b> tool{optimistic.length === 1 ? "" : "s"} on the shelf
            {outCount > 0 && (
              <> · <span className="tc-outw">{outCount} empty</span></>
            )}
            {lowCount > 0 && (
              <> · <span className="tc-warn">{lowCount} running low</span></>
            )}
            {takenToday > 0 && <> · <b>{takenToday}</b> taken today</>}
          </p>
        </div>
        {canManage && (
          <div className="tc-hero-actions">
            {/* Mig 238 — the other half of the store. This screen says
                what is ON the shelf; that one says where the things
                that left it went. */}
            <Link href="/tools/usage" className="tc-btn">
              Out of the cupboard
              {heldOut > 0 && <i className="tc-btn-n">{heldOut}</i>}
            </Link>
            <Link href="/tools/qr" className="tc-btn">Wardrobe QR</Link>
            {canScanBills && (
              <>
                {/* Daksh, Nov 2026: "we need a place so we can see all
                    scanned bills." Beside the scan rather than inside
                    the register, because a bill is not a movement — it
                    is the paper a dozen movements came from, and it
                    carries rates the register deliberately does not. */}
                <Link href="/tools/bills" className="tc-btn">Scanned bills</Link>
                <button
                  type="button"
                  className="tc-btn"
                  onClick={() => setBillOpen(true)}
                  title="Read a supplier's bill and fill the shelf from it"
                >
                  Scan bill
                </button>
              </>
            )}
            {/* Desktop only. On a phone the same action is the gold
                pill in the corner, and showing both put two Add tools
                on one 375px screen — the exact duplication Daksh was
                counting elsewhere on this page. */}
            <button
              type="button"
              className="tc-btn tc-btn-solid tc-btn-wide"
              onClick={() => { setEditing(null); setAddOpen(true); }}
            >
              Add tool
            </button>
          </div>
        )}
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
              <span aria-hidden>⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the store…" aria-label="Search tools" />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear">✕</button>}
            </div>
          )}

          {optimistic.length > 0 && canManage && (
            <p className="tc-howto">
              <b>Press a tool</b> to add stock, fix its count or read its register.
            </p>
          )}

          {optimistic.length === 0 ? (
            <div className="tc-empty">
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
            <div className="tc-grid" data-photos={visible.some((t) => t.imageUrl) ? "1" : "0"}>
              {visible.map((t) => (
                <ToolCard
                  key={t.id} tool={t} canManage={canManage}
                  onAddStock={() => setIntent({ tool: t, kind: "receive" })}
                  onOpen={() => { setConfirmDelete(null); setSheetTool(t); }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <Register
          movements={movements}
          usage={usage}
          tools={tools}
          vendorNames={vendorNames}
          truncated={movementsTruncated}
          onlyTool={onlyTool}
          onClearFilter={() => setOnlyTool(null)}
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

      <ToolSheet
        tool={sheetTool}
        canManage={canManage}
        confirmingDelete={confirmDelete === sheetTool?.id}
        onClose={() => { setSheetTool(null); setConfirmDelete(null); }}
        onAddStock={() => { const t = sheetTool; setSheetTool(null); if (t) setIntent({ tool: t, kind: "receive" }); }}
        onFixCount={() => { const t = sheetTool; setSheetTool(null); if (t) setIntent({ tool: t, kind: "adjust" }); }}
        onHistory={() => { const t = sheetTool; setSheetTool(null); if (t) { setOnlyTool(t.id); setTab("register"); } }}
        onEdit={() => { const t = sheetTool; setSheetTool(null); if (t) { setEditing(t); setAddOpen(true); } }}
        onAskDelete={() => sheetTool && setConfirmDelete(sheetTool.id)}
        onCancelDelete={() => setConfirmDelete(null)}
        onDelete={() => {
          const t = sheetTool;
          setSheetTool(null); setConfirmDelete(null);
          if (!t) return;
          const fd = new FormData();
          fd.set("tool_id", t.id);
          run(() => deleteToolAction(fd), (msg) => setDone({ at: Date.now(), text: msg ?? "Deleted" }));
        }}
      />

      <BillSheet
        open={billOpen}
        tools={optimistic}
        busy={pending}
        onClose={() => setBillOpen(false)}
        onPost={submitBill}
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
// Daksh, Nov 2026: "in website the register UI is really bad. make this
// like phone, more good interface — the simple thing, like we will see
// all at first then we can filter only vivek, or week only and all. but
// really good UI."
//
// What stood here was a set of company folders, each opening onto two
// tally columns with the actual lines folded away behind "every line
// (41)". It was built to answer one question — what did Mohit's lot go
// through in November — and it answered that one well, but it answered
// it before anybody had asked, and it answered nothing else. To see
// what happened this morning you opened four folders. To find a single
// take you knew the time of, you opened all of them.
//
// The phone, written later and under more pressure, had already got
// this right: one roll of lines, newest first, and you narrow it rather
// than navigate it. So this is the phone's register on a desk-sized
// screen. Everything, in time order, the moment it opens — then three
// ways to cut it down, which compose:
//
//   WHO      a company, the office, or the store itself
//   WHEN     today · 7 days · this month · everything
//   SEARCH   a tool or a man's name
//
// The strip above the roll says what you are looking at and offers one
// tap back to all of it, so no filter can be left on by accident and
// read as "nothing happened".
//
// It carries machine-use lines too (mig 238), as the phone does. A
// register that shows a man taking five and never shows four of them
// going into a CNC is not a register, it is half of one. Those lines
// are the one kind here that does not move the shelf — the pc left his
// hands, not the cupboard — so they get their own colour and say the
// machine out loud instead of being dressed up as a take.

/** A machine-use row, flattened for this screen (mig 238). */
export type UsageLite = {
  id: string;
  at: string;
  toolId: string;
  toolName: string;
  machineCode: string;
  qty: number;
  usedBy: string;
  vendorId: string | null;
  company: string | null;
  undone: boolean;
};

/** One thing that happened — a movement or a machine-use — flattened so
 *  the roll can tell a single story in time order. Keyed on the ACTION,
 *  never on the sign: a take and a downward count correction are both a
 *  minus, and one is a man walking off with four bits while the other is
 *  nothing leaving the cupboard at all. */
type Line = {
  id: string;
  at: string;
  act: "in" | "out" | "fix" | "use";
  word: string;
  qty: number;
  sign: string;
  toolId: string;
  toolName: string;
  person: string | null;
  vendorId: string | null;
  /** Which WHO chip this line belongs under. Decided ONCE, here, and
   *  never re-derived from the action — a scrap is an "out" by sign but
   *  it is the store throwing something away, not a man taking it, and
   *  working that out twice in two places is how it ends up on the
   *  wrong chip in one of them. */
  whoKey: string;
  company: string | null;
  machineCode: string | null;
  viaQr: boolean;
  note: string | null;
  undone: boolean;
};

type Period = "today" | "week" | "month" | "all";

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "Everything" },
];

const ALL_KEY = "__all";
const STORE_KEY = "__store";
const OFFICE_KEY = "__office";

// The cupboard is in Rajasthan. A register that silently reads
// differently on a laptop in another timezone is not a register, so
// every date on this screen is worked out in IST by shifting the
// instant and then reading its UTC parts.
const IST = 5.5 * 3_600_000;

function istDate(iso: string | number): Date {
  return new Date(new Date(iso).getTime() + IST);
}

function istDayKey(iso: string | number): string {
  const d = istDate(iso);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function istClock(iso: string): string {
  const d = istDate(iso);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h >= 12 ? "pm" : "am"}`;
}

function dayLabel(iso: string): string {
  const key = istDayKey(iso);
  if (key === istDayKey(Date.now())) return "Today";
  if (key === istDayKey(Date.now() - 86_400_000)) return "Yesterday";
  return istDate(iso).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
    // The instant is already shifted, so reading it as UTC gives the
    // IST calendar date.
    timeZone: "UTC",
  });
}

/** Midnight IST today / the 1st of this IST month, as real instants. */
function istStartOfToday(): number {
  const n = istDate(Date.now());
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - IST;
}
function istStartOfMonth(): number {
  const n = istDate(Date.now());
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1) - IST;
}

function periodStart(p: Period): number {
  if (p === "all") return 0;
  if (p === "today") return istStartOfToday();
  if (p === "month") return istStartOfMonth();
  return Date.now() - 7 * 86_400_000;
}

function Register({
  movements, usage, tools, vendorNames, truncated, onlyTool, onClearFilter,
}: {
  movements: ToolMovement[];
  usage: UsageLite[];
  tools: ToolRow[];
  vendorNames: Record<string, string>;
  truncated: boolean;
  onlyTool: string | null;
  onClearFilter: () => void;
}) {
  const toolName = useMemo(() => new Map(tools.map((t) => [t.id, t.name])), [tools]);
  const [period, setPeriod] = useState<Period>("week");
  const [who, setWho] = useState<string>(ALL_KEY);
  const [find, setFind] = useState("");

  /** Everything that happened, both ledgers, newest first. Built once
   *  and then only filtered, so the counts on the WHO chips are counts
   *  of the whole period rather than of whatever is on screen. */
  const all = useMemo<Line[]>(() => {
    const moved: Line[] = movements.map((m) => {
      const act: Line["act"] =
        m.kind === "receive" ? "in" : m.kind === "adjust" ? "fix" : "out";
      const qty = Math.abs(Number(m.delta));
      const storeSide = m.kind === "receive" || m.kind === "scrap" || m.kind === "adjust";
      return {
        id: m.id,
        at: m.created_at,
        act,
        word:
          m.kind === "receive" ? "Stock in"
          : m.kind === "return" ? "Given back"
          : m.kind === "scrap" ? "Scrapped"
          : m.kind === "adjust" ? "Count fixed"
          : "Taken",
        qty,
        sign: act === "in" ? "+" : Number(m.delta) < 0 ? "−" : "+",
        toolId: m.tool_id,
        toolName: toolName.get(m.tool_id) ?? "a tool since removed",
        person: m.taken_by,
        // A delivery, a scrap or a correction belongs to the store,
        // never to a company, even when the row carries a vendor id.
        vendorId: storeSide ? null : m.vendor_id,
        whoKey: storeSide ? STORE_KEY : m.vendor_id ?? OFFICE_KEY,
        company: storeSide ? null : m.vendor_id ? vendorNames[m.vendor_id] ?? null : null,
        machineCode: null,
        viaQr: !!m.guest_link_id,
        note: m.note,
        undone: !!m.undone_at,
      };
    });

    const spent: Line[] = usage.map((u) => ({
      id: `use:${u.id}`,
      at: u.at,
      act: "use",
      word: `Used · ${u.machineCode}`,
      qty: u.qty,
      sign: "−",
      toolId: u.toolId,
      toolName: u.toolName,
      person: u.usedBy,
      vendorId: u.vendorId,
      whoKey: u.vendorId ?? OFFICE_KEY,
      company: u.company,
      machineCode: u.machineCode,
      viaQr: false,
      note: null,
      undone: u.undone,
    }));

    return [...moved, ...spent].sort((a, b) => b.at.localeCompare(a.at));
  }, [movements, usage, toolName, vendorNames]);

  /** Narrowed by the tool chip and the period, but NOT by who or by the
   *  search box — this is what the WHO chips count, so their numbers
   *  stay still as you move between them. */
  const inPeriod = useMemo(() => {
    const from = periodStart(period);
    const base = onlyTool ? all.filter((l) => l.toolId === onlyTool) : all;
    return from === 0 ? base : base.filter((l) => new Date(l.at).getTime() >= from);
  }, [all, period, onlyTool]);

  const whoChips = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of inPeriod) n.set(l.whoKey, (n.get(l.whoKey) ?? 0) + 1);
    const vendors = [...n.entries()]
      .filter(([k]) => k !== OFFICE_KEY && k !== STORE_KEY)
      .map(([k, c]) => ({ key: k, label: vendorNames[k] ?? "Unknown company", n: c }))
      // Busiest first: the question is who is going through the most,
      // and that should not depend on who moved something last.
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    const tail = [
      { key: OFFICE_KEY, label: "Office", n: n.get(OFFICE_KEY) ?? 0 },
      { key: STORE_KEY, label: "The store", n: n.get(STORE_KEY) ?? 0 },
    ].filter((c) => c.n > 0);
    return [{ key: ALL_KEY, label: "Everyone", n: inPeriod.length }, ...vendors, ...tail];
  }, [inPeriod, vendorNames]);

  const lines = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return inPeriod.filter((l) => {
      if (who !== ALL_KEY && l.whoKey !== who) return false;
      if (!needle) return true;
      return (
        l.toolName.toLowerCase().includes(needle) ||
        (l.person ?? "").toLowerCase().includes(needle) ||
        (l.company ?? "").toLowerCase().includes(needle) ||
        (l.machineCode ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inPeriod, who, find]);

  /** Taken and added over what is on screen. A voided line is not a
   *  fact about the shelf, so it counts towards neither. */
  const sums = useMemo(() => {
    let took = 0, came = 0, used = 0;
    for (const l of lines) {
      if (l.undone) continue;
      if (l.act === "out" && l.sign === "−") took += l.qty;
      else if (l.act === "in") came += l.qty;
      else if (l.act === "use") used += l.qty;
    }
    return { took, came, used };
  }, [lines]);

  const days = useMemo(() => {
    const out: Array<{ key: string; label: string; lines: Line[] }> = [];
    for (const l of lines) {
      const key = istDayKey(l.at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.lines.push(l);
      else out.push({ key, label: dayLabel(l.at), lines: [l] });
    }
    return out;
  }, [lines]);

  const narrowed = who !== ALL_KEY || find.trim() !== "" || period !== "all" || !!onlyTool;

  function clearAll() {
    setWho(ALL_KEY);
    setFind("");
    setPeriod("all");
    onClearFilter();
  }

  return (
    <>
      {/* ── how to cut it down ───────────────────────────────── */}
      <div className="tc-rv-filters">
        <div className="tc-rv-when" role="group" aria-label="Over what period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              data-on={period === p.key ? "1" : undefined}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <input
          className="tc-rv-find"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find a tool, a man, a machine…"
          aria-label="Find in the register"
        />
      </div>

      {/* The companies get their own row: there can be a dozen, and
          cramming them in beside the period buttons was what made the
          old filter bar unreadable on a laptop. */}
      <div className="tc-rv-who" role="group" aria-label="Whose lines">
        {whoChips.map((c) => (
          <button
            key={c.key}
            type="button"
            data-on={who === c.key ? "1" : undefined}
            data-kind={c.key === STORE_KEY ? "store" : c.key === OFFICE_KEY ? "office" : undefined}
            onClick={() => setWho(c.key)}
          >
            {c.label}
            <i>{c.n}</i>
          </button>
        ))}
      </div>

      {/* ── what you are looking at ──────────────────────────── */}
      <div className="tc-rv-strip">
        <span className="tc-rv-count">
          <b>{lines.length}</b> {lines.length === 1 ? "line" : "lines"}
        </span>
        {sums.took > 0 && <span className="tc-rv-sum" data-act="out"><b>{sums.took}</b> taken</span>}
        {sums.used > 0 && <span className="tc-rv-sum" data-act="use"><b>{sums.used}</b> used on machines</span>}
        {sums.came > 0 && <span className="tc-rv-sum" data-act="in"><b>{sums.came}</b> added</span>}
        {onlyTool && (
          <span className="tc-rv-chip">
            {toolName.get(onlyTool) ?? "This tool"} only
            <button type="button" onClick={onClearFilter} aria-label="Show every tool">✕</button>
          </span>
        )}
        {narrowed && (
          <button type="button" className="tc-rv-clear" onClick={clearAll}>
            Show everything
          </button>
        )}
      </div>

      {truncated && period === "all" && (
        <div className="tc-period-note">
          Showing the most recent 2,000 lines. Older ones are in the database but
          not on this screen.
        </div>
      )}

      {/* ── the roll ─────────────────────────────────────────── */}
      {lines.length === 0 ? (
        <div className="tc-empty-search">
          {all.length === 0
            ? "Nothing has moved yet."
            : "Nothing matches that. Widen the period, or show everything."}
        </div>
      ) : (
        <div className="tc-rv-tl">
          {days.map((d) => (
            <section key={d.key} className="tc-rv-day">
              <header className="tc-rv-date">
                <span>{d.label}</span>
                <i>{d.lines.length} {d.lines.length === 1 ? "line" : "lines"}</i>
              </header>
              <div className="tc-rv-rail">
                {d.lines.map((l) => <RegLine key={l.id} l={l} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** One line of the roll. Module scope, not nested in Register — a
 *  component declared inside another remounts on every render, and the
 *  search box above would lose focus after a single keystroke. */
function RegLine({ l }: { l: Line }) {
  const glyph = l.act === "in" ? "↓" : l.act === "out" ? "↑" : l.act === "use" ? "⚙" : "=";

  // A correction moves no goods, so it says what it did to the BOOK
  // rather than naming somebody who carried something away. And the
  // company is dropped when it IS the name — a vendor principal signs
  // for himself, and "VIVEK · VIVEK" tells nobody anything.
  const whoPart = l.person
    ? `${l.person}${l.company && l.company !== l.person ? ` · ${l.company}` : ""}`
    : l.act === "fix"
      ? `Register ${l.sign === "−" ? "lowered" : "raised"} by ${l.qty} · nothing was taken`
      : l.act === "in"
        ? "Onto the shelf"
        : "Store";

  return (
    <div className="tc-rv-row" data-act={l.act} data-void={l.undone ? "1" : undefined}>
      <span className="tc-rv-time">{istClock(l.at)}</span>
      <span className="tc-rv-dot" aria-hidden>{glyph}</span>
      <span className="tc-rv-body">
        <span className="tc-rv-head">
          <span className="tc-rv-badge">{l.word}</span>
          <b className="tc-rv-qty">{l.sign}{l.qty}</b>
        </span>
        <span className="tc-rv-tool">{l.toolName}</span>
        <span className="tc-rv-who-line">
          {whoPart}
          {l.act === "use" && <> · out of his hands into machine {l.machineCode}</>}
          {l.viaQr && <span className="tc-reg-qr" title="Taken at the cupboard QR">▦</span>}
          {l.note && <> · {l.note}</>}
          {l.undone && <> · <strong style={{ color: "var(--danger)" }}>undone</strong></>}
        </span>
      </span>
    </div>
  );
}


// ── Tool card ──────────────────────────────────────────────────────

function ToolCard({
  tool, canManage, onAddStock, onOpen,
}: {
  tool: ToolRow; canManage: boolean;
  onAddStock: () => void;
  onOpen: () => void;
}) {
  // ── ONE menu per tool ──────────────────────────────────────────
  //
  // Daksh, Nov 2026: "when we press on item then also option, if we
  // press on that 3 dots then also there are options — make it easy
  // and good for usability."
  //
  // He was counting. Every single thing a tool can do existed twice:
  // the row opened a sheet with Add stock / Fix count / register /
  // Edit / Delete, and the ⋯ opened a menu with Fix count / register /
  // Edit / Delete. Two delete confirmations, two register links, two
  // ways to edit, written and maintained separately — and whichever
  // one you learned, the other was still there looking like it might
  // do something different.
  //
  // The ⋯ is gone. The row opens the sheet, which is the same gesture
  // and the same sheet as the cupboard phone, so there is one thing to
  // learn for both screens. Add stock stays on the row because it is
  // the one action people come here to do; it is a shortcut INTO the
  // sheet's first item, not a second menu.
  const press = useLongPress(onOpen, { onClick: onOpen });

  const level = tool.stock <= 0 ? "out" : tool.stock <= tool.lowLine ? "low" : "ok";

  // The progress bar that used to sit here is gone. Its denominator was
  // max(warn line × 3, stock) — a maximum no tool actually has, so the
  // bar was decoration drawn in the shape of data. The number and the
  // badge say the same thing honestly.
  const last = tool.lastMovement
    ? `${tool.lastMovement.taken_by
        ? `${tool.lastMovement.taken_by} took ${Math.abs(Number(tool.lastMovement.delta))}`
        : KIND_LABEL[tool.lastMovement.kind]} · ${ago(tool.lastMovement.created_at)}`
    : "nothing taken yet";

  return (
    <article className="tc-card" data-level={level} tabIndex={0} role="button" {...press}>
      {/* Mig 233 — the photo. A tool WITHOUT one shows a quiet empty
          frame rather than its first letter in a colour: six of the
          seven codes on this shelf begin with D, so the letter taught
          nobody anything and only added colour. */}
      <div className="tc-thumb" data-empty={tool.imageUrl ? undefined : "1"}>
        {tool.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={tool.imageUrl} alt="" loading="lazy" />
          : null}
      </div>

      <div style={{ minWidth: 0 }}>
        <h2 className="tc-name" title={tool.name}>{tool.name}</h2>
        <div className="tc-spec">
          {tool.spec ? `${tool.spec} · ` : ""}{last}
        </div>
      </div>

      <div className="tc-stockline">
        <div className="tc-stock">
          <span className="tc-stock-n">{tool.stock}</span>
          <span className="tc-stock-u">{tool.unit}</span>
        </div>
      </div>

      <span className="tc-chip">
        {level === "out" ? "Empty" : level === "low" ? `Low · warns at ${tool.lowLine}` : "In stock"}
      </span>

      {/* The row owns the press gesture, so anything inside it that is
          pressable has to keep its own events to itself — otherwise
          pressing "Add stock" would open the sheet behind it. */}
      <div
        className="tc-rowacts"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {canManage && (
          <button type="button" className="tc-addstock" onClick={onAddStock}>
            Add stock
          </button>
        )}
        {/* Says the row opens. Without it the only clue was the cursor,
            which a touchscreen does not have. */}
        <span className="tc-go" aria-hidden>›</span>
      </div>
    </article>
  );
}
