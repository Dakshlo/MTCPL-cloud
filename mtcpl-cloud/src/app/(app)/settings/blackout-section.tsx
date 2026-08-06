"use client";

/**
 * Full-blackout control. Developer only.
 *
 * Deliberately unlike every other control in Settings: it states plainly that
 * it cannot be undone from inside the app, shows the exact SQL that brings the
 * system back BEFORE you arm it, and makes you type the word out. Someone
 * about to take the whole company offline should have read the way back first.
 */

import { useState, useTransition } from "react";

type Result = { ok: true } | { ok: false; error: string };

const RESTORE_SQL = `update system_settings
set value = '{"on": false}'::jsonb,
    updated_at = now()
where key = 'blackout';`;

export function BlackoutSection({
  engageAction,
}: {
  engageAction: (formData: FormData) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const armed = confirm.trim() === "BLACKOUT";

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("confirm", confirm.trim());
    startTransition(async () => {
      const res = await engageAction(fd);
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  };

  if (done) {
    return (
      <div style={{ border: "2px solid #7f1d1d", borderRadius: 12, padding: 18, background: "rgba(127,29,29,0.08)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#7f1d1d", marginBottom: 8 }}>
          Blackout engaged — the system is going dark
        </div>
        <p style={{ fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 }}>
          Every page will stop answering within about ten seconds, for everyone
          including you. Nothing has been deleted — all data is exactly as it
          was. <b>Do not close this box until you have copied the SQL below.</b>
        </p>
        <RestoreBlock copied={copied} setCopied={setCopied} />
      </div>
    );
  }

  return (
    <div style={{ border: "2px solid #7f1d1d", borderRadius: 12, padding: 18, background: "rgba(127,29,29,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 20 }}>⛔</span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#7f1d1d" }}>Full blackout</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Takes every URL of the system off the air — for staff, for the owner,
            and for you. Not a maintenance screen: a bare 503 with no branding.
          </div>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              fontSize: 12.5, fontWeight: 800, padding: "9px 16px", borderRadius: 8,
              border: "1.5px solid #7f1d1d", background: "transparent", color: "#7f1d1d", cursor: "pointer",
            }}
          >
            Black out the whole system…
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 16, borderTop: "1px solid rgba(127,29,29,0.25)", paddingTop: 14 }}>
          <p style={{ fontSize: 13, lineHeight: 1.65, margin: "0 0 10px" }}>
            <b>Read this before you arm it.</b> There is no button that undoes
            this — once it is on, this page is blacked out too. Maintenance mode
            is the reversible one; this is not it.
          </p>
          <ul style={{ fontSize: 12.5, lineHeight: 1.7, margin: "0 0 14px", paddingLeft: 18, color: "var(--muted)" }}>
            <li>Every URL answers <b>503 Service Unavailable</b> — pages, APIs, the Parkota board, everything.</li>
            <li>No login works. There is no developer bypass, by design.</li>
            <li><b>No data is touched.</b> Every slab, bill and invoice is exactly as you left it.</li>
            <li>Search engines are told to hold, not to drop the site, so nothing is lost from listings.</li>
            <li>It comes back the moment the database flag is flipped — about ten seconds.</li>
          </ul>

          <RestoreBlock copied={copied} setCopied={setCopied} />

          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 5 }}>
              Type <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>BLACKOUT</code> to confirm
            </label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="BLACKOUT"
              autoComplete="off"
              spellCheck={false}
              style={{
                width: "100%", maxWidth: 260, padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)",
                fontFamily: "ui-monospace, monospace", fontWeight: 700, letterSpacing: "0.06em",
              }}
            />
          </div>

          {error && (
            <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={!armed || pending}
              onClick={submit}
              style={{
                fontSize: 12.5, fontWeight: 800, padding: "10px 18px", borderRadius: 8, border: "none",
                background: armed ? "#7f1d1d" : "var(--border)",
                color: armed ? "#fff" : "var(--muted)",
                cursor: armed && !pending ? "pointer" : "not-allowed",
              }}
            >
              {pending ? "Going dark…" : "Engage full blackout"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirm(""); setError(null); }}
              disabled={pending}
              style={{
                fontSize: 12.5, fontWeight: 700, padding: "10px 18px", borderRadius: 8,
                border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The way back, shown before you can arm it and again after. */
function RestoreBlock({ copied, setCopied }: { copied: boolean; setCopied: (v: boolean) => void }) {
  return (
    <div style={{ background: "var(--surface-alt, rgba(0,0,0,0.04))", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted)" }}>
          How to bring it back — Supabase → SQL Editor
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(RESTORE_SQL).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
              () => {},
            );
          }}
          style={{
            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6,
            border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", color: "var(--text)" }}>
{RESTORE_SQL}
      </pre>
    </div>
  );
}
