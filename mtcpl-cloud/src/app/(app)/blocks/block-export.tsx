"use client";

import Link from "next/link";

export function BlockExport() {
  return (
    <div className="add-panel" style={{ marginBottom: 0 }}>
      <div className="add-panel-header">
        <div>
          <p className="add-panel-title">Block Report</p>
          <p className="add-panel-subtitle">
            View, filter and sort all block records — including consumed, discarded, and active · Export to Excel from the report page
          </p>
        </div>
        <Link href="/blocks/report" className="primary-button" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
          View Report →
        </Link>
      </div>
    </div>
  );
}
