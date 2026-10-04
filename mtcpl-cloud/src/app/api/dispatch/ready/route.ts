// ──────────────────────────────────────────────────────────────────
// GET /api/dispatch/ready — ready slabs, one temple at a time
// ──────────────────────────────────────────────────────────────────
// The Make Dispatch board used to ship every ready slab into the HTML:
// ~2,000 of them, 1.3 MB, which a plant tablet has to download, parse
// and hold before the first card paints. Daksh, Oct 2026: "that page
// takes time to open, maybe because it needs to load so many slabs."
//
// The board only draws counts and totals now (see the summaries in
// dispatch/page.tsx). The slabs themselves come from here, and only for
// the temple somebody actually opened — or, when searching, only for
// the rows that match.
//
//   ?temple=NAME[&station=main|<shedId>|all]   one temple's slabs
//   ?q=TEXT                                    search across the board
//
// Same auth as the Dispatch page, and the same shaping, so a slab looks
// identical whether it arrived with the HTML or over this route.
// ──────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged, chunkIds } from "@/lib/paginate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A search with no temple could otherwise walk the whole board; the
 *  picker is for choosing, not for browsing two thousand rows. */
const SEARCH_CAP = 400;

/** Same arithmetic the Dispatch page uses. The *_ft columns hold INCHES
 *  despite their names (a long-standing quirk of this schema), which is
 *  why the divisor is 1728 and not 1. */
const toCft = (l: number, w: number, h: number) => (l * w * h) / 1728;

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const temple = (sp.get("temple") ?? "").trim();
  const station = (sp.get("station") ?? "all").trim();
  const q = (sp.get("q") ?? "").trim();

  if (!temple && !q) {
    return NextResponse.json({ ok: false, error: "Ask for a temple or a search." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  try {
    // ── 1. The slabs themselves ───────────────────────────────────
    const base = () =>
      admin
        .from("slab_requirements")
        .select(
          "id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, priority, status, cancel_requested_at, component_section, component_element, additional_description",
        )
        .eq("status", "completed")
        .eq("is_parked", false);

    let rows: Array<Record<string, unknown>>;
    if (temple) {
      rows = await fetchAllPaged((from, to) =>
        base().eq("temple", temple).order("priority", { ascending: false }).order("id").range(from, to),
      );
    } else {
      // Search the fields the board's own search box searches.
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const { data } = await base()
        .or(
          [
            `id.ilike.${like}`,
            `label.ilike.${like}`,
            `description.ilike.${like}`,
            `temple.ilike.${like}`,
            `additional_description.ilike.${like}`,
          ].join(","),
        )
        .order("temple")
        .order("id")
        .limit(SEARCH_CAP);
      rows = (data ?? []) as Array<Record<string, unknown>>;
    }

    if (rows.length === 0) return NextResponse.json({ ok: true, slabs: [], capped: false });

    const ids = rows.map((r) => String(r.id));

    // ── 2. The same side-lookups the page does ────────────────────
    // Carving rows give the ready-since timer, the dispatch gate and
    // the station. Chunked: 2,000 text ids in one .in() is a 26 KB URL.
    const gate = new Map<string, { receivedAtDispatch: string | null; stationId: string | null; readySince: string | null; reworked: boolean }>();
    for (const chunk of chunkIds(ids, 400)) {
      const { data } = await admin
        .from("carving_items")
        .select("slab_requirement_id, ready_to_dispatch_at, received_at_dispatch_at, dispatch_station_id, review_reworked_at")
        .in("slab_requirement_id", chunk);
      for (const r of (data ?? []) as Array<{
        slab_requirement_id: string; ready_to_dispatch_at: string | null;
        received_at_dispatch_at: string | null; dispatch_station_id: string | null;
        review_reworked_at: string | null;
      }>) {
        const prev = gate.get(r.slab_requirement_id);
        if (!prev || r.ready_to_dispatch_at) {
          gate.set(r.slab_requirement_id, {
            receivedAtDispatch: r.received_at_dispatch_at,
            stationId: r.dispatch_station_id ?? null,
            readySince: r.ready_to_dispatch_at,
            reworked: !!r.review_reworked_at,
          });
        }
      }
    }

    const { data: stationRows } = await admin
      .from("dispatch_stations")
      .select("id, is_default, vendor_id")
      .eq("is_active", true);
    const stations = (stationRows ?? []) as Array<{ id: string; is_default: boolean; vendor_id: string | null }>;
    const mainStationId = stations.find((s) => s.is_default)?.id ?? null;
    const shedIds = new Set(stations.filter((s) => s.vendor_id).map((s) => s.id));
    const stationOf = (slabId: string): string => {
      const sid = gate.get(slabId)?.stationId ?? null;
      if (sid && shedIds.has(sid) && sid !== mainStationId) return sid;
      return "main";
    };

    // Marble vs sandstone, read the same way the page reads it.
    const { data: stoneTypeRows } = await admin.from("stone_types").select("name, stone_category");
    const stoneCategoryMap: Record<string, string> = {};
    for (const st of (stoneTypeRows ?? []) as Array<{ name: string; stone_category?: string }>) {
      stoneCategoryMap[st.name] = st.stone_category === "marble" ? "marble" : "sandstone";
    }

    // ── 3. Shape, exactly as the page does ────────────────────────
    const slabs = rows
      .map((s) => {
        const id = String(s.id);
        const L = Number(s.length_ft), W = Number(s.width_ft), T = Number(s.thickness_ft);
        const g = gate.get(id);
        return {
          id,
          label: (s.label as string | null) ?? null,
          description: (s.description as string | null) ?? null,
          temple: String(s.temple),
          stone: (s.stone as string | null) ?? null,
          quality: (s.quality as string | null) ?? null,
          dimensions: `${L}×${W}×${T} in`,
          cft: toCft(L, W, T),
          priority: Boolean(s.priority),
          isMarble: stoneCategoryMap[(s.stone as string) ?? ""] === "marble",
          readySince: g?.readySince ?? null,
          reworked: g?.reworked ?? false,
          cancelPending: !!s.cancel_requested_at,
          hasCarving: gate.has(id),
          receivedAtDispatch: g?.receivedAtDispatch ?? null,
          station: stationOf(id),
          component_section: (s.component_section as string | null) ?? null,
          component_element: (s.component_element as string | null) ?? null,
          additional_description: (s.additional_description as string | null) ?? null,
        };
      })
      // The board filters by station before it groups, so the picker
      // must honour the station it was opened from — otherwise opening
      // a shed's card would hand back Main Dispatch's slabs too.
      .filter((s) => station === "all" || s.station === station);

    return NextResponse.json(
      { ok: true, slabs, capped: !temple && rows.length >= SEARCH_CAP },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
