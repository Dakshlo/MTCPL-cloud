"use client";

import { useState } from "react";

export function BlockExport() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const url = `/api/blocks/export?${params.toString()}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `blocks-${from || "all"}-to-${to || "all"}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      alert("Export failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function setPreset(days: number | null) {
    setTo(today);
    if (days === null) {
      setFrom("");
    } else {
      setFrom(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
  }

  return (
    <div className="add-panel" style={{ marginBottom: 0 }}>
      <div className="add-panel-header">
        <div>
          <p className="add-panel-title">Export Blocks to Excel</p>
          <p className="add-panel-subtitle">
            All blocks in date range — including consumed, discarded, and active · Full logistics data
          </p>
        </div>
      </div>

      <div className="add-panel-body">
        <div className="add-panel-row" style={{ flexWrap: "wrap", gap: 10 }}>
          {/* Quick presets */}
          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Quick Range</span>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { label: "Last 7 days", days: 7 },
                { label: "30 days", days: 30 },
                { label: "90 days", days: 90 },
                { label: "All time", days: null },
              ].map(p => (
                <button
                  key={p.label}
                  type="button"
                  className="ghost-button"
                  style={{ fontSize: 12, padding: "3px 9px" }}
                  onClick={() => setPreset(p.days)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>From Date</span>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              style={{ width: 150 }}
            />
          </label>

          <label className="stack" style={{ flex: "0 0 auto" }}>
            <span>To Date</span>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              style={{ width: 150 }}
            />
          </label>

          <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
            <span style={{ visibility: "hidden", fontSize: 12 }}>·</span>
            <button
              className="primary-button"
              type="button"
              onClick={handleExport}
              disabled={loading}
              style={{ gap: 6 }}
            >
              {loading ? "Exporting…" : "⬇ Export Excel"}
            </button>
          </div>
        </div>

        <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          Columns exported: Block Code · Stone · Yard · Category · Length · Width · Height · CFT · Status · Truck No. · Vendor · Bill No. · Added Date · Last Updated
        </p>
      </div>
    </div>
  );
}
