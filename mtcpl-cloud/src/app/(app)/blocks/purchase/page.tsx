/**
 * Block Purchase — owner/developer-only report of every block that
 * entered the system, grouped truck-wise.
 *
 * The block-journey page next door is about EFFICIENCY (what the block
 * produced). This page is the dual — INTAKE. "How much did we buy?"
 *
 * Two data shapes, one tab each:
 *   1. Marble — every row in marble_truck_entries IS a truck. The
 *      sibling blocks (linked by truck_entry_id) are listed inside it.
 *   2. Sandstone — there is no parent "truck" row; the truck_no +
 *      vendor_name live directly on each block. We group blocks added
 *      on the same date with the same (truck_no, vendor_name) — that's
 *      one operational truck.
 *
 * Both queries are bounded server-side with explicit ranges so we
 * don't get bitten by PostgREST's 1000-row default. Volumes are
 * small (a few hundred trucks/year) so paging up to 5000 is plenty.
 *
 * Auth: hard-gated to owner + developer. No managed-vendor escape
 * hatch. This is internal procurement data — sensitive.
 */

import { redirect } from "next/navigation";
import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { BlockPurchaseClient } from "./purchase-client";
import type { StoneCategory } from "@/lib/stone-categories";

export const dynamic = "force-dynamic";

export type MarbleTruckRow = {
  id: string;
  stone: string;
  truck_no: string | null;
  vendor_name: string | null;
  total_tonnes: number | null;
  num_blocks: number | null;
  created_at: string;
};

export type BlockRow = {
  id: string;
  stone: string;
  yard: number | null;
  quality: string | null;
  category: string | null;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  tonnes: number | null;
  truck_no: string | null;
  vendor_name: string | null;
  bill_no: string | null;
  truck_entry_id: string | null;
  /** "available" / "reserved" → still in stock. "consumed" → cut.
   *  "discarded" → written off. */
  status: string | null;
  created_at: string;
};

/** Stock buckets for the Compare panel — purchased vs still-on-hand. */
export type StockTotals = {
  purchasedBlocks: number;
  purchasedCft: number;
  purchasedTonnes: number;   // marble: from truck rows · sandstone: blocks
  inStockBlocks: number;
  inStockCft: number;
  inStockTonnes: number;
  consumedBlocks: number;
  consumedCft: number;
  consumedTonnes: number;
};

export type MarbleTruck = MarbleTruckRow & {
  blocks: BlockRow[];
  totalCft: number;  // 8 CFT per tonne equivalent
};

/** Synthetic sandstone "truck" — blocks grouped by (date · truck_no · vendor). */
export type SandstoneTruck = {
  /** Stable key for React: date + truck + vendor. */
  key: string;
  date: string;          // ISO date (YYYY-MM-DD)
  truck_no: string | null;
  vendor_name: string | null;
  stones: string[];      // distinct stones in this truck
  blocks: BlockRow[];
  totalCft: number;
  totalTonnes: number;   // sum of tonnes column (mostly null for sandstone, but a few entries do carry it)
};

export default async function BlockPurchasePage() {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    redirect(getDefaultRouteForRole(profile.role));
  }

  const admin = createAdminSupabaseClient();

  const PAGE = 1000;
  const MAX = 5000;

  // Paginated marble-trucks fetch (no filter).
  async function fetchMarbleTrucks(): Promise<MarbleTruckRow[]> {
    const out: MarbleTruckRow[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const { data, error } = await admin
        .from("marble_truck_entries")
        .select("id, stone, truck_no, vendor_name, total_tonnes, num_blocks, created_at")
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`marble_truck_entries fetch failed: ${error.message}`);
      if (!data || data.length === 0) break;
      out.push(...(data as MarbleTruckRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  // Paginated FRESH blocks fetch. Reused blocks are leftover material
  // re-categorised internally, not a purchase, so we exclude them.
  async function fetchFreshBlocks(): Promise<BlockRow[]> {
    const out: BlockRow[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const { data, error } = await admin
        .from("blocks")
        .select(
          "id, stone, yard, quality, category, length_ft, width_ft, height_ft, tonnes, truck_no, vendor_name, bill_no, truck_entry_id, status, created_at",
        )
        .eq("category", "Fresh")
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`blocks fetch failed: ${error.message}`);
      if (!data || data.length === 0) break;
      out.push(...(data as BlockRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  /** "available" / "reserved" → still in yard. "consumed" / "discarded"
   *  → off the books. Used to bucket each block for the Compare view. */
  function isInStock(s: string | null): boolean {
    return s === "available" || s === "reserved";
  }
  function isConsumed(s: string | null): boolean {
    return s === "consumed";
  }
  /** Sandstone CFT from inch-stored dims. */
  function blockCft(b: BlockRow): number {
    const l = Number(b.length_ft) || 0;
    const w = Number(b.width_ft) || 0;
    const h = Number(b.height_ft) || 0;
    if (l > 0 && w > 0 && h > 0) return (l * w * h) / 1728;
    return 0;
  }

  const [marbleTrucksRaw, allBlocksRaw, stoneTypesR] = await Promise.all([
    fetchMarbleTrucks(),
    fetchFreshBlocks(),
    admin.from("stone_types").select("name, stone_category"),
  ]);

  const stoneCategoryMap: Record<string, StoneCategory> = {};
  for (const s of (stoneTypesR.data ?? []) as Array<{ name: string; stone_category?: string }>) {
    stoneCategoryMap[s.name] = s.stone_category === "marble" ? "marble" : "sandstone";
  }

  // ── Marble: attach sibling blocks to each truck ─────────────────────
  const blocksByTruckId = new Map<string, BlockRow[]>();
  for (const b of allBlocksRaw) {
    if (!b.truck_entry_id) continue;
    const arr = blocksByTruckId.get(b.truck_entry_id) ?? [];
    arr.push(b);
    blocksByTruckId.set(b.truck_entry_id, arr);
  }

  const marbleTrucks: MarbleTruck[] = marbleTrucksRaw.map((t) => {
    const blocks = blocksByTruckId.get(t.id) ?? [];
    // 8 CFT per tonne is the system-wide marble equivalence used
    // everywhere (see cftEquivFromTonnes in stone-categories).
    const tonnes = Number(t.total_tonnes) || 0;
    return { ...t, blocks, totalCft: tonnes * 8 };
  });

  // ── Sandstone: bucket by (date, truck_no, vendor_name) ───────────────
  const sandstoneBlocks = allBlocksRaw.filter((b) => !b.truck_entry_id);

  const bucketMap = new Map<string, SandstoneTruck>();
  for (const b of sandstoneBlocks) {
    // Use only the date portion of created_at so all blocks added on
    // the same calendar day group together.
    const date = (b.created_at ?? "").slice(0, 10);
    const truck = (b.truck_no ?? "").trim();
    const vendor = (b.vendor_name ?? "").trim();
    const key = `${date}|${truck.toLowerCase()}|${vendor.toLowerCase()}`;
    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = {
        key,
        date,
        truck_no: truck || null,
        vendor_name: vendor || null,
        stones: [],
        blocks: [],
        totalCft: 0,
        totalTonnes: 0,
      };
      bucketMap.set(key, bucket);
    }
    bucket.blocks.push(b);
    if (!bucket.stones.includes(b.stone)) bucket.stones.push(b.stone);
    const l = Number(b.length_ft) || 0;
    const w = Number(b.width_ft) || 0;
    const h = Number(b.height_ft) || 0;
    // Dimensions are stored in INCHES (the column names lie — historical
    // schema). Convert to CFT.
    if (l > 0 && w > 0 && h > 0) bucket.totalCft += (l * w * h) / 1728;
    if (b.tonnes != null) bucket.totalTonnes += Number(b.tonnes) || 0;
  }

  const sandstoneTrucks = Array.from(bucketMap.values()).sort((a, b) => {
    // Newest first.
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return 0;
  });

  // ── Stock totals — for the Compare panel ─────────────────────────────
  // MARBLE — "purchased" is the truck-row aggregate (authoritative tonnes
  // from the bill of lading); "in stock / consumed" comes from the
  // sibling blocks' status field. CFT = tonnes × 8.
  const marbleSiblings = allBlocksRaw.filter((b) => b.truck_entry_id);
  let marblePurchTonnes = 0;
  let marblePurchBlocks = 0;
  for (const t of marbleTrucksRaw) {
    marblePurchTonnes += Number(t.total_tonnes) || 0;
    marblePurchBlocks += Number(t.num_blocks) || 0;
  }
  let marbleStockTonnes = 0;
  let marbleStockBlocks = 0;
  let marbleConsTonnes = 0;
  let marbleConsBlocks = 0;
  for (const b of marbleSiblings) {
    const t = Number(b.tonnes) || 0;
    if (isInStock(b.status)) {
      marbleStockTonnes += t;
      marbleStockBlocks += 1;
    } else if (isConsumed(b.status)) {
      marbleConsTonnes += t;
      marbleConsBlocks += 1;
    }
  }
  const marbleTotals: StockTotals = {
    purchasedBlocks: marblePurchBlocks,
    purchasedCft: marblePurchTonnes * 8,
    purchasedTonnes: marblePurchTonnes,
    inStockBlocks: marbleStockBlocks,
    inStockCft: marbleStockTonnes * 8,
    inStockTonnes: marbleStockTonnes,
    consumedBlocks: marbleConsBlocks,
    consumedCft: marbleConsTonnes * 8,
    consumedTonnes: marbleConsTonnes,
  };

  // SANDSTONE — every fresh sandstone block is one purchase; CFT from
  // its dimensions; tonnes are optional metadata.
  let sandPurchCft = 0;
  let sandPurchTonnes = 0;
  let sandStockCft = 0;
  let sandStockBlocks = 0;
  let sandStockTonnes = 0;
  let sandConsCft = 0;
  let sandConsBlocks = 0;
  let sandConsTonnes = 0;
  for (const b of sandstoneBlocks) {
    const cft = blockCft(b);
    sandPurchCft += cft;
    sandPurchTonnes += Number(b.tonnes) || 0;
    if (isInStock(b.status)) {
      sandStockCft += cft;
      sandStockBlocks += 1;
      sandStockTonnes += Number(b.tonnes) || 0;
    } else if (isConsumed(b.status)) {
      sandConsCft += cft;
      sandConsBlocks += 1;
      sandConsTonnes += Number(b.tonnes) || 0;
    }
  }
  const sandstoneTotals: StockTotals = {
    purchasedBlocks: sandstoneBlocks.length,
    purchasedCft: sandPurchCft,
    purchasedTonnes: sandPurchTonnes,
    inStockBlocks: sandStockBlocks,
    inStockCft: sandStockCft,
    inStockTonnes: sandStockTonnes,
    consumedBlocks: sandConsBlocks,
    consumedCft: sandConsCft,
    consumedTonnes: sandConsTonnes,
  };

  return (
    <BlockPurchaseClient
      marbleTrucks={marbleTrucks}
      sandstoneTrucks={sandstoneTrucks}
      marbleTotals={marbleTotals}
      sandstoneTotals={sandstoneTotals}
      stoneCategoryMap={stoneCategoryMap}
    />
  );
}
