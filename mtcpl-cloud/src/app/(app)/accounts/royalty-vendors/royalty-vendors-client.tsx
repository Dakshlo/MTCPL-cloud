"use client";

/**
 * Royalty Vendors browser — Aug 2026, Daksh for his dad.
 *
 * The problem it solves: to look at one vendor's royalty points the
 * owner had to go Finance → vendor → private data → passphrase, read
 * it, go back, pick the next vendor, and type the passphrase again.
 * The Royalty Summary shows the totals but not any one vendor's
 * ledger. Switching vendors was the slow part.
 *
 * So: unlock ONCE, then a searchable list of every vendor that has
 * royalty points on the left, and that vendor's ledger on the right —
 * click to switch, no prompt in between.
 *
 * The right-hand panel is the SAME <PrivateNotesModal> component the
 * vendor page uses, rendered `embedded` with the passphrase already
 * verified. Sharing the component (rather than rebuilding the panel
 * here) is what guarantees the two screens look and behave the same
 * — including add, cancel, and clear-all, which all work here exactly
 * as they do on the vendor page.
 */

import { useEffect, useMemo, useState } from "react";
import { PassphraseInput } from "@/components/passphrase-input";
import Link from "next/link";
import { listRoyaltyVendorsAction } from "../actions";
import { PrivateNotesModal } from "../vendors/[id]/private-notes-modal";

type VendorRow = {
  id: string;
  name: string;
  net: number;
  received: number;
  given: number;
  entryCount: number;
  lastEntryAt: string | null;
};

function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(n);
}

export function RoyaltyVendorsClient({
  isDeveloper,
}: {
  isDeveloper: boolean;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function unlock(e?: React.FormEvent) {
    e?.preventDefault();
    if (!passphrase) { setError("Enter the passphrase."); return; }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("passphrase", passphrase);
      const r = await listRoyaltyVendorsAction(fd);
      if (!r.ok) { setError(r.error); return; }
      setVendors(r.vendors);
      setUnlocked(true);
      if (r.vendors.length > 0) setSelectedId(r.vendors[0].id);
    } finally {
      setLoading(false);
    }
  }

  /** Refresh the left list — totals move when you add or clear on the
   *  right, and a stale sidebar next to a fresh ledger is confusing. */
  async function refreshList() {
    if (!unlocked) return;
    const fd = new FormData();
    fd.set("passphrase", passphrase);
    const r = await listRoyaltyVendorsAction(fd);
    if (r.ok) setVendors(r.vendors);
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.name.toLowerCase().includes(q));
  }, [vendors, query]);

  // Keep the selection valid when a search hides the selected vendor.
  useEffect(() => {
    if (!selectedId) return;
    if (shown.some((v) => v.id === selectedId)) return;
    if (shown.length > 0) setSelectedId(shown[0].id);
  }, [shown, selectedId]);

  const selected = vendors.find((v) => v.id === selectedId) ?? null;

  /* ── locked ─────────────────────────────────────────────────── */
  if (!unlocked) {
    return (
      <section className="page-card">
        <div style={{ maxWidth: 420, margin: "40px auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Owner view
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>🔒 Royalty by vendor</h1>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 8 }}>
              Enter the royalty passphrase once. After that you can move between vendors
              without being asked again.
            </p>
          </div>
          <form onSubmit={unlock} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PassphraseInput
              value={passphrase}
              onChange={setPassphrase}
              placeholder="Passphrase"
              autoFocus
              inputMode="numeric"
              style={{ padding: "10px 12px", fontSize: 14, border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
            />
            {error && (
              <div style={{ fontSize: 12, color: "#b91c1c", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 11px" }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !passphrase}
              style={{ padding: "11px 16px", fontSize: 14, fontWeight: 800, borderRadius: 10, border: "none", background: "var(--gold-dark)", color: "#fff", cursor: loading ? "wait" : "pointer" }}
            >
              {loading ? "Opening…" : "Unlock"}
            </button>
          </form>
          <Link href="/accounts/royalty-summary" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            ← Back to Royalty Summary
          </Link>
        </div>
      </section>
    );
  }

  /* ── unlocked ───────────────────────────────────────────────── */
  return (
    <section className="page-card page-fluid">
      <div className="record-head" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Owner view
          </div>
          <h1 style={{ margin: "2px 0 0", display: "flex", alignItems: "center", gap: 9 }}>
            🏷 Royalty by vendor
          </h1>
        </div>
        <Link
          href="/accounts/royalty-summary"
          style={{ textDecoration: "none", alignSelf: "flex-start", padding: "9px 14px", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, color: "var(--text)", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}
        >
          ← Summary
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(230px, 300px) 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* ── left: the vendor list ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 9, position: "sticky", top: 12 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 13, opacity: 0.6 }}>🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendor…"
              style={{ width: "100%", padding: "9px 11px 9px 33px", fontSize: 13, border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
            />
          </div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>
            {shown.length} of {vendors.length} vendor{vendors.length === 1 ? "" : "s"} with points
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: "68vh", overflowY: "auto", paddingRight: 2 }}>
            {shown.length === 0 && (
              <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: "24px 10px", border: "1px dashed var(--border)", borderRadius: 10 }}>
                No vendor matches “{query}”.
              </div>
            )}
            {shown.map((v) => {
              const active = v.id === selectedId;
              const pos = v.net >= 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  style={{
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    padding: "9px 11px",
                    borderRadius: 10,
                    border: `1.5px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
                    background: active ? "rgba(184,115,51,0.09)" : "var(--surface)",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.name}>
                    {v.name}
                  </span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 900, fontSize: 13, color: pos ? "#15803d" : "#b91c1c" }}>
                      {pos ? "+" : "−"}{fmtNum(Math.abs(v.net))}
                    </span>
                    <span className="muted" style={{ fontSize: 10, fontWeight: 700, marginLeft: "auto" }}>
                      {v.entryCount} {v.entryCount === 1 ? "entry" : "entries"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── right: the same panel the vendor page shows ── */}
        <div style={{ minWidth: 0, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: 16 }}>
          {selected ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{selected.name}</span>
                <Link
                  href={`/accounts/vendors/${selected.id}`}
                  className="muted"
                  style={{ fontSize: 11.5, marginLeft: "auto" }}
                >
                  Open full vendor page →
                </Link>
              </div>
              <PrivateNotesModal
                /* Remount on vendor change so the panel's own state
                   (form fields, just-added flash, wipe banner) resets
                   instead of bleeding across vendors. */
                key={selected.id}
                vendorId={selected.id}
                canShow
                canCancelRoyalty
                canWipeRoyalty
                canRecoverRoyalty={isDeveloper}
                embedded
                presetPassphrase={passphrase}
                initialTab="royalty"
                onChanged={refreshList}
              />
            </>
          ) : (
            <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "60px 20px" }}>
              No vendor has royalty points yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
