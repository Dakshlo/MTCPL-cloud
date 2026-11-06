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

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  KIND_LABEL,
  orderForTaking,
  shortages,
  type ToolMovement,
  type ToolRow,
} from "@/lib/cnc-tool-stock";
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

export function StoreClient({
  tools, movements, vendorNames, operators, canManage,
}: {
  tools: ToolRow[];
  movements: ToolMovement[];
  /** vendor id → company name, for the register's group headings. */
  vendorNames: Record<string, string>;
  operators: OperatorRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"stock" | "register">("stock");
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
// Daksh, Nov 2026: "in register view we will see entry vendor wise."
//
// So the page is no longer one long roll of every movement in date
// order. It is a company at a time — MOHIT, and under him whichever of
// his men actually stood at the cupboard — because that is the question
// the office asks it: not "what happened on Tuesday" but "what is
// Mohit's lot going through."
//
// Three kinds of group, and the order is deliberate:
//
//   a vendor   takes belonging to a company, most recently active first
//   Office     a take by someone with no company of their own
//   The store  stock added, scrapped, counts fixed — nobody took these
//
// A group with nothing in it is not drawn. A company that has men but
// has taken nothing still is: "MOHIT — 3 men, nothing taken yet" is
// information, and an empty space is not.

type RegGroup = {
  key: string;
  title: string;
  /** Null for the Office and The store groups. */
  vendorId: string | null;
  rows: ToolMovement[];
  team: OperatorRow[];
  /** Units taken by this company, ignoring voided lines. */
  taken: number;
  lastAt: number;
};

const STORE_KEY = "__store";
const OFFICE_KEY = "__office";

function Register({
  movements, tools, vendorNames, operators, canManage,
  onlyTool, onClearFilter, onRemoveOperator,
}: {
  movements: ToolMovement[];
  tools: ToolRow[];
  vendorNames: Record<string, string>;
  operators: OperatorRow[];
  canManage: boolean;
  onlyTool: string | null;
  onClearFilter: () => void;
  onRemoveOperator: (operatorId: string) => void;
}) {
  const toolName = useMemo(() => new Map(tools.map((t) => [t.id, t.name])), [tools]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showTeam, setShowTeam] = useState<string | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);

  const rows = onlyTool ? movements.filter((m) => m.tool_id === onlyTool) : movements;

  const groups = useMemo<RegGroup[]>(() => {
    const byKey = new Map<string, RegGroup>();

    const ensure = (key: string, title: string, vendorId: string | null) => {
      let g = byKey.get(key);
      if (!g) {
        g = { key, title, vendorId, rows: [], team: [], taken: 0, lastAt: 0 };
        byKey.set(key, g);
      }
      return g;
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
      if (!m.undone_at && m.kind === "issue") g.taken += Math.abs(Number(m.delta));
      g.lastAt = Math.max(g.lastAt, new Date(m.created_at).getTime());
    }

    const all = [...byKey.values()];
    const rank = (g: RegGroup) => (g.key === STORE_KEY ? 2 : g.key === OFFICE_KEY ? 1 : 0);
    return all.sort(
      (a, b) => rank(a) - rank(b) || b.lastAt - a.lastAt || a.title.localeCompare(b.title),
    );
  }, [rows, operators, vendorNames]);

  if (rows.length === 0 && operators.length === 0) {
    return (
      <>
        {onlyTool && <OnlyToolChip name={toolName.get(onlyTool)} onClear={onClearFilter} />}
        <div className="tc-empty-search">Nothing has moved yet.</div>
      </>
    );
  }

  return (
    <>
      {onlyTool && <OnlyToolChip name={toolName.get(onlyTool)} onClear={onClearFilter} />}

      <div className="tc-reggroups">
        {groups.map((g) => {
          const shut = collapsed[g.key] === true;
          const teamOpen = showTeam === g.key;
          return (
            <section key={g.key} className="tc-reggroup" data-kind={g.vendorId ? "vendor" : g.key}>
              <header className="tc-rg-head">
                <button
                  type="button"
                  className="tc-rg-title"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !shut }))}
                  aria-expanded={!shut}
                >
                  <span className="tc-rg-caret" aria-hidden>{shut ? "▸" : "▾"}</span>
                  <span className="tc-rg-name">{g.title}</span>
                </button>

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

              {!shut && (
                g.rows.length === 0 ? (
                  <div className="tc-rg-nothing">Nothing taken yet.</div>
                ) : (
                  <div className="tc-reg">
                    {g.rows.map((m) => (
                      <RegisterRow key={m.id} m={m} toolName={toolName.get(m.tool_id)} />
                    ))}
                  </div>
                )
              )}
            </section>
          );
        })}
      </div>
    </>
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
            <button type="button" className="tc-dots" onClick={onMenu} aria-label="More">⋯</button>
            {menuOpen && (
              <>
                <div className="tc-menu-scrim" onClick={onCloseMenu} />
                <div className="tc-menu" role="menu">
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
