"use client";

/**
 * "Wipe older entries" — the ledger's danger zone (Daksh, Aug 2026).
 * Owner-Naresh / developer only (the page mounts it only for scope
 * "both"; the server action re-checks).
 *
 * Three deliberate confirmations before anything happens:
 *   1. open the panel and press Continue — after reading exactly what
 *      will be deleted and what survives;
 *   2. type WIPE (the server independently requires this word, so the
 *      UI can't be bypassed by posting the form early);
 *   3. the final red button, which asks once more via the browser.
 *
 * Round 2 (Daksh): two OPTIONAL checkboxes, both default OFF — "also
 * reset Home to ₹0" / "also reset Office to ₹0". Unticked, that
 * account's balance survives the wipe (as an invisible carry-forward
 * row — the Details list hides it, so the card shows no entries but
 * the same figure). Ticked, no carry is written and the account comes
 * out empty AND at zero. The bullets re-word themselves live as the
 * boxes change so what's about to happen is never ambiguous.
 */

import { useState } from "react";
import { rupee } from "@/lib/challan-pricing";
import { wipeLedgerHistoryAction } from "./actions";

export function WipeLedgerHistory({
  entryCount,
  homeBalance,
  officeBalance,
}: {
  entryCount: number;
  homeBalance: number;
  officeBalance: number;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [word, setWord] = useState("");
  const [zeroHome, setZeroHome] = useState(false);
  const [zeroOffice, setZeroOffice] = useState(false);
  const armed = word.trim().toUpperCase() === "WIPE";

  if (entryCount === 0) return null;

  const red = "#b91c1c";
  const fate = (zero: boolean, balance: number) =>
    zero ? (
      <strong style={{ color: red }}>reset to ₹0</strong>
    ) : (
      <>
        stays <strong style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(balance)}</strong>
      </>
    );

  const checkRow = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12.5,
        fontWeight: 700,
        color: checked ? red : "var(--text)",
        cursor: "pointer",
        padding: "8px 12px",
        border: `1.5px solid ${checked ? "rgba(220,38,38,0.5)" : "var(--border)"}`,
        borderRadius: 10,
        background: checked ? "rgba(220,38,38,0.06)" : "var(--surface)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: red, cursor: "pointer" }}
      />
      {label}
    </label>
  );

  return (
    <div style={{ marginTop: 26, maxWidth: 680 }}>
      {step === 0 ? (
        <button
          type="button"
          onClick={() => setStep(1)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 16px",
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--muted)",
            background: "transparent",
            border: "1px dashed var(--border)",
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          🧹 Wipe older entries…
        </button>
      ) : (
        <div
          style={{
            border: `1.5px solid rgba(220,38,38,0.45)`,
            background: "rgba(220,38,38,0.04)",
            borderRadius: 14,
            padding: "16px 18px",
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 800, color: red, marginBottom: 6 }}>
            🧹 Wipe older entries — read this first
          </div>
          <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12.5, color: "var(--text)", lineHeight: 1.65 }}>
            <li>
              All <strong>{entryCount} entries</strong> in <strong>both</strong> Home and Office are deleted{" "}
              <strong>permanently</strong> — including any waiting for approval. There is no undo.
            </li>
            <li>
              🏠 Home balance {fate(zeroHome, homeBalance)} · 🏢 Office balance {fate(zeroOffice, officeBalance)}.
            </li>
            <li>Afterwards both cards show no entries — a kept balance is carried silently.</li>
          </ul>

          {/* Optional resets — both OFF by default. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {checkRow(`🏠 Also reset HOME to ₹0`, zeroHome, setZeroHome)}
            {checkRow(`🏢 Also reset OFFICE to ₹0`, zeroOffice, setZeroOffice)}
          </div>

          {step === 1 ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 800, color: "#fff", background: red, border: "none", borderRadius: 9, cursor: "pointer" }}
              >
                Continue
              </button>
              <button
                type="button"
                onClick={() => setStep(0)}
                style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <form
              action={wipeLedgerHistoryAction}
              onSubmit={(e) => {
                // Confirmation #3 — the browser asks one final time,
                // spelling out the per-account outcome.
                const homeMsg = zeroHome ? "Home balance RESET TO ₹0" : "Home balance kept";
                const officeMsg = zeroOffice ? "Office balance RESET TO ₹0" : "Office balance kept";
                if (!window.confirm(`Delete all ${entryCount} entries permanently? ${homeMsg}. ${officeMsg}.`)) {
                  e.preventDefault();
                }
              }}
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
              <input type="hidden" name="zero_home" value={zeroHome ? "1" : "0"} />
              <input type="hidden" name="zero_office" value={zeroOffice ? "1" : "0"} />
              <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>
                Type <span style={{ fontFamily: "ui-monospace, monospace", color: red }}>WIPE</span> to confirm:
              </label>
              <input
                name="confirm"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: 110,
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  border: `1.5px solid ${armed ? red : "var(--border)"}`,
                  borderRadius: 9,
                  background: "var(--surface)",
                  color: "var(--text)",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={!armed}
                style={{
                  padding: "9px 16px",
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: "#fff",
                  background: armed ? red : "rgba(185,28,28,0.35)",
                  border: "none",
                  borderRadius: 9,
                  cursor: armed ? "pointer" : "not-allowed",
                }}
              >
                Yes — delete {entryCount} entries permanently
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep(0);
                  setWord("");
                }}
                style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer" }}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
