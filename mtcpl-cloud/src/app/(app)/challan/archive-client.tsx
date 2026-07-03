"use client";

/**
 * Challan archive — filterable, sortable browse view.
 *
 * All filters + sort are client-side over the pre-fetched rows. That keeps
 * the page instant-responsive without round-trips for every dropdown change,
 * and since each row is ~300 bytes of text, holding a few thousand in
 * memory is cheap.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

export type ChallanRow = {
  id: string;
  challan_number: number | null;
  doc_fy: string | null;
  doc_seq: number | null;
  temple: string;
  vehicle_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  dispatched_at: string;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  receiver_name: string | null;
  delivery_note: string | null;
  dispatcher_name: string | null;
  approver_name: string | null;
  delivered_by_name: string | null;
  slabCount: number;
  totalCft: number;
  stones: string[];
};

type SortKey = "challan" | "temple" | "stone" | "dispatched_at";
type SortDir = "asc" | "desc";

// Jul 2026 — prefer the UNIFIED code (CH-26/27-N, mig 168); the legacy
// CHLN-#### only for pre-168 rows.
function chalanLabel(r: { challan_number: number | null; doc_fy: string | null; doc_seq: number | null; id: string }): string {
  if (r.doc_fy && r.doc_seq != null) return `CH-${r.doc_fy}-${String(r.doc_seq).padStart(2, "0")}`;
  if (r.challan_number != null) return `CHLN-${String(r.challan_number).padStart(4, "0")}`;
  return `DISP-${r.id.slice(0, 8).toUpperCase()}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export function ChallanArchiveClient({
  rows,
  temples,
  stones,
}: {
  rows: ChallanRow[];
  temples: string[];
  stones: string[];
}) {
  const [query, setQuery] = useState("");
  const [templeFilter, setTempleFilter] = useState<string>("");
  const [stoneFilter, setStoneFilter] = useState<string>("");
  const [truckFilter, setTruckFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "delivered">("all");
  const [sortKey, setSortKey] = useState<SortKey>("challan");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Apply filters + sort
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const truckQ = truckFilter.trim().toLowerCase();
    let list = rows.slice();

    if (q) {
      list = list.filter((r) => {
        const ch = chalanLabel(r).toLowerCase();
        return (
          ch.includes(q) ||
          r.temple.toLowerCase().includes(q) ||
          (r.vehicle_no ?? "").toLowerCase().includes(q) ||
          (r.driver_name ?? "").toLowerCase().includes(q) ||
          (r.driver_phone ?? "").toLowerCase().includes(q)
        );
      });
    }
    if (templeFilter) list = list.filter((r) => r.temple === templeFilter);
    if (stoneFilter) list = list.filter((r) => r.stones.includes(stoneFilter));
    if (truckQ) list = list.filter((r) => (r.vehicle_no ?? "").toLowerCase().includes(truckQ));
    if (statusFilter === "out") list = list.filter((r) => !r.delivered_at);
    if (statusFilter === "delivered") list = list.filter((r) => !!r.delivered_at);

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "challan") {
        cmp = (a.challan_number ?? 0) - (b.challan_number ?? 0);
      } else if (sortKey === "temple") {
        cmp = a.temple.localeCompare(b.temple);
      } else if (sortKey === "stone") {
        const as = a.stones.join(",");
        const bs = b.stones.join(",");
        cmp = as.localeCompare(bs);
      } else if (sortKey === "dispatched_at") {
        cmp = a.dispatched_at.localeCompare(b.dispatched_at);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [rows, query, templeFilter, stoneFilter, truckFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "challan" || key === "dispatched_at" ? "desc" : "asc");
    }
  }

  function clearFilters() {
    setQuery("");
    setTempleFilter("");
    setStoneFilter("");
    setTruckFilter("");
    setStatusFilter("all");
  }

  const totalCftInView = filtered.reduce((sum, r) => sum + r.totalCft, 0);
  const totalSlabsInView = filtered.reduce((sum, r) => sum + r.slabCount, 0);

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            📋 Old Challans
          </h1>
          <p className="muted">
            Every dispatch challan ever issued. Filter by truck, temple, or stone; reprint the A4 challan from
            any row.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          marginTop: 18,
          padding: 12,
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <label className="stack" style={{ flex: "2 1 240px" }}>
          <span>Search</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="CHLN-#, temple, vehicle, driver…"
          />
        </label>
        <label className="stack" style={{ flex: "1 1 180px" }}>
          <span>Temple</span>
          <select value={templeFilter} onChange={(e) => setTempleFilter(e.target.value)}>
            <option value="">All temples</option>
            {temples.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ flex: "1 1 160px" }}>
          <span>Stone</span>
          <select value={stoneFilter} onChange={(e) => setStoneFilter(e.target.value)}>
            <option value="">All stones</option>
            {stones.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ flex: "1 1 140px" }}>
          <span>Truck No.</span>
          <input
            type="text"
            value={truckFilter}
            onChange={(e) => setTruckFilter(e.target.value)}

            style={{ textTransform: "uppercase", fontFamily: "ui-monospace, monospace" }}
          />
        </label>
        <label className="stack" style={{ flex: "0 0 140px" }}>
          <span>Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "out" | "delivered")}>
            <option value="all">All</option>
            <option value="out">Out for delivery</option>
            <option value="delivered">Delivered</option>
          </select>
        </label>
        {(query || templeFilter || stoneFilter || truckFilter || statusFilter !== "all") && (
          <button
            type="button"
            className="ghost-button"
            onClick={clearFilters}
            style={{ fontSize: 12 }}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>
        Showing <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {rows.length} challans ·{" "}
        <strong style={{ color: "var(--text)" }}>{totalSlabsInView}</strong> slab
        {totalSlabsInView !== 1 ? "s" : ""} · <strong style={{ color: "var(--text)" }}>{totalCftInView.toFixed(2)}</strong>{" "}
        CFT
      </div>

      {/* Table */}
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 960 }}>
          <thead>
            <tr style={{ background: "var(--surface-alt)", borderBottom: "2px solid var(--border)" }}>
              <Th onClick={() => toggleSort("challan")} active={sortKey === "challan"} dir={sortDir}>
                Challan
              </Th>
              <Th onClick={() => toggleSort("temple")} active={sortKey === "temple"} dir={sortDir}>
                Temple
              </Th>
              <th style={thStyle}>Vehicle</th>
              <th style={thStyle}>Driver</th>
              <Th onClick={() => toggleSort("stone")} active={sortKey === "stone"} dir={sortDir}>
                Stone
              </Th>
              <th style={thStyle}>Slabs · CFT</th>
              <Th onClick={() => toggleSort("dispatched_at")} active={sortKey === "dispatched_at"} dir={sortDir}>
                Dispatched
              </Th>
              <th style={thStyle}>Delivered</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>
                  No challans match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                // Whole-row click target — anywhere on the row opens the
                // print challan in a new tab (matches the existing Print
                // button's target="_blank" so behaviour is consistent).
                // Print button is stopPropagation'd below so it still
                // works as a normal click without re-firing the row.
                const openPrint = () => window.open(`/dispatch/${r.id}/print`, "_blank", "noopener");
                return (
                <tr
                  key={r.id}
                  onClick={openPrint}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openPrint();
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  style={{
                    borderBottom: "1px solid var(--border-light)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-alt)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "var(--gold-dark)" }}>
                    {chalanLabel(r)}
                  </td>
                  <td style={tdStyle}>{r.temple}</td>
                  <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace" }}>
                    {r.vehicle_no ?? <span className="muted">—</span>}
                  </td>
                  <td style={tdStyle}>
                    {r.driver_name ?? <span className="muted">—</span>}
                    {r.driver_phone && (
                      <div className="muted" style={{ fontSize: 10 }}>
                        {r.driver_phone}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.stones.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      r.stones.join(", ")
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace" }}>
                    {r.slabCount} · {r.totalCft.toFixed(2)}
                  </td>
                  <td style={tdStyle}>
                    {fmtDate(r.dispatched_at)}
                    {r.dispatcher_name && (
                      <div className="muted" style={{ fontSize: 10 }}>
                        by {r.dispatcher_name}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.delivered_at ? (
                      <>
                        <span style={{ color: "#15803d", fontWeight: 600 }}>✓ {fmtDate(r.delivered_at)}</span>
                        {r.receiver_name && (
                          <div className="muted" style={{ fontSize: 10 }}>
                            {r.receiver_name}
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: "#2563EB", fontSize: 11, fontWeight: 600 }}>On the road</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <Link
                      href={`/dispatch/${r.id}/print`}
                      target="_blank"
                      className="ghost-button"
                      style={{ fontSize: 11, padding: "4px 10px", textDecoration: "none" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      🖨 Print
                    </Link>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "top",
};

function Th({
  children,
  onClick,
  active,
  dir,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    <th
      style={{
        ...thStyle,
        cursor: "pointer",
        userSelect: "none",
        color: active ? "var(--gold-dark)" : "var(--muted)",
      }}
      onClick={onClick}
    >
      {children}{" "}
      {active && (
        <span style={{ fontSize: 10, opacity: 0.7 }}>{dir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );
}
