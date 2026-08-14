"use server";

/**
 * Tender / Price-Breakdown analyses (Daksh, Aug 2026) — the Excel-style
 * costing sheets on the Temple P&L page. Developer-only, like the page.
 *
 * Storage: ONE app_settings row (key "tender_analyses") holding every
 * sheet as jsonb — same no-migration pattern as the payment planner's
 * fa_vendor_meta. Saves are FULL SNAPSHOTS of the whole list (patches
 * raced in the planner; snapshots didn't), debounced client-side.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { TENDER_KEY, type TenderAnalysis } from "./tender-model";

/** app_settings.updated_by is uuid; the dev-mock id isn't one. */
function asUuid(id: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

const s = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
};

/** Full-snapshot save. Sanitises everything — the client is trusted UI,
 *  not a trusted source. */
export async function saveTenderAnalysesAction(
  analyses: TenderAnalysis[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { profile } = await requireAuth();
    if (profile.role !== "developer") return { ok: false, error: "Not allowed." };
    if (!Array.isArray(analyses) || analyses.length > 40) return { ok: false, error: "Too many sheets." };

    const posOrNull = (v: unknown) =>
      v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v);
    const clean: TenderAnalysis[] = analyses.map((a) => ({
      id: s(a?.id, 40) || `t${Date.now()}`,
      name: s(a?.name, 120) || "Untitled",
      qty: posOrNull(a?.qty),
      paceCftPerDay: posOrNull(a?.paceCftPerDay),
      manualDays: posOrNull(a?.manualDays),
      createdAt: s(a?.createdAt, 40),
      updatedAt: new Date().toISOString(),
      groups: (Array.isArray(a?.groups) ? a.groups : []).slice(0, 30).map((g) => ({
        id: s(g?.id, 40) || "g",
        title: s(g?.title, 120),
        items: (Array.isArray(g?.items) ? g.items : []).slice(0, 60).map((it) => ({
          id: s(it?.id, 40) || "i",
          title: s(it?.title, 160),
          mode: it?.mode === "per_cft" || it?.mode === "percent" ? it.mode : "amount",
          value: n(it?.value),
        })),
      })),
    }));

    if (JSON.stringify(clean).length > 400_000) return { ok: false, error: "Sheets too large." };

    const admin = createAdminSupabaseClient();
    const { error } = await admin.from("app_settings").upsert({
      key: TENDER_KEY,
      value: { analyses: clean },
      updated_at: new Date().toISOString(),
      updated_by: asUuid(profile.id),
    });
    if (error) return { ok: false, error: error.message };

    void logAudit(profile.id, "tender_analyses_saved", "app_settings", TENDER_KEY, {
      sheets: clean.length,
    });
    revalidatePath("/reports/temple-pnl");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
