"use client";

// System-wide tablet keyboard (Daksh, Jun 2026).
//
// On the floor tablets the browser's keyboard is painful for slab codes
// (OM-0037) and dimensions (53x29x14 / 25.5). This replaces it EVERYWHERE
// with one purpose-built pad — QWERTY letters on the left, digits + . + X on
// the right, and quick temple-code chips (most-used first). It runs ONLY on
// touch-primary devices ((pointer: coarse) → never laptops/desktops).
//
// Architecture: a single <TabletKeyboardProvider/> mounted once in the app
// shell attaches to ANY focused text input / textarea. It sets inputMode="none"
// on eligible fields so the native keyboard never appears, and writes keystrokes
// back through the native value setter + an input event so React's onChange fires.
//
// Opt a field out with data-kbd="off" (or wrap a region in [data-kbd-off]).
// Number/email/tel/date/password inputs keep their native keypads automatically.
// Give a field temple-code chips with data-temple-codes="OM,UMIA,SOMN".

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const USAGE_KEY = "mtcpl:tablet-temple-code-usage";

const QWERTY: string[][] = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

type Field = HTMLInputElement | HTMLTextAreaElement;

function eligible(el: Element | null): el is Field {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") {
    const t = el as HTMLTextAreaElement;
    return !t.readOnly && !t.disabled && t.dataset.kbd !== "off" && !el.closest("[data-kbd-off]");
  }
  if (el.tagName !== "INPUT") return false;
  const inp = el as HTMLInputElement;
  if (inp.readOnly || inp.disabled) return false;
  if (inp.dataset.kbd === "off" || el.closest("[data-kbd-off]")) return false;
  const type = (inp.getAttribute("type") || "text").toLowerCase();
  if (type !== "text" && type !== "search") return false; // leave number/tel/email/date/etc. native
  const im = (inp.getAttribute("inputmode") || "").toLowerCase();
  if (im === "numeric" || im === "decimal" || im === "tel" || im === "email" || im === "url") return false;
  return true;
}

function setNativeValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function TabletKeyboardProvider({ templeCodes = [] }: { templeCodes?: string[] }) {
  const [isTablet, setIsTablet] = useState(false);
  const [active, setActive] = useState<Field | null>(null);
  const [fieldCodes, setFieldCodes] = useState<string[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      setIsTablet(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      /* desktop */
    }
    try {
      const raw = window.localStorage.getItem(USAGE_KEY);
      if (raw) setUsage(JSON.parse(raw) as Record<string, number>);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isTablet) return;
    const markEligible = (root: ParentNode) => {
      try {
        root.querySelectorAll?.("input, textarea").forEach((n) => {
          if (eligible(n)) (n as Element).setAttribute("inputmode", "none");
        });
      } catch {
        /* ignore */
      }
    };
    markEligible(document);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) {
            const el = n as Element;
            if (eligible(el)) el.setAttribute("inputmode", "none");
            markEligible(el);
          }
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element;
      if (!eligible(el)) return;
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      el.setAttribute("inputmode", "none");
      const dc = (el.getAttribute("data-temple-codes") || "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      setFieldCodes(dc);
      setActive(el as Field);
    };
    const onFocusOut = () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        if (!eligible(document.activeElement)) setActive(null);
      }, 120);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      mo.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [isTablet]);

  const bump = (code: string) =>
    setUsage((prev) => {
      const next = { ...prev, [code]: (prev[code] ?? 0) + 1 };
      try {
        window.localStorage.setItem(USAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  // Daksh — every active temple's code, so the quick chips show on EVERY
  // field the keyboard attaches to (not just the few with data-temple-codes).
  const globalCodes = useMemo(
    () => [...new Set(templeCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))],
    [templeCodes],
  );
  // Chips: every temple's code + this field's codes + the user's learned
  // codes, most-used first.
  const chips = useMemo(() => {
    const set = new Set<string>([...globalCodes, ...fieldCodes]);
    for (const k of Object.keys(usage)) set.add(k);
    return [...set]
      .sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0) || a.localeCompare(b))
      .slice(0, 18);
  }, [globalCodes, fieldCodes, usage]);

  const refocus = () => active?.focus({ preventScroll: true });
  const insert = (txt: string) => {
    const el = active;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setNativeValue(el, el.value.slice(0, start) + txt + el.value.slice(end));
    const caret = start + txt.length;
    refocus();
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* some inputs disallow selection range */
    }
  };
  const backspace = () => {
    const el = active;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (start === 0 && end === 0) return;
    let caret = start;
    if (start !== end) {
      setNativeValue(el, el.value.slice(0, start) + el.value.slice(end));
    } else {
      setNativeValue(el, el.value.slice(0, start - 1) + el.value.slice(end));
      caret = start - 1;
    }
    refocus();
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* ignore */
    }
  };
  const clearAll = () => {
    const el = active;
    if (!el) return;
    setNativeValue(el, "");
    refocus();
  };
  const hide = () => {
    active?.blur();
    setActive(null);
  };

  if (!isTablet || !active) return null;

  return (
    // data-tablet-keyboard — lets dropdowns/modals with outside-click-close
    // (e.g. Find ID) ignore taps on this keyboard so they don't dismiss.
    <div data-tablet-keyboard="1" onMouseDown={(e) => e.preventDefault()} style={panel}>
      {/* Temple-code chips */}
      {chips.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
            Temple
          </span>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1, paddingBottom: 2 }}>
            {chips.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  insert(`${code}-`);
                  bump(code);
                }}
                style={chip}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        {/* Left — QWERTY */}
        <div style={{ flex: "1.7 1 0", display: "flex", flexDirection: "column", gap: 6 }}>
          {QWERTY.map((row, ri) => (
            <div key={ri} style={{ display: "flex", gap: 6, paddingInline: ri === 1 ? "3%" : ri === 2 ? "9%" : 0 }}>
              {row.map((ch) => (
                <button key={ch} type="button" onClick={() => insert(ch)} style={key}>
                  {ch}
                </button>
              ))}
            </div>
          ))}
          <button type="button" onClick={() => insert(" ")} style={{ ...key, fontSize: 13, fontWeight: 700 }}>
            space
          </button>
        </div>

        {/* Right — digits 1–0 + . + X */}
        <div style={{ flex: "1 1 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {DIGITS.map((d) => (
            <button key={d} type="button" onClick={() => insert(d)} style={keyNum}>
              {d}
            </button>
          ))}
          <button type="button" onClick={() => insert(".")} style={keyNum}>
            .
          </button>
          <button type="button" onClick={() => insert("0")} style={keyNum}>
            0
          </button>
          {/* - for codes like OM-0037 */}
          <button type="button" onClick={() => insert("-")} style={keyNum}>
            -
          </button>
          <button type="button" onClick={() => insert("x")} style={{ ...keyNum, color: "#1d4ed8" }}>
            X
          </button>
          <button type="button" onClick={backspace} style={{ ...keyNum, color: "#b45309" }}>
            ⌫
          </button>
          <button type="button" onClick={clearAll} style={ctrl}>
            Clear
          </button>
          <button type="button" onClick={hide} style={{ ...ctrl, gridColumn: "span 3" }}>
            ⌄ Hide
          </button>
        </div>
      </div>
    </div>
  );
}

// Back-compat thin wrapper: a plain controlled input that advertises its temple
// codes to the global keyboard. Existing call sites keep working.
export function TabletSearchInput({
  value,
  onChange,
  placeholder,
  templeCodes,
  inputStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  templeCodes: string[];
  inputStyle?: CSSProperties;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-temple-codes={templeCodes.join(",")}
      style={{ width: "100%", ...inputStyle }}
    />
  );
}

const panel: CSSProperties = {
  position: "fixed",
  left: "var(--content-left, 0)",
  right: 0,
  bottom: 0,
  zIndex: 9000,
  background: "var(--surface)",
  borderTop: "1px solid var(--border)",
  boxShadow: "0 -8px 24px rgba(0,0,0,0.18)",
  padding: "10px 14px max(10px, env(safe-area-inset-bottom))",
};
const key: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 46,
  fontSize: 18,
  fontWeight: 700,
  border: "1px solid var(--border)",
  borderRadius: 9,
  background: "var(--bg)",
  color: "var(--text)",
  cursor: "pointer",
};
const keyNum: CSSProperties = { ...key, flex: undefined, fontFamily: "ui-monospace, monospace", fontSize: 20 };
const chip: CSSProperties = {
  flexShrink: 0,
  minHeight: 36,
  padding: "0 14px",
  fontSize: 14,
  fontWeight: 800,
  fontFamily: "ui-monospace, monospace",
  border: "1.5px solid #92400e",
  borderRadius: 999,
  background: "rgba(146,64,14,0.08)",
  color: "#92400e",
  cursor: "pointer",
};
const ctrl: CSSProperties = {
  minHeight: 44,
  fontSize: 13,
  fontWeight: 800,
  border: "1px solid var(--border)",
  borderRadius: 9,
  background: "var(--surface)",
  color: "var(--muted)",
  cursor: "pointer",
};
