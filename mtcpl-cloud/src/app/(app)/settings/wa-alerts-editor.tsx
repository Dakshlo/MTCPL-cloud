"use client";

// DEVELOPER-only: on/off + recipient number for the two WhatsApp
// operational alerts. Each card persists immediately (toggle saves on
// click, number saves on the Save button / Enter).

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  updateSlabTransferAlertAction,
  updateCarvingBacklogAction,
} from "./wa-alerts-actions";

function Switch({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  const track: CSSProperties = {
    width: 46,
    height: 26,
    borderRadius: 999,
    background: on ? "#16A34A" : "var(--border)",
    position: "relative",
    transition: "background 0.15s",
    flex: "0 0 auto",
    cursor: busy ? "wait" : "pointer",
  };
  const knob: CSSProperties = {
    position: "absolute",
    top: 3,
    left: on ? 23 : 3,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "#fff",
    transition: "left 0.15s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  };
  return (
    <div role="switch" aria-checked={on} onClick={onClick} style={track}>
      <span style={knob} />
    </div>
  );
}

const numberInputStyle: CSSProperties = {
  flex: "1 1 200px",
  padding: "9px 12px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "ui-monospace, monospace",
};

const smallNumStyle: CSSProperties = {
  width: 90,
  padding: "9px 12px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "ui-monospace, monospace",
};

const fieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

// ── Card 1: slab-transfer "waiting" ping ────────────────────────────
function SlabTransferCard({ initial }: { initial: { enabled: boolean; number: string } }) {
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
      const res = await updateSlabTransferAlertAction(fd);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setEnabled(res.enabled);
      setNumber(res.number);
      setMsg(res.enabled ? "✓ Slab-transfer ping ON" : "✓ Slab-transfer ping OFF");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 800 }}>🚚 Slab waiting for transfer</div>
      <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
        When ON, the number below gets a WhatsApp the moment a slab lands in
        Pending stock (awaiting transfer to its carving vendor) — with the slab
        code, size and from → to.
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
        <Switch on={enabled} busy={busy} onClick={toggle} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Ping {enabled ? "enabled" : "disabled"}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {enabled ? "Fires when a slab waits for transfer." : "No transfer pings are sent."}
          </div>
        </div>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={fieldLabel}>Send ping to</span>
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
            style={numberInputStyle}
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

// ── Card 2: carving-approval backlog alert ──────────────────────────
function BacklogCard({
  initial,
}: {
  initial: { enabled: boolean; number: string; threshold: number; step: number };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [number, setNumber] = useState(initial.number);
  const [threshold, setThreshold] = useState(String(initial.threshold));
  const [step, setStep] = useState(String(initial.step));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function persist(next: { enabled: boolean; number: string; threshold: string; step: string }) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("enabled", String(next.enabled));
      fd.set("number", next.number);
      fd.set("threshold", next.threshold);
      fd.set("step", next.step);
      const res = await updateCarvingBacklogAction(fd);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setEnabled(res.enabled);
      setNumber(res.number);
      setThreshold(String(res.threshold));
      setStep(String(res.step));
      setMsg(res.enabled ? "✓ Backlog alert ON" : "✓ Backlog alert OFF");
      router.refresh();
    } catch {
      setErr("Failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (busy) return;
    void persist({ enabled: !enabled, number, threshold, step });
  }
  function save() {
    const d = number.replace(/\D/g, "");
    if (enabled && (d.length < 10 || d.length > 12)) {
      setErr("Enter a valid 10-digit mobile number.");
      return;
    }
    const th = Math.max(1, Math.floor(Number(threshold) || 15));
    const st = Math.max(1, Math.floor(Number(step) || 5));
    void persist({ enabled, number: d, threshold: String(th), step: String(st) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 800 }}>⚠️ Carving approval backlog</div>
      <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
        When ON, the number below gets a WhatsApp once the “Carving Done
        Approval” queue reaches <strong>{threshold || 15}</strong> slabs, and
        again every <strong>{step || 5}</strong> after that ({threshold || 15},{" "}
        {Number(threshold || 15) + Number(step || 5)},{" "}
        {Number(threshold || 15) + 2 * Number(step || 5)} …). Each message shows
        the live total. It re-arms when the queue clears.
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
        <Switch on={enabled} busy={busy} onClick={toggle} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Alert {enabled ? "enabled" : "disabled"}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {enabled ? "Fires when the approval backlog builds up." : "No backlog alerts are sent."}
          </div>
        </div>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={fieldLabel}>Send alert to</span>
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
                save();
              }
            }}
            inputMode="numeric"
            maxLength={12}
            placeholder="10-digit mobile number"
            style={numberInputStyle}
          />
        </div>
      </label>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={fieldLabel}>Alert at (slabs)</span>
          <input
            value={threshold}
            onChange={(e) => {
              setThreshold(e.target.value.replace(/\D/g, ""));
              setErr(null);
            }}
            inputMode="numeric"
            maxLength={4}
            placeholder="15"
            style={smallNumStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={fieldLabel}>Then every</span>
          <input
            value={step}
            onChange={(e) => {
              setStep(e.target.value.replace(/\D/g, ""));
              setErr(null);
            }}
            inputMode="numeric"
            maxLength={4}
            placeholder="5"
            style={smallNumStyle}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="primary-button"
          style={{ padding: "9px 18px", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>{msg}</div>}
      {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>⚠ {err}</div>}
    </div>
  );
}

export function WaAlertsEditor({
  slabTransfer,
  backlog,
}: {
  slabTransfer: { enabled: boolean; number: string };
  backlog: { enabled: boolean; number: string; threshold: number; step: number };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SlabTransferCard initial={slabTransfer} />
      <div style={{ borderTop: "1px solid var(--border)" }} />
      <BacklogCard initial={backlog} />
    </div>
  );
}
