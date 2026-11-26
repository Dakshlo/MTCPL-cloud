"use client";

/**
 * "Order stock" — the WhatsApp that asks someone to send more.
 *
 * Daksh, Nov 2026: "for this needs ordering we need a thing we can send
 * WhatsApp message to some mobile number for stock buy… owner can
 * directly add mobile number or select user who to send message, and
 * how much. On tool store page itself."
 *
 * Hence one sheet rather than a Settings card: the man who notices the
 * shelf is low is the man who sets the number, and he notices it here.
 *
 * It holds two separate things on purpose, in this order:
 *
 *   WHO   the saved recipients, and the two switches. Edited rarely.
 *   WHAT  the low tools, ticked, with a quantity each. Used every time.
 *
 * The quantity box is never pre-filled. The message is going to a
 * supplier, and a number this screen invented would read exactly like a
 * number a human decided. Left empty, the message asks him to confirm
 * the quantity, which is the truth.
 */

import { useEffect, useState } from "react";

import type { ToolRow } from "@/lib/cnc-tool-stock";
import type { ToolStockOrderSetting } from "@/lib/wa-tool-stock";

import { Sheet } from "./sheet";

export type PickableUser = { id: string; name: string; phone: string };

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * The last ten digits — the number as a person says it.
 *
 * Profiles store phones with the 91 on the front and the keypad here
 * takes them without, so the same man can arrive in two shapes. Used
 * for BOTH the chip's label and the "is he already on the list" test:
 * without it, picking Alkesh from the dropdown after someone had typed
 * his number would add him twice and send him two of every message.
 */
const last10 = (s: string) => digits(s).slice(-10);

export function OrderStockSheet({
  open,
  onClose,
  tools,
  users,
  setting,
  canManage,
  templateReady,
  busy,
  onSaveSetting,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  /** The pile that needs ordering, low first. */
  tools: ToolRow[];
  users: PickableUser[];
  setting: ToolStockOrderSetting;
  canManage: boolean;
  /** False until MSG91_WA_TOOL_STOCK_TEMPLATE is set on the server, in
   *  which case the sheet says so instead of letting a send fail. */
  templateReady: boolean;
  busy: boolean;
  onSaveSetting: (next: ToolStockOrderSetting) => void;
  onSend: (items: Array<{ toolId: string; qty: number | null }>) => void;
}) {
  const [draft, setDraft] = useState<ToolStockOrderSetting>(setting);
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  // Every opening starts from what the server believes and with the
  // whole low pile ticked — the common case is "yes, all of these".
  useEffect(() => {
    if (!open) return;
    setDraft(setting);
    setNewName("");
    setNewNumber("");
    setErr(null);
    setTicked(Object.fromEntries(tools.map((t) => [t.id, true])));
    setQty({});
  }, [open, setting, tools]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(setting);
  const chosen = tools.filter((t) => ticked[t.id]);
  const canSend = templateReady && draft.enabled && draft.recipients.length > 0 && !dirty;

  function addRecipient(name: string, number: string, profileId: string | null) {
    const n = digits(number);
    if (n.length < 10 || n.length > 12) {
      setErr("That needs to be a 10-digit mobile number.");
      return;
    }
    if (draft.recipients.some((r) => last10(r.number) === last10(n))) {
      setErr("That number is already on the list.");
      return;
    }
    setErr(null);
    setDraft({
      ...draft,
      recipients: [...draft.recipients, { name: name.trim() || n, number: n, profileId }],
    });
    setNewName("");
    setNewNumber("");
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Order stock"
      subtitle="A WhatsApp to whoever buys for the store"
      wide
      footer={
        <button
          type="button"
          disabled={busy || chosen.length === 0 || !canSend}
          onClick={() => {
            onSend(
              chosen.map((t) => {
                const raw = (qty[t.id] ?? "").trim();
                const n = Number(raw);
                return { toolId: t.id, qty: raw !== "" && Number.isFinite(n) && n > 0 ? n : null };
              }),
            );
          }}
          style={{
            width: "100%", padding: "15px 18px", fontSize: 16, fontWeight: 800,
            borderRadius: 13, border: "none", color: "#fff",
            cursor: busy || chosen.length === 0 || !canSend ? "not-allowed" : "pointer",
            background: !busy && chosen.length > 0 && canSend ? "#16a34a" : "var(--border)",
            boxShadow: !busy && chosen.length > 0 && canSend ? "0 8px 20px rgba(22,163,74,.28)" : "none",
          }}
        >
          {busy
            ? "Sending…"
            : !templateReady
              ? "Waiting on the WhatsApp template"
              : !draft.enabled
                ? "Switch stock messages on first"
                : draft.recipients.length === 0
                  ? "Add a number first"
                  : dirty
                    ? "Save the changes above first"
                    : chosen.length === 0
                      ? "Tick what you need"
                      : `Send ${chosen.length} message${chosen.length === 1 ? "" : "s"}`}
        </button>
      }
    >
      {!templateReady && (
        <div className="tc-os-note tc-os-note-warn">
          <strong>Not switched on at the bank end yet.</strong> The WhatsApp template{" "}
          <code>tool_stock_order</code> has to be approved on MSG91 and set as{" "}
          <code>MSG91_WA_TOOL_STOCK_TEMPLATE</code> before anything can go out. Everything below
          saves in the meantime.
        </div>
      )}

      {/* ── WHO ─────────────────────────────────────────────────── */}
      <div className="tc-os-h">Who gets it</div>

      {draft.recipients.length === 0 ? (
        <p className="tc-os-none">Nobody yet — add a number or pick someone below.</p>
      ) : (
        <div className="tc-os-chips">
          {draft.recipients.map((r) => (
            <span key={r.number} className="tc-os-chip">
              <b>{r.name}</b>
              <i>{last10(r.number)}</i>
              {canManage && (
                <button
                  type="button"
                  aria-label={`Remove ${r.name}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      recipients: draft.recipients.filter((x) => x.number !== r.number),
                    })
                  }
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <div className="tc-os-add">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name or firm"
              aria-label="Name or firm"
            />
            <input
              value={newNumber}
              onChange={(e) => setNewNumber(digits(e.target.value).slice(0, 12))}
              placeholder="10-digit mobile"
              inputMode="numeric"
              aria-label="Mobile number"
            />
            <button
              type="button"
              className="tc-btn"
              disabled={digits(newNumber).length < 10}
              onClick={() => addRecipient(newName, newNumber, null)}
            >
              Add
            </button>
          </div>

          <label className="tc-os-pick">
            <span>…or pick someone who already uses the app</span>
            <select
              value=""
              onChange={(e) => {
                const u = users.find((x) => x.id === e.target.value);
                if (u) addRecipient(u.name, u.phone, u.id);
              }}
            >
              <option value="">Choose a person…</option>
              {users
                .filter((u) => !draft.recipients.some((r) => last10(r.number) === last10(u.phone)))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="tc-os-switch">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            <span>
              <b>Stock messages are on</b>
              <i>Off means nothing goes out, by hand or by itself.</i>
            </span>
          </label>

          <label className="tc-os-switch">
            <input
              type="checkbox"
              checked={draft.autoOnLowStock}
              disabled={!draft.enabled}
              onChange={(e) => setDraft({ ...draft, autoOnLowStock: e.target.checked })}
            />
            <span>
              <b>Send on its own when something hits its warn line</b>
              <i>
                Once per fall, not once per take — and again only if it drops further. Climbing back
                above the line re-arms it.
              </i>
            </span>
          </label>

          {err && <p className="tc-os-err">{err}</p>}

          {dirty && (
            <button
              type="button"
              className="tc-btn tc-btn-solid tc-os-save"
              disabled={busy}
              onClick={() => onSaveSetting(draft)}
            >
              {busy ? "Saving…" : "Save who gets it"}
            </button>
          )}
        </>
      )}

      {/* ── WHAT ────────────────────────────────────────────────── */}
      <div className="tc-os-h tc-os-h2">
        What to ask for
        <em>{chosen.length} of {tools.length} ticked</em>
      </div>

      {tools.length === 0 ? (
        <p className="tc-os-none">Nothing is below its warn line. Good.</p>
      ) : (
        <div className="tc-os-list">
          {tools.map((t) => (
            <label key={t.id} className="tc-os-row" data-on={ticked[t.id] ? "1" : "0"}>
              <input
                type="checkbox"
                checked={!!ticked[t.id]}
                onChange={(e) => setTicked({ ...ticked, [t.id]: e.target.checked })}
              />
              <span className="tc-os-tool">
                <b>{t.name}</b>
                <i>
                  {t.stock} {t.unit} left · warns at {t.lowLine}
                </i>
              </span>
              <input
                className="tc-os-qty"
                value={qty[t.id] ?? ""}
                onChange={(e) => setQty({ ...qty, [t.id]: digits(e.target.value).slice(0, 5) })}
                placeholder="qty"
                inputMode="numeric"
                aria-label={`How many ${t.name}`}
                disabled={!ticked[t.id]}
              />
            </label>
          ))}
        </div>
      )}

      <p className="tc-os-fine">
        One message per tool, to everyone on the list. Leave a quantity empty and the message asks
        them to confirm it.
      </p>
    </Sheet>
  );
}
