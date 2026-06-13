"use client";

// Mig 128 — two modals for the fullscreen card browser:
//   · MoveSlabModal     — re-categorize a slab (move it from one
//     Category/Label/Description to another within the same temple), with a
//     confirmation step before it commits.
//   · NodeImageUploader — attach a reference photo to ANY tree node
//     (Category 1 / Category 2 / Label / Description / Additional), bound to
//     the node you're looking at — no re-picking the category.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { moveSlabsComponentAction, renameTempleNodeAction, addTempleComponentImageAction, deleteTempleComponentImageAction } from "./actions";
import type { TempleSlabCard, ComponentImage } from "./temple-shared";

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

// ── Searchable dropdown (combobox) ───────────────────────────────────
// Daksh — clicking the field shows EVERY value used for that level in the
// SAME temple (even when the field is already filled); typing filters; a
// click fills it. You can still type a brand-new value (free text).
function ComboField({
  label, value, onChange, options, placeholder, upper = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  upper?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // query === null → just opened (show ALL); a string → user is filtering.
  const [query, setQuery] = useState<string | null>(null);
  // Dropdown is positioned with FIXED coords anchored to the input, so the
  // dialog's own overflow:auto can't clip it (that caused the double-scrollbar).
  const [menu, setMenu] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number }>({ left: 0, width: 0, maxH: 240 });
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function place() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const openUp = below < 240 && above > below;
    const maxH = Math.max(150, Math.min(300, (openUp ? above : below) - 16));
    setMenu({
      left: r.left,
      width: r.width,
      maxH,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
    });
  }
  function openMenu(resetQuery = true) {
    place();
    if (resetQuery) setQuery(null);
    setOpen(true);
  }

  // Close on outside click, and on scroll/resize (the fixed menu would drift).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onShift() { setOpen(false); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onShift, true);
    window.addEventListener("resize", onShift);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onShift, true);
      window.removeEventListener("resize", onShift);
    };
  }, [open]);

  const q = (query ?? "").trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  function pick(v: string) {
    onChange(upper ? v.toUpperCase() : v);
    setQuery(null);
    setOpen(false);
  }

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <span style={lbl}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { onChange(upper ? e.target.value.toUpperCase() : e.target.value); setQuery(e.target.value); if (!open) openMenu(false); }}
          onFocus={() => openMenu()}
          onClick={() => openMenu()}
          placeholder={placeholder}
          style={{ ...inp, paddingRight: 34, textTransform: upper ? "uppercase" : "none" }}
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show options"
          onClick={() => { if (open) setOpen(false); else openMenu(); }}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 11, transition: "transform .15s ease", rotate: open ? "180deg" : "0deg" }}
        >
          ▼
        </button>
      </div>

      {open && (
        <div style={{ position: "fixed", left: menu.left, width: menu.width, ...(menu.top != null ? { top: menu.top } : { bottom: menu.bottom }), zIndex: 2200, background: "var(--surface)", border: "1px solid var(--gold-dark)", borderRadius: 10, boxShadow: "0 14px 36px rgba(0,0,0,0.28)", maxHeight: menu.maxH, overflowY: "auto", overscrollBehavior: "contain", padding: 4, WebkitOverflowScrolling: "touch" }}>
          {options.length === 0 ? (
            <div style={{ padding: "9px 11px", fontSize: 12.5, color: "var(--muted)" }}>No values yet — type to add one.</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "9px 11px", fontSize: 12.5, color: "var(--muted)" }}>No match — “{query}” will be added as new.</div>
          ) : (
            filtered.map((o) => {
              const active = o.toLowerCase() === value.trim().toLowerCase();
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => pick(o)}
                  style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 13, fontWeight: active ? 800 : 600, color: "var(--text)", background: active ? "rgba(184,115,51,0.12)" : "transparent", border: "none", borderRadius: 7, cursor: "pointer" }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--surface-alt, rgba(0,0,0,0.04))"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ width: 14, flexShrink: 0, color: "var(--gold-dark)", fontWeight: 900 }}>{active ? "✓" : ""}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Move / re-categorize a slab ──────────────────────────────────────
export function MoveSlabModal({
  slabs, temple, cats, onClose, onMoved,
}: {
  /** One or many slabs — multi-select moves them all to the same path.
   *  They share a leaf (same Cat1›Cat2›Label›Desc), so slabs[0] seeds the
   *  form. */
  slabs: TempleSlabCard[];
  temple: string;
  cats: { cat1: string[]; cat2: string[]; labels: string[]; descriptions: string[] };
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
  const [done, setDone] = useState(0); // >0 → success view (count moved)
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
      // Show a clear success tick, then refresh the page underneath (which
      // re-fetches the tree so the moved slabs leave this leaf).
      setBusy(false);
      setDone(res.count || slabs.length);
      setTimeout(() => onMoved(), 950);
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

        {done > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "22px 8px 8px", textAlign: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#16a34a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 900, animation: "tcZoom .25s ease" }}>✓</div>
            <div style={{ fontSize: 15.5, fontWeight: 800 }}>{done === 1 ? "Slab moved" : `${done} slabs moved`}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>Now under<br /><strong style={{ color: "var(--text)" }}>{toPath}</strong></div>
          </div>
        ) : !confirming ? (
          <>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {many
                ? <>Move these <strong>{slabs.length} slabs</strong> in <strong>{temple}</strong> to a new place. Tap a field to pick a value already used here, or type a new one.</>
                : <>Change where this slab sits in <strong>{temple}</strong>. Tap a field to pick a value already used here, or type a new one.</>}
            </div>

            <ComboField label="Category 1 (area / floor)" value={section} onChange={setSection} options={cats.cat1} placeholder="e.g. FLOOR-1" upper />
            <ComboField label="Category 2 (sub-area, optional)" value={element} onChange={setElement} options={cats.cat2} placeholder="e.g. CLOISTER" upper />
            <ComboField label="Label" value={label} onChange={setLabel} options={cats.labels} placeholder="e.g. PILLAR" upper />
            <ComboField label="Description (optional)" value={description} onChange={setDescription} options={cats.descriptions} placeholder="e.g. lotus base" />
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
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Confirm this move — {many ? <>all <strong>{slabs.length} slabs</strong> will</> : "the slab will"} appear under the new path in Temple View.</div>
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

// ── Rename a whole tree-head node (Category / Label / Description) ────
// Renames the group for EVERY slab under it; choosing an existing sibling
// name merges the two groups together.
export function RenameNodeModal({
  temple, segments, options, count, onClose, onDone,
}: {
  temple: string;
  /** Path segments below the temple — the last one is the node being renamed. */
  segments: string[];
  /** Sibling names at this level — pick one to merge, or type a new name. */
  options: string[];
  count: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const current = segments[segments.length - 1] ?? "";
  const parentPath = segments.slice(0, -1);
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState("");

  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed.toUpperCase() !== current.trim().toUpperCase();
  const merges = changed && options.some((o) => o.trim().toUpperCase() === trimmed.toUpperCase());

  async function commit() {
    if (busy || !changed) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("temple", temple);
      fd.set("segments", JSON.stringify(segments));
      fd.set("new_name", trimmed);
      const res = await renameTempleNodeAction(fd);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      setBusy(false);
      setDone(res.count || count);
      setTimeout(() => onDone(), 950);
    } catch {
      setError("Rename failed — check your connection.");
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} style={overlay}>
      <div style={{ ...dialog, maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>✏️ Rename category</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {done > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "22px 8px 8px", textAlign: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#16a34a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 900, animation: "tcZoom .25s ease" }}>✓</div>
            <div style={{ fontSize: 15.5, fontWeight: 800 }}>Renamed to “{trimmed}”</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Updated {done} slab{done === 1 ? "" : "s"}.</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
              Renaming <strong style={{ color: "var(--text)" }}>{current}</strong> changes it for all{" "}
              <strong style={{ color: "var(--text)" }}>{count} slab{count === 1 ? "" : "s"}</strong> under it in <strong>{temple}</strong>.
              {parentPath.length > 0 && (
                <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>in {parentPath.join("  ›  ")}</div>
              )}
            </div>

            <ComboField label="New name" value={name} onChange={setName} options={options} placeholder="Type a new name, or pick one to merge into" />

            {merges && (
              <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", background: "rgba(180,83,9,0.1)", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 9, padding: "8px 11px" }}>
                ⚠ “{trimmed}” already exists here — these {count} slab{count === 1 ? "" : "s"} will be <strong>merged</strong> into it.
              </div>
            )}

            {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose} className="ghost-button">Cancel</button>
              <button type="button" disabled={!changed || busy} onClick={commit} style={primaryBtn(changed && !busy)}>
                {busy ? "Renaming…" : merges ? "✓ Merge" : "✓ Rename"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Manage photos on the current node (view · remove · add) ──────────
export function NodeImageUploader({
  temple, nodePath, nodeLabel, images, onClose, onChanged,
}: {
  temple: string;
  nodePath: string;
  nodeLabel: string;
  images: ComponentImage[];
  onClose: () => void;
  /** Refresh the page data but KEEP this modal open. */
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose an image first."); return; }
    setBusy(true);
    setError("");
    setOkMsg("");
    try {
      const fd = new FormData();
      fd.set("temple", temple);
      fd.set("node_path", nodePath);
      fd.set("node_label", nodeLabel);
      fd.set("caption", caption);
      fd.set("image", file);
      const res = await addTempleComponentImageAction(fd);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      // Keep the modal open so they see it land and can add/remove more.
      setBusy(false);
      setFileName("");
      setCaption("");
      if (fileRef.current) fileRef.current.value = "";
      setOkMsg("✓ Photo added");
      onChanged();
    } catch {
      setError("Upload failed — check your connection.");
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (removingId) return;
    if (!confirm("Remove this photo? This permanently deletes it.")) return;
    setRemovingId(id);
    setError("");
    setOkMsg("");
    try {
      const fd = new FormData();
      fd.set("id", id);
      await deleteTempleComponentImageAction(fd);
      setOkMsg("✓ Photo removed");
      onChanged();
    } catch {
      setError("Remove failed — check your connection.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy && !removingId) onClose(); }} style={overlay}>
      <div style={{ ...dialog, maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>📷 Photos</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          On <strong style={{ color: "var(--text)" }}>{nodeLabel}</strong>
          <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8, wordBreak: "break-word" }}>{nodePath.split("/").slice(1).join("  ›  ")}</div>
        </div>

        {/* Current photos — each with a Remove button. */}
        {images.length > 0 && (
          <div>
            <span style={lbl}>Current photos ({images.length})</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {images.map((img) => (
                <div key={img.id} style={{ position: "relative", width: 96, height: 96, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", background: "#0f172a" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.caption ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: removingId === img.id ? 0.4 : 1 }} />
                  <button
                    type="button"
                    title="Remove this photo"
                    disabled={!!removingId}
                    onClick={() => remove(img.id)}
                    style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 999, border: "none", background: "rgba(220,38,38,0.92)", color: "#fff", fontSize: 13, fontWeight: 900, cursor: removingId ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                  >
                    {removingId === img.id ? "…" : "🗑"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add a new photo. */}
        <div style={{ borderTop: images.length > 0 ? "1px solid var(--border)" : "none", paddingTop: images.length > 0 ? 12 : 0 }}>
          <span style={lbl}>Add a photo</span>
          <button type="button" onClick={() => fileRef.current?.click()} style={{ ...inp, textAlign: "left", cursor: "pointer", color: fileName ? "var(--text)" : "var(--muted)" }}>
            {fileName || "Choose an image (JPG/PNG, max 8 MB)…"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ""); setError(""); setOkMsg(""); }} />
        </div>
        <label><span style={lbl}>Caption (optional)</span>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. carved pillar reference" style={inp} />
        </label>

        {okMsg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>{okMsg}</div>}
        {error && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" disabled={busy || !!removingId} onClick={onClose} className="ghost-button">Done</button>
          <button type="button" disabled={busy || !fileName} onClick={submit} style={primaryBtn(!busy && !!fileName)}>{busy ? "Uploading…" : "✓ Add photo"}</button>
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
