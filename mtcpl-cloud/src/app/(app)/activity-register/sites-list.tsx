"use client";

import Link from "next/link";
import { useState } from "react";
import { createActivitySiteAction, deleteActivitySiteAction } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";

export type SiteCard = {
  id: string;
  name: string;
  codePrefix: string;
  codePad: number;
  count: number;
};

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
  width: "100%",
};

// Deterministic per-site accent so each card has its own colour.
const SITE_ACCENTS = ["#b87333", "#0f766e", "#2563eb", "#9333ea", "#dc2626", "#15803d", "#b45309", "#0891b2"];
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function SitesList({ sites, toast }: { sites: SiteCard[]; toast: string | null }) {
  const [showNew, setShowNew] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {toast && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e" }}>
          {toast}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {sites.length} {sites.length === 1 ? "site" : "sites"}
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          style={{ padding: "9px 18px", fontSize: 14, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 10, cursor: "pointer" }}
        >
          ＋ New site
        </button>
      </div>

      {sites.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14, padding: 36, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🗂</div>
          No sites yet. Tap <strong>＋ New site</strong> to create your first one (e.g. name “L&amp;T”, code prefix “Lnt/OOS”).
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 13 }}>
          <style>{`.ar-site{transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}.ar-site:hover{transform:translateY(-3px);box-shadow:0 12px 26px rgba(0,0,0,.1);border-color:var(--gold-dark)}.ar-site:hover .ar-go{transform:translateX(3px)}.ar-go{display:inline-block;transition:transform .14s ease}`}</style>
          {sites.map((s) => {
            const accent = SITE_ACCENTS[hashStr(s.id) % SITE_ACCENTS.length];
            return (
            <div
              key={s.id}
              className="ar-site"
              style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderTop: `4px solid ${accent}`, borderRadius: 14, overflow: "hidden" }}
            >
              <Link
                href={`/activity-register/${s.id}`}
                style={{ display: "block", padding: "16px 16px 14px", textDecoration: "none", color: "var(--text)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, background: `${accent}1f`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900 }}
                    aria-hidden
                  >
                    {s.name.trim().charAt(0).toUpperCase() || "•"}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
                      {s.codePrefix}/{"0".repeat(Math.max(0, s.codePad - 1))}1
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: accent, background: `${accent}14`, borderRadius: 999, padding: "3px 11px" }}>
                    {s.count} {s.count === 1 ? "entry" : "entries"}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--gold-dark)" }}>Open <span className="ar-go">→</span></span>
                </div>
              </Link>
              {/* Delete (owner/dev) — server blocks it unless the site is empty. */}
              <form action={deleteActivitySiteAction} style={{ position: "absolute", top: 8, right: 8 }}>
                <input type="hidden" name="id" value={s.id} />
                <ConfirmButton
                  message={`Delete site "${s.name}"? (Only allowed if it has no entries.)`}
                  style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
                >
                  ✕
                </ConfirmButton>
              </form>
            </div>
            );
          })}
        </div>
      )}

      {showNew && <NewSiteModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewSiteModal({ onClose }: { onClose: () => void }) {
  const [prefix, setPrefix] = useState("");
  const [pad, setPad] = useState("3");
  const padN = Math.min(8, Math.max(1, Number(pad) || 3));
  const cleanPrefix = prefix.trim().replace(/\/+$/, "");
  const preview = cleanPrefix ? `${cleanPrefix}/${"0".repeat(Math.max(0, padN - 1))}1` : "—";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>New site</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }} aria-label="Close">×</button>
        </div>
        <form action={createActivitySiteAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Site name *</span>
            <input name="name" required placeholder="e.g. L&amp;T" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Code prefix *</span>
            <input name="code_prefix" required value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. Lnt/OOS" style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 160 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Number digits</span>
            <input name="code_pad" type="number" min="1" max="8" value={pad} onChange={(e) => setPad(e.target.value)} style={inputStyle} />
          </label>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            First code will be{" "}
            <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{preview}</strong>
            {", then "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              {cleanPrefix ? `${cleanPrefix}/${"0".repeat(Math.max(0, padN - 1))}2` : "…"}
            </span>
            {" …"}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "9px 16px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", color: "var(--text)" }}>Cancel</button>
            <button type="submit" style={{ padding: "9px 20px", fontSize: 13, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 8, cursor: "pointer" }}>Create site</button>
          </div>
        </form>
      </div>
    </div>
  );
}
