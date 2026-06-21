"use client";

import { useState, useRef, useEffect } from "react";
import { createInstallContractAction } from "./actions";

type Opt = { value: string; label: string };

const inp: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
};
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4, display: "block" };

// Themed dropdown (app UI, not the browser's native <select> chrome).
function Dropdown({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const sel = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...inp, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left", minHeight: 42 }}
      >
        <span style={{ flex: 1, color: sel ? "var(--text)" : "var(--muted)", fontWeight: sel ? 700 : 400 }}>
          {sel ? sel.label : placeholder}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 60,
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            padding: 4,
          }}
        >
          {options.length === 0 && (
            <div className="muted" style={{ fontSize: 13, padding: "8px 10px" }}>No options.</div>
          )}
          {options.map((o) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.value);
                setOpen(false);
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
                color: "var(--text)",
                background: o.value === value ? "var(--gold-soft, rgba(232,197,114,0.18))" : "transparent",
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const UNIT_OPTS: Opt[] = [
  { value: "cft", label: "per CFT" },
  { value: "sft", label: "per SFT" },
  { value: "installation", label: "per installation" },
  { value: "piece", label: "per piece" },
  { value: "lump", label: "Lump sum (total)" },
];

export function ContractForm({
  vendors,
  sites,
  today,
}: {
  vendors: { id: string; name: string }[];
  sites: { id: string; project_name: string; location: string | null }[];
  today: string;
}) {
  const [vendorId, setVendorId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [unit, setUnit] = useState("cft");

  const vendorOpts: Opt[] = vendors.map((v) => ({ value: v.id, label: v.name }));
  const siteOpts: Opt[] = sites.map((s) => ({ value: s.id, label: s.project_name + (s.location ? ` — ${s.location}` : "") }));
  const ready = !!vendorId && !!siteId;

  return (
    <form action={createInstallContractAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="install_vendor_id" value={vendorId} />
      <input type="hidden" name="install_site_id" value={siteId} />
      <input type="hidden" name="price_unit" value={unit} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <label style={lbl}>Contractor / Vendor</label>
          <Dropdown value={vendorId} onChange={setVendorId} options={vendorOpts} placeholder="Select vendor…" />
        </div>
        <div style={{ flex: "1 1 240px" }}>
          <label style={lbl}>Project / Temple site</label>
          <Dropdown value={siteId} onChange={setSiteId} options={siteOpts} placeholder="Select site…" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px" }}>
          <label style={lbl}>Rate / price (₹)</label>
          <input name="price" type="number" min="1" step="0.01" required placeholder="e.g. 300" style={inp} />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label style={lbl}>Per</label>
          <Dropdown value={unit} onChange={setUnit} options={UNIT_OPTS} placeholder="per CFT" />
        </div>
        <div style={{ flex: "1 1 150px" }}>
          <label style={lbl}>Contract date</label>
          <input name="doc_date" type="date" defaultValue={today} style={inp} />
        </div>
      </div>
      <div>
        <label style={lbl}>Extra scope note (optional)</label>
        <textarea name="scope_note" rows={2} placeholder="Any specific work detail to add to the Scope of Work clause." style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
      </div>
      <button
        type="submit"
        className="primary-button"
        disabled={!ready}
        style={{ alignSelf: "flex-start", fontSize: 15, padding: "11px 22px", fontWeight: 700, opacity: ready ? 1 : 0.5, cursor: ready ? "pointer" : "not-allowed" }}
      >
        📜 Issue contract
      </button>
    </form>
  );
}
