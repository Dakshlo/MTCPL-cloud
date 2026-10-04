// ──────────────────────────────────────────────────────────────────
// /tools — the CNC tool crib (Migration 227)
// ──────────────────────────────────────────────────────────────────
// Replaces the physical register the CNC vendors keep for tools.
//
// DEVELOPER ONLY in v1 (Daksh, Oct 2026: "for now we will make it for
// developer only; once done we will make it for all users which are
// relevant"). The gate is canUseCncTools() and it is re-checked inside
// every server action — this redirect is the courtesy, not the control.
//
// The crib is per vendor. In v1 the developer picks one from the
// switcher; in v2 a vendor is pinned to their own and the switcher goes
// away. Nothing else about the page changes, because which cribs you may
// touch is already a question the code asks (cncToolVendorIdsFor).
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { canManageCncToolCrib, canUseCncTools } from "@/lib/cnc-tool-permissions";
import { loadCrib, listToolVendors, takenByHistory } from "@/lib/cnc-tool-stock";

import { CribClient } from "./crib-client";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ToolCribPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const vendors = await listToolVendors();
  const sp = await searchParams;
  const wanted = typeof sp.vendor === "string" ? sp.vendor : null;
  const active = vendors.find((v) => v.id === wanted) ?? vendors[0] ?? null;

  if (!active) {
    return (
      <section className="page-fluid" style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>Tool crib</h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
          There are no active CNC vendors to keep a crib for.
        </p>
      </section>
    );
  }

  const { tools, movements } = await loadCrib(active.id);

  return (
    <CribClient
      vendors={vendors}
      activeVendorId={active.id}
      activeVendorName={active.name}
      tools={tools}
      movements={movements.slice(0, 200)}
      people={takenByHistory(movements)}
      canManage={canManageCncToolCrib(profile)}
    />
  );
}
