/**
 * Payment planner — "who should I pay today?"
 *
 * Daksh (Aug 2026), for his dad: dad sets how much he wishes to pay
 * today (say ₹15 lakh) and the system recommends WHICH vendors to pay
 * and HOW MUCH each — partial amounts allowed, not just full bills —
 * considering each vendor's recent payments, how much that vendor
 * typically gets every time their cycle comes round, how old their
 * open bills are, dad's read on the relationship (😊😐😠) and on how
 * badly the vendor is pressing for money (🧊⏳🔥). Vendors whose open
 * bills are all still inside their credit period are not suggested.
 *
 * Everything here is PURE: plain functions over data the page already
 * ships to the client. Nothing reads or writes the database — the
 * planner cannot touch a bill, a payment, or a rupee. The only
 * persisted inputs (mood / urgency / firm groups) live in app_settings
 * and are edited elsewhere (actions.ts).
 *
 * The scoring is deliberately transparent: every pick carries the
 * per-component values plus human "reason" chips, so dad can see WHY a
 * vendor was suggested instead of trusting a black box.
 */

import type { VendorAnalysis, VendorBill } from "./analysis-client";

// ── Persisted-metadata shapes (stored in app_settings) ─────────────

/** Dad's read on the relationship with the firm's owner. */
export type PayMood = "good" | "avg" | "bad";
/** Dad's read on how hard the vendor is pressing for money. */
export type PayUrgency = "chill" | "normal" | "high";

export type VendorPayMeta = {
  mood?: PayMood;
  urgency?: PayUrgency;
  /** "Don't suggest this vendor": an ISO date (muted through that day)
   *  or "forever" (until dad unmutes). Absent/expired = not muted. */
  muteUntil?: string;
};
export type PayMetaMap = Record<string, VendorPayMeta>;

/** Is this vendor's mute still in force? */
export function isMuteActive(muteUntil: string | undefined, nowMs: number): boolean {
  if (!muteUntil) return false;
  if (muteUntil === "forever") return true;
  const t = Date.parse(`${muteUntil.slice(0, 10)}T23:59:59+05:30`);
  return Number.isFinite(t) && t > nowMs;
}

/** A "person" — several firms clubbed as one payee. Any firm's payment
 *  counts as that person having been paid. */
export type VendorGroup = { id: string; name: string; vendorIds: string[] };

export const MOOD_META: Record<PayMood, { emoji: string; label: string }> = {
  good: { emoji: "😊", label: "Good" },
  avg: { emoji: "😐", label: "Average" },
  bad: { emoji: "😠", label: "Bad" },
};
export const URGENCY_META: Record<PayUrgency, { emoji: string; label: string }> = {
  chill: { emoji: "🧊", label: "Relaxed" },
  normal: { emoji: "⏳", label: "Normal" },
  high: { emoji: "🔥", label: "Pressing" },
};

/** Vendors with no payment_terms_days recorded (42 of 304) are assumed
 *  30 days — conservative middle of the yard's real 10–60 range. The
 *  UI labels it "assumed". */
export const DEFAULT_TERMS_DAYS = 30;

// ── Internal unit = one payee (a lone firm, or a person's group) ───

type EligibleBill = VendorBill & {
  vendorId: string;
  vendorName: string;
  ageDays: number;
  termsDays: number;
  /** outstanding − held: the only part a suggestion may touch. */
  payable: number;
};

export type PayUnit = {
  key: string;                 // vendor id, or group id
  isGroup: boolean;
  name: string;                // firm name, or the person/group name
  memberNames: string[];       // firms inside (1 for a lone vendor)
  vendorIds: string[];
  outstanding: number;         // everything open
  eligible: number;            // open, past credit, NET OF HOLDS — the payable pool
  insideCredit: number;        // open but still inside credit
  /** Withheld money across open bills (mig 072). Deliberately parked
   *  by the owner, so the planner never counts or suggests it. */
  held: number;
  eligibleBills: EligibleBill[]; // oldest first
  typicalPayment: number | null; // median of their recent payments
  cycleDays: number | null;    // median gap between their payments
  daysSinceLastPay: number | null;
  oldestEligibleAge: number;   // days
  weightedAge: number;         // amount-weighted mean age of eligible
  mood: PayMood | null;
  urgency: PayUrgency | null;
  /** Dad said "don't suggest them for now". A group is muted only when
   *  EVERY firm in it is muted (one live firm keeps the person live). */
  muteActive: boolean;
  muteLabel: string | null;    // "muted till 19 Aug" / "muted until you unmute"
  termsLabel: string;          // "60d" or "30d (assumed)" etc.
  anyTermsAssumed: boolean;
};

export type PickReason = { icon: string; text: string };

export type PayPick = {
  unit: PayUnit;
  score: number;               // 0–100
  components: { turn: number; aging: number; urgency: number; mood: number; size: number };
  amount: number;              // suggested ₹ (≤ eligible)
  clearsFully: boolean;
  coverage: Array<{
    billLabel: string;
    vendorName: string;
    date: string | null;
    open: number;
    pay: number;
    /** Withheld part of this bill — shown so dad sees why a "full"
     *  payment still leaves the bill open. */
    held: number;
    full: boolean;
  }>;
  reasons: PickReason[];
};

export type PaySkip = { unit: PayUnit; reason: string };

export type PayPlan = {
  picks: PayPick[];
  skipped: PaySkip[];
  budget: number;
  allocated: number;
  leftover: number;
  totalEligible: number;       // across all units — the real payable pool
  /** Withheld money across every unit's open bills — excluded from
   *  the pool and from every suggestion. */
  totalHeld: number;
};

// ── Small maths helpers ────────────────────────────────────────────

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-19" → "19 Aug 2026" (for mute labels). */
function fmtShortDate(iso: string): string {
  const p = iso.slice(0, 10).split("-").map(Number);
  if (p.length !== 3 || !p[1]) return iso;
  return `${p[2]} ${MON_SHORT[p[1] - 1]} ${p[0]}`;
}

function daysSinceIso(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00+05:30`);
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

/** Round a suggestion to something dad would actually write on a
 *  cheque: down to the nearest ₹1,000. */
function roundAmount(n: number): number {
  return Math.floor(n / 1000) * 1000;
}

// ── Unit building (applies the groups) ─────────────────────────────

export function buildUnits(
  vendors: VendorAnalysis[],
  groups: VendorGroup[],
  meta: PayMetaMap,
  nowMs: number,
): PayUnit[] {
  const grouped = new Set(groups.flatMap((g) => g.vendorIds));
  const byId = new Map(vendors.map((v) => [v.id, v]));

  const units: PayUnit[] = [];

  const make = (key: string, isGroup: boolean, name: string, members: VendorAnalysis[]): PayUnit => {
    // Eligible = open bills strictly past that bill's vendor's credit
    // period. Bills with no date can't prove they're inside credit, so
    // they count as eligible (unknown age reads as old, not as new).
    const eligibleBills: EligibleBill[] = [];
    let eligible = 0;
    let insideCredit = 0;
    let held = 0;
    let anyAssumed = false;

    for (const v of members) {
      const terms = v.termsDays ?? DEFAULT_TERMS_DAYS;
      if (v.termsDays == null) anyAssumed = true;
      for (const b of v.bills) {
        if (b.outstanding <= 0.5) continue;
        // Held money is out of bounds regardless of age — the owner
        // parked it on purpose (Daksh: "if hold then don't give in
        // result that pay that").
        held += b.held;
        const age = daysSinceIso(b.date, nowMs);
        if (age != null && age <= terms) {
          insideCredit += b.outstanding;
          continue;
        }
        const payable = b.outstanding - b.held;
        if (payable <= 0.5) continue; // fully held — nothing suggestible
        eligible += payable;
        eligibleBills.push({
          ...b,
          vendorId: v.id,
          vendorName: v.name,
          ageDays: age ?? 9999,
          termsDays: terms,
          payable,
        });
      }
    }
    eligibleBills.sort((a, b) => (a.date ?? "0000").localeCompare(b.date ?? "0000"));

    // Payment rhythm across ALL member firms — a group is one person,
    // so paying any of his firms counts as paying him.
    const payDates = members
      .flatMap((v) => v.payments.map((p) => p.date).filter((d): d is string => !!d))
      .sort()
      .reverse(); // newest first
    const payAmounts = members
      .flatMap((v) => v.payments.map((p) => p.amount))
      .filter((a) => a > 0)
      .slice(0, 8);
    const gaps: number[] = [];
    for (let i = 0; i < Math.min(payDates.length - 1, 8); i++) {
      const a = Date.parse(payDates[i]);
      const b = Date.parse(payDates[i + 1]);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        const gap = Math.round((a - b) / 86400000);
        if (gap > 0) gaps.push(gap);
      }
    }
    const cycle = median(gaps);

    const lastPay = payDates[0] ?? null;
    // Weighted by PAYABLE, not outstanding — held money mustn't drag
    // the urgency up for cash nobody intends to release.
    const weightedAge =
      eligible > 0
        ? eligibleBills.reduce((s, b) => s + b.ageDays * b.payable, 0) / eligible
        : 0;

    // Group meta = the loudest member: worst mood, highest urgency.
    // (Meta is stored per firm; the person inherits the strongest
    // signal any of his firms carries.)
    const moods = members.map((v) => meta[v.id]?.mood).filter(Boolean) as PayMood[];
    const urgencies = members.map((v) => meta[v.id]?.urgency).filter(Boolean) as PayUrgency[];
    const moodRank: PayMood[] = ["good", "avg", "bad"];
    const urgRank: PayUrgency[] = ["chill", "normal", "high"];
    const mood = moods.length ? moods.sort((a, b) => moodRank.indexOf(b) - moodRank.indexOf(a))[0] : null;
    const urgency = urgencies.length
      ? urgencies.sort((a, b) => urgRank.indexOf(b) - urgRank.indexOf(a))[0]
      : null;

    // Mute: the unit is silenced only while EVERY member is. Effective
    // end = the first member expiry (one firm waking up wakes the
    // person), so the label always tells dad the true resume date.
    const mutes = members.map((v) => meta[v.id]?.muteUntil);
    const muteActive = members.length > 0 && mutes.every((m) => isMuteActive(m, nowMs));
    let muteLabel: string | null = null;
    if (muteActive) {
      const dated = mutes.filter((m): m is string => !!m && m !== "forever").sort();
      muteLabel = dated.length === 0 ? "muted until you unmute" : `muted till ${fmtShortDate(dated[0])}`;
    }

    const termsSet = [...new Set(members.map((v) => v.termsDays ?? DEFAULT_TERMS_DAYS))];
    const termsLabel =
      termsSet.length === 1
        ? `${termsSet[0]}d${anyAssumed ? " (assumed)" : ""}`
        : `${Math.min(...termsSet)}–${Math.max(...termsSet)}d`;

    return {
      key,
      isGroup,
      name,
      memberNames: members.map((v) => v.name),
      vendorIds: members.map((v) => v.id),
      outstanding: members.reduce((s, v) => s + v.outstanding, 0),
      eligible: Math.round(eligible),
      insideCredit: Math.round(insideCredit),
      held: Math.round(held),
      eligibleBills,
      typicalPayment: median(payAmounts),
      cycleDays: cycle != null ? Math.max(7, Math.round(cycle)) : null,
      daysSinceLastPay: daysSinceIso(lastPay, nowMs),
      oldestEligibleAge: eligibleBills.length ? Math.max(...eligibleBills.map((b) => b.ageDays)) : 0,
      weightedAge,
      mood,
      urgency,
      muteActive,
      muteLabel,
      termsLabel,
      anyTermsAssumed: anyAssumed,
    };
  };

  for (const g of groups) {
    const members = g.vendorIds.map((id) => byId.get(id)).filter(Boolean) as VendorAnalysis[];
    if (members.length > 0) units.push(make(g.id, true, g.name, members));
  }
  for (const v of vendors) {
    if (!grouped.has(v.id)) units.push(make(v.id, false, v.name, [v]));
  }
  return units;
}

// ── Scoring + allocation ───────────────────────────────────────────

const W = { turn: 0.3, aging: 0.25, urgency: 0.25, mood: 0.1, size: 0.1 };

/**
 * The marks table behind a pick's score — Daksh: "give marks out of
 * 100 why you think that decision." Maxes are W×100, so the five maxes
 * always total exactly 100 and the UI can't drift from the weights.
 * Colours deliberately avoid the money palette (green = paid,
 * amber = open) so marks never read as rupees.
 */
export const SCORE_PARTS: Array<{
  key: keyof PayPick["components"];
  label: string;
  icon: string;
  max: number;
  color: string;
}> = [
  { key: "turn", label: "Their turn", icon: "🔁", max: W.turn * 100, color: "#4f46e5" },
  { key: "aging", label: "Money age", icon: "📅", max: W.aging * 100, color: "#7c3aed" },
  { key: "urgency", label: "Wants money", icon: "🔥", max: W.urgency * 100, color: "#0ea5e9" },
  { key: "mood", label: "Relationship", icon: "🤝", max: W.mood * 100, color: "#64748b" },
  { key: "size", label: "Amount size", icon: "⚖️", max: W.size * 100, color: "#94a3b8" },
];

/**
 * Split a pick's score into the five earned-marks, guaranteed to sum
 * EXACTLY to the score (largest-remainder rounding) — dad checking
 * 26+20+13+5+8 against the badge must never find a ±1 gap.
 */
export function scoreBreakdown(
  components: PayPick["components"],
  score: number,
): Array<{ key: string; label: string; icon: string; max: number; color: string; earned: number }> {
  const parts = SCORE_PARTS.map((p) => {
    const raw = components[p.key] * p.max;
    return { key: p.key as string, label: p.label, icon: p.icon, max: p.max, color: p.color, raw, earned: Math.floor(raw) };
  });
  let rem = score - parts.reduce((s, p) => s + p.earned, 0);
  const byFraction = [...parts].sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)));
  for (const p of byFraction) {
    if (rem <= 0) break;
    p.earned += 1;
    rem -= 1;
  }
  return parts.map(({ raw: _raw, ...rest }) => rest);
}

export function buildPlan(
  vendors: VendorAnalysis[],
  groups: VendorGroup[],
  meta: PayMetaMap,
  budget: number,
  nowMs: number = Date.now(),
): PayPlan {
  const units = buildUnits(vendors, groups, meta, nowMs);

  const skipped: PaySkip[] = [];
  const candidates: PayUnit[] = [];
  for (const u of units) {
    if (u.outstanding <= 0.5) continue; // fully settled — not even worth listing
    // Muted beats everything — even a vendor screaming with eligible
    // money stays out while dad has him silenced. Listed in "skipped"
    // (not hidden) so the mute is always visible and reversible.
    if (u.muteActive) {
      skipped.push({ unit: u, reason: `🔕 ${u.muteLabel ?? "muted"}` });
      continue;
    }
    if (u.eligible < 500) {
      // Say exactly WHY there's nothing suggestible — inside credit,
      // on hold, or both.
      const parts: string[] = [];
      if (u.insideCredit > 0.5) {
        parts.push(
          `₹${Math.round(u.insideCredit).toLocaleString("en-IN")} inside the ${u.termsLabel} credit period`,
        );
      }
      if (u.held > 0.5) {
        parts.push(`₹${u.held.toLocaleString("en-IN")} on hold`);
      }
      skipped.push({
        unit: u,
        reason: parts.length > 0 ? `Nothing payable — ${parts.join(" · ")}` : "Nothing payable",
      });
      continue;
    }
    candidates.push(u);
  }

  const maxEligible = Math.max(...candidates.map((u) => u.eligible), 1);

  const scored = candidates.map((u) => {
    // A) Is it "their turn"? Compare silence-since-last-payment with
    //    their own historical cycle. Never-paid vendors score by how
    //    old their eligible money is instead.
    const turn =
      u.daysSinceLastPay == null
        ? Math.min(1, u.oldestEligibleAge / 90)
        : Math.min(1, u.daysSinceLastPay / ((u.cycleDays ?? 45) * 2));
    // B) How stale is the eligible money itself.
    const aging = Math.min(1, u.weightedAge / 120);
    // C) Dad's pressure dial.
    const urgency = u.urgency === "high" ? 1 : u.urgency === "chill" ? 0.1 : 0.5;
    // D) Relationship: a strained relation gets paid sooner to cool
    //    it; a good relation will tolerate waiting a little longer.
    const mood = u.mood === "bad" ? 1 : u.mood === "good" ? 0.25 : 0.5;
    // E) Materiality — log scale so one giant vendor doesn't drown
    //    every small one that has waited months.
    const size = Math.log1p(u.eligible) / Math.log1p(maxEligible);

    const score = Math.round(
      (W.turn * turn + W.aging * aging + W.urgency * urgency + W.mood * mood + W.size * size) * 100,
    );
    return { u, score, components: { turn, aging, urgency, mood, size } };
  });

  scored.sort((a, b) => b.score - a.score || b.u.eligible - a.u.eligible);

  // ── Allocate the budget down the ranking ─────────────────────────
  const picks: PayPick[] = [];
  let left = Math.max(0, Math.floor(budget));

  for (const { u, score, components } of scored) {
    if (left < 1000) break;

    // Their usual payment size drives the suggestion — that's the
    // "how much this vendor gets every time their cycle comes" rule,
    // and it's what makes partial-bill suggestions natural. Fallback
    // for never-paid vendors: a typical eligible bill.
    const base =
      u.typicalPayment ??
      median(u.eligibleBills.map((b) => b.payable)) ??
      u.eligible;

    let amount = Math.min(u.eligible, Math.max(base, 5000));
    // Close-out rule: if the suggestion nearly clears them, clear them.
    if (u.eligible <= amount * 1.35) amount = u.eligible;
    amount = Math.min(amount, left);
    if (amount < u.eligible) amount = roundAmount(amount);
    if (amount < 5000 && amount < u.eligible) continue; // not a real payment

    // Map the amount onto actual bills, oldest first — so dad sees
    // exactly which bills this covers (n full + possibly 1 partial).
    const coverage: PayPick["coverage"] = [];
    let rem = amount;
    for (const b of u.eligibleBills) {
      if (rem <= 0) break;
      // Only the un-held part of a bill may be covered.
      const pay = Math.min(b.payable, rem);
      rem -= pay;
      coverage.push({
        billLabel: b.token || b.billNo || "bill",
        vendorName: b.vendorName,
        date: b.date,
        open: Math.round(b.outstanding),
        pay: Math.round(pay),
        held: Math.round(b.held),
        // "Full" = the bill is genuinely closed by this payment. A
        // bill with money still held stays open by design.
        full: b.held < 0.5 && pay >= b.outstanding - 0.5,
      });
    }

    const clearsFully = amount >= u.eligible - 0.5;

    const reasons: PickReason[] = [];
    if (u.daysSinceLastPay == null) {
      reasons.push({ icon: "🕰", text: `Never paid — oldest bill ${u.oldestEligibleAge}d old` });
    } else if (u.cycleDays != null) {
      reasons.push({
        icon: "🔁",
        text: `${u.daysSinceLastPay}d since last payment · usually paid every ~${u.cycleDays}d`,
      });
    } else {
      reasons.push({ icon: "🕰", text: `${u.daysSinceLastPay}d since their only payment` });
    }
    if (u.typicalPayment != null && !clearsFully) {
      reasons.push({
        icon: "₹",
        text: `Their usual payment is ~₹${Math.round(u.typicalPayment).toLocaleString("en-IN")}`,
      });
    }
    reasons.push({
      icon: "📅",
      text: `₹${u.eligible.toLocaleString("en-IN")} past the ${u.termsLabel} credit period`,
    });
    if (u.held > 0.5) {
      reasons.push({
        icon: "✋",
        text: `₹${u.held.toLocaleString("en-IN")} on hold — kept out of this suggestion`,
      });
    }
    if (u.urgency === "high") reasons.push({ icon: "🔥", text: "Pressing hard for money" });
    if (u.urgency === "chill") reasons.push({ icon: "🧊", text: "Not pushing for money" });
    if (u.mood === "bad") reasons.push({ icon: "😠", text: "Relation is strained — settling helps" });
    if (u.mood === "good") reasons.push({ icon: "😊", text: "Good relation — they can wait if needed" });
    if (clearsFully) reasons.push({ icon: "✅", text: "This clears everything payable" });
    if (u.isGroup) reasons.push({ icon: "🔗", text: `${u.memberNames.length} firms counted as one person` });

    picks.push({ unit: u, score, components, amount: Math.round(amount), clearsFully, coverage, reasons });
    left -= Math.round(amount);
  }

  const allocated = picks.reduce((s, p) => s + p.amount, 0);

  return {
    picks,
    skipped,
    budget: Math.floor(budget),
    allocated,
    leftover: Math.max(0, Math.floor(budget) - allocated),
    totalEligible: candidates.reduce((s, u) => s + u.eligible, 0),
    totalHeld: units.reduce((s, u) => s + u.held, 0),
  };
}
