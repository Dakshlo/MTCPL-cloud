"use client";

// DEVELOPER-only: ON/OFF for the two slab-transfer lanes. Each toggle saves
// immediately. ON = slab routes through the transfer runner; OFF = slab goes
// straight to its destination (skips the transfer / pending-stock step).

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateSlabTransferStagesAction } from "./slab-transfer-actions";
import type { SlabTransferStages } from "@/lib/slab-transfer-stages";

function Switch({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  const track: CSSProperties = {
    width: 46, height: 26, borderRadius: 999,
    background: on ? "#16A34A" : "var(--border)",
    position: "relative", transition: "background 0.15s", flex: "0 0 auto",
    cursor: busy ? "wait" : "pointer",
  };
  const knob: CSSProperties = {
    position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20,
    borderRadius: "50%", background: "#fff", transition: "left 0.15s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  };
  return (
    <div role="switch" aria-checked={on} onClick={onClick} style={track}>
      <span style={knob} />
    </div>
  );
}

export function SlabTransferEditor({ initial }: { initial: SlabTransferStages }) {
  const router = useRouter();
  const [stages, setStages] = useState<SlabTransferStages>(initial);
  const [busy, setBusy] = useState<null | keyof SlabTransferStages>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function persist(next: SlabTransferStages, which: keyof SlabTransferStages) {
    setBusy(which);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("cuttingToCarving", String(next.cuttingToCarving));
      fd.set("carvingToDispatch", String(next.carvingToDispatch));
      const res = await updateSlabTransferStagesAction(fd);
      if (!res.ok) { setErr(res.error); return; }
      const saved = { cuttingToCarving: res.cuttingToCarving, carvingToDispatch: res.carvingToDispatch };
      setStages(saved);
      setMsg(
        which === "cuttingToCarving"
          ? `✓ Cutting → Carving transfer ${saved.cuttingToCarving ? "ON" : "OFF"}`
          : `✓ Carving → Dispatch transfer ${saved.carvingToDispatch ? "ON" : "OFF"}`,
      );
      router.refresh();
    } catch {
      setErr("Failed — check your connection.");
    } finally {
      setBusy(null);
    }
  }

  function toggle(which: keyof SlabTransferStages) {
    if (busy) return;
    void persist({ ...stages, [which]: !stages[which] }, which);
  }

  const Lane = ({
    which, title, onText, offText,
  }: {
    which: keyof SlabTransferStages; title: string; onText: string; offText: string;
  }) => {
    const on = stages[which];
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 3 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            <strong style={{ color: on ? "#16A34A" : "#b45309" }}>{on ? "ON" : "OFF"}</strong>
            {" — "}
            {on ? onText : offText}
          </div>
        </div>
        <Switch on={on} busy={busy === which} onClick={() => toggle(which)} />
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {Lane({
        which: "cuttingToCarving",
        title: "🪨 Cutting → Carving transfer",
        onText: "an assigned slab waits in the vendor's Pending stock until the transfer runner delivers it.",
        offText: "an assigned slab is received instantly — straight to the CNC cockpit Ready-to-load (Outsource auto-starts). No pending stock.",
      })}
      <div style={{ borderTop: "1px solid var(--border)" }} />
      {Lane({
        which: "carvingToDispatch",
        title: "🛕 Carving → Dispatch transfer",
        onText: "an approved carving slab waits in the Carving→Dispatch bring-in queue (greyed on the Dispatch board) until a runner brings it in.",
        offText: "an approved carving slab is dispatch-selectable immediately — no bring-in step.",
      })}

      {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠ {err}</div>}
      {msg && !err && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#16A34A" }}>{msg}</div>}
      <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
        Changes take effect on the next assignment / approval — slabs already in transit keep their current lane.
      </div>
    </div>
  );
}
