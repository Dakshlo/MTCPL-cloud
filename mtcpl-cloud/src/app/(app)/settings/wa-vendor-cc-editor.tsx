"use client";

// DEVELOPER-only: carbon-copy of vendor WhatsApp messages. Flip the switch to
// have the chosen number receive an identical copy of every message sent to a
// vendor (currently the payment-paid voucher). Persists immediately.

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateVendorCcAction } from "./wa-vendor-cc-actions";

export function WaVendorCcEditor({
  initial,
}: {
  initial: { enabled: boolean; number: string };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [number, setNumber] = useState(initial.number);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function persist(nextEnabled: boolean, nextNumber: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("enabled", String(nextEnabled));
      fd.set("number", nextNumber);
      const res = await updateVendorCcAction(fd);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setEnabled(res.enabled);
      setNumber(res.number);
      setMsg(res.enabled ? "✓ Carbon-copy ON" : "✓ Carbon-copy OFF");
      router.refresh();
    } catch {
      setErr("Failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (busy) return;
    void persist(!enabled, number);
  }
  function saveNumber() {
    const d = number.replace(/\D/g, "");
    if (d.length < 10 || d.length > 12) {
      setErr("Enter a valid 10-digit mobile number.");
      return;
    }
    void persist(enabled, d);
  }

  const track: CSSProperties = {
    width: 46,
    height: 26,
    borderRadius: 999,
    background: enabled ? "#16A34A" : "var(--border)",
    position: "relative",
    transition: "background 0.15s",
    flex: "0 0 auto",
    cursor: busy ? "wait" : "pointer",
  };
  const knob: CSSProperties = {
    position: "absolute",
    top: 3,
    left: enabled ? 23 : 3,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "#fff",
    transition: "left 0.15s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
        When ON, the number below receives an <strong>identical copy</strong> of every
        WhatsApp message sent to a vendor (the payment-paid voucher). Each vendor still
        only gets their own message — they never see this copy or each other.{" "}
        <strong>Developer-only.</strong>
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--bg)",
        }}
      >
        <div role="switch" aria-checked={enabled} onClick={toggle} style={track}>
          <span style={knob} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>
            Carbon-copy {enabled ? "enabled" : "disabled"}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {enabled ? "A copy goes out with every vendor message." : "No copies are sent."}
          </div>
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Copy goes to
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 14, fontWeight: 700 }}>+91</span>
          <input
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveNumber();
              }
            }}
            inputMode="numeric"
            maxLength={12}
            placeholder="10-digit mobile number"
            style={{ flex: "1 1 200px", padding: "9px 12px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", fontFamily: "ui-monospace, monospace" }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={saveNumber}
            className="primary-button"
            style={{ padding: "9px 18px", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Saving…" : "Save number"}
          </button>
        </div>
      </label>

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>{msg}</div>}
      {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>⚠ {err}</div>}
    </div>
  );
}
