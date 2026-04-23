"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  // Separate error for "you typed a new vendor but didn't click Create"
  // so it doesn't collide with DB-side addError.
  const [submitBlockError, setSubmitBlockError] = useState("");
  const [isPending, startTransition] = useTransition();
  const hiddenRef = useRef<HTMLInputElement>(null);

  function handleChange(val: string) {
    if (val === "__new__") {
      setShowAdd(true);
    } else {
      setSelected(val);
      setShowAdd(false);
    }
    setSubmitBlockError("");
  }

  function handleAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await addBlockVendorAction(newName.trim());
      if ("error" in result) {
        setAddError(result.error);
      } else {
        // Server may return a canonical name — when the typed input
        // case/space-insensitively matches an existing vendor, we
        // silently reuse the existing row. Otherwise it echoes the
        // trimmed input back.
        const canonical = result.canonicalName;
        const sorted = vendorList.includes(canonical)
          ? [...vendorList].sort((a, b) => a.localeCompare(b))
          : [...vendorList, canonical].sort((a, b) => a.localeCompare(b));
        setVendorList(sorted);
        setSelected(canonical);
        setNewName("");
        setShowAdd(false);
        setAddError("");
        setSubmitBlockError("");
      }
    });
  }

  // Parent-form submit guard: if the user opened "Add new vendor",
  // typed a name, and then clicked the outer form's submit WITHOUT
  // pressing Create, the typed name is lost and the block saves with
  // vendor_name=NULL. Intercept the form's submit in capture phase,
  // block it, and surface an inline prompt to press Create first.
  // If the name is empty (user clicked "+ Add" then reconsidered),
  // silently collapse the sub-form and let submission proceed.
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      if (showAdd && newName.trim() !== "") {
        e.preventDefault();
        e.stopPropagation();
        setSubmitBlockError("Press 'Create' to save the new vendor before submitting.");
        hiddenRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (showAdd && newName.trim() === "") {
        setShowAdd(false);
      }
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [showAdd, newName]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* hidden input carries the value into the parent form; ref lets
       * us find the parent <form> element for the submit-guard hook. */}
      <input ref={hiddenRef} type="hidden" name={name} value={selected} />
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
            onChange={e => { setNewName(e.target.value); setAddError(""); setSubmitBlockError(""); }}
            placeholder="e.g. YK Stone"
            style={{ flex: 1, fontSize: 13 }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
              if (e.key === "Escape") { setShowAdd(false); setNewName(""); setSubmitBlockError(""); }
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
            onClick={() => { setShowAdd(false); setNewName(""); setAddError(""); setSubmitBlockError(""); }}
            style={{ fontSize: 14, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}
      {submitBlockError && (
        <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>
          ⚠ {submitBlockError}
        </span>
      )}
      {addError && (
        <span style={{ fontSize: 11, color: "var(--danger)" }}>{addError}</span>
      )}
    </div>
  );
}
