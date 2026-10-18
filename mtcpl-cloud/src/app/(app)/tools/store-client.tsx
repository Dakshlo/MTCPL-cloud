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
import { createToolAction, recordMovementAction, undoMovementAction, updateToolAction } from "./actions";
import { MoveSheet, type MoveIntent } from "./move-sheet";
import { AddToolSheet } from "./add-tool-sheet";
import { UndoToast, TOOLS_CSS, ago, type Done } from "./ui-bits";

export function StoreClient({
  tools, movements, canManage,
}: {
  tools: ToolRow[];
  movements: ToolMovement[];
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

      {/* ── how it works ──────────────────────────────────────────
          Two screens, two jobs. Written on the page because the keeper
          and the takers are different people and neither sees the
          other's side. */}
      <div className="tc-how">
        <div className="tc-how-step" data-n="1">
          <strong>You keep it full</strong>
          <span>Add a tool, add stock, fix a count — from this screen.</span>
        </div>
        <div className="tc-how-step" data-n="2">
          <strong>They scan the cupboard</strong>
          <span>The QR on the door, on their own phone. Name, then a code to that phone.</span>
        </div>
        <div className="tc-how-step" data-n="3">
          <strong>The register writes itself</strong>
          <span>Every take is signed by the person who took it. Nobody types it up.</span>
        </div>
      </div>

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
                  onMenu={() => setMenuFor((m) => (m === t.id ? null : t.id))}
                  onCloseMenu={() => setMenuFor(null)}
                  onAddStock={() => { setMenuFor(null); setIntent({ tool: t, kind: "receive" }); }}
                  onFixCount={() => { setMenuFor(null); setIntent({ tool: t, kind: "adjust" }); }}
                  onEdit={() => { setMenuFor(null); setEditing(t); setAddOpen(true); }}
                  onHistory={() => { setMenuFor(null); setOnlyTool(t.id); setTab("register"); }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <Register
          movements={movements}
          tools={tools}
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

function Register({
  movements, tools, onlyTool, onClearFilter,
}: {
  movements: ToolMovement[];
  tools: ToolRow[];
  onlyTool: string | null;
  onClearFilter: () => void;
}) {
  const toolName = useMemo(() => new Map(tools.map((t) => [t.id, t.name])), [tools]);
  const rows = onlyTool ? movements.filter((m) => m.tool_id === onlyTool) : movements;

  return (
    <>
      {onlyTool && (
        <button type="button" className="tc-filter" onClick={onClearFilter}>
          {toolName.get(onlyTool) ?? "This tool"} only · <span>show everything ✕</span>
        </button>
      )}
      {rows.length === 0 ? (
        <div className="tc-empty-search">Nothing has moved yet.</div>
      ) : (
        <div className="tc-reg">
          {rows.map((m) => {
            const voided = !!m.undone_at;
            const positive = Number(m.delta) > 0;
            return (
              <div key={m.id} className="tc-reg-row" data-void={voided ? "1" : undefined}>
                <div className="tc-reg-delta" data-up={positive ? "1" : undefined}>
                  {positive ? "+" : ""}{m.delta}
                </div>
                <div className="tc-reg-main">
                  <div className="tc-reg-title">
                    {toolName.get(m.tool_id) ?? "—"}
                    <span className="tc-reg-kind" data-kind={m.kind}>{KIND_LABEL[m.kind]}</span>
                  </div>
                  <div className="tc-reg-sub">
                    {m.taken_by ? <strong>{m.taken_by}</strong> : <>Store</>}
                    {m.guest_link_id && <span className="tc-reg-qr" title="Taken at the cupboard QR">▦</span>}
                    {" · "}{ago(m.created_at)}
                    {m.note && <> · {m.note}</>}
                    {voided && <> · <strong style={{ color: "var(--danger)" }}>undone</strong></>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Tool card ──────────────────────────────────────────────────────

function ToolCard({
  tool, canManage, menuOpen, onMenu, onCloseMenu, onAddStock, onFixCount, onEdit, onHistory,
}: {
  tool: ToolRow; canManage: boolean; menuOpen: boolean;
  onMenu: () => void; onCloseMenu: () => void;
  onAddStock: () => void; onFixCount: () => void; onEdit: () => void; onHistory: () => void;
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
