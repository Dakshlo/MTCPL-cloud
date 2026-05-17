/**
 * Mig 061 follow-on (Daksh, May 2026) — canonical bill-vendor
 * category list. Drives:
 *
 *   • the Category <select> on the bill-vendor form (replaces the
 *     free-text input that was easy to mistype)
 *   • the Category filter dropdown on /accounts (Due Bills) so
 *     Daksh's dad can slice the outstanding total by "what kind
 *     of cost is this"
 *   • the category pill displayed on each bill row + the vendor
 *     list row
 *
 * Block Purchase is the only top-level category with sub-types,
 * because the raw-stone spend dominates the books and we want to
 * tell pinkstone from marble at a glance. Everything else is flat.
 *
 * Storage: the canonical `value` string lives on bill_vendors.category
 * (TEXT NULL). No DB migration needed — existing free-text values
 * are treated as legacy / "Other" by the lookup helper below.
 */

export type BillVendorCategory = {
  value: string;
  label: string;
  /** When set, the <select> renders this option inside an <optgroup>
   *  with the group string as its label. Used for the Block Purchase
   *  sub-types to keep stones visually grouped. */
  group?: string;
  /** Accent colour for the pill chip on bill / vendor rows. Pulled
   *  from the existing accounts palette so the page reads consistent. */
  pill: { fg: string; bg: string };
};

const PILL_STONE_PINK   = { fg: "#9d174d", bg: "#fce7f3" };
const PILL_STONE_WHITE  = { fg: "#374151", bg: "#f3f4f6" };
const PILL_STONE_YELLOW = { fg: "#92400e", bg: "#fef3c7" };
const PILL_STONE_RED    = { fg: "#9f1239", bg: "#ffe4e6" };
const PILL_STONE_OTHER  = { fg: "#4b5563", bg: "#e5e7eb" };
const PILL_EQUIPMENT    = { fg: "#1d4ed8", bg: "#dbeafe" };
const PILL_JOBWORK      = { fg: "#6d28d9", bg: "#ede9fe" };
const PILL_TRANSPORT    = { fg: "#b45309", bg: "#fef3c7" };
const PILL_REPAIR       = { fg: "#0e7490", bg: "#cffafe" };
const PILL_OTHER        = { fg: "#6b7280", bg: "#f3f4f6" };

export const BILL_VENDOR_CATEGORIES: ReadonlyArray<BillVendorCategory> = [
  // ── Block Purchase sub-types (raw-stone vendors) ────────────────
  { value: "block_purchase_pinkstone",    label: "Pink Stone",    group: "Block Purchase", pill: PILL_STONE_PINK },
  { value: "block_purchase_marble",       label: "Marble",        group: "Block Purchase", pill: PILL_STONE_WHITE },
  { value: "block_purchase_yellowmarble", label: "Yellow Marble", group: "Block Purchase", pill: PILL_STONE_YELLOW },
  { value: "block_purchase_redstone",     label: "Red Stone",     group: "Block Purchase", pill: PILL_STONE_RED },
  { value: "block_purchase_other",        label: "Other (Block)", group: "Block Purchase", pill: PILL_STONE_OTHER },
  // ── Flat top-level categories ───────────────────────────────────
  { value: "equipment_tools",    label: "Equipment & Tools",  pill: PILL_EQUIPMENT },
  { value: "jobwork",            label: "Jobwork",            pill: PILL_JOBWORK },
  { value: "transport",          label: "Transport",          pill: PILL_TRANSPORT },
  { value: "repair_maintenance", label: "Repair & Maintenance", pill: PILL_REPAIR },
  { value: "other",              label: "Other",              pill: PILL_OTHER },
] as const;

const BY_VALUE = new Map(BILL_VENDOR_CATEGORIES.map((c) => [c.value, c]));

/** Lookup the full category record by stored value. Unknown values
 *  (legacy free-text like "TOOLS" / "SAND" / null) fall back to a
 *  generic "Uncategorised" pill so the row still renders. */
export function getBillVendorCategory(value: string | null | undefined): {
  value: string | null;
  label: string;
  pill: { fg: string; bg: string };
} {
  if (!value) {
    return { value: null, label: "Uncategorised", pill: { fg: "#6b7280", bg: "#f3f4f6" } };
  }
  const c = BY_VALUE.get(value);
  if (c) return { value: c.value, label: c.label, pill: c.pill };
  // Legacy free-text — show the raw value but in muted pill colours.
  return { value, label: value, pill: { fg: "#6b7280", bg: "#f3f4f6" } };
}

/** Full display label for a category — used inside the <select>
 *  where the optgroup label already covers the group, but the
 *  filter dropdown wants the group prefix inline so options are
 *  unambiguous when listed flat. */
export function billVendorCategoryDisplay(value: string): string {
  const c = BY_VALUE.get(value);
  if (!c) return value;
  return c.group ? `${c.group} — ${c.label}` : c.label;
}
