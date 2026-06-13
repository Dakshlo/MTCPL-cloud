/**
 * 🏗️ Stock Yard (mig 133) — server shell.
 *
 * Top: delivered trucks waiting to be unloaded (each → pick/create a
 * yard). Below: every in-stock slab, grouped by yard, card view +
 * search, with transfer-between-yards.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { SITE_ROLES } from "../../site-roles";
import { loadSiteData, resolveTemple } from "../../site-lib";
import { StockClient } from "./stock-client";

export const dynamic = "force-dynamic";

export default async function SiteStockPage({ params }: { params: Promise<{ temple: string }> }) {
  const { profile } = await requireAuth();
  if (!SITE_ROLES.includes(profile.role)) redirect("/");
  const { temple: slug } = await params;
  const temple = await resolveTemple(slug);
  if (!temple) notFound();

  const data = await loadSiteData(temple);
  const base = `/site/${encodeURIComponent(slug)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 40 }}>
      <div>
        <Link href={base} style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textDecoration: "none" }}>← {temple} site</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🏗️ Stock Yard</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
          Unload delivered trucks into a yard, then manage stock yard-wise. Ready to install? Use the{" "}
          <Link href={`${base}/install`} style={{ fontWeight: 700 }}>Installation portal</Link>.
        </p>
      </div>

      <StockClient
        temple={temple}
        yards={data.yards}
        toUnload={data.toUnload}
        stock={data.stock}
      />
    </div>
  );
}
