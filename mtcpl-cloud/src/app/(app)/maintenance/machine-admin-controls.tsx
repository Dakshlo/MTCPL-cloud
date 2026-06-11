"use client";

// Machine status + delete controls with in-app (our-UI) confirmation for
// the destructive ones (Retire + Delete). Working / Under-maintenance are
// instant. Posts to the maintenance server actions.

import { useRef, useState } from "react";
import { setMachineStatusAction, deleteMachineAction } from "./actions";

const pill: React.CSSProperties = { padding: "6px 12px", fontSize: 12, fontWeight: 700, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", color: "var(--text)" };
const danger: React.CSSProperties = { padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "#b91c1c", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, cursor: "pointer" };
const btnGhost: React.CSSProperties = { padding: "8px 14px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer", color: "var(--text)" };

export function MachineAdminControls({ machineId, status, back, canManage }: { machineId: string; status: string; back: string; canManage: boolean }) {
  const [confirm, setConfirm] = useState<null | "retire" | "delete">(null);
  const retireRef = useRef<HTMLFormElement>(null);
  const deleteRef = useRef<HTMLFormElement>(null);

  // Everyone with access can flip Working / Under-maintenance. Retire is a
  // management action — only owner/developer (canManage) get it.
  const statuses = canManage
    ? (["working", "under_maintenance", "retired"] as const)
    : (["working", "under_maintenance"] as const);
  const others = statuses.filter((s) => s !== status);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 18px", borderTop: "1px dashed var(--border)", alignItems: "center" }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Set status</span>

      {others.map((s) => {
        if (s === "retired") {
          return <button key={s} type="button" onClick={() => setConfirm("retire")} style={pill}>Retire</button>;
        }
        return (
          <form key={s} action={setMachineStatusAction}>
            <input type="hidden" name="id" value={machineId} /><input type="hidden" name="status" value={s} /><input type="hidden" name="back" value={back} />
            <button type="submit" style={pill}>{s === "working" ? "Working" : "Under maintenance"}</button>
          </form>
        );
      })}

      {canManage && (
        <button type="button" onClick={() => setConfirm("delete")} style={{ ...danger, marginLeft: "auto" }}>Delete machine</button>
      )}

      {/* hidden forms driven by the confirm modal */}
      <form ref={retireRef} action={setMachineStatusAction} style={{ display: "none" }}>
        <input type="hidden" name="id" value={machineId} /><input type="hidden" name="status" value="retired" /><input type="hidden" name="back" value={back} />
      </form>
      <form ref={deleteRef} action={deleteMachineAction} style={{ display: "none" }}>
        <input type="hidden" name="id" value={machineId} /><input type="hidden" name="back" value="/maintenance" />
      </form>

      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.32)" }}>
            {confirm === "retire" ? (
              <>
                <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Retire this machine?</h2>
                <p className="muted" style={{ margin: "0 0 18px", fontSize: 13 }}>It will be marked <strong style={{ color: "var(--text)" }}>Retired</strong> and shown greyed out. You can set it back to Working anytime.</p>
              </>
            ) : (
              <>
                <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Delete this machine?</h2>
                <p className="muted" style={{ margin: "0 0 18px", fontSize: 13 }}>This permanently removes the machine. This can&apos;t be undone.</p>
              </>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setConfirm(null)} style={btnGhost}>Cancel</button>
              <button
                type="button"
                onClick={() => {
                  const ref = confirm === "retire" ? retireRef : deleteRef;
                  setConfirm(null);
                  requestAnimationFrame(() => ref.current?.requestSubmit());
                }}
                style={{ padding: "8px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: confirm === "retire" ? "var(--gold-dark, #a16207)" : "#b91c1c", border: "none", borderRadius: 9, cursor: "pointer" }}
              >
                {confirm === "retire" ? "Retire" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
