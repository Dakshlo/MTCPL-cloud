"use client";

/**
 * Due-bills table + multi-select propose-pay-today.
 *
 * Modern Zoho-style layout: sticky action bar at the bottom shows
 * selected count + grand total + propose button. Per-row "propose ₹"
 * input is collapsed by default — appears only after the row is
 * ticked. Sticky table header, hover rows, vendor avatars.
 */

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  Money,
  TABLE_STYLES,
  VendorIdentity,
} from "./_ui/components";
import { getBillVendorCategory } from "@/lib/bill-vendor-categories";
import { RoyaltyNetPeek } from "./vendors/[id]/royalty-net-peek";

export type DueBillRow = {
  id: string;
  token: string;
  vendorId: string;
  vendorName: string;
  /** Mig 066 — vendor's owner-handle / nickname. Used by the quick
   *  search so multi-firm vendors match on the owner's name. */
  vendorNickname: string | null;
  /** Mig 061 — bill_vendors.category (canonical enum value). Drives
   *  the category filter dropdown above + the pill chip on each row. */
  vendorCategory: string | null;
  vendorBillNo: string;
  billDate: string;
  description: string;
  costHead: string | null;
  amountTotal: number;
  /** Mig 042 — tax breakdown surfaced in the table so the accountant
   *  can see at a glance how much of the total is tax + whether the
   *  bill carries TDS / TCS adjustments. */
  amountGst: number;
  amountTds: number;
  amountTcs: number;
  /** Net of TDS, gross of TCS — what we actually pay the vendor. */
  amountPayableToVendor: number;
  amountPaid: number;
  amountOutstanding: number;
  /** Mig 072 — owner-held slice. 0 = no hold. Renders a 🔒 chip on
   *  the row + clamps the proposable amount input to
   *  (amountOutstanding − heldAmount). Server enforces too. */
  heldAmount: number;
  heldReason: string | null;
  ageBucket: "0_30" | "31_60" | "61_90" | "90_plus";
  hasOpenPayment: boolean;
  /** Days since bill_date. Used for the premature-payment guard. */
  daysSinceBill: number;
  /** Per-vendor payment terms (Mig 040): bills younger than this
   *  vendor's terms shouldn't be paid yet. Soft warning, not a hard
   *  block. Pre-Mig-040 vendors fall back to the app default (45). */
  prematureForPayment: boolean;
  /** The vendor's actual terms in days — used for the warning text
   *  ("Pay after 30d" varies per vendor now). */
  paymentTermsDays: number;
  /** When the bill was approved by the crosscheck role (or owner) —
   *  shows in the Due Bills table so the accountant can see how long
   *  it has been verified. NULL for legacy bills approved before the
   *  Mig 027 timestamp field was added. */
  crosscheckedAt: string | null;
  /** Breakdown of paid payments for this bill. Empty if nothing paid
   *  yet. Used to render chips under the Paid column. */
  paymentParts: Array<{
    amount: number;
    paidAt: string | null;
    method: string | null;
  }>;
  /** Mig 064 follow-on — per-vendor net royalty balance (paid −
   *  received, approved entries only). NULL when the role can't
   *  see royalty data — the dot doesn't render then. */
  vendorRoyaltyNet: number | null;
  /** Mig 081 follow-on (Daksh) — last paid_at across ALL of this
   *  vendor's bills (any amount, any bill, status='paid' only). Lets
   *  dad see how long ago this vendor was last paid without leaving
   *  the Due Bills page. NULL = never paid (new vendor or all
   *  prior bills cancelled). Read-only display; the surrounding
   *  page never writes to this. */
  lastPaidAtForVendor: string | null;
};

/** Legacy global default — kept for back-compat with code paths that
 *  haven't moved to per-vendor terms yet. Vendors that have an
 *  explicit payment_terms_days override this. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 45;

type ProposeResult =
  | { ok: true; batchId: string; rowsCreated: number; skipped: string[] }
  | { ok: false; error: string };

export function DueBillsClient({
  rows,
  canPropose,
  proposeAction,
}: {
  rows: DueBillRow[];
  canPropose: boolean;
  proposeAction: (formData: FormData) => Promise<ProposeResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amountOverrides, setAmountOverrides] = useState<Record<string, string>>({});

  // Daksh May 2026 — single-bill-per-vendor mode. Default ON. When
  // ON, ticking a bill locks every OTHER bill for the same vendor
  // (greyscaled, disabled checkbox, "Vendor already in batch"
  // badge) so dad doesn't accidentally propose two payments for
  // the same vendor in one batch. Toggle OFF reverts to plain
  // multi-bill behaviour. Persisted in localStorage so the
  // preference sticks across reloads.
  const SINGLE_VENDOR_KEY = "mtcpl:due-bills:single-per-vendor";
  const [singleVendorMode, setSingleVendorMode] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(SINGLE_VENDOR_KEY);
      // Default is ON. Only flip to OFF if the stored value is
      // explicitly "0" (user has previously opted out).
      if (v === "0") setSingleVendorMode(false);
    } catch {
      // ignore — private mode etc., keep the default
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SINGLE_VENDOR_KEY, singleVendorMode ? "1" : "0");
    } catch {
      // ignore
    }
  }, [singleVendorMode]);

  // Daksh May 2026 — persist the tick selection across page reloads
  // so changing a server-side filter (vendor / category / date range)
  // doesn't unselect everything the accountant just queued. Stored in
  // sessionStorage (cleared automatically when the tab closes); the
  // accountant only ever cares about the current sitting.
  //
  // Edge case: if a previously-selected bill is no longer in the
  // current `rows` (e.g. paid since selection, or filtered out by a
  // server query), the ID stays in sessionStorage but doesn't render.
  // Switching back to a broader filter brings it back into view with
  // its tick intact.
  const SELECTION_KEY = "mtcpl:due-bills:selected";
  const AMOUNT_OVERRIDES_KEY = "mtcpl:due-bills:amount-overrides";
  // Rehydrate on mount (client-only — sessionStorage is unavailable
  // during SSR). Also push the rehydrated selection into the URL
  // (?selected=…) via router.replace so the server fires the
  // supplementary query and returns the pinned bills with the rest
  // of rows. Without this initial push, hitting /accounts directly
  // wouldn't include selected bills filtered out by current
  // server-side filters.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      let rehydratedIds: string[] | null = null;
      const sRaw = sessionStorage.getItem(SELECTION_KEY);
      if (sRaw) {
        const arr = JSON.parse(sRaw);
        if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
          rehydratedIds = arr;
          setSelected(new Set(arr));
        }
      }
      const aRaw = sessionStorage.getItem(AMOUNT_OVERRIDES_KEY);
      if (aRaw) {
        const obj = JSON.parse(aRaw);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          setAmountOverrides(obj as Record<string, string>);
        }
      }
      // If we rehydrated something AND the URL doesn't already
      // carry it, push so the server picks it up. router.replace
      // (Next.js) triggers an RSC re-fetch which lands new rows
      // including the supplementary "selected" bills.
      if (rehydratedIds && rehydratedIds.length > 0) {
        const url = new URL(window.location.href);
        const currentSelected = (url.searchParams.get("selected") ?? "")
          .split(",")
          .filter(Boolean)
          .sort()
          .join(",");
        const wanted = [...rehydratedIds].sort().join(",");
        if (wanted !== currentSelected) {
          url.searchParams.set("selected", wanted);
          router.replace(url.pathname + url.search, { scroll: false });
        }
      }
    } catch {
      // Malformed sessionStorage — drop silently and start fresh.
    }
    // router is stable across renders; safe to omit. Effect only
    // runs on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist on every change. JSON.stringify a Set isn't supported
  // directly, so spread to an array first.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(SELECTION_KEY, JSON.stringify([...selected]));
    } catch {
      // Quota / private-mode — ignore. Worst case selection won't
      // survive reload, which is the pre-fix behaviour.
    }
    // Daksh May 2026 — also push the selection into the URL as
    // `?selected=id1,id2,id3`. The server reads this and adds a
    // supplementary query so pinned bills survive any filter
    // change (even ones that would otherwise exclude them, e.g.
    // selecting a Vendor-A bill then filtering to Vendor B).
    // router.replace (not push) so the browser back-stack doesn't
    // fill with every tick. Same-pathname guard prevents recursion
    // on initial mount where the URL already matches.
    try {
      const url = new URL(window.location.href);
      const wantedSelected = [...selected].sort().join(",");
      const currentSelected = (url.searchParams.get("selected") ?? "")
        .split(",")
        .filter(Boolean)
        .sort()
        .join(",");
      if (wantedSelected !== currentSelected) {
        if (wantedSelected) {
          url.searchParams.set("selected", wantedSelected);
        } else {
          url.searchParams.delete("selected");
        }
        // Replace history entry, don't push — accountant doesn't
        // want back button to walk through every tick.
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + (url.search ? url.search : ""),
        );
      }
    } catch {
      // URL update is best-effort — server filter still works
      // without it; the pin-on-top just won't survive a hard reload.
    }
  }, [selected]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(AMOUNT_OVERRIDES_KEY, JSON.stringify(amountOverrides));
    } catch {
      // ignore
    }
  }, [amountOverrides]);
  // Mig 053 follow-on (Daksh, May 2026): live quick-filter that
  // matches token / vendor name / vendor bill no on every keystroke
  // — no Apply button. Filters client-side over what the server
  // already loaded, so it's instant.
  const [quickFilter, setQuickFilter] = useState("");
  // Mig 058 follow-on (Daksh): sort direction toggle. Default is
  // "oldest" — oldest bill at the top, newest at the bottom. So
  // the accountant works through the queue in age order (oldest
  // = most overdue = highest priority). Toggle flips to "newest"
  // if they want recent-first. Aging analysis row above the table
  // is computed from the data, NOT from the sort, so it stays
  // intact either way.
  const [sortDir, setSortDir] = useState<"oldest" | "newest">("oldest");

  const filteredRows = useMemo(() => {
    const q = quickFilter.trim().toLowerCase();
    const matchesFilter = (r: DueBillRow) =>
      !q ||
      r.token.toLowerCase().includes(q) ||
      r.vendorName.toLowerCase().includes(q) ||
      // Mig 066 — nickname (owner handle) included in the quick
      // search so multi-firm vendors find each other on the same
      // query (e.g. type owner's name → all his firms).
      (r.vendorNickname?.toLowerCase().includes(q) ?? false) ||
      r.vendorBillNo.toLowerCase().includes(q);

    // Daksh May 2026 — selected bills are ALWAYS visible and pinned
    // to the top of the list, regardless of whether they match the
    // current quick-filter. The pain point: accountant ticks 4 bills,
    // then types in the search to find a 5th, and their 4 prior
    // picks vanish from view because they don't match the query.
    // Now they stay pinned at top in a "selected" block, with the
    // filter-matched rest below them. The selected block still
    // sorts by billDate per sortDir so multi-select picks are in a
    // consistent order.
    const selectedBucket: DueBillRow[] = [];
    const restBucket: DueBillRow[] = [];
    for (const r of rows) {
      if (selected.has(r.id)) {
        selectedBucket.push(r);
      } else if (matchesFilter(r)) {
        restBucket.push(r);
      }
    }
    // Sort a copy of each bucket so we don't mutate the rows prop.
    // billDate is ISO YYYY-MM-DD which compares correctly as strings.
    const dateSort = (a: DueBillRow, b: DueBillRow) => {
      if (a.billDate === b.billDate) return 0;
      const cmp = a.billDate < b.billDate ? -1 : 1;
      return sortDir === "oldest" ? cmp : -cmp;
    };
    selectedBucket.sort(dateSort);
    restBucket.sort(dateSort);
    return [...selectedBucket, ...restBucket];
  }, [rows, quickFilter, sortDir, selected]);

  // Track the boundary index where the selected (pinned) bucket ends
  // and the rest starts. Used to render a thin divider row in the
  // table between the two groups when both are non-empty, so the
  // accountant can see at a glance "above this line = my picks,
  // below = the filtered queue".
  const selectedPinnedCount = useMemo(
    () => filteredRows.filter((r) => selected.has(r.id)).length,
    [filteredRows, selected],
  );

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );
  const selectedTotal = selectedRows.reduce(
    (s, r) => s + (Number(amountOverrides[r.id]) || r.amountOutstanding),
    0,
  );
  // Daksh's 45-day rule — flag any selected rows that are too young
  // to be paid by company policy. Soft warning rendered above the
  // sticky propose bar.
  const prematureSelected = selectedRows.filter((r) => r.prematureForPayment);

  // Daksh May 2026 — single-bill-per-vendor lock set. When mode is
  // ON, any vendor that already has a ticked bill goes into this
  // set; the row-render gates extra bills for that vendor as
  // "vendor already in batch". Built from the FULL rows list (not
  // just filteredRows) so a vendor lock survives the quick-filter
  // — e.g. dad ticks one bill, then searches for a different vendor,
  // then comes back: the original tick is still locking the others.
  const lockedVendorIds = useMemo(() => {
    if (!singleVendorMode) return new Set<string>();
    const s = new Set<string>();
    for (const r of rows) if (selected.has(r.id)) s.add(r.vendorId);
    return s;
  }, [rows, selected, singleVendorMode]);
  // Helper used by the row render + select-all + the propose action.
  // True when the row is BLOCKED by the single-per-vendor rule:
  // the vendor already has another selected bill, and THIS row
  // itself isn't the selected one.
  const isRowVendorLocked = useCallback(
    (r: DueBillRow) =>
      singleVendorMode &&
      lockedVendorIds.has(r.vendorId) &&
      !selected.has(r.id),
    [singleVendorMode, lockedVendorIds, selected],
  );

  // Daksh May 2026 — preserve scroll position across toggles.
  // The page pins ticked bills to the top of the list; that's the
  // desired behaviour but the row-reorder + focus on the moved
  // checkbox was making the browser auto-scroll to top, losing
  // dad's place mid-search. We save the pre-toggle scrollY in a
  // ref and restore it in useLayoutEffect (fires after React
  // commits the new DOM, before the browser paints — so no
  // visible jump). Ref is cleared once consumed so a normal
  // selection update from elsewhere doesn't accidentally
  // re-restore an old scroll position.
  const preserveScrollYRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (preserveScrollYRef.current === null) return;
    window.scrollTo({ top: preserveScrollYRef.current, behavior: "auto" });
    preserveScrollYRef.current = null;
  });

  function toggle(id: string) {
    // Snapshot scroll position BEFORE the state changes — the
    // useLayoutEffect above restores it once React commits.
    if (typeof window !== "undefined") {
      preserveScrollYRef.current = window.scrollY;
    }
    // Daksh May 2026 round 2 — refactored to NOT nest the
    // setAmountOverrides call inside setSelected's updater.
    // Nesting state setters inside another setter's updater is a
    // React anti-pattern: the updater function is supposed to be
    // pure (no side effects), and in some render paths the nested
    // call wasn't taking effect — which is why dad still saw the
    // stale 50000 after untick → retick even after the prior fix.
    //
    // New shape: two flat setter calls. Always wipe any override
    // for this id on toggle — on untick it removes the typed value
    // so re-tick shows the default; on tick it's a no-op (a fresh
    // selection rarely has an override). This is the same shape
    // clearAll() uses, which is why the bottom-bar Clear button
    // already worked correctly.
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAmountOverrides((p) => {
      if (p[id] == null) return p;
      const updated = { ...p };
      delete updated[id];
      return updated;
    });
  }

  function selectAllVisible() {
    // Mig 053 follow-on — respect the quick-filter. Selecting all
    // should only pick rows currently visible after the filter, not
    // every row in memory.
    const next = new Set(selected);
    // Daksh May 2026 — when single-vendor-mode is ON, select-all
    // can pick at most ONE bill per vendor. We walk filteredRows
    // in order and skip any whose vendor is already in the running
    // set (either pre-selected or just added by this pass).
    const seenVendors = new Set<string>();
    for (const id of next) {
      const row = rows.find((r) => r.id === id);
      if (row) seenVendors.add(row.vendorId);
    }
    for (const r of filteredRows) {
      if (r.hasOpenPayment) continue;
      if (singleVendorMode && seenVendors.has(r.vendorId)) continue;
      next.add(r.id);
      if (singleVendorMode) seenVendors.add(r.vendorId);
    }
    setSelected(next);
  }

  function clearAll() {
    setSelected(new Set());
    setAmountOverrides({});
  }

  function handlePropose() {
    setError(null);
    setSuccess(null);
    if (selectedRows.length === 0) return setError("Pick at least one bill.");
    const proposedAmounts: Record<string, number> = {};
    for (const r of selectedRows) {
      const override = Number(amountOverrides[r.id]);
      proposedAmounts[r.id] =
        Number.isFinite(override) && override > 0
          ? Math.min(override, r.amountOutstanding)
          : r.amountOutstanding;
    }
    const fd = new FormData();
    fd.set("bill_ids", JSON.stringify(selectedRows.map((r) => r.id)));
    fd.set("proposed_amounts", JSON.stringify(proposedAmounts));
    startTransition(async () => {
      const r = await proposeAction(fd);
      if (!r.ok) return setError(r.error);
      setSelected(new Set());
      setAmountOverrides({});
      setSuccess(
        `${r.rowsCreated} bill${r.rowsCreated === 1 ? "" : "s"} proposed${
          r.skipped.length > 0 ? ` · ${r.skipped.length} skipped` : ""
        }. Owner can confirm on Pay Today.`,
      );
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return null; // EmptyState rendered by the parent server component
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Mig 053 follow-on — branded overlay while the propose-
          payments action runs. Visible across the whole page so the
          accountant knows the click registered. */}
      <FinanceLoadingOverlay show={pending} label="Proposing payments…" />
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: "10px 14px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 8,
            color: ACCOUNTS_TOKENS.danger,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            marginBottom: 10,
            padding: "10px 14px",
            background: ACCOUNTS_TOKENS.successLight,
            border: `1px solid ${ACCOUNTS_TOKENS.success}`,
            borderRadius: 8,
            color: ACCOUNTS_TOKENS.success,
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>{success}</span>
          <Link
            href="/accounts/pay-today"
            style={{ ...BUTTON_STYLES.secondary, padding: "6px 12px", fontSize: 12 }}
          >
            Open Pay Today →
          </Link>
        </div>
      )}

      {/* Mig 053 follow-on — Daksh: "user can search vendor, bill,
          and no need to apply filter — even one letter filters live."
          Client-side filter on already-loaded rows. Searches across
          token, vendor name, and vendor bill no. Server-side filters
          (vendor dropdown, date range) still narrow the source set;
          this is for the fast in-page lookup. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <input
          type="search"
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          placeholder="🔍 Quick search — vendor, nickname, token, or bill no…"
          aria-label="Quick search due bills"
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 13,
            background: "#fff",
            border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
            borderRadius: 8,
            color: "var(--text)",
            minWidth: 240,
          }}
        />
        {/* Mig 058 follow-on (Daksh): sort toggle. Default is
            "oldest first" so the most overdue bills bubble to
            the top of the queue (natural payment-priority order). */}
        <div
          style={{
            display: "inline-flex",
            background: ACCOUNTS_TOKENS.surfaceMuted,
            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
            borderRadius: 8,
            padding: 3,
            gap: 2,
          }}
          role="group"
          aria-label="Sort by bill date"
        >
          <button
            type="button"
            onClick={() => setSortDir("oldest")}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 700,
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              background: sortDir === "oldest" ? "#fff" : "transparent",
              color: sortDir === "oldest" ? ACCOUNTS_TOKENS.accent : "var(--muted)",
              boxShadow: sortDir === "oldest" ? ACCOUNTS_TOKENS.shadow : "none",
            }}
            title="Oldest bill date first (most overdue at top)"
          >
            ↑ Oldest first
          </button>
          <button
            type="button"
            onClick={() => setSortDir("newest")}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 700,
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              background: sortDir === "newest" ? "#fff" : "transparent",
              color: sortDir === "newest" ? ACCOUNTS_TOKENS.accent : "var(--muted)",
              boxShadow: sortDir === "newest" ? ACCOUNTS_TOKENS.shadow : "none",
            }}
            title="Newest bill date first"
          >
            ↓ Newest first
          </button>
        </div>
        {/* Daksh May 2026 — single-bill-per-vendor switch. Sliding-
            pill iOS-style toggle so it visually reads as a "mode
            setting" (different shape + behaviour than the
            segmented sort pills next to it). Whole pill is
            clickable. Persists in localStorage. */}
        <button
          type="button"
          onClick={() => setSingleVendorMode((v) => !v)}
          role="switch"
          aria-checked={singleVendorMode}
          title={
            singleVendorMode
              ? "Single bill per vendor — click to allow multiple bills per vendor"
              : "Any bill — click to enforce one bill per vendor"
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "5px 6px 5px 12px",
            background: singleVendorMode
              ? "rgba(124, 58, 237, 0.08)" // soft purple fill when ON
              : "var(--surface, #fff)",
            border: `1.5px solid ${
              singleVendorMode
                ? "#7c3aed"
                : ACCOUNTS_TOKENS.borderStrong
            }`,
            borderRadius: 999,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            color: singleVendorMode ? "#5b21b6" : "var(--muted)",
            whiteSpace: "nowrap",
            transition:
              "background 0.18s ease, border-color 0.18s ease, color 0.18s ease",
            boxShadow: singleVendorMode
              ? "0 1px 2px rgba(124,58,237,0.18)"
              : "0 1px 0 rgba(15,23,42,0.04)",
          }}
        >
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>
            {singleVendorMode ? "🔒" : "🔓"}
          </span>
          <span style={{ letterSpacing: "0.01em" }}>
            {singleVendorMode ? "1 bill / vendor" : "Any bill"}
          </span>
          {/* The actual sliding switch — a 36×20 pill with a 14×14
              dot that translates between left and right. Visually
              distinct from the surrounding segmented controls. */}
          <span
            aria-hidden
            style={{
              position: "relative",
              width: 30,
              height: 18,
              borderRadius: 999,
              background: singleVendorMode ? "#7c3aed" : "#cbd5e1",
              transition: "background 0.18s ease",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: singleVendorMode ? 14 : 2,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 2px rgba(15,23,42,0.28)",
                transition: "left 0.18s ease",
              }}
            />
          </span>
        </button>
        {quickFilter && (
          <span
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "ui-monospace, monospace",
              whiteSpace: "nowrap",
            }}
          >
            {filteredRows.length} of {rows.length}
          </span>
        )}
      </div>

      <div style={TABLE_STYLES.tableWrap}>
        <div style={{ overflowX: "auto" }}>
          <table style={TABLE_STYLES.table}>
            <thead style={TABLE_STYLES.thead}>
              <tr>
                {canPropose && (
                  <th style={{ ...TABLE_STYLES.th, width: 28, padding: "8px 4px" }}>
                    <input
                      type="checkbox"
                      checked={
                        filteredRows.length > 0 &&
                        filteredRows.every(
                          (r) =>
                            r.hasOpenPayment ||
                            isRowVendorLocked(r) ||
                            selected.has(r.id),
                        )
                      }
                      onChange={(e) =>
                        e.currentTarget.checked ? selectAllVisible() : clearAll()
                      }
                    />
                  </th>
                )}
                <th style={TABLE_STYLES.th}>Vendor / token</th>
                <th style={TABLE_STYLES.th}>Bill #</th>
                <th style={TABLE_STYLES.th}>Bill date</th>
                <th style={TABLE_STYLES.th}>Cost head</th>
                <th style={TABLE_STYLES.thRight}>Total</th>
                {/* Mig 042 — tax column: GST amount per bill, plus a
                    small TDS / TCS chip under it when the bill carries
                    them. Daksh: "show tax amount after total". */}
                <th style={TABLE_STYLES.thRight}>Tax</th>
                <th style={TABLE_STYLES.thRight}>Paid</th>
                <th style={TABLE_STYLES.thRight}>Outstanding</th>
                {/* Daksh May 2026 — Propose moved before Age so it
                    lands inside the viewport on a 1440-wide screen
                    with the sidebar hidden. Age (the informational
                    column) drops to last. */}
                {canPropose && <th style={TABLE_STYLES.thRight}>Propose</th>}
                <th style={TABLE_STYLES.th}>Age / Verified</th>
                {/* Mig 081 follow-on (Daksh) — last time we paid this
                    vendor anything, on any bill. Read-only signal,
                    no checkbox or action. Helps dad triage who's
                    been waiting longest without leaving the page. */}
                <th style={TABLE_STYLES.th}>Last paid</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && quickFilter.trim() !== "" && (
                <tr>
                  <td
                    colSpan={canPropose ? 12 : 11}
                    style={{
                      padding: "20px",
                      textAlign: "center",
                      color: "var(--muted)",
                      fontSize: 13,
                    }}
                  >
                    No bills match <strong>{quickFilter}</strong>.
                  </td>
                </tr>
              )}
              {filteredRows.map((r, idx) => {
                const isSelected = selected.has(r.id);
                // Daksh May 2026 — single-bill-per-vendor lock. True
                // when the toggle is ON, this row's vendor already
                // has another ticked bill, and THIS row isn't the
                // ticked one. Mirrors the in-flight (hasOpenPayment)
                // gate — same visual treatment family (dim + grey-
                // scale + disabled checkbox + lock badge) but with
                // a slate accent instead of purple so the two locks
                // read as distinct reasons.
                const isVendorLocked = isRowVendorLocked(r);
                const display =
                  amountOverrides[r.id] != null
                    ? amountOverrides[r.id]
                    : String(r.amountOutstanding);
                // Daksh May 2026 — render a thin divider row at the
                // boundary between pinned-selected and the rest, but
                // only when BOTH buckets are non-empty AND we just
                // crossed the boundary (idx === selectedPinnedCount).
                // The divider gives the accountant a visual anchor —
                // "above the line = my picks, below = the filtered
                // queue" — so a long search that pushes their picks
                // up to the top doesn't make them feel like the
                // queue is gone.
                const showDivider =
                  selectedPinnedCount > 0 &&
                  idx === selectedPinnedCount &&
                  filteredRows.length > selectedPinnedCount;
                return (
                  <Fragment key={r.id}>
                    {showDivider && (
                      <tr aria-hidden style={{ background: "transparent" }}>
                        <td
                          colSpan={canPropose ? 12 : 11}
                          style={{
                            padding: "6px 14px 4px",
                            fontSize: 10,
                            fontWeight: 700,
                            color: "var(--muted)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            borderTop: `2px dashed ${ACCOUNTS_TOKENS.accentLight}`,
                            background: ACCOUNTS_TOKENS.surfaceMuted,
                          }}
                        >
                          {quickFilter.trim()
                            ? `Other bills matching "${quickFilter.trim()}"`
                            : "Other due bills"}
                        </td>
                      </tr>
                    )}
                    <tr
                      style={{
                        background: r.hasOpenPayment
                          ? "rgba(124,58,237,0.06)" // purple tint = in-flight
                          : isVendorLocked
                            ? "rgba(100,116,139,0.07)" // slate tint = vendor-locked
                            : isSelected
                              ? ACCOUNTS_TOKENS.accentLight
                              : r.heldAmount > 0
                                ? "rgba(254,243,199,0.45)"
                                : idx % 2 === 0
                                  ? "#fff"
                                  : ACCOUNTS_TOKENS.surfaceMuted,
                        opacity: r.hasOpenPayment || isVendorLocked ? 0.7 : 1,
                        // Desaturate blocked rows (either in-flight
                        // OR vendor-locked) so the colored chips
                        // (Pink Stone, COST HEAD) read as muted too.
                        filter:
                          r.hasOpenPayment || isVendorLocked
                            ? "grayscale(0.5)"
                            : undefined,
                        boxShadow: r.hasOpenPayment
                          ? "inset 4px 0 0 #7c3aed" // purple stripe = in-flight
                          : isVendorLocked
                            ? "inset 4px 0 0 #64748b" // slate stripe = vendor-locked
                            : r.heldAmount > 0
                              ? "inset 4px 0 0 #d97706"
                              : undefined,
                        transition: "background 0.1s",
                        // Block pointer events on the entire row
                        // except the checkbox + the vendor link.
                        // Implemented with pointer-events: none on
                        // the children, OR by intercepting on the
                        // checkbox via the disabled flag. Disabled
                        // checkbox already blocks toggle; the visual
                        // changes carry the rest.
                      }}
                    >
                    {canPropose && (
                      // Daksh May 2026 — tighter padding on the
                      // checkbox cell so dad isn't staring at 20 px
                      // of whitespace before the vendor avatar.
                      <td style={{ ...TABLE_STYLES.td, padding: "8px 4px" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={r.hasOpenPayment || isVendorLocked}
                          onChange={() => toggle(r.id)}
                          title={
                            r.hasOpenPayment
                              ? "🔒 Already in Pay Today — mark paid first to act on this bill again"
                              : isVendorLocked
                                ? "🔒 Vendor already in this batch — untick the other bill first, or switch to 'Any bill' mode"
                                : undefined
                          }
                          // Visually distinct disabled state — the
                          // default macOS look is barely different
                          // from enabled.
                          style={
                            r.hasOpenPayment || isVendorLocked
                              ? { cursor: "not-allowed", opacity: 0.4 }
                              : undefined
                          }
                        />
                        {!r.hasOpenPayment && isVendorLocked && (
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 800,
                              color: "#475569", // slate-600
                              letterSpacing: "0.06em",
                              marginTop: 4,
                              padding: "2px 5px",
                              borderRadius: 4,
                              background: "rgba(100,116,139,0.12)",
                              border: "1px solid rgba(100,116,139,0.32)",
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                              textAlign: "center",
                            }}
                            title="Single-bill-per-vendor mode — this vendor already has another bill in the batch. Switch the toggle at the top to 'Any bill' if you want to add more."
                          >
                            🔒 Vendor ticked
                          </div>
                        )}
                        {r.hasOpenPayment && (
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 800,
                              color: "#7c3aed",
                              letterSpacing: "0.06em",
                              marginTop: 4,
                              padding: "2px 5px",
                              borderRadius: 4,
                              background: "rgba(124,58,237,0.12)",
                              border: "1px solid rgba(124,58,237,0.32)",
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                              textAlign: "center",
                            }}
                            title="A payment for this bill is currently in Pay Today (proposed / confirmed / bank-rejected). Mark it paid to act on this bill again."
                          >
                            🔒 In Pay Today
                          </div>
                        )}
                      </td>
                    )}
                    <td style={TABLE_STYLES.td}>
                      <Link
                        href={`/accounts/bills/${r.id}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <VendorIdentity
                          name={r.vendorName}
                          subLabel={r.token}
                          size={26}
                        />
                      </Link>
                      {/* Mig 066 — small "owner" line so multi-firm
                          vendors are easy to spot at a glance. Only
                          renders when the vendor row has a nickname. */}
                      {r.vendorNickname && (
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 10,
                            color: "var(--muted)",
                            fontStyle: "italic",
                          }}
                          title="Vendor nickname / owner handle"
                        >
                          ✦ {r.vendorNickname}
                        </div>
                      )}
                      {/* Mig 061 — category pill below the vendor
                          identity. Uncategorised renders muted so
                          legacy vendors don't shout for attention. */}
                      {(() => {
                        const cat = getBillVendorCategory(r.vendorCategory);
                        return (
                          <div style={{ marginTop: 4 }}>
                            <span
                              style={{
                                display: "inline-block",
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 8px",
                                background: cat.pill.bg,
                                color: cat.pill.fg,
                                borderRadius: 999,
                                letterSpacing: "0.03em",
                              }}
                            >
                              {cat.label}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <code style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                        {r.vendorBillNo}
                      </code>
                    </td>
                    {/* Daksh May 2026 — date now single-line via
                        whiteSpace: nowrap + 2-digit year ("19 Jan
                        25" instead of "19 Jan / 2025" on two
                        lines). Frees a meaningful chunk of column
                        width so the Propose column fits. */}
                    <td
                      style={{
                        ...TABLE_STYLES.td,
                        fontSize: 12,
                        color: "var(--muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(r.billDate).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        year: "2-digit",
                      })}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      {r.costHead ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 10px",
                            borderRadius: 999,
                            background: ACCOUNTS_TOKENS.surfaceMuted,
                            color: ACCOUNTS_TOKENS.neutral,
                            fontWeight: 600,
                            border: `1px solid ${ACCOUNTS_TOKENS.border}`,
                          }}
                        >
                          {r.costHead}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <Money value={r.amountTotal} tone="muted" />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <TaxCell
                        gst={r.amountGst}
                        tds={r.amountTds}
                        tcs={r.amountTcs}
                      />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <PaidCell paid={r.amountPaid} parts={r.paymentParts} />
                    </td>
                    <td style={TABLE_STYLES.tdRight}>
                      <Money value={r.amountOutstanding} tone="warning" />
                      {/* Mig 072 — show the owner-held slice inline so
                          the accountant sees, at a glance, what's
                          actually proposable. Hover for the reason. */}
                      {r.heldAmount > 0 && (
                        <div
                          title={
                            r.heldReason
                              ? `Held by owner: ${r.heldReason}`
                              : "Held by owner"
                          }
                          style={{
                            marginTop: 4,
                            fontSize: 10,
                            fontWeight: 800,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "#fef3c7",
                            color: "#92400e",
                            border: "1px solid #d97706",
                            fontFamily: "ui-monospace, monospace",
                            display: "inline-block",
                            whiteSpace: "nowrap",
                          }}
                        >
                          🔒 HELD ₹{r.heldAmount.toLocaleString("en-IN")}
                        </div>
                      )}
                    </td>
                    {/* Daksh May 2026 — Propose td moved BEFORE the
                        Age td so the actionable input lands inside
                        the viewport on a 1440-wide screen with the
                        sidebar hidden. Age (informational) is now
                        the trailing column. */}
                    {canPropose && (
                      <td style={TABLE_STYLES.tdRight}>
                        {(() => {
                          // Mig 072 — proposable = outstanding − held.
                          // When fully held, the row is greyed out
                          // and the propose input becomes a notice
                          // pointing to the bill detail page.
                          const proposable = Math.max(
                            0,
                            r.amountOutstanding - r.heldAmount,
                          );
                          const fullyHeld = r.heldAmount >= r.amountOutstanding;
                          if (!isSelected) {
                            return <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>;
                          }
                          if (fullyHeld) {
                            return (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "#92400e",
                                  fontFamily: "ui-monospace, monospace",
                                }}
                                title="Owner has held the full outstanding — release the hold before proposing"
                              >
                                🔒 fully held
                              </span>
                            );
                          }
                          return (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={proposable}
                              value={display}
                              disabled={r.hasOpenPayment}
                              onFocus={(e) => {
                                // Daksh May 2026 — clear the auto-filled
                                // default on first focus so dad doesn't
                                // have to manually erase the full
                                // outstanding before typing a partial
                                // amount. Only fires when there's no
                                // user-typed override yet (i.e. the
                                // field is still showing the proposable
                                // default). If he's already typed a
                                // custom value, focus is a no-op and
                                // his work is preserved.
                                //
                                // onBlur (below) handles the "clicked
                                // away without typing" case — it
                                // restores the default by deleting the
                                // empty override.
                                if (amountOverrides[r.id] == null) {
                                  setAmountOverrides((p) => ({ ...p, [r.id]: "" }));
                                  // Don't need .select() — the input is
                                  // now empty, cursor is ready.
                                }
                              }}
                              onChange={(e) => {
                                // Cap at PROPOSABLE — outstanding minus
                                // owner's hold. Empty string is allowed
                                // during typing so the user can clear
                                // and retype.
                                const raw = e.target.value;
                                if (raw === "") {
                                  setAmountOverrides((p) => ({ ...p, [r.id]: "" }));
                                  return;
                                }
                                const n = Number(raw);
                                if (!Number.isFinite(n) || n < 0) return;
                                const clamped =
                                  n > proposable
                                    ? String(proposable)
                                    : raw;
                                setAmountOverrides((p) => ({ ...p, [r.id]: clamped }));
                              }}
                              onBlur={(e) => {
                                // On blur, normalise: empty/0 → proposable,
                                // otherwise leave the user's number alone.
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n) || n <= 0) {
                                  setAmountOverrides((p) => {
                                    const next = { ...p };
                                    delete next[r.id];
                                    return next;
                                  });
                                }
                              }}
                              title={
                                r.heldAmount > 0
                                  ? `Max ₹${proposable.toLocaleString("en-IN")} — outstanding ₹${r.amountOutstanding.toLocaleString("en-IN")} minus held ₹${r.heldAmount.toLocaleString("en-IN")}`
                                  : `Max ₹${proposable.toLocaleString("en-IN")} — capped at outstanding`
                              }
                              style={{
                                width: 100,
                                padding: "5px 7px",
                                fontSize: 12,
                                fontFamily: "ui-monospace, monospace",
                                border: `1px solid ${
                                  r.heldAmount > 0
                                    ? "#d97706"
                                    : ACCOUNTS_TOKENS.accent
                                }`,
                                borderRadius: 6,
                                background:
                                  r.heldAmount > 0 ? "#fffbeb" : "#fff",
                                color: "var(--text)",
                                textAlign: "right",
                              }}
                            />
                          );
                        })()}
                      </td>
                    )}
                    <td style={TABLE_STYLES.td}>
                      {/* Mig 064 follow-on (Daksh, 2nd pass) — royalty
                          net dot sits to the LEFT of the age pill on
                          each row (outside the pill, not inside).
                          Same 3-px black dot used on the vendor
                          profile page; click reveals "Net: +/-X (10s)"
                          inline. Only renders when the vendor has a
                          non-zero approved net AND the viewer's role
                          can see royalty data. */}
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {r.vendorRoyaltyNet !== null && r.vendorRoyaltyNet !== 0 && (
                          <RoyaltyNetPeek netValue={r.vendorRoyaltyNet} />
                        )}
                        <AgeBadge
                          bucket={r.ageBucket}
                          days={r.daysSinceBill}
                          premature={r.prematureForPayment}
                          termsDays={r.paymentTermsDays}
                        />
                      </div>
                      {r.crosscheckedAt && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 10,
                            color: "var(--muted)",
                            fontFamily: "ui-monospace, monospace",
                            whiteSpace: "nowrap",
                          }}
                          title={`Crosschecked at ${new Date(r.crosscheckedAt).toLocaleString("en-IN")}`}
                        >
                          ✅{" "}
                          {new Date(r.crosscheckedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
                            day: "numeric",
                            month: "short",
                          })}
                        </div>
                      )}
                    </td>
                    {/* Mig 081 follow-on (Daksh) — last time this
                        vendor was paid anything, across all their
                        bills. Read-only triage signal: dad uses it
                        to prioritise who's been waiting longest.
                        "—" when this is the vendor's first bill in
                        the system. The colour intensifies as the gap
                        gets larger (green ≤ 30d, amber 30-90d,
                        red > 90d, slate when never). */}
                    <LastPaidCell isoDate={r.lastPaidAtForVendor} />
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Premature-payment warning (mig 040: per-vendor terms).
          Renders above the sticky bar when the current selection
          includes any bill younger than its vendor's terms. Soft
          block — user can still proceed if they have a reason. */}
      {canPropose && prematureSelected.length > 0 && (
        <div
          style={{
            marginTop: 14,
            padding: "12px 16px",
            background: "rgba(251, 191, 36, 0.10)",
            border: "1.5px solid #f59e0b",
            borderLeft: "5px solid #b45309",
            borderRadius: 10,
            fontSize: 13,
            color: "#78350f",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
          role="alert"
        >
          <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">
            ⚠️
          </span>
          <div style={{ flex: 1 }}>
            <strong>
              {prematureSelected.length} bill
              {prematureSelected.length === 1 ? "" : "s"} below vendor payment terms
            </strong>
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5 }}>
              Each vendor's terms (Vendor Account → payment terms) determine
              when bills become payable. You can still propose now, but please
              double-check before sending.
              Bills affected:{" "}
              {prematureSelected
                .map(
                  (r) =>
                    `${r.vendorName} (${r.daysSinceBill}d / terms ${r.paymentTermsDays}d)`,
                )
                .join(", ")}
              .
            </div>
          </div>
        </div>
      )}

      {/* Daksh May 2026 — sticky-was-wrong fix. position: sticky
          only kicks in once the user has scrolled PAST the bar's
          natural position; while scrolling through a long list the
          bar sat at the END of the list, out of view. Switched to
          position: fixed so the bar is ALWAYS pinned to the
          viewport bottom whenever there's a selection — no matter
          how deep into the list the accountant has scrolled.
          left: var(--content-left) matches the Pay Today footer
          pattern so the bar starts where the sidebar ends; on
          mobile (<900px) --content-left collapses to 0. The
          bottom-padding spacer below reserves layout space so
          the last list row isn't hidden behind the fixed bar. */}
      {canPropose && selected.size > 0 && (
        <>
          <div
            style={{
              position: "fixed",
              left: "var(--content-left, 240px)",
              right: 0,
              bottom: 0,
              padding: "12px 24px calc(12px + env(safe-area-inset-bottom, 0px))",
              background: "rgba(255,255,255,0.96)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              borderTop: `1.5px solid ${ACCOUNTS_TOKENS.accent}`,
              boxShadow: "0 -8px 24px rgba(79,70,229,0.14)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              zIndex: 50,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {selected.size} bill{selected.size === 1 ? "" : "s"} selected
              </span>
              <Money value={selectedTotal} size="large" tone="accent" />
            </div>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={clearAll}
              style={BUTTON_STYLES.ghost}
              disabled={pending}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handlePropose}
              disabled={pending}
              style={BUTTON_STYLES.primary}
            >
              {pending
                ? "Proposing…"
                : `💸 Propose ${selected.size} for Pay Today`}
            </button>
          </div>
          {/* Spacer so the last list row isn't visually hidden
              behind the fixed bar. Matches the bar's approximate
              height (~72px) — tighter than the bar itself so it
              doesn't add a giant gap when the bar wraps. */}
          <div aria-hidden style={{ height: 80 }} />
        </>
      )}
    </div>
  );
}

/** Mig 081 follow-on (Daksh) — small read-only cell that summarises
 *  how long ago this vendor was last paid. Three states:
 *    • "—" + slate     when isoDate is null (vendor has never been
 *                      paid; the system has no record).
 *    • "Today" / "2d ago" / "31 May" formatted compactly, plus
 *      a coloured gap pill (green ≤30d, amber 30-90d, red >90d)
 *      so dad can scan the column and spot the long-waiters.
 *  Pure presentation — no callbacks, no writes. */
function LastPaidCell({ isoDate }: { isoDate: string | null }) {
  if (!isoDate) {
    return (
      <td style={{ ...TABLE_STYLES.td }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 700,
            background: "var(--surface-alt)",
            color: "var(--muted)",
            border: "1px solid var(--border)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
          title="No prior payment recorded for this vendor"
        >
          — never paid
        </span>
      </td>
    );
  }
  const paidMs = new Date(isoDate).getTime();
  const days = Math.max(0, Math.floor((Date.now() - paidMs) / 86_400_000));
  const dateLabel = new Date(isoDate).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
  const tone =
    days <= 30
      ? { bg: "rgba(22,163,74,0.10)", fg: "#15803d", border: "rgba(22,163,74,0.32)" }
      : days <= 90
        ? { bg: "rgba(217,119,6,0.10)", fg: "#b45309", border: "rgba(217,119,6,0.32)" }
        : { bg: "rgba(220,38,38,0.10)", fg: "#b91c1c", border: "rgba(220,38,38,0.4)" };
  const gapLabel =
    days === 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
  return (
    <td style={{ ...TABLE_STYLES.td }}>
      <div
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 3,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 800,
            background: tone.bg,
            color: tone.fg,
            border: `1px solid ${tone.border}`,
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}
          title={`Last paid ${new Date(isoDate).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`}
        >
          💸 {gapLabel}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--muted)",
            fontFamily: "ui-monospace, monospace",
            whiteSpace: "nowrap",
          }}
        >
          {dateLabel}
        </span>
      </div>
    </td>
  );
}

function AgeBadge({
  bucket,
  days,
  premature,
  termsDays,
}: {
  bucket: DueBillRow["ageBucket"];
  days: number;
  premature?: boolean;
  /** This vendor's payment terms in days. Drives the "Pay after Nd"
   *  countdown text on the premature pill. Falls back to the legacy
   *  45 if not supplied (mostly to keep call sites optional). */
  termsDays?: number;
}) {
  const tints: Record<DueBillRow["ageBucket"], { bg: string; fg: string; dot: string }> = {
    "0_30":    { bg: "#dcfce7", fg: "#166534", dot: "#22c55e" },
    "31_60":   { bg: "#fef3c7", fg: "#92400e", dot: "#f59e0b" },
    "61_90":   { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c" },
    "90_plus": { bg: "#fee2e2", fg: "#991b1b", dot: "#ef4444" },
  };
  const t = tints[bucket];
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 10px 2px 8px",
          borderRadius: 999,
          background: t.bg,
          color: t.fg,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "ui-monospace, monospace",
        }}
        title={`${days} day${days === 1 ? "" : "s"} since bill date`}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: t.dot }} />
        {days}d
      </span>
      {premature && (
        <span
          title={`Vendor's terms: ${termsDays ?? DEFAULT_PAYMENT_TERMS_DAYS}d after bill date`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 4,
            background: "rgba(251, 191, 36, 0.15)",
            color: "#92400e",
            border: "1px solid #fbbf24",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          ⚠ Pay after {Math.max(0, (termsDays ?? DEFAULT_PAYMENT_TERMS_DAYS) - days)}d
        </span>
      )}
    </div>
  );
}

/** Mig 042 — tax column on the due-bills table. Shows the GST
 *  amount prominently and stacks small TDS / TCS chips underneath
 *  for the bills that carry them, so the accountant sees the tax
 *  composition at a glance. */
function TaxCell({
  gst,
  tds,
  tcs,
}: {
  gst: number;
  tds: number;
  tcs: number;
}) {
  if (gst <= 0 && tds <= 0 && tcs <= 0) {
    return <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>;
  }
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 2,
      }}
    >
      {gst > 0 ? (
        <Money value={gst} tone="muted" />
      ) : (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>
      )}
      {(tds > 0 || tcs > 0) && (
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            fontFamily: "ui-monospace, monospace",
            fontSize: 10,
          }}
        >
          {tds > 0 && (
            <span
              title="TDS deducted from vendor payment"
              style={{
                padding: "1px 6px",
                borderRadius: 4,
                background: ACCOUNTS_TOKENS.dangerLight,
                color: ACCOUNTS_TOKENS.danger,
                fontWeight: 700,
              }}
            >
              −TDS ₹{tds.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          )}
          {tcs > 0 && (
            <span
              title="TCS collected by vendor — included in payable"
              style={{
                padding: "1px 6px",
                borderRadius: 4,
                background: ACCOUNTS_TOKENS.accentLight,
                color: ACCOUNTS_TOKENS.accent,
                fontWeight: 700,
              }}
            >
              +TCS ₹{tcs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Paid column cell — total paid figure with a breakdown of the
 *  individual payment chunks underneath (Daksh: "show paid amount in
 *  parts. like 10000 under that 20000 and under that 20000"). If the
 *  bill has no payments yet the cell collapses to a muted dash. */
function PaidCell({
  paid,
  parts,
}: {
  paid: number;
  parts: DueBillRow["paymentParts"];
}) {
  if (paid <= 0 || parts.length === 0) {
    return <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>;
  }
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <Money value={paid} tone="success" />
      {parts.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {parts.map((p, i) => {
            const datePart = p.paidAt
              ? new Date(p.paidAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
                  day: "numeric",
                  month: "short",
                })
              : null;
            return (
              <span
                key={i}
                title={[
                  `Part #${i + 1}`,
                  datePart ? `Paid on ${datePart}` : null,
                  p.method ? `via ${p.method}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#15803d",
                  background: "rgba(34, 197, 94, 0.10)",
                  border: "1px solid rgba(34, 197, 94, 0.25)",
                  borderRadius: 4,
                  padding: "1px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                ₹{p.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                {datePart ? (
                  <span style={{ opacity: 0.7, fontWeight: 500 }}> · {datePart}</span>
                ) : null}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
