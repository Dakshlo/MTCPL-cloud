/**
 * The same month, read man by man instead of machine by machine.
 *
 * Daksh, Nov 2026: "in register a place where we can see detail things
 * like how many tools Mohit took this week, number of tools, then his
 * machine-wise… how much tools he uses in week, month. All 3 in one
 * page so we can compare."
 *
 * The three being Mohit, Manthan and Vivek, side by side — which is the
 * whole point and the thing nothing else on the system does.
 *
 *   /tools          what is on the shelf
 *   /tools/usage    what each MACHINE ate
 *   this            what each MAN took and spent, next to each other
 *
 * Same two ledgers as everywhere else in this module and the same
 * rules: a take is cnc_tool_movements.kind = 'issue', a spend is a
 * cnc_tool_usage row (mig 238), voided lines on either side are
 * ignored, and money is the last rate a scanned supplier bill carried
 * (mig 237) — never Finance, which is the line drawn when the bill scan
 * was built.
 *
 * TAKEN AND USED ARE NOT THE SAME NUMBER, and the page says so rather
 * than quietly adding them. A man takes five on Monday, spends two on
 * Tuesday and is still holding three: that gap is the thing worth
 * looking at, and collapsing it into one figure would hide exactly what
 * this screen is for.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { latestToolRates } from "@/lib/cnc-tool-usage";

export type PersonMachineLine = {
  machineCode: string;
  qty: number;
  value: number;
};

export type PersonToolLine = {
  toolId: string;
  name: string;
  unit: string;
  qty: number;
};

export type PersonUsage = {
  /** Stable key — profile id or operator id, whichever signed. */
  key: string;
  name: string;
  company: string | null;
  /** His firm, for the fleet lookup below. */
  vendorId: string | null;
  /**
   * CNC machines assigned to his company.
   *
   * Daksh, Nov 2026: "consider the number of machines under the vendor
   * — Mohit has more machines and Manthan less, so Mohit taking a few
   * extra is fine."
   *
   * He is right, and on the live numbers it does not just soften the
   * comparison, it reverses it: Manthan's 8 across 17 machines is 0.47
   * each, Mohit's 4 across 23 is 0.17. The raw totals say Manthan took
   * twice as much; per machine he is running at nearly three times the
   * rate. A fleet-blind league table would have pointed at the wrong
   * man.
   *
   * It is the COMPANY's fleet, not the individual's — machines are
   * assigned to a vendor and his men share them. So for a vendor
   * principal this is exactly right, and if operators ever appear here
   * as their own columns they would each show the firm's fleet, which
   * is why the page labels it "machines in his firm" rather than his.
   *
   * 0 when the company has none, and the page then shows a dash rather
   * than dividing by it.
   */
  machineCount: number;
  /** Pieces taken off the shelf in the window. */
  takenQty: number;
  /** How many DIFFERENT tools he took — "12 pcs across 4 kinds". */
  takenKinds: number;
  takenLines: number;
  /** Pieces reported into a machine in the window. */
  usedQty: number;
  usedValue: number;
  /** What those pieces went into, biggest first. */
  machines: PersonMachineLine[];
  /** What he took, biggest first. */
  tools: PersonToolLine[];
};

type MoveRow = {
  tool_id: string;
  delta: number | string;
  taken_by: string | null;
  taken_by_profile_id: string | null;
  taken_by_operator_id: string | null;
  vendor_id: string | null;
};

type UseRow = {
  tool_id: string;
  qty: number | string;
  used_by: string | null;
  used_by_profile_id: string | null;
  used_by_operator_id: string | null;
  vendor_id: string | null;
  machine_id: string | null;
};

/**
 * Everybody who took or spent anything in [fromIso, toIso).
 *
 * Four queries, all fired together — the two ledgers and the two lookup
 * tables they need. Nothing here walks a list issuing one query per
 * person; see reference_mtcpl_serial_query_waiting for why that habit
 * is the thing that actually makes pages slow in this codebase.
 */
export async function loadPeopleUsage(
  fromIso: string,
  toIso: string,
): Promise<PersonUsage[]> {
  const admin = createAdminSupabaseClient();

  const [movesRes, usesRes, toolsRes, machinesRes, vendorsRes] = await Promise.all([
    admin
      .from("cnc_tool_movements")
      .select("tool_id, delta, taken_by, taken_by_profile_id, taken_by_operator_id, vendor_id")
      .eq("kind", "issue")
      .is("undone_at", null)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    admin
      .from("cnc_tool_usage")
      .select("tool_id, qty, used_by, used_by_profile_id, used_by_operator_id, vendor_id, machine_id")
      .is("undone_at", null)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    admin.from("cnc_tools").select("id, name, unit"),
    admin.from("cnc_machines").select("id, machine_code, vendor_id"),
    admin.from("vendors").select("id, name"),
  ]);

  const toolName = new Map<string, { name: string; unit: string }>();
  for (const t of (toolsRes.data ?? []) as Array<{ id: string; name: string; unit: string }>) {
    toolName.set(t.id, { name: t.name, unit: t.unit });
  }
  const machineCode = new Map<string, string>();
  const fleet = new Map<string, number>();
  for (const m of (machinesRes.data ?? []) as Array<{
    id: string; machine_code: string; vendor_id: string | null;
  }>) {
    machineCode.set(m.id, m.machine_code);
    if (m.vendor_id) fleet.set(m.vendor_id, (fleet.get(m.vendor_id) ?? 0) + 1);
  }
  const vendorName = new Map<string, string>();
  for (const v of (vendorsRes.data ?? []) as Array<{ id: string; name: string }>) {
    vendorName.set(v.id, v.name);
  }

  const people = new Map<string, PersonUsage>();
  // Per person, keyed sub-totals — built in Maps and flattened once at
  // the end so nothing is sorted inside a loop.
  const toolAcc = new Map<string, Map<string, number>>();
  const machineAcc = new Map<string, Map<string, { qty: number; value: number }>>();

  /** The signer, never the typed name: two men called the same thing
   *  must not merge into one column. Falls back to the readable name
   *  only for a line signed by nobody, which the old paper-register
   *  import can still produce. */
  const keyOf = (
    profileId: string | null,
    operatorId: string | null,
    readable: string | null,
  ) => profileId ?? operatorId ?? `name:${(readable ?? "Unsigned").trim().toUpperCase()}`;

  const ensure = (
    key: string,
    readable: string | null,
    vendorId: string | null,
  ): PersonUsage => {
    let p = people.get(key);
    if (!p) {
      p = {
        key,
        name: (readable ?? "").trim() || "Unsigned",
        company: vendorId ? vendorName.get(vendorId) ?? null : null,
        vendorId: vendorId ?? null,
        machineCount: vendorId ? fleet.get(vendorId) ?? 0 : 0,
        takenQty: 0,
        takenKinds: 0,
        takenLines: 0,
        usedQty: 0,
        usedValue: 0,
        machines: [],
        tools: [],
      };
      people.set(key, p);
      toolAcc.set(key, new Map());
      machineAcc.set(key, new Map());
    }
    // A later line may carry the company when an earlier one did not.
    if (!p.company && vendorId) {
      p.company = vendorName.get(vendorId) ?? null;
      p.vendorId = vendorId;
      p.machineCount = fleet.get(vendorId) ?? 0;
    }
    return p;
  };

  for (const r of (movesRes.data ?? []) as MoveRow[]) {
    const key = keyOf(r.taken_by_profile_id, r.taken_by_operator_id, r.taken_by);
    const p = ensure(key, r.taken_by, r.vendor_id);
    const qty = Math.abs(Number(r.delta));
    p.takenQty += qty;
    p.takenLines += 1;
    const byTool = toolAcc.get(key)!;
    byTool.set(r.tool_id, (byTool.get(r.tool_id) ?? 0) + qty);
  }

  const rates = await latestToolRates(
    [...new Set(((usesRes.data ?? []) as UseRow[]).map((u) => u.tool_id))],
  );

  for (const r of (usesRes.data ?? []) as UseRow[]) {
    const key = keyOf(r.used_by_profile_id, r.used_by_operator_id, r.used_by);
    const p = ensure(key, r.used_by, r.vendor_id);
    const qty = Number(r.qty);
    const value = qty * (rates.get(r.tool_id) ?? 0);
    p.usedQty += qty;
    p.usedValue += value;
    const code = r.machine_id ? machineCode.get(r.machine_id) ?? "—" : "—";
    const byMachine = machineAcc.get(key)!;
    const prev = byMachine.get(code) ?? { qty: 0, value: 0 };
    byMachine.set(code, { qty: prev.qty + qty, value: prev.value + value });
  }

  for (const p of people.values()) {
    const byTool = toolAcc.get(p.key)!;
    p.takenKinds = byTool.size;
    p.tools = [...byTool.entries()]
      .map(([toolId, qty]) => ({
        toolId,
        name: toolName.get(toolId)?.name ?? "a tool since removed",
        unit: toolName.get(toolId)?.unit ?? "pcs",
        qty,
      }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

    p.machines = [...machineAcc.get(p.key)!.entries()]
      .map(([machineCode2, v]) => ({ machineCode: machineCode2, qty: v.qty, value: v.value }))
      .sort((a, b) => b.qty - a.qty || a.machineCode.localeCompare(b.machineCode));
  }

  // Busiest first — the column order IS the comparison.
  return [...people.values()].sort(
    (a, b) => b.takenQty - a.takenQty || b.usedQty - a.usedQty || a.name.localeCompare(b.name),
  );
}
