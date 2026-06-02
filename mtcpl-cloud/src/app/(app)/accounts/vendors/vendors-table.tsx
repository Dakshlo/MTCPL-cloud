"use client";

/**
 * Mig 058 follow-on (Daksh): vendor-account list extracted into a
 * client component so we can add a search-as-you-type input that
 * filters by name / category / GSTIN. Server still does the
 * heavy fetch + sort; this layer just narrows the visible rows.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "../_ui/components";
import { archiveBillVendorFormAction } from "../actions";
import {
  getBillVendorCategory,
  type CustomBillVendorCategory,
} from "@/lib/bill-vendor-categories";

export type VendorRow = {
  id: string;
  name: string;
  /** Mig 066 — owner-name / informal handle. Shown next to the
   *  vendor name and included in the quick-search index. */
  nickname: string | null;
  category: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
};

export function VendorsTable({
  vendors,
  outstandingByVendor,
  canEdit = true,
  customCategories = [],
}: {
  vendors: VendorRow[];
  outstandingByVendor: Record<string, number>;
  /** When false, hides Archive/Reactivate buttons. Read-only roles
   *  like crosscheck get the table without the mutating controls. */
  canEdit?: boolean;
  /** Mig 082 — passed to getBillVendorCategory so custom slugs
   *  resolve to their proper label + pill colour on each row. */
  customCategories?: CustomBillVendorCategory[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => {
      if (v.name.toLowerCase().includes(q)) return true;
      // Mig 066 — nickname / owner handle included in quick search
      // so multi-firm vendors find each other on the same query.
      if (v.nickname?.toLowerCase().includes(q)) return true;
      if (v.category?.toLowerCase().includes(q)) return true;
      // Mig 061 — also search against the resolved category LABEL
      // so "marble" finds "block_purchase_marble" vendors etc.
      if (getBillVendorCategory(v.category, customCategories).label.toLowerCase().includes(q)) return true;
      if (v.gstin?.toLowerCase().includes(q)) return true;
      if (v.phone?.toLowerCase().includes(q)) return true;
      if (v.email?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [query, vendors]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Search vendor by name, nickname, category, GSTIN, phone, or email…"
          style={{ ...INPUT_STYLE, maxWidth: 480 }}
          aria-label="Search vendors"
        />
        {query.trim() && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} of {vendors.length} {filtered.length === 1 ? "vendor" : "vendors"}
          </span>
        )}
      </div>

      <div style={TABLE_STYLES.tableWrap}>
        <div style={{ overflowX: "auto" }}>
          <table style={TABLE_STYLES.table}>
            <thead style={TABLE_STYLES.thead}>
              <tr>
                <th style={TABLE_STYLES.th}>Vendor</th>
                <th style={TABLE_STYLES.th}>Category</th>
                <th style={TABLE_STYLES.th}>GSTIN</th>
                <th style={TABLE_STYLES.th}>Contact</th>
                <th style={TABLE_STYLES.thRight}>Outstanding</th>
                <th style={TABLE_STYLES.th}>Status</th>
                <th style={TABLE_STYLES.th}>&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: "32px 16px",
                      textAlign: "center",
                      color: "var(--muted)",
                      fontSize: 13,
                      fontStyle: "italic",
                    }}
                  >
                    No vendors match <strong style={{ color: "var(--text)" }}>{query}</strong>.
                  </td>
                </tr>
              ) : (
                filtered.map((v, idx) => {
                  const outstanding = outstandingByVendor[v.id] ?? 0;
                  return (
                    <tr
                      key={v.id}
                      style={{
                        background: idx % 2 === 0 ? "#fff" : ACCOUNTS_TOKENS.surfaceMuted,
                        opacity: v.isActive ? 1 : 0.6,
                      }}
                    >
                      <td style={TABLE_STYLES.td}>
                        {/* Mig 066 — nickname (owner handle) takes
                            the subLabel slot when set, fallback to
                            email otherwise. Owner names matter more
                            for vendor matching than the email. */}
                        <VendorIdentity
                          name={v.name}
                          subLabel={v.nickname ?? v.email ?? undefined}
                          size={36}
                          href={`/accounts/vendors/${v.id}`}
                        />
                      </td>
                      <td style={TABLE_STYLES.td}>
                        {/* Mig 061 — coloured category pill driven by
                            the canonical category enum. Legacy free-
                            text values render in the muted fallback
                            colours (still visible, just neutral). */}
                        {v.category ? (() => {
                          const cat = getBillVendorCategory(v.category, customCategories);
                          return (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "2px 10px",
                                borderRadius: 999,
                                background: cat.pill.bg,
                                color: cat.pill.fg,
                                fontWeight: 700,
                                letterSpacing: "0.02em",
                              }}
                            >
                              {cat.label}
                            </span>
                          );
                        })() : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={TABLE_STYLES.td}>
                        {v.gstin ? (
                          <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                            {v.gstin}
                          </code>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...TABLE_STYLES.td, fontSize: 12, color: "var(--muted)" }}>
                        {v.phone ?? "—"}
                      </td>
                      <td style={TABLE_STYLES.tdRight}>
                        {outstanding > 0 ? (
                          <Money value={outstanding} tone="warning" />
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 10px",
                            borderRadius: 999,
                            background: v.isActive ? ACCOUNTS_TOKENS.successLight : ACCOUNTS_TOKENS.surfaceMuted,
                            color: v.isActive ? ACCOUNTS_TOKENS.success : "var(--muted)",
                          }}
                        >
                          {v.isActive ? "● Active" : "○ Archived"}
                        </span>
                      </td>
                      <td style={TABLE_STYLES.td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Link
                            href={`/accounts/vendors/${v.id}`}
                            style={{ ...BUTTON_STYLES.secondary, padding: "5px 12px", fontSize: 11 }}
                          >
                            View
                          </Link>
                          {canEdit && (
                            <form action={archiveBillVendorFormAction}>
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="reactivate" value={v.isActive ? "" : "1"} />
                              <button
                                type="submit"
                                style={{ ...BUTTON_STYLES.ghost, padding: "5px 10px" }}
                              >
                                {v.isActive ? "Archive" : "Reactivate"}
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
