"use client";

// ──────────────────────────────────────────────────────────────────
// Mig 086 — Move stock between warehouse yards.
// ──────────────────────────────────────────────────────────────────
// A simple single-component re-shuffle: pick a component, the yard it's
// in now (From), the yard it's going to (To), and how many. The
// available qty for the chosen component+From-yard is shown live so the
// storekeeper can't move more than that yard holds.
// ──────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ComponentIcon } from "./component-icon";
import { INV_THEME, primaryButton } from "./theme";
import { moveBetweenYardsAction } from "../actions";

type YardLite = { id: string; code: string; name: string };
type ComponentLite = {
  id: string;
  name: string;
  component_type: string;
  size_spec: string | null;
  unit: string;
  image_data_url?: string | null;
};
type StockLookup = Record<string, { onHand: number; pendingOut: number }>;

export function MoveYardForm({
  components,
  yards,
  yardStockLookup,
}: {
  components: ComponentLite[];
  yards: YardLite[];
  yardStockLookup: StockLookup; // key = `${componentId}::${yardId}`
}) {
  const router = useRouter();
  const [componentId, setComponentId] = useState<string>(components[0]?.id ?? "");
  const [fromYardId, setFromYardId] = useState<string>(yards[0]?.id ?? "");
  const [toYardId, setToYardId] = useState<string>(yards[1]?.id ?? yards[0]?.id ?? "");
  const [qty, setQty] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const component = components.find((c) => c.id === componentId) ?? null;

  const available = useMemo(() => {
    if (!componentId || !fromYardId) return 0;
    const e = yardStockLookup[`${componentId}::${fromYardId}`];
    if (!e) return 0;
    return Math.max(0, e.onHand - e.pendingOut);
  }, [componentId, fromYardId, yardStockLookup]);

  async function onSubmit() {
    setError(null);
    const n = Number(qty);
    if (!componentId) return setError("Pick a component.");
    if (!fromYardId || !toYardId) return setError("Pick both yards.");
    if (fromYardId === toYardId) return setError("From and To yards must be different.");
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return setError("Quantity must be a whole number greater than zero.");
    }
    if (n > available) {
      return setError(`The From yard only has ${available} available.`);
    }

    const fd = new FormData();
    fd.append("component_id", componentId);
    fd.append("from_yard_id", fromYardId);
    fd.append("to_yard_id", toYardId);
    fd.append("qty", String(n));

    setSubmitting(true);
    try {
      const res = await moveBetweenYardsAction(fd);
      if (!res.ok) {
        setError(res.error);
        setSubmitting(false);
        return;
      }
      router.push("/inventory/scaffolding?moved=1");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const selectStyle = {
    width: "100%",
    padding: "9px 11px",
    fontSize: 13,
    fontWeight: 600,
    border: `1px solid ${INV_THEME.parchment}`,
    borderRadius: 8,
    background: INV_THEME.cream,
    color: INV_THEME.steel,
  } as const;

  const labelStyle = {
    fontSize: 11,
    fontWeight: 800,
    color: INV_THEME.steel,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 5,
    display: "block",
  };

  if (yards.length < 2) {
    return (
      <div
        style={{
          background: INV_THEME.paper,
          border: `1px dashed ${INV_THEME.parchment}`,
          borderRadius: 12,
          padding: 28,
          textAlign: "center",
          color: INV_THEME.steelLight,
          fontSize: 13,
        }}
      >
        You need at least two yards to move stock between them.
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 520,
        background: INV_THEME.paper,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 12,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Component */}
      <div>
        <label style={labelStyle}>Component</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {component && (
            <ComponentIcon
              type={component.component_type as never}
              size={34}
              imageDataUrl={component.image_data_url ?? undefined}
            />
          )}
          <select
            value={componentId}
            onChange={(e) => {
              setComponentId(e.target.value);
              setQty("");
            }}
            style={selectStyle}
          >
            {components.length === 0 && <option value="">No components</option>}
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.size_spec ? ` · ${c.size_spec}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* From → To yards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "end" }}>
        <div>
          <label style={labelStyle}>From yard</label>
          <select
            value={fromYardId}
            onChange={(e) => {
              setFromYardId(e.target.value);
              setQty("");
            }}
            style={selectStyle}
          >
            {yards.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name} · {y.code}
              </option>
            ))}
          </select>
        </div>
        <div style={{ paddingBottom: 9, fontSize: 18, color: INV_THEME.steelLight }}>→</div>
        <div>
          <label style={labelStyle}>To yard</label>
          <select
            value={toYardId}
            onChange={(e) => setToYardId(e.target.value)}
            style={selectStyle}
          >
            {yards.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name} · {y.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Available in From yard */}
      <div style={{ fontSize: 12, color: INV_THEME.steelLight }}>
        Available in From yard:{" "}
        <strong style={{ color: available > 0 ? INV_THEME.steel : INV_THEME.stockOut }}>
          {available.toLocaleString("en-IN")} {component?.unit ?? ""}
        </strong>
      </div>

      {/* Qty */}
      <div>
        <label style={labelStyle}>Quantity to move</label>
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          pattern="[0-9]*"
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="e.g. 20"
          style={{
            width: 160,
            padding: "9px 11px",
            fontSize: 15,
            fontWeight: 700,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 8,
            background: "#fff",
            color: INV_THEME.steel,
            fontFeatureSettings: '"tnum"',
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            background: "rgba(193, 68, 46, 0.1)",
            color: INV_THEME.stockOut,
            fontSize: 12,
            fontWeight: 600,
            border: `1px solid ${INV_THEME.stockOut}`,
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        style={{
          ...primaryButton,
          justifyContent: "center",
          width: "100%",
          opacity: submitting ? 0.6 : 1,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Moving…" : "⇄ Move stock"}
      </button>
      <div style={{ fontSize: 11, color: INV_THEME.steelLight, textAlign: "center" }}>
        Internal warehouse move — applied immediately, no approval needed.
      </div>
    </div>
  );
}
