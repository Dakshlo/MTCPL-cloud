"use client";

/**
 * Running bills section (mig 182 rework, Daksh Jul 2026). Each card is a RUNNING
 * CHALLAN (items created at the prepare step, no rate yet). Options: download the
 * dispatch challan + the running challan, send it back to Challans, edit the
 * running challan, or convert it to an invoice (adds rate + GST on its own page).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { sendRunningBackAction } from "../actions";
import type { DroppedChallan } from "./challans-board";

export function DroppedSection({ dropped, showHeader = true }: { dropped: DroppedChallan[]; showHeader?: boolean; initialEditId?: string }) {
  return (
    <div style={{ marginTop: showHeader ? 24 : 0 }}>
      {showHeader && (
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "#5b21b6", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          🏃 Running challans <span style={pill}>{dropped.length}</span>
        </div>
      )}
      {dropped.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          No running challans. On the <strong>Challans</strong> page, drag a challan onto the <strong>🏃 Running bill</strong> drop zone.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {dropped.map((d) => <RunningCard key={d.id} d={d} />)}
        </div>
      )}
    </div>
  );
}

function RunningCard({ d }: { d: DroppedChallan }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: "4px solid #8b5cf6", borderRadius: 12, background: "var(--surface, #fff)", padding: "12px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>{d.code}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#5b21b6", background: "rgba(139,92,246,0.14)", borderRadius: 999, padding: "2px 9px" }}>🏃 RUNNING CHALLAN</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>🏛 {d.temple}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
        📅 {new Date(`${d.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })} · {d.items.length} item{d.items.length !== 1 ? "s" : ""}
      </div>
      {(d.transport.vehicle || d.transport.driver) && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>🚚 {[d.transport.vehicle, d.transport.driver].filter(Boolean).join(" · ")}</div>
      )}
      <div style={{ marginTop: 2, display: "flex", gap: 7, flexWrap: "wrap" }}>
        {d.sourceDispatchId && <Link href={`/dispatch/${d.sourceDispatchId}/print`} target="_blank" rel="noopener noreferrer" style={btnSmall}>🖨 Dispatch challan</Link>}
        <Link href={`/invoicing/challan/${d.id}/running/print`} target="_blank" rel="noopener noreferrer" style={btnSmall}>🏃 Running challan</Link>
        <Link href={`/invoicing/running/prepare/${d.id}`} style={btnSmall}>✎ Edit</Link>
        <SendBackButton id={d.id} code={d.code} />
        <Link href={`/invoicing/running/${d.id}/invoice`} style={{ ...btnSmall, color: "#fff", background: "#0f172a", border: "1px solid #0f172a" }}>🧾 Convert to invoice</Link>
      </div>
    </div>
  );
}

function SendBackButton({ id, code }: { id: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => setMounted(true), []);
  return (
    <>
      <form ref={formRef} action={sendRunningBackAction} style={{ display: "none" }}><input type="hidden" name="id" value={id} /></form>
      <button type="button" onClick={() => setOpen(true)} style={{ ...btnSmall, color: "#b91c1c", borderColor: "rgba(220,38,38,0.4)" }}>↩ Send back</button>
      {mounted && open && createPortal(
        <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "center", padding: 20 }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(430px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>↩</div>
            <div style={{ fontSize: 16.5, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Send {code} back to Challans?</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 16px" }}>The running challan and its items are removed, and the dispatch returns to <strong>Invoice in process</strong>. The challan goes back to the Challans page.</p>
            <span style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Keep it</button>
              <button type="button" onClick={() => { setOpen(false); formRef.current?.requestSubmit(); }} style={{ fontSize: 13, fontWeight: 800, padding: "9px 17px", borderRadius: 10, border: "none", color: "#fff", background: "#b91c1c", cursor: "pointer" }}>↩ Send back</button>
            </span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const pill: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "#5b21b6", background: "rgba(139,92,246,0.14)", borderRadius: 999, padding: "1px 9px" };
const btnSmall: React.CSSProperties = { fontSize: 12, fontWeight: 700, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", textDecoration: "none", cursor: "pointer" };
