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

/** Mig 082 — user-created categories from
 *  bill_vendor_custom_categories. Same shape as the canonical
 *  list. Server pages fetch the list once on render and pass it
 *  via mergeBillVendorCategories(); callers downstream of that
 *  merge see one combined array indistinguishable from the
 *  canonical one. The standalone helpers (getBillVendorCategory /
 *  isBlockPurchaseCategory) accept the merged list as a 2nd arg
 *  so they keep working on custom values too. */
export type CustomBillVendorCategory = {
  value: string;
  label: string;
  pill_fg: string;
  pill_bg: string;
};

/** Merge canonical + custom categories into one display list.
 *  Custom rows render under a "Custom" group at the end of the
 *  picker so the canonical ordering stays predictable. */
export function mergeBillVendorCategories(
  custom: CustomBillVendorCategory[],
): BillVendorCategory[] {
  const customMapped: BillVendorCategory[] = custom.map((c) => ({
    value: c.value,
    label: c.label,
    group: "Custom",
    pill: { fg: c.pill_fg, bg: c.pill_bg },
  }));
  return [...BILL_VENDOR_CATEGORIES, ...customMapped];
}

/** Lookup the full category record by stored value. Unknown values
 *  (legacy free-text like "TOOLS" / "SAND" / null) fall back to a
 *  generic "Uncategorised" pill so the row still renders.
 *  Mig 082 — accepts an optional `customCategories` array so
 *  custom slugs (custom_xyz) resolve to their proper label + pill
 *  instead of falling through to the legacy branch. */
export function getBillVendorCategory(
  value: string | null | undefined,
  customCategories: CustomBillVendorCategory[] = [],
): {
  value: string | null;
  label: string;
  pill: { fg: string; bg: string };
} {
  if (!value) {
    return { value: null, label: "Uncategorised", pill: { fg: "#6b7280", bg: "#f3f4f6" } };
  }
  const c = BY_VALUE.get(value);
  if (c) return { value: c.value, label: c.label, pill: c.pill };
  // Mig 082 — custom category lookup before the legacy fallback.
  const cc = customCategories.find((x) => x.value === value);
  if (cc) {
    return {
      value: cc.value,
      label: cc.label,
      pill: { fg: cc.pill_fg, bg: cc.pill_bg },
    };
  }
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

/** Mig 062 — is this category one of the Block Purchase sub-types?
 *  Drives the conditional CFT input on the bill-entry form: only
 *  raw-stone bills get a CFT field. Mapped by group rather than a
 *  hardcoded prefix so renaming a value stays safe. */
export function isBlockPurchaseCategory(value: string | null | undefined): boolean {
  if (!value) return false;
  const c = BY_VALUE.get(value);
  return c?.group === "Block Purchase";
}
