"use client";

// DEVELOPER-only: carbon-copy of vendor WhatsApp messages. Flip the switch to
// have the chosen number receive an identical copy of every message sent to a
// vendor (currently the payment-paid voucher). Persists immediately.

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateVendorCcAction } from "./wa-vendor-cc-actions";
import { sendVendorCcTestAction } from "../accounts/actions";

export function WaVendorCcEditor({
  initial,
  recentPaid,
}: {
  initial: { enabled: boolean; number: string };
  recentPaid: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [number, setNumber] = useState(initial.number);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // "Send test" — to the owner's number only, never the vendor.
  const [testId, setTestId] = useState(recentPaid[0]?.id ?? "");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);

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

  async function sendTest() {
    if (testBusy || !testId) return;
    if (!window.confirm("Send a test voucher to YOUR number only? The vendor will NOT be messaged.")) return;
    setTestBusy(true);
    setTestMsg(null);
    setTestErr(null);
    try {
      const fd = new FormData();
      fd.set("paymentId", testId);
      const res = await sendVendorCcTestAction(fd);
      if (!res.ok) {
        setTestErr(res.error);
        return;
      }
      setTestMsg(`✓ Test sent to +91 ${res.to.replace(/^91/, "")} — voucher for ${res.vendor}. The vendor was not messaged.`);
    } catch {
      setTestErr("Failed — check your connection.");
    } finally {
      setTestBusy(false);
    }
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

      {/* Send a test — to the owner's number ONLY, never the vendor. */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 2, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>🧪 Send a test (to your number only)</div>
        <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
          Pick one of the last 5 paid bills and send its <strong>real voucher</strong> to the carbon-copy number above. The <strong>vendor is not messaged</strong> — this only goes to you, so you can check the template, PDF and formatting.
        </p>
        {recentPaid.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No paid bills yet to test with.</div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={testId}
              onChange={(e) => { setTestId(e.target.value); setTestErr(null); setTestMsg(null); }}
              style={{ flex: "1 1 240px", padding: "9px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
            >
              {recentPaid.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={sendTest}
              disabled={testBusy || !testId}
              style={{ padding: "9px 16px", fontSize: 13, fontWeight: 800, color: "#fff", background: testBusy ? "var(--border)" : "#16A34A", border: "none", borderRadius: 8, cursor: testBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {testBusy ? "Sending…" : "Send test to me"}
            </button>
          </div>
        )}
        {testMsg && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 7, padding: "8px 12px" }}>{testMsg}</div>}
        {testErr && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", background: "rgba(185,28,28,0.08)", border: "1px solid rgba(185,28,28,0.3)", borderRadius: 7, padding: "8px 12px" }}>⚠ {testErr}</div>}
      </div>
    </div>
  );
}
