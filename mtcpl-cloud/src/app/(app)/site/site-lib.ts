import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// ──────────────────────────────────────────────────────────────────
// Site / Installation data loader (mig 133). One call returns the whole
// picture for a temple's site portal; each page renders the slice it
// needs (dashboard / stock / install).
// ──────────────────────────────────────────────────────────────────

export type Yard = { id: string; name: string };

export type SiteSlab = {
  id: string;
  label: string | null;
  description: string | null;
  stone: string | null;
  quality: string | null;
  l: number;
  w: number;
  t: number;
  cft: number;
  priority: boolean;
  yardId: string | null;
  yardName: string | null;
  installedAt: string | null;
  installNote: string | null;
  installPhotoUrl: string | null;
};

export type SiteTruck = {
  dispatchId: string;
  challanNumber: number | null;
  loadNumber: number | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  whenAt: string; // delivered_at (to-unload) or dispatched_at (on-road)
  toUnload: SiteSlab[]; // slabs still needing a yard (to-unload trucks)
  slabCount: number; // total slabs on the truck (on-road trucks)
};

export type SiteData = {
  temple: string;
  yards: Yard[];
  onRoad: SiteTruck[]; // approved, not delivered — heading here
  toUnload: SiteTruck[]; // delivered, still have un-yarded slabs
  stock: SiteSlab[]; // in a yard, not installed
  installed: SiteSlab[]; // installed (recent first)
  counts: { onRoad: number; toUnload: number; stock: number; installed: number; yards: number };
};

const toCft = (l: number, w: number, t: number) => (l * w * t) / 1728;

function shapeSlab(
  s: {
    id: string; label: string | null; description: string | null; stone: string | null; quality: string | null;
    length_ft: number | string; width_ft: number | string; thickness_ft: number | string; priority: boolean | null;
    site_yard_id: string | null; installed_at: string | null; install_note: string | null; install_photo_path: string | null;
  },
  yardName: string | null,
  photoUrl: (p: string | null) => string | null,
): SiteSlab {
  const l = Number(s.length_ft) || 0;
  const w = Number(s.width_ft) || 0;
  const t = Number(s.thickness_ft) || 0;
  return {
    id: s.id,
    label: s.label,
    description: s.description,
    stone: s.stone,
    quality: s.quality,
    l, w, t,
    cft: toCft(l, w, t),
    priority: s.priority === true,
    yardId: s.site_yard_id,
    yardName,
    installedAt: s.installed_at,
    installNote: s.install_note,
    installPhotoUrl: photoUrl(s.install_photo_path),
  };
}

const SLAB_COLS =
  "id, label, description, stone, quality, length_ft, width_ft, thickness_ft, priority, site_yard_id, installed_at, install_note, install_photo_path";

/** Resolve the temple name from a URL slug. We route by the temple's
 *  code_prefix (URL-safe, unique) but fall back to a raw name match so
 *  links built from the name still resolve. Returns null if unknown. */
export async function resolveTemple(slug: string): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const decoded = decodeURIComponent(slug);
  // Prefix match first (e.g. /site/HYD).
  const { data: byPrefix } = await admin
    .from("temples")
    .select("name")
    .ilike("code_prefix", decoded)
    .maybeSingle();
  if (byPrefix?.name) return byPrefix.name as string;
  const { data: byName } = await admin
    .from("temples")
    .select("name")
    .ilike("name", decoded)
    .maybeSingle();
  return (byName?.name as string) ?? null;
}

export async function loadSiteData(temple: string): Promise<SiteData> {
  const admin = createAdminSupabaseClient();
  const photoUrl = (p: string | null) =>
    p ? admin.storage.from("site_install_photos").getPublicUrl(p).data.publicUrl : null;

  const [{ data: yardRows }, { data: onRoadRows }, { data: deliveredRows }, { data: stockRows }, { data: installedRows }] =
    await Promise.all([
      admin.from("site_yards").select("id, name").eq("temple", temple).eq("is_active", true).order("name"),
      // On the road = approved, not delivered, heading to this temple.
      admin
        .from("dispatches")
        .select("id, challan_number, load_number, vehicle_no, driver_name, driver_phone, dispatched_at")
        .eq("temple", temple)
        .not("approved_at", "is", null)
        .is("delivered_at", null)
        .order("dispatched_at", { ascending: false }),
      // Delivered trucks (candidates for unloading).
      admin
        .from("dispatches")
        .select("id, challan_number, load_number, vehicle_no, driver_name, driver_phone, delivered_at")
        .eq("temple", temple)
        .not("delivered_at", "is", null)
        .order("delivered_at", { ascending: false })
        .limit(400),
      // In-stock = unloaded into a yard, not yet installed.
      admin
        .from("slab_requirements")
        .select(SLAB_COLS)
        .eq("temple", temple)
        .not("site_yard_id", "is", null)
        .is("installed_at", null)
        .order("site_unloaded_at", { ascending: false })
        .limit(5000),
      // Installed, recent first.
      admin
        .from("slab_requirements")
        .select(SLAB_COLS)
        .eq("temple", temple)
        .not("installed_at", "is", null)
        .order("installed_at", { ascending: false })
        .limit(500),
    ]);

  const yards: Yard[] = ((yardRows ?? []) as Array<{ id: string; name: string }>).map((y) => ({ id: y.id, name: y.name }));
  const yardName = (id: string | null) => (id ? yards.find((y) => y.id === id)?.name ?? "—" : null);

  // On-road trucks — slab counts from dispatch_logs.
  const onRoadDispatches = (onRoadRows ?? []) as Array<{
    id: string; challan_number: number | null; load_number: number | null;
    vehicle_no: string | null; driver_name: string | null; driver_phone: string | null; dispatched_at: string;
  }>;
  const deliveredDispatches = (deliveredRows ?? []) as Array<{
    id: string; challan_number: number | null; load_number: number | null;
    vehicle_no: string | null; driver_name: string | null; driver_phone: string | null; delivered_at: string;
  }>;

  const allDispatchIds = [...onRoadDispatches.map((d) => d.id), ...deliveredDispatches.map((d) => d.id)];
  const logsByDispatch = new Map<string, string[]>();
  if (allDispatchIds.length > 0) {
    const { data: logs } = await admin
      .from("dispatch_logs")
      .select("dispatch_id, slab_requirement_id")
      .in("dispatch_id", allDispatchIds);
    for (const l of (logs ?? []) as Array<{ dispatch_id: string | null; slab_requirement_id: string | null }>) {
      if (!l.dispatch_id || !l.slab_requirement_id) continue;
      const arr = logsByDispatch.get(l.dispatch_id) ?? [];
      arr.push(l.slab_requirement_id);
      logsByDispatch.set(l.dispatch_id, arr);
    }
  }

  // For delivered trucks we need each slab's current site_yard_id to know
  // what's still to unload. Pull the relevant slab rows once.
  const deliveredSlabIds = [...new Set(deliveredDispatches.flatMap((d) => logsByDispatch.get(d.id) ?? []))];
  const slabById = new Map<string, ReturnType<typeof shapeSlab>>();
  if (deliveredSlabIds.length > 0) {
    // Chunk to stay under the IN() / row caps.
    for (let i = 0; i < deliveredSlabIds.length; i += 1000) {
      const chunk = deliveredSlabIds.slice(i, i + 1000);
      const { data } = await admin.from("slab_requirements").select(SLAB_COLS).in("id", chunk);
      for (const s of (data ?? []) as Parameters<typeof shapeSlab>[0][]) {
        slabById.set(s.id, shapeSlab(s, yardName(s.site_yard_id), photoUrl));
      }
    }
  }

  const onRoad: SiteTruck[] = onRoadDispatches.map((d) => ({
    dispatchId: d.id,
    challanNumber: d.challan_number,
    loadNumber: d.load_number,
    vehicleNo: d.vehicle_no,
    driverName: d.driver_name,
    driverPhone: d.driver_phone,
    whenAt: d.dispatched_at,
    toUnload: [],
    slabCount: (logsByDispatch.get(d.id) ?? []).length,
  }));

  const toUnload: SiteTruck[] = deliveredDispatches
    .map((d) => {
      const slabs = (logsByDispatch.get(d.id) ?? [])
        .map((id) => slabById.get(id))
        .filter((s): s is SiteSlab => !!s && !s.yardId && !s.installedAt);
      return {
        dispatchId: d.id,
        challanNumber: d.challan_number,
        loadNumber: d.load_number,
        vehicleNo: d.vehicle_no,
        driverName: d.driver_name,
        driverPhone: d.driver_phone,
        whenAt: d.delivered_at,
        toUnload: slabs,
        slabCount: slabs.length,
      };
    })
    .filter((t) => t.toUnload.length > 0);

  const stock: SiteSlab[] = ((stockRows ?? []) as Parameters<typeof shapeSlab>[0][]).map((s) =>
    shapeSlab(s, yardName(s.site_yard_id), photoUrl),
  );
  const installed: SiteSlab[] = ((installedRows ?? []) as Parameters<typeof shapeSlab>[0][]).map((s) =>
    shapeSlab(s, yardName(s.site_yard_id), photoUrl),
  );

  return {
    temple,
    yards,
    onRoad,
    toUnload,
    stock,
    installed,
    counts: {
      onRoad: onRoad.length,
      toUnload: toUnload.reduce((n, t) => n + t.toUnload.length, 0),
      stock: stock.length,
      installed: installed.length,
      yards: yards.length,
    },
  };
}
