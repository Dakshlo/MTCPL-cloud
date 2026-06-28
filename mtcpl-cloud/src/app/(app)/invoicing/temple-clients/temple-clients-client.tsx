"use client";

/**
 * Client billing editor (Mig 158 → 165). One ACCORDION row per temple: collapsed
 * shows the name + code + a "filled" dot; expand to edit a full BILLING block and
 * a SHIPPING block (each Name / Address / City / State / State code / GSTIN / PAN
 * / Phone / Email) plus Vendor code + Work order no. Each field saves on blur.
 * Shipping left blank ⇒ the invoice uses the billing address. Accountants can
 * also rename the temple here (cascades everywhere via rename_temple).
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTempleBillingAction, renameTempleClientAction } from "../actions";
import {
  BILLING_FIELDS, SHIPPING_FIELDS, SHARED_FIELDS, ALL_FIELDS,
  type Field, type FieldMeta, type TempleRow,
} from "./fields";

export type { TempleRow } from "./fields";

type Status = { state: "idle" | "saving" | "saved" | "error"; msg?: string };

const inp: React.CSSProperties = { padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", width: "100%" };
const groupTitle: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--gold-dark)", margin: "4px 0 6px" };

function pick(t: TempleRow): Record<Field, string> {
  const o = {} as Record<Field, string>;
  for (const k of ALL_FIELDS) o[k] = t[k] ?? "";
  return o;
}

export function TempleClientsClient({ temples }: { temples: TempleRow[] }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, Record<Field, string>>>(() =>
    Object.fromEntries(temples.map((t) => [t.id, pick(t)])),
  );
  const [saved, setSaved] = useState<Record<string, Record<Field, string>>>(() => JSON.parse(JSON.stringify(vals)));
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [renameVal, setRenameVal] = useState<Record<string, string>>(() => Object.fromEntries(temples.map((t) => [t.id, t.name])));
  const [renameBusy, setRenameBusy] = useState<string | null>(null);
  const [renameErr, setRenameErr] = useState<Record<string, string | null>>({});
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return temples;
    return temples.filter((t) => t.name.toLowerCase().includes(q) || t.code_prefix.toLowerCase().includes(q));
  }, [temples, query]);

  const isFilled = (id: string) => Object.values(vals[id] ?? {}).some((v) => (v ?? "").trim());
  const filledCount = useMemo(() => temples.filter((t) => isFilled(t.id)).length, [temples, vals]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleOpen(id: string) {
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function setField(templeId: string, field: Field, value: string) {
    setVals((m) => ({ ...m, [templeId]: { ...m[templeId], [field]: value } }));
  }
  function saveField(templeId: string, field: Field) {
    const cur = vals[templeId]?.[field] ?? "";
    if (cur === (saved[templeId]?.[field] ?? "")) return;
    setStatus((s) => ({ ...s, [templeId]: { state: "saving" } }));
    const fd = new FormData();
    fd.set("temple_id", templeId);
    fd.set(field, cur);
    startTransition(async () => {
      const res = await setTempleBillingAction(fd);
      if (res.ok) {
        setSaved((m) => ({ ...m, [templeId]: { ...m[templeId], [field]: cur } }));
        setStatus((s) => ({ ...s, [templeId]: { state: "saved" } }));
      } else {
        setStatus((s) => ({ ...s, [templeId]: { state: "error", msg: res.error } }));
      }
    });
  }
  function doRename(t: TempleRow) {
    const name = (renameVal[t.id] ?? "").trim();
    if (!name || name === t.name) return;
    setRenameBusy(t.id); setRenameErr((e) => ({ ...e, [t.id]: null }));
    startTransition(async () => {
      const res = await renameTempleClientAction(t.id, name);
      setRenameBusy(null);
      if (res.ok) router.refresh();
      else setRenameErr((e) => ({ ...e, [t.id]: res.error }));
    });
  }

  // Inline (not a sub-component) so editable inputs keep focus — see the
  // nested-component focus gotcha.
  function fieldGrid(t: TempleRow, list: readonly FieldMeta[]) {
    const v = vals[t.id];
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 9 }}>
        {list.map((f) => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3, gridColumn: f.wide ? "1 / -1" : undefined }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>{f.label}</span>
            <input
              value={v?.[f.key as Field] ?? ""}
              onChange={(e) => setField(t.id, f.key as Field, e.target.value)}
              onBlur={() => saveField(t.id, f.key as Field)}
              placeholder={f.key === "bill_address" && t.site_location ? `e.g. ${t.site_location}` : ""}
              style={inp}
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Search temple or code…" style={{ ...inp, flex: "1 1 260px", maxWidth: 360 }} />
        <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
          {filledCount} of {temples.length} temple{temples.length === 1 ? "" : "s"} with billing details
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((t) => {
          const st = status[t.id]?.state ?? "idle";
          const expanded = open.has(t.id);
          return (
            <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", opacity: t.is_active ? 1 : 0.6, overflow: "hidden" }}>
              {/* Collapsed header — click to expand */}
              <button
                type="button"
                onClick={() => toggleOpen(t.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}
              >
                <span style={{ color: "var(--muted)", fontSize: 12, width: 12 }}>{expanded ? "▾" : "▸"}</span>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: isFilled(t.id) ? "#15803d" : "var(--border)", flexShrink: 0 }} title={isFilled(t.id) ? "Has billing details" : "No billing details yet"} />
                <span style={{ fontWeight: 800, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🛕 {t.name}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--muted)" }}>{t.code_prefix}</span>
                {!t.is_active && <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>inactive</span>}
                <span style={{ marginLeft: "auto", fontSize: 12, minWidth: 60, textAlign: "right" }}>
                  {st === "saving" && <span style={{ color: "var(--muted)" }}>Saving…</span>}
                  {st === "saved" && <span style={{ fontWeight: 700, color: "#15803d" }}>✓ Saved</span>}
                  {st === "error" && <span style={{ fontWeight: 700, color: "#991b1b" }} title={status[t.id]?.msg}>✕ Failed</span>}
                </span>
              </button>

              {expanded && (
                <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Rename */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBottom: 10, borderBottom: "1px solid var(--border-light)" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>Temple name</span>
                    <input value={renameVal[t.id] ?? ""} onChange={(e) => setRenameVal((m) => ({ ...m, [t.id]: e.target.value }))} style={{ ...inp, width: 280, maxWidth: "60%" }} />
                    <button type="button" disabled={renameBusy === t.id || (renameVal[t.id] ?? "").trim() === t.name} onClick={() => doRename(t)} style={{ fontSize: 12, fontWeight: 800, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--gold-dark)", background: "var(--gold)", color: "#fff", cursor: "pointer", opacity: renameBusy === t.id || (renameVal[t.id] ?? "").trim() === t.name ? 0.6 : 1 }}>
                      {renameBusy === t.id ? "Renaming…" : "Rename"}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>code <code style={{ fontFamily: "ui-monospace, monospace" }}>{t.code_prefix}</code> stays locked</span>
                    {renameErr[t.id] && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#991b1b" }}>{renameErr[t.id]}</span>}
                  </div>

                  {/* Billing + Shipping side by side on wide screens */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                    <div>
                      <div style={groupTitle}>Billing address</div>
                      {fieldGrid(t, BILLING_FIELDS)}
                    </div>
                    <div>
                      <div style={groupTitle}>Shipping address <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: "var(--muted)" }}>· blank = same as billing</span></div>
                      {fieldGrid(t, SHIPPING_FIELDS)}
                    </div>
                  </div>

                  <div>
                    <div style={groupTitle}>Optional · shown on the invoice when filled</div>
                    {fieldGrid(t, SHARED_FIELDS)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 10px", fontSize: 13 }}>No temples match “{query}”.</div>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", margin: "2px 2px 0", lineHeight: 1.6 }}>
        These print on the tax invoice (Bill To + Ship To). Leave Shipping blank to reuse the billing address. Vendor code and Work order no appear only when filled.
      </p>
    </div>
  );
}
