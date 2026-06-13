/**
 * 🔨 Installation portal (mig 133) — server shell.
 *
 * Two columns: right = in-stock slabs (by yard), left = installed.
 * Drag (or tap) a stock card into Installed → note + photo → done.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { SITE_ROLES } from "../../site-roles";
import { loadSiteData, resolveTemple } from "../../site-lib";
import { InstallClient } from "./install-client";

export const dynamic = "force-dynamic";

export default async function SiteInstallPage({ params }: { params: Promise<{ temple: string }> }) {
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
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🔨 Installation Portal</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
          Drag a stock slab into <strong>Installed</strong> (or tap <strong>Install</strong>) — add a note + photo as proof.
        </p>
      </div>

      <InstallClient temple={temple} stock={data.stock} installed={data.installed} />
    </div>
  );
}
