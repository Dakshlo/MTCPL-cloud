"use client";

// ──────────────────────────────────────────────────────────────────
// Migration 041 — Movement form (shopping-cart style)
// ──────────────────────────────────────────────────────────────────
// Shared client island used by issue / return / receive / writeoff.
// Left pane: live catalog of components (with available qty for the
// chosen source location, when applicable). Right pane: the "cart"
// of selected components with qty steppers and per-line notes.
// Submit posts to proposeMovementAction.
//
// State is local. No useEffect, no fetch — every refresh is a fresh
// server render, which keeps the available-qty number trustworthy.
// ──────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ComponentIcon, labelForComponentType } from "./component-icon";
import { INV_THEME, primaryButton, secondaryButton } from "./theme";
import { proposeMovementAction } from "../actions";

export type MovementMode = "issue" | "return" | "receive" | "writeoff";

type SiteLite = {
  id: string;
  code: string;
  name: string;
  is_plant: boolean;
  is_active: boolean;
};

type ComponentLite = {
  id: string;
  name: string;
  component_type: string;
  size_spec: string | null;
  unit: string;
  display_order: number;
  // Mig 044 — optional uploaded PNG (data URL). When present, the
  // catalog tile + cart row render the real image instead of the
  // SVG fallback.
  image_data_url?: string | null;
};

type StockEntry = { onHand: number; pendingOut: number };

type StockLookup = Record<string, StockEntry>; // key = `${componentId}::${siteId}`

type CartItem = {
  component_id: string;
  qty: string; // string so blank field is editable; converted on submit
  note: string;
};

export function MovementForm({
  mode,
  sites,
  components,
  stockLookup,
  plantId,
  defaultSiteId,
}: {
  mode: MovementMode;
  sites: SiteLite[];
  components: ComponentLite[];
  stockLookup: StockLookup;
  plantId: string;
  defaultSiteId?: string;
}) {
  const router = useRouter();

  // Which project site is selected (for issue/return/writeoff). For
  // receive, no project site is needed — the form locks to plant.
  const siteOptions = useMemo(() => {
    if (mode === "issue" || mode === "return") {
      // Project sites only — exclude the plant.
      return sites.filter((s) => !s.is_plant && s.is_active);
    }
    if (mode === "writeoff") {
      // Allow writeoff from any site, including the plant.
      return sites.filter((s) => s.is_active);
    }
    return [];
  }, [mode, sites]);

  const [siteId, setSiteId] = useState<string>(
    defaultSiteId && siteOptions.some((s) => s.id === defaultSiteId)
      ? defaultSiteId
      : siteOptions[0]?.id ?? "",
  );
  const [batchNote, setBatchNote] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which site's stock is shown in the left pane?
  //   issue    : plant (source of stock)
  //   return   : project site (source of stock)
  //   receive  : NO source — show catalog with no qty
  //   writeoff : the chosen site (source of stock)
  const sourceSiteId =
    mode === "issue"
      ? plantId
      : mode === "receive"
        ? null
        : siteId; // return + writeoff

  function getAvailable(componentId: string): number | null {
    if (!sourceSiteId) return null; // receive mode
    const e = stockLookup[`${componentId}::${sourceSiteId}`];
    if (!e) return 0;
    return Math.max(0, e.onHand - e.pendingOut);
  }

  // Components visible in the left pane. For modes with a source,
  // only show those with available > 0 (otherwise the storekeeper
  // can't pick them anyway). For receive, show every active
  // component — they're all candidates for stocking up.
  const visibleComponents = useMemo(() => {
    if (mode === "receive") return components;
    return components.filter((c) => (getAvailable(c.id) ?? 0) > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, mode, sourceSiteId, stockLookup]);

  function addToCart(component_id: string) {
    setCart((prev) => {
      if (prev.some((it) => it.component_id === component_id)) return prev;
      return [...prev, { component_id, qty: "1", note: "" }];
    });
  }
  function removeFromCart(component_id: string) {
    setCart((prev) => prev.filter((it) => it.component_id !== component_id));
  }
  function setQty(component_id: string, qty: string) {
    setCart((prev) =>
      prev.map((it) => (it.component_id === component_id ? { ...it, qty } : it)),
    );
  }
  function setNote(component_id: string, note: string) {
    setCart((prev) =>
      prev.map((it) => (it.component_id === component_id ? { ...it, note } : it)),
    );
  }

  async function onSubmit() {
    setError(null);
    if (cart.length === 0) {
      setError("Add at least one component to the cart.");
      return;
    }
    for (const it of cart) {
      const n = Number(it.qty);
      // Daksh — scaffolding ships in whole pieces. Reject any
      // non-integer (and zero/negative). Doubles as a safety net
      // for paste/autofill that bypasses the input filter.
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        const c = components.find((c) => c.id === it.component_id);
        setError(
          `Quantity for ${c?.name ?? "an item"} must be a whole number greater than zero.`,
        );
        return;
      }
      if (sourceSiteId) {
        const avail = getAvailable(it.component_id) ?? 0;
        if (n > avail) {
          const c = components.find((c) => c.id === it.component_id);
          setError(
            `${c?.name ?? "Item"}: requested ${n}, only ${avail} available at source.`,
          );
          return;
        }
      }
    }

    const fd = new FormData();
    fd.append("movement_type", mode);
    if (mode !== "receive") fd.append("site_id", siteId);
    fd.append("batch_note", batchNote);
    for (const it of cart) {
      fd.append("component_ids[]", it.component_id);
      fd.append("qtys[]", String(Number(it.qty)));
      fd.append("notes[]", it.note);
    }

    setSubmitting(true);
    try {
      const res = await proposeMovementAction(fd);
      if (!res.ok) {
        setError(res.error);
        setSubmitting(false);
        return;
      }
      router.push("/inventory/scaffolding?submitted=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const headerCopy = headerForMode(mode);
  const needsSitePicker = mode !== "receive";

  // Group visible components by type for the left pane.
  const groupedComponents = useMemo(() => {
    const byType = new Map<string, ComponentLite[]>();
    for (const c of visibleComponents) {
      if (!byType.has(c.component_type)) byType.set(c.component_type, []);
      byType.get(c.component_type)!.push(c);
    }
    return Array.from(byType.entries());
  }, [visibleComponents]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      {/* ── LEFT PANE: source / catalog ─────────────────────────── */}
      <div
        style={{
          background: INV_THEME.paper,
          border: `1px solid ${INV_THEME.parchment}`,
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: INV_THEME.steel,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {headerCopy.leftLabel}
          </div>
          {needsSitePicker && (
            <div style={{ marginTop: 8 }}>
              <select
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  setCart([]); // reset cart when source changes
                }}
                style={{
                  width: "100%",
                  maxWidth: 380,
                  padding: "8px 10px",
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1px solid ${INV_THEME.parchment}`,
                  borderRadius: 8,
                  background: INV_THEME.cream,
                  color: INV_THEME.steel,
                }}
              >
                {siteOptions.length === 0 && (
                  <option value="">No sites available</option>
                )}
                {siteOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.is_plant ? "Plant (Warehouse)" : `${s.name} · ${s.code}`}
                  </option>
                ))}
              </select>
              {mode === "issue" && (
                <div
                  style={{
                    fontSize: 11,
                    color: INV_THEME.steelLight,
                    marginTop: 4,
                  }}
                >
                  Source: Plant — destination is the site you pick above.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Catalog cards */}
        {visibleComponents.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: INV_THEME.steelLight,
              fontSize: 13,
              border: `1px dashed ${INV_THEME.parchment}`,
              borderRadius: 10,
            }}
          >
            {mode === "receive"
              ? "No active components in the catalog."
              : "Source location has no stock to move."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groupedComponents.map(([t, list]) => (
              <div key={t} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: INV_THEME.steelLight,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    paddingBottom: 4,
                    borderBottom: `1px solid ${INV_THEME.parchment}`,
                  }}
                >
                  {labelForComponentType(t as never)}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                    gap: 8,
                  }}
                >
                  {list.map((c) => {
                    const inCart = cart.some((it) => it.component_id === c.id);
                    const avail = getAvailable(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => (inCart ? removeFromCart(c.id) : addToCart(c.id))}
                        title={inCart ? "Remove from cart" : "Add to cart"}
                        style={{
                          textAlign: "left",
                          padding: 10,
                          background: inCart ? INV_THEME.steel : INV_THEME.cream,
                          color: inCart ? "#fff" : INV_THEME.steel,
                          border: `1px solid ${inCart ? INV_THEME.steel : INV_THEME.parchment}`,
                          borderRadius: 8,
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: inCart ? "#fff" : INV_THEME.steel,
                          }}
                        >
                          <ComponentIcon
                            type={c.component_type as never}
                            size={28}
                            imageDataUrl={c.image_data_url ?? undefined}
                          />
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                              }}
                            >
                              {c.name}
                            </span>
                            {c.size_spec && (
                              <span
                                style={{
                                  fontSize: 10,
                                  opacity: inCart ? 0.8 : 0.7,
                                }}
                              >
                                {c.size_spec}
                              </span>
                            )}
                          </div>
                        </div>
                        {avail !== null && (
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              opacity: inCart ? 0.85 : 0.7,
                            }}
                          >
                            {avail.toLocaleString("en-IN")} available
                          </div>
                        )}
                        {inCart && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>
                            ✓ in cart
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT PANE: cart + submit ───────────────────────────── */}
      <div
        style={{
          background: INV_THEME.paper,
          border: `1px solid ${INV_THEME.parchment}`,
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          position: "sticky",
          top: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: INV_THEME.steel,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {headerCopy.rightLabel}
          </div>
          <div
            style={{
              fontSize: 12,
              color: INV_THEME.steelLight,
              marginTop: 4,
            }}
          >
            {headerCopy.rightHint}
          </div>
        </div>

        {cart.length === 0 && (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: INV_THEME.steelLight,
              fontSize: 12,
              border: `1px dashed ${INV_THEME.parchment}`,
              borderRadius: 10,
            }}
          >
            Tap a component on the left to add it.
          </div>
        )}

        {cart.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cart.map((it) => {
              const c = components.find((cc) => cc.id === it.component_id);
              if (!c) return null;
              const avail = getAvailable(c.id);
              return (
                <div
                  key={it.component_id}
                  style={{
                    background: INV_THEME.cream,
                    border: `1px solid ${INV_THEME.parchment}`,
                    borderRadius: 8,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: INV_THEME.steel,
                    }}
                  >
                    <ComponentIcon
                      type={c.component_type as never}
                      size={22}
                      imageDataUrl={c.image_data_url ?? undefined}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        flex: 1,
                      }}
                    >
                      {c.name}
                      {c.size_spec && (
                        <span
                          style={{ fontWeight: 600, opacity: 0.7, marginLeft: 6 }}
                        >
                          ({c.size_spec})
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromCart(it.component_id)}
                      title="Remove"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: INV_THEME.stockOut,
                        fontWeight: 800,
                        fontSize: 13,
                        cursor: "pointer",
                        padding: "2px 6px",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {/* Daksh — scaffolding components ship as whole
                        pieces (one clamp is one clamp, not 1.5).
                        Lock the input to integers: step=1 keeps the
                        ↑↓ arrows snapping; inputMode=numeric brings
                        up the digit keypad on tablets; the onChange
                        strips any non-digit so paste or autofill
                        can't sneak a "25.01" through. Server-side
                        also rejects non-integers as a backstop. */}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={it.qty}
                      onChange={(e) => {
                        // Strip everything that isn't a digit (drops
                        // "." automatically so 25.01 collapses to
                        // "2501"). Empty stays empty so the field is
                        // still editable.
                        const cleaned = e.target.value.replace(/[^0-9]/g, "");
                        setQty(it.component_id, cleaned);
                      }}
                      placeholder="qty"
                      style={{
                        width: 90,
                        padding: "6px 8px",
                        fontSize: 13,
                        fontWeight: 700,
                        border: `1px solid ${INV_THEME.parchment}`,
                        borderRadius: 6,
                        background: "#fff",
                        color: INV_THEME.steel,
                        fontFeatureSettings: '"tnum"',
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        color: INV_THEME.steelLight,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {c.unit}
                    </span>
                    {avail !== null && (
                      <span
                        style={{
                          fontSize: 10,
                          color: INV_THEME.steelLight,
                          marginLeft: "auto",
                        }}
                      >
                        max {avail}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={it.note}
                    onChange={(e) => setNote(it.component_id, e.target.value)}
                    placeholder="Optional line note"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 12,
                      border: `1px solid ${INV_THEME.parchment}`,
                      borderRadius: 6,
                      background: "#fff",
                      color: INV_THEME.steel,
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Batch note */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 10,
              fontWeight: 800,
              color: INV_THEME.steelLight,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            Batch note (optional)
          </label>
          <input
            type="text"
            value={batchNote}
            onChange={(e) => setBatchNote(e.target.value)}
            placeholder={headerCopy.batchNotePlaceholder}
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              border: `1px solid ${INV_THEME.parchment}`,
              borderRadius: 8,
              background: INV_THEME.cream,
              color: INV_THEME.steel,
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
          disabled={submitting || cart.length === 0}
          style={{
            ...primaryButton,
            justifyContent: "center",
            width: "100%",
            opacity: submitting || cart.length === 0 ? 0.6 : 1,
            cursor: submitting || cart.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          {submitting
            ? "Submitting…"
            : `Send for ${headerCopy.approvalLabel} approval (${cart.length} item${cart.length === 1 ? "" : "s"})`}
        </button>
        <div
          style={{
            fontSize: 11,
            color: INV_THEME.steelLight,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          Crosscheck (Mafat) or owner reviews and approves. Stock counts
          update once approved.
        </div>
      </div>
    </div>
  );
}

function headerForMode(mode: MovementMode) {
  switch (mode) {
    case "issue":
      return {
        leftLabel: "Plant stock — pick destination site below",
        rightLabel: "→ Issue cart",
        rightHint: "Items being sent out to the chosen site.",
        batchNotePlaceholder: "Driver, vehicle no., or delivery note",
        approvalLabel: "issue",
      };
    case "return":
      return {
        leftLabel: "Site stock — pick source site below",
        rightLabel: "← Return cart",
        rightHint: "Items being returned from the chosen site to the plant.",
        batchNotePlaceholder: "Truck no., driver name, condition",
        approvalLabel: "return",
      };
    case "receive":
      return {
        leftLabel: "Catalog — what arrived at the plant?",
        rightLabel: "⤓ Receive cart",
        rightHint: "New stock landing at the plant from a vendor.",
        batchNotePlaceholder: "Vendor name, invoice/bill ref, vehicle",
        approvalLabel: "receipt",
      };
    case "writeoff":
      return {
        leftLabel: "Source stock — pick the location below",
        rightLabel: "✕ Write-off cart",
        rightHint: "Items being marked as damaged / lost / no longer usable.",
        batchNotePlaceholder: "Reason, incident date, photos ref",
        approvalLabel: "write-off",
      };
  }
}
