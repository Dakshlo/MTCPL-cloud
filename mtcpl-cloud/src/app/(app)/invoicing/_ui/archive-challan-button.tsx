"use client";

/** Archive (retire) a challan without invoicing it — mig 181. For test/cleanup
 *  challans whose slabs already left the plant: removes the challan from
 *  Invoicing + its dispatch from the board, no invoice, no slabs returned.
 *  Confirm modal portalled to <body> so an ancestor transform can't move it. */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { archiveChallanAction } from "../actions";

export function ArchiveChallanButton({ id, code }: { id: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => setMounted(true), []);
  return (
    <>
      <form ref={formRef} action={archiveChallanAction} style={{ display: "none" }}>
        <input type="hidden" name="id" value={id} />
      </form>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Remove this challan without making an invoice (test/cleanup)"
        style={{ fontSize: 12, fontWeight: 700, padding: "9px 11px", borderRadius: 9, color: "#b91c1c", background: "var(--surface, #fff)", border: "1px solid rgba(220,38,38,0.4)", cursor: "pointer" }}
      >
        🗑 Archive
      </button>
      {mounted && open && createPortal(
        <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "center", padding: 20 }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(460px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>🗑</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Archive {code} without an invoice?</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, margin: "0 0 16px" }}>
              Use this only for test / no-longer-needed challans whose <strong>slabs already left the plant</strong>. It:
              <br />• removes the challan from Invoicing and its truck from the Dispatch board,
              <br />• does <strong>NOT</strong> make an invoice (no INV number used),
              <br />• does <strong>NOT</strong> return the slabs to Make Dispatch.
            </p>
            <span style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 13, fontWeight: 700, padding: "9px 15px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Keep it</button>
              <button type="button" onClick={() => { setOpen(false); formRef.current?.requestSubmit(); }} style={{ fontSize: 13, fontWeight: 800, padding: "9px 17px", borderRadius: 10, border: "none", color: "#fff", background: "#b91c1c", cursor: "pointer" }}>🗑 Archive challan</button>
            </span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
