"use client";

/**
 * ChallansBoard (Daksh, Mig 173 UI) — the Challans page body.
 *
 *  • Search bar (temple / challan no. / slab code) — replaces the old filters.
 *  • Temple-wise sections, DEFAULT COLLAPSED (auto-expand while searching).
 *  • Each challan is a prominent CARD with a status accent.
 *  • Drag a card → a FLOATING drop zone appears pinned to the screen (reachable
 *    no matter how far you've scrolled). Drop → custom confirm → bulk pool.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BUTTON_STYLES } from "../../accounts/_ui/components";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { challanStatus, type ChallanStatus } from "@/lib/challan-status";
import { ChallanStatusPill } from "./challan-status-pill";
import { ReturnToDispatchButton } from "./return-to-dispatch-button";
import { sendChallanToBulkAction, returnDispatchToWaitingAction, dropChallanAction } from "../actions";
import type { GstMode } from "@/lib/challan-pricing";
import { DroppedSection } from "./dropped-section";

export type BoardChallan = {
  id: string;
  code: string;
  date: string;
  notes: string | null;
  cancelled_at: string | null;
  converted_invoice_id: string | null;
  priced_at: string | null;
  owner_approved_at: string | null;
  owner_rejected_at: string | null;
  owner_reject_reason: string | null;
  search: string;
};
export type BoardGroup = { temple: string; rows: BoardChallan[] };

export type DroppedItem = { particulars: string; hsn: string; unit: string; quantity: number; rate: number; amount: number };
export type DroppedChallan = {
  id: string; code: string; temple: string; date: string; customBilled: boolean;
  gstMode: GstMode; igst: number; cgst: number; sgst: number; items: DroppedItem[];
};

const ACCENT: Record<ChallanStatus, string> = {
  open: "#6366f1",
  pending_approval: "#f59e0b",
  invoiced: "#10b981",
  rejected: "#ef4444",
  converted: "#22c55e",
  cancelled: "#94a3b8",
};

function templeHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function ChallansBoard({ groups, total, dropped }: { groups: BoardGroup[]; total: number; dropped: DroppedChallan[] }) {
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [isOverDrop, setIsOverDrop] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ id: string; code: string; target: "bulk" | "drop" } | null>(null);
  const [sending, setSending] = useState(false);

  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const goConvert = (id: string) => startNav(() => router.push(`/invoicing/challans/${id}/review`));

  const formRef = useRef<HTMLFormElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const dropFormRef = useRef<HTMLFormElement>(null);
  const dropIdRef = useRef<HTMLInputElement>(null);

  const dragging = dragId != null;
  const q = query.trim().toLowerCase();
  const searchActive = q.length > 0;

  const filtered = useMemo(() => {
    const out: BoardGroup[] = [];
    for (const g of groups) {
      const rows = searchActive ? g.rows.filter((r) => r.search.includes(q)) : g.rows;
      if (rows.length) out.push({ temple: g.temple, rows });
    }
    return out;
  }, [groups, q, searchActive]);
  const shown = filtered.reduce((n, g) => n + g.rows.length, 0);

  const isExpanded = (t: string) => searchActive || (expanded[t] ?? allExpanded);
  const toggle = (t: string) => setExpanded((p) => ({ ...p, [t]: !(p[t] ?? allExpanded) }));

  function beginDrag(id: string) { setDragId(id); }
  function endDrag() { setDragId(null); setIsOver(false); setIsOverDrop(false); }

  function onDrop(target: "bulk" | "drop") {
    setIsOver(false);
    setIsOverDrop(false);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    for (const g of groups) {
      const hit = g.rows.find((r) => r.id === id);
      if (hit) { setPendingDrop({ id: hit.id, code: hit.code, target }); return; }
    }
  }

  function confirmSend() {
    if (!pendingDrop) return;
    setSending(true);
    if (pendingDrop.target === "drop") {
      if (dropIdRef.current) dropIdRef.current.value = pendingDrop.id;
      dropFormRef.current?.requestSubmit();
    } else {
      if (idRef.current) idRef.current.value = pendingDrop.id;
      formRef.current?.requestSubmit();
    }
  }

  return (
    <>
      <FinanceLoadingOverlay show={navPending || sending} label={sending ? (pendingDrop?.target === "drop" ? "Dropping…" : "Sending to bulk…") : "Opening…"} />
      <style>{`
        .chl-card { transition: transform .12s ease, box-shadow .12s ease; }
        .chl-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15,23,42,0.12); }
        .chl-temple { transition: background .12s ease; }
        .chl-temple:hover { background: var(--bg); }
        @keyframes chlFloat { 0%,100% { box-shadow: 0 0 0 0 rgba(180,83,9,0.5); } 50% { box-shadow: 0 0 0 14px rgba(180,83,9,0); } }
        @keyframes chlLift { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Hidden form that performs the actual "send to bulk" on confirm. */}
      <form ref={formRef} action={sendChallanToBulkAction} style={{ display: "none" }}>
        <input ref={idRef} type="hidden" name="id" />
      </form>
      <form ref={dropFormRef} action={dropChallanAction} style={{ display: "none" }}>
        <input ref={dropIdRef} type="hidden" name="id" />
      </form>

      {/* Top action bar — Approval + Bulk (Bulk is also a drop target). */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Link href="/invoicing/approval" style={BUTTON_STYLES.secondary}>🟡 Approval</Link>
        <Link
          href="/invoicing/bulk"
          onDragOver={(e) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsOver(true); } }}
          onDragLeave={() => setIsOver(false)}
          onDrop={(e) => { e.preventDefault(); onDrop("bulk"); }}
          style={{
            ...BUTTON_STYLES.secondary,
            display: "inline-flex", alignItems: "center", gap: 6,
            borderColor: dragging ? "#f59e0b" : undefined,
            background: dragging ? "rgba(245,158,11,0.12)" : undefined,
          }}
        >
          📦 Bulk challans
        </Link>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 14, maxWidth: 520 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: 0.55, pointerEvents: "none" }}>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search temple, challan no., or slab code…"
          style={{ width: "100%", padding: "11px 38px 11px 38px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface, #fff)", color: "var(--text)", fontSize: 14 }}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 6 }}>✕</button>
        )}
      </div>

      {/* Count + expand/collapse all */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {searchActive ? <>Results <span style={{ color: "var(--text)" }}>· {shown}</span></> : <>Challans <span style={{ color: "var(--text)" }}>· {total}</span></>}
        </div>
        {!searchActive && filtered.length > 0 && (
          <button
            type="button"
            onClick={() => { setAllExpanded((v) => !v); setExpanded({}); }}
            style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: "pointer" }}
          >
            {allExpanded ? "⊖ Collapse all" : "⊕ Expand all"}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          {searchActive ? <>No challans match <strong>“{query}”</strong>.</> : <>No challans yet. <Link href="/invoicing/challans/new" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>Create one</Link>.</>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((g) => {
            const open = isExpanded(g.temple);
            const hue = templeHue(g.temple);
            return (
              <div key={g.temple} style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface, #fff)" }}>
                <button
                  type="button"
                  className="chl-temple"
                  onClick={() => toggle(g.temple)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", border: "none", background: "var(--bg)", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, flexShrink: 0, fontSize: 13, fontWeight: 800, color: "#fff", background: `hsl(${hue} 55% 45%)` }}>
                    {g.temple.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "🛕"}
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 14, color: "var(--text)", flex: 1, minWidth: 0 }}>{g.temple}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 10px" }}>{g.rows.length}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
                </button>
                {open && (
                  <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(262px, 1fr))", gap: 12 }}>
                    {g.rows.map((c) => (
                      <Card key={c.id} c={c} dragging={dragId === c.id} onDragStart={() => beginDrag(c.id)} onDragEnd={endDrag} onConvert={() => goConvert(c.id)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating drop zone — appears while dragging, fixed to the viewport so it's
          reachable from any scroll position (Daksh). */}
      {dragging && (
        <div style={{ position: "fixed", left: "50%", bottom: 30, transform: "translateX(-50%)", zIndex: 80, display: "flex", gap: 14, width: "min(760px, 94vw)", justifyContent: "center", flexWrap: "wrap" }}>
          {/* Send to Bulk */}
          <div
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={() => setIsOver(false)}
            onDrop={(e) => { e.preventDefault(); onDrop("bulk"); }}
            style={{
              flex: "1 1 300px", textAlign: "center", cursor: "copy", padding: "18px 20px", borderRadius: 16,
              transform: `scale(${isOver ? 1.05 : 1})`,
              border: `2.5px dashed ${isOver ? "#b45309" : "#f59e0b"}`,
              background: isOver ? "#b45309" : "rgba(255,251,235,0.97)",
              color: isOver ? "#fff" : "#92400e",
              boxShadow: "0 18px 50px rgba(15,23,42,0.28)",
              animation: isOver ? "none" : "chlFloat 1.1s ease-in-out infinite",
              transition: "transform .12s ease, background .12s ease, color .12s ease", backdropFilter: "blur(2px)",
            }}
          >
            <div style={{ fontSize: 26, lineHeight: 1 }}>📦</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 5 }}>{isOver ? "Release → Bulk" : "Drop here → Bulk challans"}</div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>bill together later on one invoice</div>
          </div>
          {/* Drop → custom whole-piece bill */}
          <div
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsOverDrop(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsOverDrop(true); }}
            onDragLeave={() => setIsOverDrop(false)}
            onDrop={(e) => { e.preventDefault(); onDrop("drop"); }}
            style={{
              flex: "1 1 300px", textAlign: "center", cursor: "copy", padding: "18px 20px", borderRadius: 16,
              transform: `scale(${isOverDrop ? 1.05 : 1})`,
              border: `2.5px dashed ${isOverDrop ? "#6d28d9" : "#8b5cf6"}`,
              background: isOverDrop ? "#6d28d9" : "rgba(245,243,255,0.97)",
              color: isOverDrop ? "#fff" : "#5b21b6",
              boxShadow: "0 18px 50px rgba(15,23,42,0.28)",
              animation: isOverDrop ? "none" : "chlFloat 1.1s ease-in-out infinite",
              transition: "transform .12s ease, background .12s ease, color .12s ease", backdropFilter: "blur(2px)",
            }}
          >
            <div style={{ fontSize: 26, lineHeight: 1 }}>🎯</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 5 }}>{isOverDrop ? "Release → Drop" : "Drop here → Custom bill"}</div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>re-bill as one whole piece &amp; deliver</div>
          </div>
        </div>
      )}

      {/* Custom confirm dialog (NOT window.confirm). */}
      {pendingDrop && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => { if (!sending) setPendingDrop(null); }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 34, marginBottom: 6 }}>{pendingDrop.target === "drop" ? "🎯" : "📦"}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>{pendingDrop.target === "drop" ? "Drop this challan?" : "Send to Bulk challans?"}</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 18px" }}>
              <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{pendingDrop.code}</strong>{" "}
              {pendingDrop.target === "drop"
                ? <>moves to the <strong>Dropped</strong> section below, where you re-bill it as ONE whole-piece bill in the client&apos;s format. Creating that bill delivers the production dispatch (no on-road leg) — the <strong>challan number stays the same</strong>.</>
                : <>will leave this page and wait on the <strong>Bulk challans</strong> page, where it can be billed together with the temple&apos;s other challans on one tax invoice. You can send it back anytime.</>}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" disabled={sending} onClick={() => setPendingDrop(null)} style={{ ...BUTTON_STYLES.ghost, opacity: sending ? 0.5 : 1 }}>Cancel</button>
              <button type="button" disabled={sending} onClick={confirmSend} style={{ fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: pendingDrop.target === "drop" ? "#6d28d9" : "#b45309", cursor: sending ? "default" : "pointer", opacity: sending ? 0.7 : 1 }}>
                {sending ? (pendingDrop.target === "drop" ? "Dropping…" : "Sending…") : (pendingDrop.target === "drop" ? "🎯 Drop the challan" : "📦 Send to bulk")}
              </button>
            </div>
          </div>
        </div>
      )}

      {dropped.length > 0 && <DroppedSection dropped={dropped} />}
    </>
  );
}

function Card({ c, dragging, onDragStart, onDragEnd, onConvert }: { c: BoardChallan; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onConvert: () => void }) {
  const st = challanStatus(c);
  const open = st === "open";
  const accent = ACCENT[st];
  return (
    <div
      className="chl-card"
      draggable={open}
      onDragStart={open ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); onDragStart(); } : undefined}
      onDragEnd={open ? onDragEnd : undefined}
      style={{
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        background: "var(--surface, #fff)",
        padding: "12px 13px 13px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        cursor: open ? "grab" : "default",
        opacity: dragging ? 0.4 : 1,
        animation: "chlLift 0.18s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <Link href={`/invoicing/challans/${c.id}`} style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15, color: "var(--text)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          {c.code}
        </Link>
        <ChallanStatusPill challan={c} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ opacity: 0.7 }}>📅</span>
        {new Date(`${c.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
      </div>

      {st === "rejected" && c.owner_reject_reason && (
        <div style={{ fontSize: 11.5, color: "#991b1b", background: "rgba(220,38,38,0.06)", border: "1px solid #fecaca", borderRadius: 6, padding: "5px 8px" }}>
          Rejected: {c.owner_reject_reason}
        </div>
      )}
      {st !== "rejected" && c.notes && !c.notes.startsWith("Auto from dispatch") && (
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.notes}</div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 4 }}>
        {open ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button type="button" onClick={onConvert} style={{ width: "100%", textAlign: "center", fontSize: 12.5, fontWeight: 800, padding: "9px 12px", borderRadius: 9, color: "#fff", background: "var(--gold)", border: "1px solid var(--gold-dark)", cursor: "pointer" }}>
              🧾 Convert to purchase invoice
            </button>
            <span style={{ fontSize: 10.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 13, cursor: "grab" }}>⠿</span> drag this card onto 📦 Bulk
            </span>
          </div>
        ) : st === "rejected" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            <Link href={`/invoicing/challans/${c.id}/review`} style={{ ...BUTTON_STYLES.secondary, fontSize: 12 }}>✏️ Re-price</Link>
            <ReturnToDispatchButton challanId={c.id} action={returnDispatchToWaitingAction} />
          </div>
        ) : st === "pending_approval" ? (
          <Link href="/invoicing/approval" style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textDecoration: "none" }}>Awaiting approval →</Link>
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
        )}
      </div>
    </div>
  );
}
