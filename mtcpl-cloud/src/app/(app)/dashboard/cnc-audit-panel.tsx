"use client";

/**
 * CNC Audit — dashboard tile + who-to-send-it-to panel.
 *
 * Daksh: "when press it will ask for whom to message on WhatsApp, it
 * will give all owner, developer and other roles option."
 *
 * The list loads when the panel opens rather than on every dashboard
 * render — nobody opens this often enough to justify the query sitting
 * in the page's critical path, and the dashboard is already heavy.
 *
 * The send is confirmed before it fires. It puts a message on somebody's
 * personal phone from the company number; that is not something to do on
 * a stray click.
 */

import { useCallback, useEffect, useState } from "react";

import { listCncAuditRecipientsAction, sendCncAuditAction } from "./cnc-audit-actions";

type Person = { id: string; name: string; role: string };

/** Roles in the order the office thinks of them, so the picker does not
 *  read as a database dump. Anything unlisted falls to the bottom. */
const ROLE_ORDER = [
  "owner", "developer", "carving_head", "senior_incharge", "team_head",
  "tender_manager", "accountant_star", "accountant", "dispatch", "vendor",
];
const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  developer: "Developer",
  carving_head: "Carving head",
  senior_incharge: "Senior incharge",
  team_head: "Team head",
  tender_manager: "Tender manager",
  accountant_star: "Accountant ★",
  accountant: "Accountant",
  dispatch: "Dispatch incharge",
  vendor: "CNC operator",
  storekeeper: "Storekeeper",
  crosscheck: "Crosscheck",
  tv: "TV display",
};
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r.replace(/_/g, " ");

export function CncAuditPanel({ triggerStyle }: { triggerStyle?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    const r = await listCncAuditRecipientsAction();
    if (r.ok) setPeople(r.people);
    else setMsg({ kind: "err", text: r.error });
  }, []);

  useEffect(() => {
    if (open && people === null) void load();
  }, [open, people, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const send = async () => {
    if (picked.size === 0 || busy) return;
    const names = (people ?? []).filter((p) => picked.has(p.id)).map((p) => p.name);
    if (!window.confirm(`Send the CNC audit sheet on WhatsApp to:\n\n${names.join("\n")}`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendCncAuditAction([...picked]);
      if (r.ok) { setMsg({ kind: "ok", text: r.summary }); setPicked(new Set()); }
      else setMsg({ kind: "err", text: r.error });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Send failed." });
    } finally {
      setBusy(false);
    }
  };

  const grouped = (people ?? []).slice().sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.role), bi = ROLE_ORDER.indexOf(b.role);
    const ar = ai === -1 ? 99 : ai, br = bi === -1 ? 99 : bi;
    return ar - br || a.name.localeCompare(b.name);
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={triggerStyle}>
        <span style={{ fontSize: 20, marginRight: 10 }}>🔍</span>
        <span style={{ fontWeight: 700 }}>CNC Audit</span>
        <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 2, fontWeight: 600 }}>
          WhatsApp the floor check
        </span>
      </button>

      {open && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,12,6,0.5)",
            display: "grid", placeItems: "center", zIndex: 1000, padding: "24px 16px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="CNC Audit"
            style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, width: "100%", maxWidth: 560, maxHeight: "86vh",
              display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 18px 60px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17 }}>🔍 CNC Audit</h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.5 }}>
                    Sends a sheet of every machine and the slab the software says is on it, so it
                    can be checked against the floor. Who should get it?
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
              {people === null && !msg && (
                <div className="muted" style={{ fontSize: 13, padding: 12 }}>Loading people…</div>
              )}
              {grouped.map((p) => {
                const on = picked.has(p.id);
                return (
                  <label
                    key={p.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                      borderRadius: 9, cursor: "pointer", marginBottom: 6,
                      background: on ? "var(--gold-subtle)" : "var(--surface-alt)",
                      border: `1px solid ${on ? "var(--gold-border)" : "var(--border-light)"}`,
                    }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ width: 17, height: 17 }} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {roleLabel(p.role)}
                    </span>
                  </label>
                );
              })}
            </div>

            {msg && (
              <div
                style={{
                  margin: "0 14px 10px", padding: "10px 12px", borderRadius: 9, fontSize: 13, fontWeight: 600,
                  background: msg.kind === "ok" ? "var(--success-bg)" : "var(--danger-bg)",
                  color: msg.kind === "ok" ? "var(--success)" : "var(--danger)",
                }}
              >
                {msg.text}
              </div>
            )}

            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {/* See it before it goes to somebody's phone. The same
                  builder the send uses, so the preview cannot drift
                  from what is actually delivered. */}
              <a
                href="/api/cnc-audit/preview"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none" }}
              >
                👁 Preview the sheet
              </a>
              <span className="muted" style={{ fontSize: 12, flex: 1, textAlign: "right" }}>
                {picked.size === 0 ? "Nobody selected" : `${picked.size} selected`}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: "9px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--bg)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={busy || picked.size === 0}
                style={{
                  padding: "9px 18px", fontSize: 13, fontWeight: 800, borderRadius: 8,
                  border: "1px solid var(--gold-dark)",
                  background: busy || picked.size === 0 ? "var(--border)" : "var(--gold)",
                  color: busy || picked.size === 0 ? "var(--muted)" : "#fff",
                  cursor: busy || picked.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                {busy ? "Sending…" : "Send on WhatsApp"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
