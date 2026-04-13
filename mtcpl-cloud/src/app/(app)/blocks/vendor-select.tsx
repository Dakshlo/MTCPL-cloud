"use client";

import { useState, useTransition } from "react";
import { addBlockVendorAction } from "./actions";

export function VendorSelect({
  vendors: initialVendors,
  defaultValue,
  name = "vendor_name",
}: {
  vendors: string[];
  defaultValue?: string | null;
  name?: string;
}) {
  const [vendorList, setVendorList] = useState<string[]>(initialVendors);
  const [selected, setSelected] = useState(defaultValue ?? "");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleChange(val: string) {
    if (val === "__new__") {
      setShowAdd(true);
    } else {
      setSelected(val);
      setShowAdd(false);
    }
  }

  function handleAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await addBlockVendorAction(newName.trim());
      if (result?.error) {
        setAddError(result.error);
      } else {
        const sorted = [...vendorList, newName.trim()].sort((a, b) =>
          a.localeCompare(b)
        );
        setVendorList(sorted);
        setSelected(newName.trim());
        setNewName("");
        setShowAdd(false);
        setAddError("");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* hidden input carries the value into the parent form */}
      <input type="hidden" name={name} value={selected} />
      <select
        value={showAdd ? "__new__" : selected}
        onChange={e => handleChange(e.target.value)}
      >
        <option value="">— Select vendor —</option>
        {vendorList.map(v => (
          <option key={v} value={v}>{v}</option>
        ))}
        <option value="__new__">＋ Add new vendor…</option>
      </select>

      {showAdd && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={newName}
            onChange={e => { setNewName(e.target.value); setAddError(""); }}
            placeholder="e.g. YK Stone"
            style={{ flex: 1, fontSize: 13 }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
              if (e.key === "Escape") { setShowAdd(false); setNewName(""); }
            }}
            autoFocus
          />
          <button
            type="button"
            className="secondary-button"
            onClick={handleAdd}
            disabled={isPending || !newName.trim()}
            style={{ whiteSpace: "nowrap", fontSize: 12, padding: "5px 10px" }}
          >
            {isPending ? "…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => { setShowAdd(false); setNewName(""); setAddError(""); }}
            style={{ fontSize: 14, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}
      {addError && (
        <span style={{ fontSize: 11, color: "var(--danger)" }}>{addError}</span>
      )}
    </div>
  );
}
