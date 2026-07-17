"use client";

/** ➕ Add user (Jul 2026) — self-signup is closed (bot attack), so owner/dev
 *  pre-create team members here. A compact button that opens a CENTERED modal
 *  with the form; portaled to <body> so the PeekSection's transformed ancestors
 *  can't break position:fixed (see the nested-modal gotcha). */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addUserAction } from "./actions";

type Role = { value: string; label: string };
type Vendor = { id: string; name: string };

export function AddUserForm({ roles, vendors }: { roles: Role[]; vendors: Vendor[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState("cutting_operator");
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    // capture + stopPropagation: Esc must close ONLY this modal, not also the
    // PeekSection underneath (its window-level Esc listener runs in bubble
    // phase — stopping here means it never fires).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  const label: React.CSSProperties = { display: "grid", gap: 4, fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" };
  const input: React.CSSProperties = { fontSize: 14, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", width: "100%" };

  return (
    <>
      <button type="button" className="primary-button" style={{ minHeight: 38 }} onClick={() => setOpen(true)}>
        ➕ Add user
      </button>

      {open && mounted && createPortal(
        <div
          onClick={() => setOpen(false)}
          // stopPropagation: the portal's events bubble up the REACT tree into
          // PeekSection, whose backdrop closes on any mousedown outside ITS
          // dialog — without this, clicking any field here closed the whole
          // Users peek and dumped you back on the settings page.
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.45)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 94vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.35)", padding: "18px 20px 20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>➕ Add user</div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 18, fontWeight: 900, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              They can log in with OTP immediately after this.
            </div>

            <form action={addUserAction} style={{ display: "grid", gap: 12 }}>
              <label style={label}>
                Name
                <input name="full_name" required placeholder="FULL NAME" autoFocus style={{ ...input, textTransform: "uppercase" }} />
              </label>
              <label style={label}>
                Mobile
                <input name="phone" required placeholder="10-digit mobile" inputMode="numeric" pattern="[0-9 +\-]{10,15}" style={input} />
              </label>
              <label style={label}>
                Role
                <select name="role" value={role} onChange={(e) => setRole(e.target.value)} style={input}>
                  {roles.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
              {role === "vendor" && (
                <label style={label}>
                  CNC vendor
                  <select name="vendor_id" defaultValue="" required style={input}>
                    <option value="">— pick the vendor —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button type="button" className="ghost-button" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button" style={{ minHeight: 40 }}>➕ Add user</button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
