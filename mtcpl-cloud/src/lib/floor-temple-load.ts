/**
 * "Which temple is on which machine" — one aggregation, two readers.
 *
 * The carving wall has shown this since Sep 2026 (Daksh, for his dad:
 * a pie of the CNC floor by temple). Sep 2026 he asked for the same
 * figure in the daily WhatsApp report: "on what machine what temple is
 * going on — out of total machines how much in what temple."
 *
 * The arithmetic lives here rather than in either screen so the wall and
 * the report can never quote different numbers for the same floor. Same
 * reason the CNC audit sheet reuses buildFloorViewData(): a plant number
 * that disagrees with itself across two surfaces is worse than no number.
 *
 * A machine is counted ONCE, under the temple of the slab it is carving.
 * Checked against production: no machine runs two temples at once — a
 * 2-head pair is always one temple — but a mixed machine is attributed
 * to its first job rather than counted twice, because inventing a CNC
 * that does not exist is the worse failure.
 */

import type { FloorVendor } from "@/app/(app)/carving/floor/floor-client";

export type TempleLoadRow = {
  temple: string;
  machines: number;
  slabs: number;
  /** Raw volume on the bed — plain l x w x t, the same figure the machine
   *  tiles print per slab. NOT the SFT/CFT carving-output rule: this is
   *  stone under the tool right now, not work signed off. */
  cft: number;
  /** Machine codes carrying it, in board order. */
  codes: string[];
};

export type FloorTempleLoad = {
  loads: TempleLoadRow[];
  /** Machines with nothing on them (excludes inactive). */
  idle: number;
  maintenance: number;
  /** Every active machine across every active CNC vendor. */
  total: number;
  /** Machines actually carving — the sum of loads[].machines. */
  running: number;
};

export function templeLoadFromVendors(vendors: FloorVendor[]): FloorTempleLoad {
  const byTemple = new Map<string, TempleLoadRow>();
  let idle = 0, maintenance = 0, total = 0;

  for (const v of vendors) {
    for (const m of v.machines) {
      total += 1;
      if (m.status === "maintenance") { maintenance += 1; continue; }
      if (m.status !== "carving" || m.current_jobs.length === 0) {
        if (m.status !== "inactive") idle += 1;
        continue;
      }
      const temple = m.current_jobs[0]?.slab?.temple?.trim() || "—";
      const g = byTemple.get(temple) ?? { temple, machines: 0, slabs: 0, cft: 0, codes: [] };
      g.machines += 1;
      g.slabs += m.current_jobs.length;
      for (const j of m.current_jobs) {
        const sl = j.slab;
        if (sl) g.cft += (sl.length_in * sl.width_in * sl.thickness_in) / 1728;
      }
      g.codes.push(m.machine_code);
      byTemple.set(temple, g);
    }
  }

  const loads = [...byTemple.values()].sort(
    (a, b) => b.machines - a.machines || b.slabs - a.slabs,
  );
  return { loads, idle, maintenance, total, running: loads.reduce((s, l) => s + l.machines, 0) };
}
