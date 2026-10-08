"use client";

/**
 * The MASTER view of the tool store.
 *
 * Daksh: "there will be a master view for me or owner or whatever role
 * we decide — they will see info." So this screen answers the owner's
 * questions, not the vendor's:
 *
 *   • what is on the shelf, and what is about to run out
 *   • who has been drawing what out of it
 *   • the whole register, in order
 *
 * The vendor's screen is deliberately a different page, not a filtered
 * version of this one — see /tools/v/[vendorId].
 */

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  KIND_LABEL,
  KIND_VERB,
  orderForTaking,
  shortages,
  takenByVendor,
  type ToolMovement,
  type ToolMovementKind,
  type ToolRow,
} from "@/lib/cnc-tool-stock";
import { createToolAction, recordMovementAction, undoMovementAction, updateToolAction } from "./actions";
import { MoveSheet, type MoveIntent } from "./move-sheet";
import { AddToolSheet } from "./add-tool-sheet";
import { UndoToast, TOOLS_CSS, ago, describe, type Done } from "./ui-bits";

type Vendor = { id: string; name: string };

export function StoreClient({
  vendors, tools, movements, people, canManage,
}: {
  vendors: Vendor[];
  tools: ToolRow[];
  movements: ToolMovement[];
  people: string[];
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

  const [optimistic, applyOptimistic] = useOptimistic(
    tools,
    (state: ToolRow[], patch: { toolId: string; delta: number }) =>
      state.map((t) => (t.id === patch.toolId ? { ...t, stock: t.stock + patch.delta } : t)),
  );

  const vendorName = useMemo(
    () => new Map(vendors.map((v) => [v.id, v.name])),
    [vendors],
  );
  const short = useMemo(() => shortages(optimistic), [optimistic]);
  const draws = useMemo(() => takenByVendor(movements), [movements]);
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
    return movements.filter(
      (m) => !m.undone_at && m.kind === "issue" && new Date(m.created_at).getTime() >= start.getTime(),
    ).length;
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
    const kind = String(fd.get("kind")) as ToolMovementKind;
    const qty = Number(fd.get("qty"));
    const signed =
      kind === "receive" || kind === "return" ? qty
        : kind === "issue" || kind === "scrap" ? -qty
          : String(fd.get("direction")) === "down" ? -qty : qty;
    const tool = optimistic.find((t) => t.id === toolId);
    const who = String(fd.get("taken_by") ?? "");
    setIntent(null);
    startTransition(async () => {
      applyOptimistic({ toolId, delta: signed });
      const r = await recordMovementAction(fd);
      if (!r.ok) { setErr(r.error); router.refresh(); return; }
      setDone({
        at: Date.now(),
        text: kind === "issue"
          ? `${who} took ${qty} × ${tool?.name ?? "tool"}`
          : `${KIND_VERB[kind]} ${qty} × ${tool?.name ?? "tool"}`,
      });
      router.refresh();
    });
  }

  return (
    <section className="page-fluid tc-page allow-portrait" style={{ paddingBottom: 110 }}>
      <style>{TOOLS_CSS}</style>

      <header className="tc-head">
        <div style={{ minWidth: 0 }}>
          <div className="tc-eyebrow">🧰 Tool store</div>
          <h1 className="tc-title">The store</h1>
          <div className="tc-sub">
            {optimistic.length} tool{optimistic.length === 1 ? "" : "s"} on the shelf
            {takenToday > 0 && <> · {takenToday} taken today</>}
            {short.length > 0 && (
              <> · <span style={{ color: "var(--danger)", fontWeight: 700 }}>{short.length} short</span></>
            )}
          </div>
        </div>
        {canManage && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 9, flexWrap: "wrap" }}>
            {/* The sticker on the wardrobe door — mig 229. Takes come in
                through it with no login; everything else still needs one. */}
            {/* The way the register actually gets in — mig 231. The team
                would not accept per-person entry at the cupboard, so the
                paper stays and one person types the page in. */}
            <Link
              href="/tools/register"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "11px 16px", fontSize: 13.5, fontWeight: 700,
                borderRadius: 13, textDecoration: "none", whiteSpace: "nowrap",
                border: "1px solid var(--gold)", background: "var(--gold-subtle)",
                color: "var(--gold-dark)",
              }}
            >
              <span aria-hidden>📒</span> Enter register
            </Link>
            <Link
              href="/tools/qr"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "11px 16px", fontSize: 13.5, fontWeight: 700,
                borderRadius: 13, textDecoration: "none", whiteSpace: "nowrap",
                border: "1px solid var(--border)", background: "var(--surface)",
                color: "var(--text)",
              }}
            >
              <span aria-hidden>▦</span> Wardrobe QR
            </Link>
            <button type="button" className="tc-add" onClick={() => { setEditing(null); setAddOpen(true); }}>
              + Add tool
            </button>
          </div>
        )}
      </header>

      {/* Each vendor's own screen, one tap away. The master takes on
          their behalf from here; they take for themselves from there. */}
      {vendors.length > 0 && (
        <div className="tc-vendors">
          <span className="tc-vendors-label">Vendor screens</span>
          {vendors.map((v) => {
            const d = draws.get(v.id);
            return (
              <Link key={v.id} href={`/tools/v/${v.id}`} className="tc-vendor">
                {v.name}
                {d && d.taken > 0 && <i>{d.taken}</i>}
              </Link>
            );
          })}
        </div>
      )}

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
            {short.filter((t) => t.stock <= 0).length > 0
              ? `${short.filter((t) => t.stock <= 0).length} finished, ${short.filter((t) => t.stock > 0).length} running low`
              : `${short.length} tool${short.length === 1 ? "" : "s"} running low`}
          </div>
          <div className="tc-short-list">
            {short.slice(0, 6).map((t) => (
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
            {short.length > 6 && <span className="tc-short-more">+{short.length - 6} more</span>}
          </div>
        </div>
      )}

      <div className="tc-tabs">
        <button type="button" className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>
          On the shelf
        </button>
        <button type="button" className={tab === "register" ? "on" : ""} onClick={() => setTab("register")}>
          Register {movements.length > 0 && <i>{movements.length}</i>}
        </button>
      </div>

      {tab === "stock" ? (
        <>
          {optimistic.length > 0 && (
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
                it. It becomes available to every CNC vendor at once.
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
                  onMove={(kind) => { setMenuFor(null); setIntent({ tool: t, kind }); }}
                  onEdit={() => { setMenuFor(null); setEditing(t); setAddOpen(true); }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <Register movements={movements} tools={tools} vendorName={vendorName} />
      )}

      <MoveSheet
        intent={intent}
        vendors={vendors}
        lockedVendorId={null}
        people={people}
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

// ── The register, whole-store ──────────────────────────────────────

function Register({
  movements, tools, vendorName,
}: {
  movements: ToolMovement[];
  tools: ToolRow[];
  vendorName: Map<string, string>;
}) {
  const toolName = useMemo(() => new Map(tools.map((t) => [t.id, t.name])), [tools]);
  if (movements.length === 0) {
    return <div className="tc-empty-search">Nothing has moved yet.</div>;
  }
  return (
    <div className="tc-reg">
      {movements.map((m) => {
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
                <span className="tc-reg-kind"> · {KIND_LABEL[m.kind]}</span>
              </div>
              <div className="tc-reg-sub">
                {m.vendor_id
                  ? <><strong>{vendorName.get(m.vendor_id) ?? "—"}</strong>{m.taken_by ? <> · {m.taken_by}</> : null}</>
                  : <>Store</>}
                {" · "}{ago(m.created_at)}
                {m.note && <> · {m.note}</>}
                {voided && <> · <strong style={{ color: "var(--danger)" }}>undone</strong></>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tool card ──────────────────────────────────────────────────────

function ToolCard({
  tool, canManage, menuOpen, onMenu, onCloseMenu, onMove, onEdit,
}: {
  tool: ToolRow; canManage: boolean; menuOpen: boolean;
  onMenu: () => void; onCloseMenu: () => void;
  onMove: (k: ToolMovementKind) => void; onEdit: () => void;
}) {
  const level = tool.stock <= 0 ? "out" : tool.stock <= tool.lowLine ? "low" : "ok";
  // Stock against three times the warning line — a scale that means
  // something per tool, rather than a percentage of a maximum no tool
  // actually has.
  const full = Math.max(tool.lowLine * 3, tool.stock, 1);
  const pct = Math.max(tool.stock > 0 ? 4 : 0, Math.min(100, (tool.stock / full) * 100));

  return (
    <article className="tc-card" data-level={level}>
      <div className="tc-card-top">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className="tc-name" title={tool.name}>{tool.name}</h2>
          {tool.spec && <div className="tc-spec">{tool.spec}</div>}
        </div>
        {canManage && (
          <div style={{ position: "relative", flex: "0 0 auto" }}>
            <button type="button" className="tc-dots" onClick={onMenu} aria-label="More">⋯</button>
            {menuOpen && (
              <>
                <div className="tc-menu-scrim" onClick={onCloseMenu} />
                <div className="tc-menu" role="menu">
                  <button type="button" onClick={() => onMove("receive")}>➕ Add stock</button>
                  <button type="button" onClick={() => onMove("issue")}>📤 Give to a vendor</button>
                  <button type="button" onClick={() => onMove("return")}>↩ Returned</button>
                  <button type="button" onClick={() => onMove("scrap")}>🗑 Scrap</button>
                  <button type="button" onClick={() => onMove("adjust")}>⚖ Fix count</button>
                  <div className="tc-menu-sep" />
                  <button type="button" onClick={onEdit}>✎ Edit tool</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="tc-stock">
        <span className="tc-stock-n">{tool.stock}</span>
        <span className="tc-stock-u">{tool.unit}</span>
      </div>

      <div className="tc-bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>

      <div className="tc-last">
        {level === "out" ? <span className="tc-flag">Empty — nothing left</span>
          : level === "low" ? <span className="tc-flag">Low — warns at {tool.lowLine}</span>
            : tool.lastMovement ? <>{describe(tool.lastMovement)} · {ago(tool.lastMovement.created_at)}</>
              : <>Nothing taken yet</>}
      </div>

      <div className="tc-actions">
        <Link href={`/tools/${tool.id}`} className="tc-take-link">Register</Link>
      </div>
    </article>
  );
}
