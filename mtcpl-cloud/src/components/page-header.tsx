"use client";

import { usePathname } from "next/navigation";

const labels: Record<string, string> = {
  dashboard: "Dashboard",
  blocks: "Blocks",
  slabs: "Slabs",
  planning: "Plan Generator",
  cutting: "Cutting"
};

export function PageHeader() {
  const pathname = usePathname();
  const segment = pathname.split("/").filter(Boolean)[0] || "dashboard";

  return (
    <div className="page-header">
      <span className="page-breadcrumb">Operations</span>
      <span className="page-separator">/</span>
      <strong>{labels[segment] || "Operations"}</strong>
    </div>
  );
}
