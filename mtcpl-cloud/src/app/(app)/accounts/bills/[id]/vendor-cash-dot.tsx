"use client";

/**
 * Where this vendor stands, without leaving the bill.
 *
 * Daksh, Nov 2026: "in a particular bill view give that dot which
 * activates with hover so we can easily see net cash of that bill
 * vendor from any bill. So easy — no need to go to vendor account
 * again and again."
 *
 * The question it answers is the one you have while looking at a
 * single bill: "fine, but what do we owe these people in total?" The
 * answer already existed on the vendor profile, two clicks and a lost
 * place away.
 *
 * ── What it shows, and why those numbers ──────────────────────────
 *
 * Exactly the figures the vendor profile puts at the top, computed
 * the same way, so the two can never disagree:
 *
 *   Outstanding   approved bills, what is still unpaid
 *   Paid          every bill, what has gone out
 *   Advance       credit sitting with them, unapplied
 *   Net to pay    outstanding − advance, the number you act on
 *
 * Nothing here is new information: anyone who sees this card can
 * already click through to the vendor and read all of it. This only
 * removes the walk.
 *
 * Hover for a mouse, tap for a thumb, and focusable so the keyboard
 * reaches it too — a hover-only control is invisible on a phone.
 */

import { useEffect, useRef, useState } from "react";

export type VendorCash = {
  outstanding: number;
  paid: number;
  advance: number;
  billCount: number;
  openCount: number;
};

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;

export function VendorCashDot({ name, cash }: { name: string; cash: VendorCash }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // A tap opens it; a tap anywhere else puts it away. Without this the
  // card sticks open on a phone, where there is no "mouse leave".
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const net = cash.outstanding - cash.advance;
  const tone = cash.outstanding > 0 ? "#d97706" : "#16a34a";

  return (
    <span
      ref={wrapRef}
      className="vcd"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <style>{CSS}</style>
      <button
        type="button"
        className="vcd-dot"
        style={{ ["--vcd" as string]: tone }}
        aria-label={`${name} — money position`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <span aria-hidden>●</span>
      </button>

      {open && (
        <span className="vcd-card" role="status">
          <span className="vcd-name">{name}</span>

          <span className="vcd-row">
            <em>Outstanding</em>
            <b style={{ color: cash.outstanding > 0 ? "#b45309" : "var(--muted)" }}>
              {cash.outstanding > 0 ? inr(cash.outstanding) : "—"}
            </b>
          </span>
          <span className="vcd-row">
            <em>Paid</em>
            <b>{cash.paid > 0 ? inr(cash.paid) : "—"}</b>
          </span>
          {cash.advance > 0 && (
            <span className="vcd-row">
              <em>Advance with them</em>
              <b style={{ color: "#0369a1" }}>−{inr(cash.advance)}</b>
            </span>
          )}

          <span className="vcd-rule" />

          <span className="vcd-row vcd-net">
            <em>{net >= 0 ? "Net to pay" : "They owe us"}</em>
            <b>{inr(Math.abs(net))}</b>
          </span>

          <span className="vcd-foot">
            {cash.billCount} bill{cash.billCount === 1 ? "" : "s"}
            {cash.openCount > 0 && ` · ${cash.openCount} still open`}
          </span>
        </span>
      )}
    </span>
  );
}

const CSS = `
.vcd { position:relative; display:inline-flex; align-items:center; }
.vcd-dot {
  width:18px; height:18px; display:grid; place-items:center; cursor:pointer;
  border:none; background:none; padding:0; font:inherit; line-height:1;
  color:var(--vcd); font-size:11px;
}
.vcd-dot:hover, .vcd-dot:focus-visible { outline:none; transform:scale(1.25); }
.vcd-dot::after {
  content:""; position:absolute; inset:-6px; border-radius:50%;
}
.vcd-card {
  position:absolute; top:calc(100% + 8px); right:0; z-index:50; width:244px;
  display:flex; flex-direction:column; gap:7px; cursor:default;
  padding:13px 14px; border-radius:12px; text-align:left;
  background:var(--surface, #fff); border:1px solid var(--border, #e5e3de);
  box-shadow:0 14px 34px rgba(15,23,42,.17);
  /* The dot sits inside the card's "VENDOR" heading, which is
     uppercase and letter-spaced. Everything in here would inherit
     that and come out shouting. */
  text-transform:none; letter-spacing:normal; font-weight:400;
  color:var(--text); font-size:13px;
}
.vcd-name {
  font-size:10px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.vcd-row { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
.vcd-row em { font-style:normal; font-size:12px; color:var(--muted); }
.vcd-row b { font-size:13.5px; font-weight:800; font-variant-numeric:tabular-nums;
  color:var(--text); white-space:nowrap; }
.vcd-rule { height:1px; background:var(--border, #e5e3de); margin:1px 0; }
.vcd-net em { font-weight:700; color:var(--text); font-size:12.5px; }
.vcd-net b { font-size:16px; }
.vcd-foot { font-size:11px; color:var(--muted); }

@media (max-width: 560px) {
  /* On a phone the rail is full width, so the card would hang off the
     right edge if it kept hugging the dot. */
  .vcd-card { right:auto; left:0; width:min(244px, 78vw); }
}
`;
