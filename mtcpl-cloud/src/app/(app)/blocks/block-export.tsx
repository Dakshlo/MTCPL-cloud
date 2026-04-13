"use client";

import Link from "next/link";

export function BlockExport() {
  return (
    <Link href="/blocks/report" className="secondary-button" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
      View Report →
    </Link>
  );
}
