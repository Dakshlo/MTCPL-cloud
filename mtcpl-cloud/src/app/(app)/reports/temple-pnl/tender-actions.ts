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
import { TENDER_KEY, TENDER_UOMS, canUseTender, computeSheetTotal, sectionsOf, type TenderAnalysis, type TenderGroup, type TenderQuote, type TenderSection, type TenderUom, type TenderVersion } from "./tender-model";

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
    if (!canUseTender(profile.role)) return { ok: false, error: "Not allowed." };
    if (!Array.isArray(analyses) || analyses.length > 40) return { ok: false, error: "Too many sheets." };

    const posOrNull = (v: unknown) =>
      v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v);

    const cleanGroups = (raw: unknown): TenderGroup[] =>
      (Array.isArray(raw) ? raw : []).slice(0, 30).map((g) => ({
        id: s(g?.id, 40) || "g",
        title: s(g?.title, 120),
        items: (Array.isArray(g?.items) ? g.items : []).slice(0, 60).map((it: unknown) => {
          const i = it as { id?: unknown; title?: unknown; mode?: unknown; value?: unknown };
          return {
            id: s(i?.id, 40) || "i",
            title: s(i?.title, 160),
            mode: i?.mode === "per_cft" || i?.mode === "percent" ? i.mode : ("amount" as const),
            value: n(i?.value),
          };
        }),
      }));

    /** Covering-letter fields. Dropped entirely when every field is blank so an
     *  untouched sheet never carries an empty object into storage. */
    const cleanQuote = (raw: unknown): TenderQuote | undefined => {
      const q = raw as Partial<TenderQuote> | null | undefined;
      if (!q || typeof q !== "object") return undefined;
      const out: TenderQuote = {
        toName: s(q.toName, 120),
        toOrg: s(q.toOrg, 200),
        toPlace: s(q.toPlace, 120),
        work: s(q.work, 160),
        intro: s(q.intro, 1200),
        terms: s(q.terms, 2000),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(q.date ?? "")) ? String(q.date) : "",
        refNo: s(q.refNo, 60),
      };
      return Object.values(out).some((v) => v) ? out : undefined;
    };

    const uomOr = (v: unknown, fallback: TenderUom = "Cft."): TenderUom =>
      TENDER_UOMS.includes(v as TenderUom) ? (v as TenderUom) : fallback;

    /** Master groups. Capped at 10 — a quotation with more separate rate
     *  breakups than that is a different document, not one sheet. */
    const cleanSections = (raw: unknown): TenderSection[] =>
      (Array.isArray(raw) ? raw : []).slice(0, 10).map((sec, i) => ({
        id: s(sec?.id, 40) || `s${i}`,
        title: s(sec?.title, 160),
        uom: uomOr(sec?.uom),
        qty: posOrNull(sec?.qty),
        groups: cleanGroups(sec?.groups),
      }));

    /** Saved snapshots, newest first, capped — the whole list shares one
     *  app_settings row, so unbounded history would blow the size limit. */
    const cleanVersions = (raw: unknown): TenderVersion[] | undefined => {
      if (!Array.isArray(raw) || raw.length === 0) return undefined;
      return raw.slice(0, 12).map((v) => {
        const groups = cleanGroups(v?.groups);
        const qty = posOrNull(v?.qty);
        const sections = Array.isArray(v?.sections) && v.sections.length > 0 ? cleanSections(v.sections) : undefined;
        return {
          id: s(v?.id, 40) || "v",
          label: s(v?.label, 120) || "Version",
          savedAt: s(v?.savedAt, 40),
          qty,
          groups,
          sections,
          // Recomputed, never trusted from the client.
          grand: computeSheetTotal({ sections, groups, qty }).grand,
        };
      });
    };

    const clean: TenderAnalysis[] = analyses.map((a) => {
      // Sections are the truth. A sheet that has never been opened since the
      // Aug-2026 rework still arrives in the legacy shape — sectionsOf lifts it,
      // so what lands in storage is always sectioned from here on.
      const sections = cleanSections(
        Array.isArray(a?.sections) && a.sections.length > 0 ? a.sections : sectionsOf({ groups: cleanGroups(a?.groups), qty: posOrNull(a?.qty), uom: uomOr(a?.uom) }),
      );
      const first = sections[0];
      return {
        id: s(a?.id, 40) || `t${Date.now()}`,
        name: s(a?.name, 120) || "Untitled",
        paceCftPerDay: posOrNull(a?.paceCftPerDay),
        manualDays: posOrNull(a?.manualDays),
        createdAt: s(a?.createdAt, 40),
        updatedAt: new Date().toISOString(),
        quote: cleanQuote(a?.quote),
        versions: cleanVersions(a?.versions),
        sections,
        // Legacy mirror of the FIRST section. Anything still reading the old
        // top-level fields sees a coherent single-section sheet rather than
        // stale or doubled numbers.
        qty: first?.qty ?? null,
        uom: first ? first.uom : undefined,
        groups: first?.groups ?? [],
      };
    });

    if (JSON.stringify(clean).length > 900_000) return { ok: false, error: "Sheets too large — delete an old version or sheet." };

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
