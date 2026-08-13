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
 * What it does is stated on the panel and mirrored in the action: every
 * entry in BOTH accounts is permanently deleted — pending ones too —
 * and each account gets one fresh "Balance carried forward" line, so
 * the numbers dad sees today don't move by a rupee.
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
  const armed = word.trim().toUpperCase() === "WIPE";

  if (entryCount === 0) return null;

  const red = "#b91c1c";

  return (
    <div style={{ marginTop: 26, maxWidth: 640 }}>
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
              The balances stay exactly as they are now — <strong style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(homeBalance)}</strong> Home,{" "}
              <strong style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(officeBalance)}</strong> Office — each kept by one fresh{" "}
              <em>“Balance carried forward”</em> line.
            </li>
            <li>After the wipe, each card shows just that one line.</li>
          </ul>

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
                // Confirmation #3 — the browser asks one final time.
                if (!window.confirm(`Delete all ${entryCount} entries permanently? The balances will be carried forward.`)) {
                  e.preventDefault();
                }
              }}
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
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
