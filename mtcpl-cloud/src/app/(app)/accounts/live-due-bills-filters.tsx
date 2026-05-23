"use client";

/**
 * Live (no-Apply-button) filter strip for the Due Bills page.
 *
 * Daksh May 2026: previously a server-rendered <form method="GET">
 * with an "Apply filters" button. Two papercuts:
 *   1. Apply caused a full page navigation. dashboard-client's
 *      `selected` (ticked) Set lived in memory only, so reload
 *      blew away the accountant's queued picks. Persistence layer
 *      (sessionStorage) in dashboard-client now fixes that side.
 *   2. Needing to press a button felt clunky next to the in-page
 *      quick-search which is live on every keystroke.
 *
 * This client component owns the controls and pushes the new
 * `?vendor=…&category=…&date_from=…&date_to=…&token=…&age=…` URL
 * via router.replace() the moment any control changes (date /
 * select fire on every change; token input debounces 350ms so an
 * accountant typing a long token doesn't fire a navigation per
 * keystroke).
 *
 * The token field stays here as it was — it filters server-side
 * (different from the in-page quick-search which is client-side).
 * The `age` query param is preserved as a hidden value so the
 * age-bucket links above the table keep working.
 */

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BILL_VENDOR_CATEGORIES,
  billVendorCategoryDisplay,
} from "@/lib/bill-vendor-categories";

export function LiveDueBillsFilters({
  vendors,
  initialToken,
  initialVendor,
  initialCategory,
  initialDateFrom,
  initialDateTo,
  initialAge,
  tokens: { borderStrong, border, shadow, surface },
}: {
  vendors: Array<{ id: string; name: string }>;
  initialToken: string;
  initialVendor: string;
  initialCategory: string;
  initialDateFrom: string;
  initialDateTo: string;
  initialAge: string;
  /** Reuse the page's existing colour palette so the controls
   *  look identical to the rest of the Accounts surface. */
  tokens: { borderStrong: string; border: string; shadow: string; surface: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [token, setToken] = useState(initialToken);
  const [vendor, setVendor] = useState(initialVendor);
  const [category, setCategory] = useState(initialCategory);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);

  // Sync local state back from URL whenever the searchParams change
  // (e.g. Clear link navigates to /accounts with empty params, or
  // an age-bucket link adds ?age=…). Without this the controls would
  // hold stale local state after such navigations.
  useEffect(() => {
    setToken(searchParams.get("token") ?? "");
    setVendor(searchParams.get("vendor") ?? "");
    setCategory(searchParams.get("category") ?? "");
    setDateFrom(searchParams.get("date_from") ?? "");
    setDateTo(searchParams.get("date_to") ?? "");
  }, [searchParams]);

  /** Build the new URL from the current control state and push it.
   *  Replace (not push) so the browser back-stack doesn't fill with
   *  every keystroke. */
  function pushFilters(next: {
    token?: string;
    vendor?: string;
    category?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const params = new URLSearchParams();
    const merged = {
      token: next.token ?? token,
      vendor: next.vendor ?? vendor,
      category: next.category ?? category,
      date_from: next.date_from ?? dateFrom,
      date_to: next.date_to ?? dateTo,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    // Preserve the age bucket if it was in the URL.
    if (initialAge) params.set("age", initialAge);
    // Daksh May 2026 — preserve `?selected=` across filter pushes
    // so the server keeps surfacing pinned bills regardless of
    // which filter the operator just changed. The dashboard-client
    // sync effect owns the lifecycle of this param; we just don't
    // want to drop it on the floor.
    const selectedParam = searchParams.get("selected");
    if (selectedParam) params.set("selected", selectedParam);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Debounced token push — accountant typing a long token shouldn't
  // fire a navigation on every keystroke. 350ms is the sweet spot
  // for search inputs: long enough that fast typers don't trigger
  // mid-word, short enough that pausing feels responsive.
  const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onTokenChange(v: string) {
    setToken(v);
    if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
    tokenDebounceRef.current = setTimeout(() => pushFilters({ token: v }), 350);
  }
  useEffect(() => {
    return () => {
      if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
    };
  }, []);

  const anyFilter =
    Boolean(vendor) ||
    Boolean(initialAge) ||
    Boolean(token) ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(category);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(140px, 1.4fr) minmax(160px, 1.6fr) minmax(160px, 1.6fr) minmax(140px, 1fr) minmax(140px, 1fr) auto",
        alignItems: "end",
        columnGap: 10,
        rowGap: 4,
        marginBottom: 14,
        padding: "10px 12px",
        background: surface,
        border: `1px solid ${border}`,
        borderRadius: 10,
        boxShadow: shadow,
      }}
    >
      <FilterField label="Token">
        <input
          type="search"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="T-YYYY-N or any part"
          style={{
            padding: "6px 10px",
            fontSize: 13,
            background: "#fff",
            border: `1px solid ${borderStrong}`,
            borderRadius: 8,
            color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
            width: "100%",
          }}
        />
      </FilterField>

      {/* Daksh May 2026 — Vendor and Category are mutually exclusive.
       *  Picking one auto-clears the other, both in local state and
       *  in the pushed URL. Each select disables itself when the
       *  other is active so the operator sees the rule visually
       *  (and the disabled control's title explains why). Picking
       *  the "All …" option from EITHER releases the lock and the
       *  other becomes usable again. */}
      <FilterField label="Vendor">
        <select
          value={vendor}
          disabled={Boolean(category)}
          title={
            category
              ? "Clear the Category filter to pick a vendor"
              : undefined
          }
          onChange={(e) => {
            const v = e.target.value;
            setVendor(v);
            // Picking a vendor clears category; clearing vendor
            // ("All vendors") leaves category alone (it's already
            // empty if disabled).
            if (v && category) setCategory("");
            pushFilters({ vendor: v, category: v ? "" : category });
          }}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            background: "#fff",
            border: `1px solid ${borderStrong}`,
            borderRadius: 8,
            color: "var(--text)",
            width: "100%",
            opacity: category ? 0.55 : 1,
            cursor: category ? "not-allowed" : "pointer",
          }}
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Category">
        <select
          value={category}
          disabled={Boolean(vendor)}
          title={
            vendor
              ? "Clear the Vendor filter to pick a category"
              : undefined
          }
          onChange={(e) => {
            const v = e.target.value;
            setCategory(v);
            if (v && vendor) setVendor("");
            pushFilters({ category: v, vendor: v ? "" : vendor });
          }}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            background: "#fff",
            border: `1px solid ${borderStrong}`,
            borderRadius: 8,
            color: "var(--text)",
            width: "100%",
            opacity: vendor ? 0.55 : 1,
            cursor: vendor ? "not-allowed" : "pointer",
          }}
        >
          <option value="">All categories</option>
          {BILL_VENDOR_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {billVendorCategoryDisplay(c.value)}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Bill date — from">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            const v = e.target.value;
            setDateFrom(v);
            pushFilters({ date_from: v });
          }}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            background: "#fff",
            border: `1px solid ${borderStrong}`,
            borderRadius: 8,
            color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
            width: "100%",
          }}
        />
      </FilterField>

      <FilterField label="to">
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            const v = e.target.value;
            setDateTo(v);
            pushFilters({ date_to: v });
          }}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            background: "#fff",
            border: `1px solid ${borderStrong}`,
            borderRadius: 8,
            color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
            width: "100%",
          }}
        />
      </FilterField>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            fontStyle: "italic",
            whiteSpace: "nowrap",
          }}
          title="Filters apply automatically — no Apply button needed"
        >
          🔄 live
        </span>
        {anyFilter && (
          <Link
            href="/accounts"
            style={{
              fontSize: 12,
              color: "var(--muted)",
              textDecoration: "underline",
            }}
          >
            Clear
          </Link>
        )}
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minHeight: 56,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
