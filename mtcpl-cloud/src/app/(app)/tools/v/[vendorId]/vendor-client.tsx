"use client";

/**
 * The vendor's screen.
 *
 * One job: take a tool, and see what you took. The store's stock sits
 * behind one more tap at the bottom — Daksh was explicit that studying
 * stock is not a vendor's work ("their main point is not to see what is
 * in stock, they will just take from the store").
 *
 * Taken means USED. There is no holdings balance here, because the
 * tools generally do not come back; `Return` exists on the master view
 * for the occasional one that does.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { orderForTaking, type ToolMovement, type ToolRow } from "@/lib/cnc-tool-stock";
import { recordMovementAction, undoMovementAction } from "../../actions";
import { MoveSheet, type MoveIntent } from "../../move-sheet";
import { PickToolSheet } from "./pick-tool-sheet";
import { UndoToast, TOOLS_CSS, ago, type Done } from "../../ui-bits";

export function VendorClient({
  vendor, tools, takings, people, isMaster,
}: {
  vendor: { id: string; name: string };
  tools: ToolRow[];
  takings: ToolMovement[];
  people: string[];
  isMaster: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [intent, setIntent] = useState<MoveIntent | null>(null);
  const [showStock, setShowStock] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const byId = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);
  const available = useMemo(() => orderForTaking(tools.filter((t) => t.stock > 0)), [tools]);
  const takenToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return takings.filter(
      (m) => !m.undone_at && m.kind === "issue" && new Date(m.created_at).getTime() >= start.getTime(),
    ).length;
  }, [takings]);

  function submitMove(fd: FormData) {
    const toolId = String(fd.get("tool_id"));
    const qty = Number(fd.get("qty"));
    const who = String(fd.get("taken_by") ?? "");
    const tool = byId.get(toolId);
    setIntent(null);
    setErr(null);
    startTransition(async () => {
      const r = await recordMovementAction(fd);
      if (!r.ok) { setErr(r.error); return; }
      setDone({ at: Date.now(), text: `${who} took ${qty} × ${tool?.name ?? "tool"}` });
      router.refresh();
    });
  }

  return (
    <section className="page-fluid tc-page allow-portrait" style={{ paddingBottom: 110 }}>
      <style>{TOOLS_CSS}</style>

      <header className="tc-head" style={{ marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div className="tc-eyebrow">🧰 Tool store</div>
          <h1 className="tc-title">{vendor.name}</h1>
          <div className="tc-sub">
            {takenToday > 0
              ? <>{takenToday} taken today</>
              : <>Nothing taken yet today</>}
          </div>
        </div>
        {isMaster && (
          <Link
            href="/tools"
            style={{
              marginLeft: "auto", padding: "10px 16px", fontSize: 13, fontWeight: 700,
              borderRadius: 11, textDecoration: "none", whiteSpace: "nowrap",
              border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
            }}
          >
            ← Store
          </Link>
        )}
      </header>

      {err && (
        <div className="tc-err" role="alert">
          <span>⚠ {err}</span>
          <button type="button" onClick={() => setErr(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* The whole point of the screen. */}
      <button type="button" className="tcv-take" onClick={() => setPicking(true)}>
        <span aria-hidden style={{ fontSize: 24 }}>＋</span> Take a tool
      </button>

      <p className="tcv-sec">Recently taken</p>
      {takings.length === 0 ? (
        <div className="tc-empty-search" style={{ border: "1px dashed var(--border)", borderRadius: 14 }}>
          Nothing taken yet. Press <strong>Take a tool</strong> and it will show up here.
        </div>
      ) : (
        <div className="tcv-list">
          {takings.map((m) => {
            const t = byId.get(m.tool_id);
            return (
              <div key={m.id} className="tcv-row" data-kind={m.kind} data-void={m.undone_at ? "1" : undefined}>
                <div className="tcv-qty">{m.kind === "return" ? "+" : ""}{Math.abs(Number(m.delta))}</div>
                <div className="tcv-main">
                  <div className="tcv-name">{t?.name ?? "—"}{t?.spec ? <span style={{ fontWeight: 600, color: "var(--muted)" }}> · {t.spec}</span> : null}</div>
                  <div className="tcv-meta">
                    {m.kind === "return" ? "Returned by " : ""}{m.taken_by ?? "—"} · {ago(m.created_at)}
                    {m.note && <> · {m.note}</>}
                    {m.undone_at && <> · <strong style={{ color: "var(--danger)" }}>undone</strong></>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stock, at the end, as asked. Collapsed by default so the screen
          stays about taking rather than about counting. */}
      {!showStock ? (
        <button type="button" className="tcv-stock-link" onClick={() => setShowStock(true)}>
          📦 See what the store has
        </button>
      ) : (
        <div style={{ marginTop: 20 }}>
          <p className="tcv-sec" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            What the store has
            <button
              type="button" onClick={() => setShowStock(false)}
              style={{ marginLeft: "auto", border: "none", background: "none", color: "var(--gold-dark)",
                       fontSize: 11, fontWeight: 800, letterSpacing: ".06em", cursor: "pointer" }}
            >
              HIDE
            </button>
          </p>
          {tools.length === 0 ? (
            <div className="tc-empty-search">The store is empty.</div>
          ) : (
            <div className="tcv-list">
              {orderForTaking(tools).map((t) => (
                <div key={t.id} className="tcv-row">
                  <div
                    className="tcv-qty"
                    style={
                      t.level === "out"
                        ? { background: "var(--danger-bg)", color: "var(--danger)" }
                        : t.level === "low"
                          ? { background: "var(--warning-bg)", color: "var(--warning)" }
                          : { background: "var(--success-bg)", color: "var(--success)" }
                    }
                  >
                    {t.stock}
                  </div>
                  <div className="tcv-main">
                    <div className="tcv-name">{t.name}</div>
                    <div className="tcv-meta">
                      {t.spec ? <>{t.spec} · </> : null}
                      {t.level === "out" ? "finished" : t.level === "low" ? "running low" : `${t.unit} on the shelf`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <PickToolSheet
        open={picking}
        tools={available}
        onClose={() => setPicking(false)}
        onPick={(tool) => { setPicking(false); setIntent({ tool, kind: "issue" }); }}
      />

      <MoveSheet
        intent={intent}
        vendors={[vendor]}
        lockedVendorId={vendor.id}
        people={people}
        busy={pending}
        onClose={() => setIntent(null)}
        onSubmit={submitMove}
      />

      {done && (
        <UndoToast
          done={done} movements={takings}
          onDismiss={() => setDone(null)}
          onUndo={(id) => {
            const fd = new FormData();
            fd.set("movement_id", id);
            setDone(null);
            setErr(null);
            startTransition(async () => {
              const r = await undoMovementAction(fd);
              if (!r.ok) setErr(r.error);
              router.refresh();
            });
          }}
        />
      )}
    </section>
  );
}
