"use client";

/**
 * System-styled combobox — free text + a filtered suggestion dropdown rendered
 * in OUR UI (not the browser <datalist>). Renders a submittable <input name> so
 * it works inside a plain <form action> as well as controlled forms (Daksh).
 */

import { useMemo, useState } from "react";

export function Combobox({
  value, onChange, options, name, placeholder, inputStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  name?: string;
  placeholder?: string;
  inputStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    return (q ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, 50);
  }, [value, options]);

  return (
    <div style={{ position: "relative" }}>
      <input
        name={name}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        autoComplete="off"
        placeholder={placeholder}
        style={{ width: "100%", ...inputStyle }}
      />
      {open && matches.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 40, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, boxShadow: "0 12px 34px rgba(0,0,0,0.18)", maxHeight: 240, overflowY: "auto" }}>
          {matches.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 13, background: o === value ? "rgba(184,115,51,0.12)" : "transparent", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--text)" }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Common heads for classifying non-temple / custom sales. */
export const CATEGORY_HINTS = ["Maintenance & repair", "Stone wastage", "Scrap sale", "Machinery / spares", "Consumables", "Other"];
