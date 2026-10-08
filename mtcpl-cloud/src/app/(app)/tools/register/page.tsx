/**
 * Type the paper register in — one page at a time (mig 231).
 *
 * The team would not accept per-person entry at the cupboard, so the
 * register stays on paper exactly as it is and one person types the
 * page in afterwards. Each vendor keeps a separate register, which is
 * why the vendor is chosen once at the top and never per line.
 *
 * A vendor may type their own register; a store manager may type any.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canSeeCncToolMaster,
  canUseCncTools,
  canManageCncToolStore,
} from "@/lib/cnc-tool-permissions";
import { loadStore, listToolVendors, orderForTaking } from "@/lib/cnc-tool-stock";
import { saveToolRegisterPageAction, undoToolRegisterPageAction } from "../actions";
import { RegisterGrid, type GridTool, type RecentPage } from "./register-grid";

export const dynamic = "force-dynamic";

export default async function ToolRegisterPage() {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const isMaster = canSeeCncToolMaster(profile);
  const [{ tools, movements }, allVendors] = await Promise.all([
    loadStore(),
    listToolVendors(),
  ]);

  // A vendor types only their own register. A manager picks.
  const vendors = isMaster
    ? allVendors
    : allVendors.filter((v) => v.id === profile.vendor_id);
  if (vendors.length === 0) redirect("/tools");

  const gridTools: GridTool[] = orderForTaking(tools).map((t) => ({
    id: t.id,
    name: t.name,
    spec: t.spec,
    unit: t.unit,
    stock: t.stock,
  }));

  // Names already seen on each vendor's register, newest first, so the
  // typist gets a suggestion instead of spelling a name three ways.
  const peopleByVendor: Record<string, string[]> = {};
  for (const v of vendors) {
    const seen = new Map<string, number>();
    for (const m of movements) {
      if (m.undone_at || m.kind !== "issue" || m.vendor_id !== v.id) continue;
      const name = (m.taken_by ?? "").trim();
      if (!name) continue;
      const at = new Date(m.created_at).getTime();
      const key = name.toLowerCase();
      if (!seen.has(key) || at > (seen.get(key) as number)) seen.set(key, at);
    }
    peopleByVendor[v.id] = [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([key]) =>
        movements.find((m) => (m.taken_by ?? "").trim().toLowerCase() === key)?.taken_by?.trim() ?? key,
      );
  }

  // Pages already entered, so nobody types the same page twice.
  const admin = createAdminSupabaseClient();
  const { data: batchRows } = await admin
    .from("cnc_tool_register_batches")
    .select("id, vendor_id, register_date, entered_at, line_count, undone_at")
    .in("vendor_id", vendors.map((v) => v.id))
    .order("entered_at", { ascending: false })
    .limit(15);

  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const recent: RecentPage[] = ((batchRows ?? []) as Array<{
    id: string; vendor_id: string; register_date: string;
    entered_at: string; line_count: number; undone_at: string | null;
  }>).map((b) => ({
    id: b.id,
    vendorName: vendorName.get(b.vendor_id) ?? "—",
    registerDate: b.register_date,
    enteredAt: b.entered_at,
    lines: b.line_count,
    undone: !!b.undone_at,
  }));

  return (
    <section className="page-fluid tc-page allow-portrait" style={{ paddingBottom: 60 }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "var(--muted)", marginBottom: 5,
            }}
          >
            🧰 Tool store
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.4px", margin: 0 }}>
            Enter the register
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "6px 0 0", maxWidth: "66ch", lineHeight: 1.55 }}>
            Type a page of the paper register exactly as it is written. Pick
            whose register it is, then fill one line per entry. Tab moves
            across, Enter starts the next line.
          </p>
        </div>
        <Link
          href="/tools"
          style={{
            marginLeft: "auto", padding: "10px 16px", fontSize: 13, fontWeight: 700,
            borderRadius: 11, textDecoration: "none", whiteSpace: "nowrap",
            border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
          }}
        >
          ← Store
        </Link>
      </header>

      <RegisterGrid
        vendors={vendors}
        tools={gridTools}
        peopleByVendor={peopleByVendor}
        recent={recent}
        canUndo={canManageCncToolStore(profile)}
        saveAction={saveToolRegisterPageAction}
        undoAction={undoToolRegisterPageAction}
      />
    </section>
  );
}
