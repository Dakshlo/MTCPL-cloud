"use client";

/**
 * "Which tool?" — the first half of taking something.
 *
 * Opens with the search box focused and the store's most-used tools
 * already listed, so the common case is: press Take, press the tool.
 * Tools at zero are not offered at all; there is nothing to take.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { ToolRow } from "@/lib/cnc-tool-stock";
import { Sheet } from "../../sheet";

export function PickToolSheet({
  open, tools, onClose, onPick,
}: {
  open: boolean;
  tools: ToolRow[];
  onClose: () => void;
  onPick: (t: ToolRow) => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    // Focus on a desktop only. Popping the on-screen keyboard the
    // instant the sheet opens hides the very list the man is reaching
    // for, which is worse than one extra tap.
    if (window.matchMedia("(min-width: 720px)").matches) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (t) => t.name.toLowerCase().includes(needle) || (t.spec ?? "").toLowerCase().includes(needle),
    );
  }, [tools, q]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Which tool?"
      subtitle={`${tools.length} available in the store`}
    >
      <div className="tc-search" style={{ marginBottom: 14 }}>
        <span aria-hidden>🔍</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          aria-label="Search tools"
        />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear">✕</button>}
      </div>

      {tools.length === 0 ? (
        <div className="tc-empty-search">
          The store has nothing on the shelf right now. Tell the office.
        </div>
      ) : shown.length === 0 ? (
        <div className="tc-empty-search">Nothing matches “{q}”.</div>
      ) : (
        <div className="tcv-list">
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tcv-row"
              onClick={() => onPick(t)}
              style={{ width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", borderTop: "1px solid var(--border-light)" }}
            >
              <div
                className="tcv-qty"
                style={
                  t.level === "low"
                    ? { background: "var(--warning-bg)", color: "var(--warning)" }
                    : { background: "var(--success-bg)", color: "var(--success)" }
                }
              >
                {t.stock}
              </div>
              <div className="tcv-main">
                <div className="tcv-name">{t.name}</div>
                <div className="tcv-meta">
                  {t.spec ? <>{t.spec} · </> : null}
                  {t.level === "low" ? "running low" : `${t.unit} on the shelf`}
                </div>
              </div>
              <span style={{ color: "var(--muted)", fontSize: 18, flex: "0 0 auto" }} aria-hidden>›</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
