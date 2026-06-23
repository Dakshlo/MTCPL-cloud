"use client";

/**
 * Client billing editor (Mig 158). One card per temple — the temple IS the
 * client, so the name is read-only and the accountant fills the billing fields
 * (GSTIN, PAN, address, email, phone). Each field saves on blur via
 * setTempleBillingAction with a per-temple status.
 */

import { useMemo, useState, useTransition } from "react";
import { setTempleBillingAction } from "../actions";

export type TempleRow = {
  id: string;
  name: string;
  code_prefix: string;
  is_active: boolean;
  site_location: string;
  bill_gstin: string;
  bill_pan: string;
  bill_address: string;
  bill_email: string;
  bill_phone: string;
};

type Field = "bill_gstin" | "bill_pan" | "bill_address" | "bill_email" | "bill_phone";
type Status = { state: "idle" | "saving" | "saved" | "error"; msg?: string };

const FIELD_META: Array<{ key: Field; label: string; placeholder?: string; wide?: boolean }> = [
  { key: "bill_gstin", label: "GSTIN" },
  { key: "bill_pan", label: "PAN" },
  { key: "bill_phone", label: "Phone" },
  { key: "bill_email", label: "Email" },
  { key: "bill_address", label: "Billing address", wide: true },
];

const inp: React.CSSProperties = { padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", width: "100%" };

export function TempleClientsClient({ temples }: { temples: TempleRow[] }) {
  const [vals, setVals] = useState<Record<string, Record<Field, string>>>(() =>
    Object.fromEntries(
      temples.map((t) => [t.id, { bill_gstin: t.bill_gstin, bill_pan: t.bill_pan, bill_address: t.bill_address, bill_email: t.bill_email, bill_phone: t.bill_phone }]),
    ),
  );
  const [saved, setSaved] = useState<Record<string, Record<Field, string>>>(() => JSON.parse(JSON.stringify(vals)));
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return temples;
    return temples.filter((t) => t.name.toLowerCase().includes(q) || t.code_prefix.toLowerCase().includes(q));
  }, [temples, query]);

  const filledCount = useMemo(
    () => temples.filter((t) => Object.values(vals[t.id] ?? {}).some((v) => v.trim())).length,
    [temples, vals],
  );

  function setField(templeId: string, field: Field, value: string) {
    setVals((m) => ({ ...m, [templeId]: { ...m[templeId], [field]: value } }));
  }

  function saveField(templeId: string, field: Field) {
    const cur = vals[templeId]?.[field] ?? "";
    if (cur === (saved[templeId]?.[field] ?? "")) return; // unchanged
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Search temple or code…" style={{ ...inp, flex: "1 1 260px", maxWidth: 360 }} />
        <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
          {filledCount} of {temples.length} temple{temples.length === 1 ? "" : "s"} with billing details
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((t) => {
          const st = status[t.id]?.state ?? "idle";
          const v = vals[t.id] ?? { bill_gstin: "", bill_pan: "", bill_address: "", bill_email: "", bill_phone: "" };
          return (
            <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "12px 14px", opacity: t.is_active ? 1 : 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 800, fontSize: 14.5 }}>🛕 {t.name}</span>
                  <span style={{ marginLeft: 8, fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--muted)" }}>{t.code_prefix}</span>
                  {!t.is_active && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>inactive</span>}
                  <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>· client = temple name</span>
                </div>
                <div style={{ fontSize: 12, minWidth: 70, textAlign: "right" }}>
                  {st === "saving" && <span style={{ color: "var(--muted)" }}>Saving…</span>}
                  {st === "saved" && <span style={{ fontWeight: 700, color: "#15803d" }}>✓ Saved</span>}
                  {st === "error" && <span style={{ fontWeight: 700, color: "#991b1b" }} title={status[t.id]?.msg}>✕ Failed</span>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                {FIELD_META.map((f) => (
                  <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3, gridColumn: f.wide ? "1 / -1" : undefined }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>{f.label}</span>
                    <input
                      value={v[f.key]}
                      onChange={(e) => setField(t.id, f.key, e.target.value)}
                      onBlur={() => saveField(t.id, f.key)}
                      placeholder={f.key === "bill_address" && t.site_location ? `e.g. ${t.site_location}` : ""}
                      style={inp}
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 10px", fontSize: 13 }}>No temples match “{query}”.</div>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", margin: "2px 2px 0", lineHeight: 1.6 }}>
        These details print on the tax invoice. The temple name and site location come from Settings (production) — only the billing fields are edited here.
      </p>
    </div>
  );
}
