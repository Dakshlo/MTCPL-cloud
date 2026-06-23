"use client";

/**
 * Per-dispatch incharge override on the Check & verify page (Mig 159). Pick a
 * different incharge for THIS truck (or fall back to the temple's default); the
 * choice saves immediately and prints on the challan.
 */

import { useRef } from "react";
import { setDispatchInchargeAction } from "../../actions";

export function InchargePicker({
  dispatchId,
  options,
  overrideId,
  resolvedLabel,
}: {
  dispatchId: string;
  options: { id: string; name: string; phone: string | null }[];
  overrideId: string | null;
  resolvedLabel: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={setDispatchInchargeAction}
      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", background: "var(--surface)" }}
    >
      <input type="hidden" name="id" value={dispatchId} />
      <span style={{ fontSize: 12.5, fontWeight: 800 }}>🧑‍✈️ Dispatch incharge</span>
      <select
        name="incharge_id"
        defaultValue={overrideId ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        style={{ padding: "8px 10px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", maxWidth: 320 }}
      >
        <option value="">Use temple&apos;s default</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}{o.phone ? ` · ${o.phone}` : ""}</option>
        ))}
      </select>
      <span className="muted" style={{ fontSize: 11.5 }}>→ prints on challan: <strong style={{ color: "var(--text)" }}>{resolvedLabel}</strong></span>
    </form>
  );
}
