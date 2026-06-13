"use client";

// Mig 128 — two modals for the fullscreen card browser:
//   · MoveSlabModal     — re-categorize a slab (move it from one
//     Category/Label/Description to another within the same temple), with a
//     confirmation step before it commits.
//   · NodeImageUploader — attach a reference photo to ANY tree node
//     (Category 1 / Category 2 / Label / Description / Additional), bound to
//     the node you're looking at — no re-picking the category.

import { useRef, useState, type CSSProperties } from "react";
import { moveSlabsComponentAction, addTempleComponentImageAction } from "./actions";
import type { TempleSlabCard } from "./temple-shared";

const overlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1800, background: "rgba(10,8,4,0.6)",
  backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center",
  padding: 16, animation: "tcFade .16s ease",
};
const dialog: CSSProperties = {
  width: "100%", maxWidth: 480, background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 16, boxShadow: "0 22px 70px rgba(0,0,0,0.5)", padding: 20,
  display: "flex", flexDirection: "column", gap: 13, maxHeight: "88vh", overflowY: "auto",
};
const inp: CSSProperties = {
  padding: "9px 11px", fontSize: 13.5, border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--bg)", color: "var(--text)", width: "100%", boxSizing: "border-box",
};
const lbl: CSSProperties = {
  fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase",
  letterSpacing: "0.05em", display: "block", marginBottom: 4,
};

// ── Move / re-categorize a slab ──────────────────────────────────────
export function MoveSlabModal({
  slabs, temple, cats, onClose, onMoved,
}: {
  /** One or many slabs — multi-select moves them all to the same path.
   *  They share a leaf (same Cat1›Cat2›Label›Desc), so slabs[0] seeds the
   *  form. */
  slabs: TempleSlabCard[];
  temple: string;
  cats: { cat1: string[]; cat2: string[]; labels: string[] };
  onClose: () => void;
  onMoved: () => void;
}) {
  const slab = slabs[0];
  const many = slabs.length > 1;
  const [section, setSection] = useState(slab.section);
  const [element, setElement] = useState(slab.element);
  const [label, setLabel] = useState(slab.label);
  const [description, setDescription] = useState(slab.description);
  const [additional, setAdditional] = useState(slab.additional);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pathStr = (s: string, e: string, l: string, d: string, a: string) =>
    [s || "Unassigned", e, l || "— (no label)", d, a].filter(Boolean).join("  ›  ");
  const fromPath = pathStr(slab.section, slab.element, slab.label, slab.description, slab.additional);
  const toPath = pathStr(section.trim(), element.trim(), label.trim(), description.trim(), additional.trim());
  const changed = toPath !== fromPath;

  async function commit() {
    if (busy) return;
    if (!label.trim()) { setError("Label can't be empty."); return; }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("slab_ids", JSON.stringify(slabs.map((s) => s.id)));
      fd.set("section", section);
      fd.set("element", element);
      fd.set("label", label);
      fd.set("description", description);
      fd.set("additional", additional);
      const res = await moveSlabsComponentAction(fd);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      onMoved();
    } catch {
      setError("Move failed — check your connection.");
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} style={overlay}>
      <div style={dialog}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {many ? <>↔ Move <span style={{ color: "var(--gold-dark)" }}>{slabs.length} slabs</span></> : <>↔ Move slab <code style={{ fontFamily: "ui-monospace, monospace" }}>{slab.id}</code></>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {!confirming ? (
          <>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Change where this slab sits in <strong>{temple}</strong>. Type a new value or pick one already used here.
            </div>

            <datalist id="mv-cat1">{cats.cat1.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="mv-cat2">{cats.cat2.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="mv-label">{cats.labels.map((v) => <option key={v} value={v} />)}</datalist>

            <label><span style={lbl}>Category 1 (area / floor)</span>
              <input list="mv-cat1" value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. FLOOR-1" style={{ ...inp, textTransform: "uppercase" }} />
            </label>
            <label><span style={lbl}>Category 2 (sub-area, optional)</span>
              <input list="mv-cat2" value={element} onChange={(e) => setElement(e.target.value)} placeholder="e.g. CLOISTER" style={{ ...inp, textTransform: "uppercase" }} />
            </label>
            <label><span style={lbl}>Label</span>
              <input list="mv-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. PILLAR" style={{ ...inp, textTransform: "uppercase" }} />
            </label>
            <label><span style={lbl}>Description (optional)</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. lotus base" style={inp} />
            </label>
            <label><span style={lbl}>Additional description (optional)</span>
              <input value={additional} onChange={(e) => setAdditional(e.target.value)} placeholder="extra sub-group" style={inp} />
            </label>

            {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose} className="ghost-button">Cancel</button>
              <button type="button" disabled={!changed} onClick={() => { setError(""); setConfirming(true); }} style={primaryBtn(changed)}>
                Review move →
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Confirm this move — the slab will appear under the new path in Temple View.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={lbl}>From</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{fromPath}</div>
              </div>
              <div style={{ textAlign: "center", fontSize: 18, color: "var(--gold-dark)" }}>↓</div>
              <div style={{ background: "rgba(184,115,51,0.08)", border: "1px solid var(--gold-dark)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={lbl}>To</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.5 }}>{toPath}</div>
              </div>
            </div>
            {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="ghost-button">← Edit</button>
              <button type="button" disabled={busy} onClick={commit} style={primaryBtn(true)}>{busy ? "Moving…" : "✓ Confirm move"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Attach a photo to the current node ───────────────────────────────
export function NodeImageUploader({
  temple, nodePath, nodeLabel, onClose, onUploaded,
}: {
  temple: string;
  nodePath: string;
  nodeLabel: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose an image."); return; }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("temple", temple);
      fd.set("node_path", nodePath);
      fd.set("node_label", nodeLabel);
      fd.set("caption", caption);
      fd.set("image", file);
      const res = await addTempleComponentImageAction(fd);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      onUploaded();
    } catch {
      setError("Upload failed — check your connection.");
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} style={overlay}>
      <div style={{ ...dialog, maxWidth: 440 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>📷 Add photo</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Attaching to <strong style={{ color: "var(--text)" }}>{nodeLabel}</strong>
          <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8, wordBreak: "break-word" }}>{nodePath.split("/").slice(1).join("  ›  ")}</div>
        </div>

        <div>
          <span style={lbl}>Image</span>
          <button type="button" onClick={() => fileRef.current?.click()} style={{ ...inp, textAlign: "left", cursor: "pointer", color: fileName ? "var(--text)" : "var(--muted)" }}>
            {fileName || "Choose an image (JPG/PNG, max 8 MB)…"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ""); setError(""); }} />
        </div>
        <label><span style={lbl}>Caption (optional)</span>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. carved pillar reference" style={inp} />
        </label>

        {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onClose} className="ghost-button">Cancel</button>
          <button type="button" disabled={busy} onClick={submit} style={primaryBtn(true)}>{busy ? "Uploading…" : "✓ Add photo"}</button>
        </div>
      </div>
    </div>
  );
}

function primaryBtn(enabled: boolean): CSSProperties {
  return {
    padding: "9px 18px", fontSize: 14, fontWeight: 800, color: "#fff",
    background: enabled ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 9,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}
