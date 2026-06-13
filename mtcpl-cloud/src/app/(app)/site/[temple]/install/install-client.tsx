"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { SiteSlab } from "../../site-lib";
import { installSlabAction } from "../../actions";

const peekOverlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1500, background: "rgba(15,12,6,0.6)",
  backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
};

function matchSlab(s: SiteSlab, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const dim = `${s.l}x${s.w}x${s.t}`;
  const hay = `${s.id} ${s.label ?? ""} ${s.description ?? ""} ${s.stone ?? ""} ${s.yardName ?? ""} ${dim}`.toLowerCase();
  return query.split(/\s+/).every((tok) => hay.includes(tok.replace(/[×x*]/g, "x")));
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ── Install form modal — mandatory photo + optional note. ────────────────
function InstallModal({ slab, onClose }: { slab: SiteSlab; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function submit() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setErr("An installed photo is required."); return; }
    setErr(null);
    const fd = new FormData();
    fd.set("slab_id", slab.id);
    fd.set("note", note.trim());
    fd.set("photo", f);
    startBusy(async () => {
      const res = await installSlabAction(fd);
      if (!res.ok) { setErr(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <div style={peekOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ width: "100%", maxWidth: 460, background: "var(--surface)", border: "1.5px solid rgba(22,163,74,0.5)", borderTop: "6px solid #15803d", borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" }} role="dialog" aria-modal="true">
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#15803d" }}>🔨 Mark installed</div>
            <div style={{ fontSize: 13, marginTop: 3 }}>
              <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{slab.id}</code>
              {slab.label ? <span className="muted"> · {slab.label}</span> : null}
              {slab.yardName ? <span className="muted"> · 📍 {slab.yardName}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 120, padding: 10,
              background: preview ? "var(--surface)" : "rgba(22,163,74,0.05)",
              border: `2px dashed ${preview ? "#15803d" : "rgba(22,163,74,0.5)"}`, borderRadius: 12, cursor: "pointer",
              color: "var(--text)", position: "relative", overflow: "hidden",
            }}
          >
            {preview ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="installed" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                <span style={{ position: "relative", fontSize: 12.5, fontWeight: 800, color: "#fff", background: "rgba(21,128,61,0.9)", borderRadius: 999, padding: "4px 12px" }}>✓ Photo — tap to change</span>
              </>
            ) : (
              <span style={{ fontSize: 13.5, fontWeight: 800 }}>📷 Installed photo (required)</span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={() => {
                const f = fileRef.current?.files?.[0];
                if (preview) URL.revokeObjectURL(preview);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            />
          </button>

          <label className="stack">
            <span style={{ fontSize: 13, fontWeight: 700 }}>Note (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Installed on north wall, row 3" style={{ resize: "vertical", fontFamily: "inherit", fontSize: 14 }} />
          </label>

          {err && <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 700 }}>⚠ {err}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={submit} disabled={busy} className="primary-button" style={{ flex: 1, fontSize: 14.5, padding: "12px", background: "#15803d", borderColor: "#15803d" }}>
              {busy ? "Saving…" : "✓ Mark installed"}
            </button>
            <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StockCard({ s, onInstall, onDragStart }: { s: SiteSlab; onInstall: () => void; onDragStart: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", s.id); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "5px solid #0f766e", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5, cursor: "grab" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, opacity: 0.4 }}>⠿</span>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>{s.id}</code>
        {s.priority && <span title="Urgent">⚡</span>}
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, color: "#0f766e", background: "rgba(15,118,110,0.1)", borderRadius: 999, padding: "2px 9px" }}>📍 {s.yardName}</span>
      </div>
      {(s.label || s.description) && (
        <div style={{ fontSize: 12, lineHeight: 1.35 }}><strong>{s.label ?? ""}</strong>{s.description && <span className="muted">{s.label ? " · " : ""}{s.description}</span>}</div>
      )}
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>{s.l}×{s.w}×{s.t} in · {s.cft.toFixed(2)} CFT{s.stone ? <span className="muted"> · {s.stone}</span> : null}</div>
      <button type="button" onClick={onInstall} style={{ alignSelf: "flex-start", marginTop: 2, fontSize: 12.5, fontWeight: 800, padding: "7px 14px", borderRadius: 8, border: "none", background: "#15803d", color: "#fff", cursor: "pointer" }}>
        ✓ Install →
      </button>
    </div>
  );
}

export function InstallClient({ temple: _temple, stock, installed }: { temple: string; stock: SiteSlab[]; installed: SiteSlab[] }) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<SiteSlab | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const filteredStock = useMemo(() => stock.filter((s) => matchSlab(s, query)), [stock, query]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    const id = e.dataTransfer.getData("text/plain");
    const slab = stock.find((s) => s.id === id);
    if (slab) setTarget(slab);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ position: "relative", flex: "1 1 260px" }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.6 }}>🔍</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stock — code / label / size / yard…" style={{ width: "100%", padding: "10px 14px 10px 38px", fontSize: 14, border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }} />
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>{filteredStock.length} ready · {installed.length} installed</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 14, alignItems: "start" }}>
        {/* LEFT — installed drop zone + history */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDrop}
          style={{
            background: dropActive ? "rgba(22,163,74,0.1)" : "rgba(22,163,74,0.04)",
            border: `2px dashed ${dropActive ? "#15803d" : "rgba(22,163,74,0.4)"}`,
            borderRadius: 14, padding: 14, minHeight: 200, transition: "background .12s, border-color .12s",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800, color: "#15803d", marginBottom: 2 }}>✅ Installed ({installed.length})</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Drag a stock slab here, or tap “Install” on a card.</div>
          {installed.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: "24px 8px", textAlign: "center" }}>Nothing installed yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {installed.map((s) => (
                <div key={s.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "5px solid #15803d", borderRadius: 10, padding: "9px 11px", display: "flex", gap: 10, alignItems: "center" }}>
                  {s.installPhotoUrl && (
                    <a href={s.installPhotoUrl} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.installPhotoUrl} alt="installed" style={{ width: 52, height: 40, objectFit: "cover", borderRadius: 7, border: "1px solid var(--border)", display: "block" }} />
                    </a>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                      <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12.5 }}>{s.id}</code>
                      {s.label && <span className="muted" style={{ fontSize: 11.5 }}>{s.label}</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {s.installedAt ? fmtDateTime(s.installedAt) : ""}{s.installNote ? ` · ${s.installNote}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — stock to install */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f766e", marginBottom: 10 }}>📦 In stock — ready to install ({filteredStock.length})</div>
          {filteredStock.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: "24px 8px", textAlign: "center" }}>
              {stock.length === 0 ? "No stock to install — unload a truck in the Stock Yard first." : `No stock matches “${query}”.`}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 9 }}>
              {filteredStock.map((s) => (
                <StockCard key={s.id} s={s} onInstall={() => setTarget(s)} onDragStart={() => {}} />
              ))}
            </div>
          )}
        </div>
      </div>

      {target && <InstallModal slab={target} onClose={() => setTarget(null)} />}
    </>
  );
}
