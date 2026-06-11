"use client";

// Mig 124 — "📷 Add image" on Temple View. A modal to attach a reference
// photo to a temple component: pick Temple → Category 1 → optional
// Category 2 (dropdowns from the temple's real categories so the image
// lands on an existing node), choose an image + optional caption.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addTempleComponentImageAction } from "./actions";

export function AddTempleImageButton({ categoryStruct }: { categoryStruct: Record<string, Record<string, string[]>> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [temple, setTemple] = useState("");
  const [section, setSection] = useState("");
  const [element, setElement] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  const temples = Object.keys(categoryStruct).sort();
  const cat1s = temple ? Object.keys(categoryStruct[temple] ?? {}).sort() : [];
  const cat2s = temple && section ? (categoryStruct[temple]?.[section] ?? []) : [];

  function reset() {
    setTemple(""); setSection(""); setElement(""); setCaption(""); setFileName(""); setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (busy) return;
    setError("");
    const file = fileRef.current?.files?.[0];
    if (!temple) return setError("Pick a temple.");
    if (!section) return setError("Pick Category 1.");
    if (!file) return setError("Choose an image.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("temple", temple);
      fd.set("section", section);
      fd.set("element", element);
      fd.set("caption", caption);
      fd.set("image", file);
      const res = await addTempleComponentImageAction(fd);
      if (!res.ok) { setError(res.error); return; }
      reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Upload failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const inp = { padding: "9px 11px", fontSize: 13.5, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)", width: "100%", boxSizing: "border-box" as const };
  const lbl = { fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.05em", display: "block", marginBottom: 4 };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="secondary-button">📷 Add image</button>

      {open && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,12,6,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" style={{ width: "100%", maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.45)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>📷 Add component image</div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
            </div>

            <label><span style={lbl}>Temple</span>
              <select value={temple} onChange={(e) => { setTemple(e.target.value); setSection(""); setElement(""); }} style={inp}>
                <option value="">Select temple…</option>
                {temples.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label><span style={lbl}>Category 1 (area / floor)</span>
              <select value={section} disabled={!temple} onChange={(e) => { setSection(e.target.value); setElement(""); }} style={inp}>
                <option value="">{temple ? "Select Category 1…" : "Pick a temple first"}</option>
                {cat1s.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <label><span style={lbl}>Category 2 (optional — sub-area)</span>
              <select value={element} disabled={!section || cat2s.length === 0} onChange={(e) => setElement(e.target.value)} style={inp}>
                <option value="">{cat2s.length === 0 ? "— none —" : "Whole Category 1 (or pick…)"}</option>
                {cat2s.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <div>
              <span style={lbl}>Image</span>
              <button type="button" onClick={() => fileRef.current?.click()} style={{ ...inp, textAlign: "left", cursor: "pointer", color: fileName ? "var(--text)" : "var(--muted)" }}>
                {fileName || "Choose an image (JPG/PNG, max 8 MB)…"}
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
            </div>

            <label><span style={lbl}>Caption (optional)</span>
              <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. carved pillar reference" style={inp} />
            </label>

            {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" disabled={busy} onClick={() => setOpen(false)} className="ghost-button">Cancel</button>
              <button type="button" disabled={busy} onClick={submit} style={{ padding: "9px 18px", fontSize: 14, fontWeight: 800, color: "#fff", background: busy ? "var(--border)" : "var(--gold-dark)", border: "none", borderRadius: 9, cursor: busy ? "wait" : "pointer" }}>
                {busy ? "Uploading…" : "✓ Add image"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
