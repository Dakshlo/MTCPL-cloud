"use client";

/**
 * The only two things the keeper writes.
 *
 *   Add stock   the box that arrived — stock goes up
 *   Fix count   the shelf and the register disagree — make the register
 *               tell the truth, with a reason attached
 *
 * Taking is NOT here, on purpose (Oct 2026). It happens at the cupboard
 * QR, signed by the person taking it. A "give to vendor" button on this
 * screen would mean the keeper guessing on somebody's behalf, which is
 * the paper register with extra steps.
 */

import { useEffect, useState } from "react";

import { type ToolRow } from "@/lib/cnc-tool-stock";
import { Sheet } from "./sheet";

export type MoveKind = "receive" | "adjust";
export type MoveIntent = { tool: ToolRow; kind: MoveKind };

export function MoveSheet({
  intent, busy, onClose, onSubmit,
}: {
  intent: MoveIntent | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  const tool = intent?.tool ?? null;
  const kind = intent?.kind ?? "receive";
  // Held as TEXT, not a number. A bill says 24 and the keeper should be
  // able to type 24 — the old control was a − and a + around a read-only
  // figure, so reaching 24 meant pressing 25 and then minus, or holding
  // plus twenty-three times. Text also lets the box be empty for the
  // moment between clearing it and typing the next digit, which a
  // number state cannot represent without snapping back to 0.
  const [qtyStr, setQtyStr] = useState("1");
  const qty = Math.max(0, Math.floor(Number(qtyStr) || 0));
  const [down, setDown] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!intent) return;
    setQtyStr("1");
    setDown(false);
    setNote("");
  }, [intent]);

  if (!tool) return null;

  const delta = kind === "receive" ? qty : down ? -qty : qty;
  const after = tool.stock + delta;
  const impossible = after < 0;
  // A correction without a reason is just a different wrong number.
  const needsReason = kind === "adjust" && note.trim().length === 0;

  return (
    <Sheet
      open={!!intent}
      onClose={onClose}
      tone={kind === "receive" ? "stock" : "count"}
      title={kind === "receive" ? `Add stock · ${tool.name}` : `Fix count · ${tool.name}`}
      subtitle={
        kind === "receive"
          ? <>On the shelf now: <strong>{tool.stock} {tool.unit}</strong></>
          : <>The register says <strong>{tool.stock} {tool.unit}</strong> — what does the shelf say?</>
      }
      footer={
        <button
          type="button"
          className="tc-sheet-go"
          disabled={busy || qty <= 0 || impossible || needsReason}
          onClick={() => {
            const fd = new FormData();
            fd.set("tool_id", tool.id);
            fd.set("kind", kind);
            fd.set("qty", String(qty));
            if (kind === "adjust") {
              fd.set("direction", down ? "down" : "up");
              // Mig 235 — the number this man was looking at when he
              // counted. The server turns it into an absolute target,
              // so a take that lands while he is counting cannot make
              // his correction come out wrong.
              fd.set("seen_stock", String(tool.stock));
            }
            if (note.trim()) fd.set("note", note.trim());
            onSubmit(fd);
          }}
        >
          {busy ? "Saving…"
            : impossible ? "That would go below zero"
              : needsReason ? "Say why first"
                : kind === "receive" ? `Add ${qty} · ${after} ${tool.unit} after`
                  : `Make it ${after} ${tool.unit}`}
        </button>
      }
    >
      {/* Daksh, Nov 2026: "so the user will not confuse what mode they
          are in." The two sheets differed only in their title, and a
          title is what you skip. This is the same sentence the menu
          offered, repeated where the consequence is. */}
      <div className="tc-mode" data-mode={kind}>
        <span className="tc-mode-ic" aria-hidden>{kind === "receive" ? "＋" : "⚖"}</span>
        <span>
          <b>{kind === "receive" ? "Adding stock" : "Fixing the count"}</b>
          <em>
            {kind === "receive"
              ? "A box has arrived — the shelf goes up."
              : "The shelf and the register disagree. This does not take anything; it makes the register tell the truth."}
          </em>
        </span>
      </div>

      {kind === "adjust" && (
        <div className="tc-seg" role="group" aria-label="Direction">
          <button type="button" className={!down ? "on" : ""} onClick={() => setDown(false)}>
            More than the register says
          </button>
          <button type="button" className={down ? "on" : ""} onClick={() => setDown(true)}>
            Less
          </button>
        </div>
      )}

      <div className="tc-steps">
        <button
          type="button"
          onClick={() => setQtyStr(String(Math.max(1, qty - 1)))}
          disabled={qty <= 1}
          aria-label="One less"
        >
          −
        </button>
        <label className="tc-steps-n">
          <input
            // A phone keypad, not a full keyboard, and not type="number"
            // — that brings spinner arrows on a desktop and silently
            // accepts "1e5".
            inputMode="numeric"
            pattern="[0-9]*"
            value={qtyStr}
            maxLength={6}
            onChange={(e) => setQtyStr(e.target.value.replace(/[^\d]/g, ""))}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={`How many ${tool.unit}`}
          />
          <i>{tool.unit}</i>
        </label>
        <button type="button" onClick={() => setQtyStr(String(qty + 1))} aria-label="One more">+</button>
      </div>

      <div className="tc-quick">
        {[5, 10, 25, 50].map((n) => (
          <button key={n} type="button" onClick={() => setQtyStr(String(n))} className={qty === n ? "on" : ""}>
            {n}
          </button>
        ))}
      </div>

      <label className="tc-field">
        <span>{kind === "adjust" ? "Why the count is different" : "Note (optional)"}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          placeholder={kind === "adjust" ? "Counted the shelf — two were broken" : "Bill no., who brought it…"}
        />
      </label>

      <p className="tc-sheet-fine">
        {kind === "receive"
          ? "Goes straight onto the shelf and onto the cupboard QR. Ten minutes to undo."
          : "The old line stays in the register. A correction is a new line, never a rub-out."}
      </p>
    </Sheet>
  );
}
