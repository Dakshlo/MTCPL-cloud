/**
 * Where a tool went after it left the cupboard — data layer (mig 238).
 *
 * Daksh, Nov 2026: "Mohit took 5 pcs of some tool, then this 5 pcs will
 * show in his account. Now we have to connect this with our CNC. He
 * will then do 1 pcs used in CNC no 14. This way we will have CNC wise
 * consumption too."
 *
 * Three places a tool can be, and this file owns the last two:
 *
 *     on the shelf   lib/cnc-tool-stock.ts   SUM(movements.delta)
 *     in his hands   HERE                    taken − returned − used
 *     spent          HERE                    SUM(usage.qty) per machine
 *
 * The custody formula is NOT repeated here. It lives once, in SQL, as
 * the view `cnc_tool_holdings`, because the database has to apply the
 * same rule when it refuses a man who reports using more than he took —
 * and a formula written in two languages is a formula that will
 * eventually disagree with itself.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";
import { TOOL_IMAGE_BUCKET, UNDO_WINDOW_MS } from "@/lib/cnc-tool-stock";
import { allActiveOperators, operatorsForVendor } from "@/lib/cnc-tool-operators";

/** A wrong machine number lands straight in a costing report, so it is
 *  takeable back for the same ten minutes as everything else in this
 *  module and in the Work Diary. One rule across the app. */
export const USAGE_UNDO_WINDOW_MS = UNDO_WINDOW_MS;

/** A man reports what he spent, not what a plant spends in a month.
 *  Anything past this is a slipped thumb on a number pad. */
export const MAX_USE_QTY = 50;

// ── What mig 238's guarded write hands back ────────────────────────

export type SettleOutcome = {
  ok: boolean;
  outcome?: "used" | "returned";
  code?:
    | "bad_outcome"
    | "bad_qty"
    | "no_person"
    | "missing"
    | "not_holding"
    | "over_holding"
    | "no_machine"
    | "bad_machine"
    | "other_vendor";
  usage_id?: string;
  movement_id?: string;
  qty?: number;
  holding?: number;
  holding_after?: number;
  tool?: string;
  unit?: string;
  machine?: string;
};

/** The sentence a refusal turns into — in the same voice as the rest of
 *  the cupboard screen, and written once so the phone and the office
 *  never explain the same refusal differently. */
export function settleRefusal(r: SettleOutcome, opts?: { unit?: boolean }): string {
  const unit = opts?.unit === false ? "" : ` ${r.unit ?? "pcs"}`;
  switch (r.code) {
    case "missing":
      return "That tool is gone.";
    case "not_holding":
      return `You are not holding any ${r.tool ?? "of that"}. Only what you took can be used.`;
    case "over_holding":
      return `You have ${Number(r.holding ?? 0)}${unit} in hand — enter ${Number(r.holding ?? 0)} or fewer.`;
    case "no_machine":
      return "Which machine? Tap one first.";
    case "bad_machine":
      return "That machine is not in use any more. Tell the office.";
    case "other_vendor":
      return `Machine ${r.machine ?? "that"} is not yours. Pick one of your own.`;
    case "no_person":
      return "Your sign-in has run out. Tap your name again.";
    case "bad_qty":
      return "How many? Enter at least 1.";
    default:
      return "Could not record that. Try again.";
  }
}

// ── In his hands ───────────────────────────────────────────────────

export type HeldItem = {
  toolId: string;
  name: string;
  spec: string | null;
  unit: string;
  qty: number;
  imageUrl: string | null;
};

export type HeldByPerson = {
  /** Stable across renders: the kind and the id together, because a
   *  profile and an operator could in principle share neither but the
   *  key has to say which table the id is from. */
  key: string;
  kind: "profile" | "operator";
  personId: string;
  name: string;
  /** The firm. Null for the office three, who have none. */
  company: string | null;
  items: HeldItem[];
  /** Everything he is holding, added up. Units are mixed in principle;
   *  in this store they are all pcs, and the screens say so. */
  total: number;
};

type HoldingRow = {
  tool_id: string;
  profile_id: string | null;
  operator_id: string | null;
  qty: number | string;
};

/** Everything anybody is holding, grouped by the man — the office's
 *  "who has what" list. */
export async function loadHoldings(): Promise<HeldByPerson[]> {
  const admin = createAdminSupabaseClient();

  const rows = await fetchAllPaged<HoldingRow>((from, to) =>
    admin
      .from("cnc_tool_holdings")
      .select("tool_id, profile_id, operator_id, qty")
      .gt("qty", 0)
      .order("tool_id")
      .range(from, to),
  );
  if (rows.length === 0) return [];

  const [tools, people] = await Promise.all([
    toolLookup(admin, rows.map((r) => r.tool_id)),
    personLookup(
      admin,
      rows.map((r) => r.profile_id).filter((v): v is string => !!v),
      rows.map((r) => r.operator_id).filter((v): v is string => !!v),
    ),
  ]);

  const byPerson = new Map<string, HeldByPerson>();

  for (const r of rows) {
    const kind: "profile" | "operator" = r.profile_id ? "profile" : "operator";
    const personId = (r.profile_id ?? r.operator_id)!;
    const key = `${kind}:${personId}`;
    const tool = tools.get(r.tool_id);
    if (!tool) continue; // archived out from under us

    let p = byPerson.get(key);
    if (!p) {
      const who = people.get(key);
      p = {
        key,
        kind,
        personId,
        name: who?.name ?? "Unnamed",
        company: who?.company ?? null,
        items: [],
        total: 0,
      };
      byPerson.set(key, p);
    }
    const qty = Number(r.qty);
    p.items.push({ ...tool, qty });
    p.total += qty;
  }

  const out = [...byPerson.values()];
  for (const p of out) p.items.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  // Most in hand first — that is who the office wants to chase.
  return out.sort(
    (a, b) =>
      b.total - a.total ||
      (a.company ?? "").localeCompare(b.company ?? "") ||
      a.name.localeCompare(b.name),
  );
}

/** One man's account: what HE is holding. The phone's "my tools". */
export async function holdingsForPerson(
  profileId: string | null,
  operatorId: string | null,
): Promise<HeldItem[]> {
  if (!profileId && !operatorId) return [];
  const admin = createAdminSupabaseClient();

  let q = admin
    .from("cnc_tool_holdings")
    .select("tool_id, profile_id, operator_id, qty")
    .gt("qty", 0);
  // `.is(col, null)` matters as much as the equality: without it a
  // profile's row and an operator's row for the same tool would both
  // match on the one column that was filtered.
  q = profileId
    ? q.eq("profile_id", profileId).is("operator_id", null)
    : q.eq("operator_id", operatorId!).is("profile_id", null);

  const { data } = await q;
  const rows = (data ?? []) as HoldingRow[];
  if (rows.length === 0) return [];

  const tools = await toolLookup(admin, rows.map((r) => r.tool_id));

  return rows
    .map((r) => {
      const t = tools.get(r.tool_id);
      return t ? { ...t, qty: Number(r.qty) } : null;
    })
    .filter((v): v is HeldItem => !!v)
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

/**
 * What each of these men is carrying, named tool by named tool.
 *
 * For a vendor's own screen. Daksh, Nov 2026: "if Mohit's additional
 * added operator tries to take the tool from store to custody, how
 * things will work — his separate dashboard will work or Mohit's?"
 *
 * His own. Custody is keyed on the PERSON, so Shyam's take sits in
 * Shyam's hands and Mohit's own page is unaffected — the man who signed
 * for it is the man who must account for it, which is the one rule this
 * whole module has.
 *
 * And then: "make it this way in mohit it should show all his down
 * vendor so mohit can know what there vendor has taken." So Mohit sees
 * his men's accounts beside his own — the tools, not only a number.
 * Seeing is not the same as answering for it: he cannot file a usage or
 * a return on another man's holding, here or anywhere, because that
 * write is signed by the OTP of the man who is holding it.
 *
 * One query for the whole team and one for the tool names, whatever the
 * size of the team.
 */
export async function holdingsForOperators(
  operatorIds: string[],
): Promise<Map<string, HeldItem[]>> {
  const want = [...new Set(operatorIds)].filter(Boolean);
  if (want.length === 0) return new Map();

  const admin = createAdminSupabaseClient();
  const rows = await fetchAllPaged<HoldingRow>((from, to) =>
    admin
      .from("cnc_tool_holdings")
      .select("tool_id, profile_id, operator_id, qty")
      .in("operator_id", want)
      .gt("qty", 0)
      .order("tool_id")
      .range(from, to),
  );
  if (rows.length === 0) return new Map();

  const tools = await toolLookup(admin, rows.map((r) => r.tool_id));

  const out = new Map<string, HeldItem[]>();
  for (const r of rows) {
    if (!r.operator_id) continue;
    const t = tools.get(r.tool_id);
    if (!t) continue; // archived out from under us
    const list = out.get(r.operator_id) ?? [];
    list.push({ ...t, qty: Number(r.qty) });
    out.set(r.operator_id, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  }
  return out;
}

/**
 * The same thing added up — the badge on the team list.
 *
 * Derived from the detail on purpose. These two numbers are shown on
 * the same screen, so a tool that has gone missing from `cnc_tools`
 * must drop out of BOTH or the badge says 6 over a list of 4.
 */
export async function heldByOperators(operatorIds: string[]): Promise<Map<string, number>> {
  const detail = await holdingsForOperators(operatorIds);
  const out = new Map<string, number>();
  for (const [id, items] of detail) {
    out.set(id, items.reduce((a, i) => a + i.qty, 0));
  }
  return out;
}

/**
 * A vendor's men, each with his own account on him.
 *
 * Daksh, Nov 2026: "in mohit it should show all his down vendor so
 * mohit can know what there vendor has taken."
 *
 * The same scope rule as the team list it sits beside, and for the same
 * reason — a vendor sees HIS firm's men and no other firm's, and the
 * office three, who have no firm, see everybody. A man with nothing in
 * his hands is still in the list: "Shyam has nothing out" is a fact
 * Mohit came here for, and a name that vanishes when it reaches zero
 * reads as a man who has left.
 */
export async function menUnder(session: {
  canEnrol: boolean;
  enrolScope: "own" | "any" | null;
  vendorId: string | null;
}): Promise<ManHolding[]> {
  if (!session.canEnrol) return [];

  const all = session.enrolScope === "any";
  if (!all && !session.vendorId) return [];

  const men = all ? await allActiveOperators() : await operatorsForVendor(session.vendorId!);
  return attachHoldings(men, all);
}

/**
 * The same thing for a caller that has ALREADY loaded the roster.
 *
 * The guest page loads a vendor's men anyway, to draw the 👷 panel.
 * Having menUnder() go and fetch the identical list a second time cost
 * a round trip on every render of a page a man is standing in front of
 * on shed wifi — so the page hands the list it has.
 *
 * `withCompany` only where one list covers all three firms. On a
 * vendor's own page every name is his, and printing his firm against
 * each of them says nothing.
 */
export async function attachHoldings(
  men: Array<{ id: string; name: string; vendorName: string }>,
  withCompany: boolean,
): Promise<ManHolding[]> {
  if (men.length === 0) return [];

  const held = await holdingsForOperators(men.map((m) => m.id));

  return men
    .map((m) => {
      const items = held.get(m.id) ?? [];
      return {
        id: m.id,
        name: m.name,
        company: withCompany ? m.vendorName : null,
        items,
        total: items.reduce((a, i) => a + i.qty, 0),
      };
    })
    .sort(
      (a, b) =>
        (a.company ?? "").localeCompare(b.company ?? "") ||
        b.total - a.total ||
        a.name.localeCompare(b.name),
    );
}

export type ManHolding = {
  /** The operator id — not a profile. An operator is not an app login. */
  id: string;
  name: string;
  company: string | null;
  items: HeldItem[];
  total: number;
};

type ToolBits = Omit<HeldItem, "qty">;

async function toolLookup(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ids: string[],
): Promise<Map<string, ToolBits>> {
  const want = [...new Set(ids)];
  if (want.length === 0) return new Map();
  const { data } = await admin
    .from("cnc_tools")
    .select("id, name, spec, unit, image_path")
    .in("id", want);

  const out = new Map<string, ToolBits>();
  for (const t of (data ?? []) as Array<{
    id: string; name: string; spec: string | null; unit: string; image_path: string | null;
  }>) {
    out.set(t.id, {
      toolId: t.id,
      name: t.name,
      spec: t.spec,
      unit: t.unit,
      // Public bucket (mig 233) — the cupboard screen has no app login
      // to sign a URL with.
      imageUrl: t.image_path
        ? admin.storage.from(TOOL_IMAGE_BUCKET).getPublicUrl(t.image_path).data.publicUrl
        : null,
    });
  }
  return out;
}

async function personLookup(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  profileIds: string[],
  operatorIds: string[],
): Promise<Map<string, { name: string; company: string | null }>> {
  const out = new Map<string, { name: string; company: string | null }>();

  const [profs, ops] = await Promise.all([
    profileIds.length
      ? admin
          .from("profiles")
          .select("id, full_name, vendors(name)")
          .in("id", [...new Set(profileIds)])
      : Promise.resolve({ data: [] }),
    operatorIds.length
      ? admin
          .from("cnc_tool_operators")
          .select("id, name, vendors(name)")
          .in("id", [...new Set(operatorIds)])
      : Promise.resolve({ data: [] }),
  ]);

  for (const p of (profs.data ?? []) as Array<{
    id: string; full_name: string | null; vendors: { name: string } | { name: string }[] | null;
  }>) {
    out.set(`profile:${p.id}`, {
      name: (p.full_name || "Unnamed").trim(),
      company: one(p.vendors)?.name ?? null,
    });
  }
  for (const o of (ops.data ?? []) as Array<{
    id: string; name: string | null; vendors: { name: string } | { name: string }[] | null;
  }>) {
    out.set(`operator:${o.id}`, {
      name: (o.name || "Unnamed").trim(),
      company: one(o.vendors)?.name ?? null,
    });
  }
  return out;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

// ── The machines a man may spend a tool on ─────────────────────────

export type ToolMachine = {
  id: string;
  code: string;
  vendorId: string;
  vendorName: string | null;
  machineType: string;
  /** Carving right now, as against idle or down for maintenance. Shown
   *  as a dot so the man can tell he is about to file against a machine
   *  that is not even running — usually a sign he tapped the wrong one. */
  busy: boolean;
};

/**
 * The store is shared; the machines are not. A man working for MANTHAN
 * sees 1–18, Mohit's men see 19–41, Vivek's see R1–R7. The office —
 * Daksh, Nikhil, Vinay, who have no firm — see all of them, which is
 * how they can file on anybody's behalf.
 *
 * The database enforces the same rule (mig 238, code `other_vendor`);
 * this only decides what is drawn.
 */
export async function machinesForVendor(vendorId: string | null): Promise<ToolMachine[]> {
  const admin = createAdminSupabaseClient();
  let q = admin
    .from("cnc_machines")
    .select("id, machine_code, vendor_id, machine_type, status, is_active, vendors(name)")
    .eq("is_active", true);
  if (vendorId) q = q.eq("vendor_id", vendorId);

  const { data } = await q;
  const rows = (data ?? []) as Array<{
    id: string; machine_code: string; vendor_id: string; machine_type: string;
    status: string; vendors: { name: string } | { name: string }[] | null;
  }>;

  return rows
    .map((m) => ({
      id: m.id,
      code: m.machine_code,
      vendorId: m.vendor_id,
      vendorName: one(m.vendors)?.name ?? null,
      machineType: m.machine_type,
      busy: m.status === "carving",
    }))
    .sort(byMachineCode);
}

/**
 * "10" after "9", and "R1" after "41".
 *
 * The codes are text, so a plain string sort puts 10 between 1 and 2 —
 * which on a grid of forty buttons is the difference between finding
 * your machine and hunting for it. Compare the digits as a number when
 * both sides have them, and keep the lettered ones (Vivek's R1–R7) in
 * their own block at the end.
 */
export function byMachineCode(a: { code: string }, b: { code: string }): number {
  const pa = /^(\D*)(\d*)$/.exec(a.code) ?? [];
  const pb = /^(\D*)(\d*)$/.exec(b.code) ?? [];
  const la = (pa[1] ?? "").toUpperCase();
  const lb = (pb[1] ?? "").toUpperCase();
  if (la !== lb) return la.localeCompare(lb);
  const na = pa[2] ? Number(pa[2]) : Number.NaN;
  const nb = pb[2] ? Number(pb[2]) : Number.NaN;
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.code.localeCompare(b.code);
  return na - nb;
}

// ── The window a report covers ─────────────────────────────────────

export const USAGE_WINDOWS = ["today", "7d", "month", "all"] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

export const USAGE_WINDOW_LABEL: Record<UsageWindow, string> = {
  today: "Today",
  "7d": "Last 7 days",
  month: "This month",
  all: "All time",
};

/** The same windows inside a sentence. A label lowercased does not read
 *  as English — "nothing used in this month" — so the phrasing is
 *  written out rather than derived. */
export const USAGE_WINDOW_PHRASE: Record<UsageWindow, string> = {
  today: "today",
  "7d": "in the last seven days",
  month: "this month",
  all: "at any point",
};

/**
 * IST, always — the shed's day and the shed's month, not the browser's.
 *
 * A report that reads differently on a laptop in another timezone is a
 * report people stop trusting, so the whole codebase buckets the same
 * way: shift the instant by +5:30 and then read the UTC parts of it.
 */
export function usageWindowRange(
  w: UsageWindow,
  now = Date.now(),
): { fromIso: string; toIso: string } {
  // `toIso` is always just past now: usage is never filed for the future,
  // and an exclusive upper bound keeps the query a clean half-open range.
  const toIso = new Date(now + 60_000).toISOString();
  if (w === "all") return { fromIso: new Date(0).toISOString(), toIso };

  const ist = new Date(now + 5.5 * 3_600_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + 1;
  const d = ist.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");

  if (w === "month") {
    return { fromIso: new Date(`${y}-${pad(m)}-01T00:00:00+05:30`).toISOString(), toIso };
  }
  const midnight = new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+05:30`).getTime();
  // "Last 7 days" counts today plus the six before it, which is what
  // somebody means by a week of production.
  const from = w === "today" ? midnight : midnight - 6 * 86_400_000;
  return { fromIso: new Date(from).toISOString(), toIso };
}

// ── Spent, machine by machine ──────────────────────────────────────

export type MachineToolLine = {
  toolId: string;
  name: string;
  spec: string | null;
  unit: string;
  qty: number;
  /** The last rate a posted bill carried for this tool × qty, or null
   *  when no bill has ever priced it. Never guessed. */
  value: number | null;
};

export type MachineUse = {
  machineId: string;
  code: string;
  vendorName: string | null;
  machineType: string;
  lines: MachineToolLine[];
  qty: number;
  /** The priced part of `qty` only. A machine whose tools have never
   *  been on a scanned bill reads 0 here and the screen says so rather
   *  than pretending the tools were free. */
  value: number;
  /** True when at least one line had no rate, so the money is a floor
   *  and not a total. */
  partlyPriced: boolean;
};

export type UsageReport = {
  machines: MachineUse[];
  /** Spent in the window with no machine left to show it against —
   *  only possible if a machine row were deleted, which RESTRICT
   *  prevents. Kept so a surprise is visible instead of silently gone. */
  orphanQty: number;
  totalQty: number;
  totalValue: number;
  pricedTools: number;
  unpricedTools: number;
};

type UsageRow = {
  tool_id: string;
  machine_id: string;
  qty: number | string;
};

/**
 * Machine-wise consumption for a window.
 *
 * Paginated: a plant with forty machines spending tools daily passes a
 * thousand rows inside a quarter, and PostgREST truncates at a thousand
 * without saying so — the trap that once broke the monthly costing.
 */
export async function loadMachineUsage(fromIso: string, toIso: string): Promise<UsageReport> {
  const admin = createAdminSupabaseClient();

  const rows = await fetchAllPaged<UsageRow>((from, to) =>
    admin
      .from("cnc_tool_usage")
      .select("tool_id, machine_id, qty")
      .is("undone_at", null)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at")
      .order("id")
      .range(from, to),
  );

  const empty: UsageReport = {
    machines: [], orphanQty: 0, totalQty: 0, totalValue: 0,
    pricedTools: 0, unpricedTools: 0,
  };
  if (rows.length === 0) return empty;

  const [tools, rates, machines] = await Promise.all([
    toolLookup(admin, rows.map((r) => r.tool_id)),
    latestToolRates(rows.map((r) => r.tool_id)),
    machineLookup(admin, rows.map((r) => r.machine_id)),
  ]);

  // machine → tool → qty
  const grid = new Map<string, Map<string, number>>();
  let orphanQty = 0;

  for (const r of rows) {
    const qty = Number(r.qty);
    if (!machines.has(r.machine_id)) { orphanQty += qty; continue; }
    let row = grid.get(r.machine_id);
    if (!row) { row = new Map(); grid.set(r.machine_id, row); }
    row.set(r.tool_id, (row.get(r.tool_id) ?? 0) + qty);
  }

  const priced = new Set<string>();
  const unpriced = new Set<string>();

  const out: MachineUse[] = [];
  for (const [machineId, row] of grid) {
    const m = machines.get(machineId)!;
    const lines: MachineToolLine[] = [];
    let qty = 0;
    let value = 0;
    let partlyPriced = false;

    for (const [toolId, q] of row) {
      const t = tools.get(toolId);
      const rate = rates.get(toolId) ?? null;
      if (rate == null) { partlyPriced = true; unpriced.add(toolId); } else { priced.add(toolId); }
      lines.push({
        toolId,
        name: t?.name ?? "(removed tool)",
        spec: t?.spec ?? null,
        unit: t?.unit ?? "pcs",
        qty: q,
        value: rate == null ? null : rate * q,
      });
      qty += q;
      if (rate != null) value += rate * q;
    }

    lines.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.qty - a.qty || a.name.localeCompare(b.name));
    out.push({
      machineId,
      code: m.code,
      vendorName: m.vendorName,
      machineType: m.machineType,
      lines, qty, value, partlyPriced,
    });
  }

  return {
    machines: out.sort(byMachineCode),
    orphanQty,
    totalQty: out.reduce((a, m) => a + m.qty, 0) + orphanQty,
    totalValue: out.reduce((a, m) => a + m.value, 0),
    pricedTools: priced.size,
    unpricedTools: unpriced.size,
  };
}

async function machineLookup(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ids: string[],
): Promise<Map<string, { code: string; vendorName: string | null; machineType: string }>> {
  const want = [...new Set(ids)];
  if (want.length === 0) return new Map();
  const { data } = await admin
    .from("cnc_machines")
    .select("id, machine_code, machine_type, vendors(name)")
    .in("id", want);

  const out = new Map<string, { code: string; vendorName: string | null; machineType: string }>();
  for (const m of (data ?? []) as Array<{
    id: string; machine_code: string; machine_type: string;
    vendors: { name: string } | { name: string }[] | null;
  }>) {
    out.set(m.id, {
      code: m.machine_code,
      vendorName: one(m.vendors)?.name ?? null,
      machineType: m.machine_type,
    });
  }
  return out;
}

/**
 * The last price anybody paid for each tool, from the scanned bills
 * (mig 237).
 *
 * This is the ONLY money in the tool store, and it is deliberately
 * one-directional: the consumption report reads a rate the bill module
 * recorded, and nothing here writes to Finance or is read by it. Daksh
 * was explicit when the bill scan was built — "don't link this to
 * finance at all, it's completely separate."
 *
 * A tool nobody has billed has no rate and gets NULL, not zero. A zero
 * would quietly say the tool was free; a null makes the screen admit it
 * does not know.
 */
export async function latestToolRates(toolIds?: string[]): Promise<Map<string, number>> {
  const admin = createAdminSupabaseClient();

  let q = admin
    .from("cnc_tool_bill_lines")
    .select("tool_id, rate, created_at, cnc_tool_bills!inner(status, bill_date)")
    .not("tool_id", "is", null)
    .not("rate", "is", null)
    .gt("rate", 0)
    .eq("cnc_tool_bills.status", "posted");
  if (toolIds && toolIds.length) q = q.in("tool_id", [...new Set(toolIds)]);

  const { data } = await q;
  const rows = (data ?? []) as Array<{
    tool_id: string;
    rate: number | string;
    created_at: string;
    cnc_tool_bills: { status: string; bill_date: string | null } | { status: string; bill_date: string | null }[] | null;
  }>;

  // Newest bill wins. bill_date is what the supplier printed, which is
  // the date that means something; created_at only breaks a tie between
  // two bills dated the same day (or stands in when a date was missed).
  const best = new Map<string, { rate: number; on: string }>();
  for (const r of rows) {
    const bill = one(r.cnc_tool_bills);
    const on = `${bill?.bill_date ?? "0000-00-00"}|${r.created_at}`;
    const prev = best.get(r.tool_id);
    if (!prev || on > prev.on) best.set(r.tool_id, { rate: Number(r.rate), on });
  }

  return new Map([...best].map(([id, v]) => [id, v.rate]));
}

// ── The usage log (for the register, and for taking one back) ──────

export type UsageLine = {
  id: string;
  toolId: string;
  toolName: string;
  machineCode: string;
  qty: number;
  unit: string;
  usedBy: string;
  company: string | null;
  mine: boolean;
  createdAt: string;
  undoneAt: string | null;
};

/**
 * Whose lines a register is allowed to contain.
 *
 * Daksh, Nov 2026: "the register in phone — owner and developer can see
 * all activity, but respective vendor will see theirs only."
 *
 * This is a SCOPE, not a filter. The difference matters: a filter is
 * applied to rows the phone has already been sent, and a phone that has
 * been sent a row has been told the answer whether or not it draws it.
 * Every reader of these two ledgers takes one of these and puts it in
 * the query.
 *
 *   all      the office three and the developer
 *   company  a vendor principal: his own firm, his men included
 *   person   an operator: the lines he signed himself, and no others
 */
export type LedgerScope =
  | { kind: "all" }
  | { kind: "company"; vendorId: string }
  | { kind: "person"; profileId: string | null; operatorId: string | null };

/**
 * The PostgREST `or` for "lines this person signed", against whichever
 * pair of columns the table uses.
 *
 * Returns null when the session names nobody at all. A caller that gets
 * null must return NOTHING — an empty filter would widen the query to
 * everything, which is the one mistake this whole type exists to stop.
 */
export function personScopeFilter(
  who: { profileId: string | null; operatorId: string | null },
  cols: { profileCol: string; operatorCol: string },
): string | null {
  const parts: string[] = [];
  if (who.profileId) parts.push(`${cols.profileCol}.eq.${who.profileId}`);
  if (who.operatorId) parts.push(`${cols.operatorCol}.eq.${who.operatorId}`);
  return parts.length ? parts.join(",") : null;
}

/** Usage rows for the cupboard register, over the same window the
 *  movements use. `mine` is decided from the session on the server —
 *  never from anything the page sent — and `scope` decides which rows
 *  the phone is allowed to be handed in the first place. */
export async function usageLinesSince(
  sinceIso: string,
  me: { profileId: string | null; operatorId: string | null },
  max: number,
  scope: LedgerScope,
): Promise<UsageLine[]> {
  const admin = createAdminSupabaseClient();

  let q = admin
    .from("cnc_tool_usage")
    .select("id, tool_id, machine_id, qty, used_by, used_by_profile_id, used_by_operator_id, vendor_id, created_at, undone_at, cnc_tools(name, unit), cnc_machines(machine_code), vendors(name)")
    .gte("created_at", sinceIso);

  if (scope.kind === "company") {
    q = q.eq("vendor_id", scope.vendorId);
  } else if (scope.kind === "person") {
    const f = personScopeFilter(scope, {
      profileCol: "used_by_profile_id",
      operatorCol: "used_by_operator_id",
    });
    if (!f) return [];
    q = q.or(f);
  }

  const { data } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(max);

  const rows = (data ?? []) as Array<{
    id: string; tool_id: string; machine_id: string; qty: number | string;
    used_by: string; used_by_profile_id: string | null; used_by_operator_id: string | null;
    created_at: string; undone_at: string | null;
    cnc_tools: { name: string; unit: string } | { name: string; unit: string }[] | null;
    cnc_machines: { machine_code: string } | { machine_code: string }[] | null;
    vendors: { name: string } | { name: string }[] | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    toolId: r.tool_id,
    toolName: one(r.cnc_tools)?.name ?? "tool",
    machineCode: one(r.cnc_machines)?.machine_code ?? "?",
    qty: Number(r.qty),
    unit: one(r.cnc_tools)?.unit ?? "pcs",
    usedBy: r.used_by,
    company: one(r.vendors)?.name ?? null,
    mine:
      (!!me.profileId && r.used_by_profile_id === me.profileId) ||
      (!!me.operatorId && r.used_by_operator_id === me.operatorId),
    createdAt: r.created_at,
    undoneAt: r.undone_at,
  }));
}

/** Can this usage line still be taken back? Same ten minutes, same
 *  shape as canUndo() for a movement. */
export function canUndoUsage(
  u: Pick<UsageLine, "createdAt" | "undoneAt">,
  now = Date.now(),
): boolean {
  if (u.undoneAt) return false;
  return now - new Date(u.createdAt).getTime() < USAGE_UNDO_WINDOW_MS;
}
