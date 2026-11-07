// ──────────────────────────────────────────────────────────────────
// Matching a printed bill line to a tool on the shelf (mig 237).
//
// Daksh, Nov 2026: "make the AI smart — if there is a small typo the AI
// can fix it and put stock to the relevant item."
//
// This is the part that quietly fails if you leave it to the model
// alone. Reading a bill is solved; deciding that
//
//     "DSZ.10.4/40 160MM"      (as printed by SHARDA)
//
// is the shelf's
//
//     "DSZ. 10.4-40"  spec "160"
//
// is not, because every supplier writes the same tool differently and
// the same supplier is not consistent with itself.
//
// ── Four doors, cheapest and most certain first ───────────────────
//
//   1. ALIAS  this supplier has printed this exact text before and a
//             human told us what it was. No judgement, just a lookup.
//             Costs nothing and is always right.
//   2. EXACT  normalised equality with a catalogue entry.
//   3. FUZZY  our own scoring, over a high bar. The separator-noise
//             case: dots, slashes, spaces, a trailing MM.
//   4. AI     the model's proposal — but only if our own scoring also
//             finds it plausible.
//
// ── Why the AI gets a veto and not a vote ─────────────────────────
//
// The catalogue currently has ONE active tool. Hand a model a list of
// one and ask "which of these is it?" and it will find a reason. That
// is how a box of end mills ends up filed as diamond segments.
//
// So an AI match must also clear AI_FLOOR on our own string scoring.
// Below that the suggestion is thrown away and the line is treated as
// new — which a human then confirms. The model is very good at reading
// and quite capable of being agreeable; we take the reading and check
// the agreement.
//
// ── Digits are sacred, and scoring will not protect them ──────────
//
// The first version of this file trusted the score to keep sizes apart.
// It does not. Measured:
//
//   "DSZ 10.4-40 (150)"  vs  "DSZ. 10.4-40 160"   →  0.909
//   "DSZ.10.4/40 160MM"  vs  "DSZ. 10.4-40 160"   →  0.909
//
// Identical. Of course they are: normalised to "DSZ10440150" and
// "DSZ10440160", one digit differs out of eleven characters, so every
// string metric calls that nearly the same word. It IS nearly the same
// word. It is a completely different tool, and auto-accepting it would
// put a box of 150s into the 160s row where nobody would ever find it.
//
// So size is checked separately and exactly. A line may only be
// AUTO-ACCEPTED against a catalogue entry when the numbers in the two
// texts are the same multiset — see digitsAgree(). Punctuation,
// spacing, case and a trailing MM may all differ freely, because none
// of those change what is in the box. A single digit anywhere stops the
// automatic path dead and sends the line to a human.
//
// Everything stopped that way is still SHOWN pre-filled with its best
// candidate, so the reviewer taps once rather than typing. Nothing is
// ever posted without a human looking at the sheet.
// ──────────────────────────────────────────────────────────────────

/** Auto-accept a fuzzy match at or above this. Separator noise only. */
export const CONFIDENT = 0.88;

/** An AI proposal below this is discarded as a hallucinated match. */
export const AI_FLOOR = 0.55;

/** Below this we do not even offer a candidate — the line reads as new. */
export const SUGGEST = 0.45;

/**
 * Letters and digits, upper case, everything else gone.
 *
 * "DSZ. 10.4-40 (160)" → "DSZ10440160"
 *
 * Aggressive on purpose: punctuation is where suppliers disagree and
 * digits are where they must not.
 */
export function normKey(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A supplier's identity for the learning table. Drops the company
 *  furniture so "SHARDA HARDWARE" and "Sharda Hardware & Co." at least
 *  stand a chance of being the same key. */
export function normSupplier(s: string): string {
  return normKey(
    (s || "")
      .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|AND|CO|COMPANY|THE|ENTERPRISES?|TRADERS?|AGENCY|AGENCIES)\b/gi, " ")
      .replace(/&/g, " "),
  );
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice over character bigrams. Good at separator noise, and
 *  properly unforgiving about a changed digit. */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  let total = 0;
  for (const n of A.values()) total += n;
  for (const [g, n] of B) {
    total += n;
    const have = A.get(g);
    if (have) shared += Math.min(have, n);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

/** Levenshtein distance, iterative two-row. Strings here are part
 *  numbers, so length is tiny and the simple version is the right one. */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length];
}

/** Edit distance as a 0–1 ratio. Catches a transposition, which bigrams
 *  punish harder than a human would. */
function levRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return Math.max(0, 1 - lev(a, b) / longest);
}

/**
 * How alike are two printed descriptions, 0–1.
 *
 * The max of two different opinions: bigrams forgive reordering and
 * punctuation, edit distance forgives a transposed pair. Taking the
 * better of the two means a match is only rejected when BOTH think it
 * is far — which is what we want before we make somebody retype a line.
 */
export function similarity(rawA: string, rawB: string): number {
  const a = normKey(rawA);
  const b = normKey(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // A code printed in full on one bill and abbreviated on another:
  // containment is a strong signal that bigrams alone underrates.
  const contained =
    (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b))
      ? Math.min(a.length, b.length) / Math.max(a.length, b.length)
      : 0;
  return Math.max(dice(a, b), levRatio(a, b), contained);
}

/**
 * Every number in a text, sorted, decimals intact.
 *
 * Run on the RAW text, never on normKey output — normKey strips the
 * decimal point, which would turn 10.4 into 104 and make a 10.4 agree
 * with a 104.
 */
export function numbersOf(s: string): number[] {
  const out: number[] = [];
  for (const m of (s || "").matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Do two texts describe the same SIZE?
 *
 * The one gate that keeps a 150 out of the 160s row. Compared as
 * numbers, so "0160" and "160" agree and "10.4" and "104" do not.
 */
export function digitsAgree(a: string, b: string): boolean {
  const A = numbersOf(a);
  const B = numbersOf(b);
  if (A.length !== B.length) return false;
  return A.every((n, i) => n === B[i]);
}

/** The shelf, as little of it as the matcher needs. */
export type MatchTool = {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
};

/** supplier_key + code_key → tool id, from cnc_tool_supplier_codes. */
export type AliasMap = Record<string, string>;

export const aliasKey = (supplierKey: string, rawText: string): string =>
  `${supplierKey}|${normKey(rawText)}`;

export type MatchOutcome = "alias" | "exact" | "fuzzy" | "ai" | "new";

export type MatchResult = {
  toolId: string | null;
  outcome: MatchOutcome;
  score: number;
  /** True when a human has to say yes before anything is written: a new
   *  tool, or a candidate we are not sure enough about. */
  needsConfirm: boolean;
  /** Runners-up, so the reviewer can pick instead of typing. */
  alternatives: Array<{ toolId: string; score: number }>;
};

/** Every way a tool might be written, for scoring against. */
function facesOf(t: MatchTool): string[] {
  const faces = [t.name];
  if (t.spec) {
    faces.push(`${t.name} ${t.spec}`);
    faces.push(t.spec);
  }
  return faces;
}

/**
 * Two scores for one tool.
 *
 *   score      the best resemblance to any way of writing this tool.
 *              Used for ranking and for offering candidates.
 *   safeScore  the best resemblance to a way of writing it that has
 *              THE SAME NUMBERS. Only this one may auto-accept.
 *
 * Both are needed: the top-ranked candidate for a 150 is the 160, and
 * it should still be shown as the likely answer — just never applied
 * without somebody looking at it.
 */
function scoreTool(raw: string, t: MatchTool): { score: number; safeScore: number } {
  let score = 0;
  let safeScore = 0;
  for (const face of facesOf(t)) {
    const s = similarity(raw, face);
    if (s > score) score = s;
    if (s > safeScore && digitsAgree(raw, face)) safeScore = s;
  }
  return { score, safeScore };
}

function bestScore(raw: string, t: MatchTool): number {
  return scoreTool(raw, t).score;
}

/**
 * Decide what one printed line is.
 *
 * `aiToolId` is the model's proposal, which is treated as a candidate
 * and not an answer: it has to clear AI_FLOOR on our own scoring or it
 * is dropped entirely.
 */
export function matchLine(args: {
  raw: string;
  tools: MatchTool[];
  aliases: AliasMap;
  supplierKey: string;
  aiToolId?: string | null;
}): MatchResult {
  const { raw, tools, aliases, supplierKey, aiToolId } = args;
  const live = tools.filter((t) => t.id);

  const scored = live
    .map((t) => ({ toolId: t.id, ...scoreTool(raw, t) }))
    .sort((a, b) => b.score - a.score);
  const alternatives = scored
    .filter((s) => s.score >= SUGGEST)
    .slice(0, 4)
    .map((s) => ({ toolId: s.toolId, score: s.score }));

  // 1 ── The supplier's own code, already learned. Nothing beats this:
  //      a human said so, about this exact text, from this supplier.
  const learned = aliases[aliasKey(supplierKey, raw)];
  if (learned && live.some((t) => t.id === learned)) {
    return { toolId: learned, outcome: "alias", score: 1, needsConfirm: false, alternatives };
  }

  // 2 ── Normalised equality against any face of a catalogue entry.
  const exact = live.find((t) => facesOf(t).some((f) => normKey(f) === normKey(raw)));
  if (exact) {
    return { toolId: exact.id, outcome: "exact", score: 1, needsConfirm: false, alternatives };
  }

  const top = scored[0];

  // 3 ── Our own scoring, over the strict bar — and only against a way
  //      of writing the tool that has the SAME NUMBERS. This is the
  //      separator-noise case and nothing else. A 150 scores 0.909
  //      against a 160 and must never arrive here.
  const safest = scored.filter((s) => s.safeScore > 0).sort((a, b) => b.safeScore - a.safeScore)[0];
  if (safest && safest.safeScore >= CONFIDENT) {
    return {
      toolId: safest.toolId,
      outcome: "fuzzy",
      score: safest.safeScore,
      needsConfirm: false,
      alternatives,
    };
  }

  // 4 ── The model's proposal, if we can see why it said it. This is
  //      the typo case the request was about: pre-filled, flagged, and
  //      one tap from done — after which the alias table means the
  //      question is never asked again.
  if (aiToolId && live.some((t) => t.id === aiToolId)) {
    const aiScore = bestScore(raw, live.find((t) => t.id === aiToolId)!);
    if (aiScore >= AI_FLOOR) {
      return { toolId: aiToolId, outcome: "ai", score: aiScore, needsConfirm: true, alternatives };
    }
  }

  // Nothing we can stand behind. Offer the best candidate anyway so the
  // reviewer can tap it, but the line reads as new until they do.
  return {
    toolId: null,
    outcome: "new",
    score: top?.score ?? 0,
    needsConfirm: true,
    alternatives,
  };
}

/**
 * A tidy name for a tool we are about to create from a bill line.
 *
 * The AI's suggestion wins when it has one — it has seen the whole bill
 * and can tell a product name from a row of codes. Failing that, the
 * printed text with its worst punctuation knocked off, because
 * "DSZ.10.4/40  160MM  X" is a name somebody has to read on a phone.
 */
export function cleanToolName(raw: string, suggested?: string | null): string {
  const pick = (suggested || "").trim() || (raw || "").trim();
  return pick
    .replace(/\s+/g, " ")
    .replace(/^[-–—·*,.\s]+|[-–—·*,.\s]+$/g, "")
    .slice(0, 80);
}

/** Units a bill prints, mapped onto what the shelf calls them. */
const UNIT_ALIASES: Record<string, string> = {
  PCS: "pcs", PC: "pcs", PIECE: "pcs", PIECES: "pcs", NOS: "pcs", NO: "pcs",
  EA: "pcs", EACH: "pcs", UNIT: "pcs", UNITS: "pcs", SET: "set", SETS: "set",
  BOX: "box", BOXES: "box", PKT: "pkt", PACKET: "pkt", PACK: "pkt",
  KG: "kg", KGS: "kg", KILO: "kg", GM: "gm", GRAM: "gm", LTR: "ltr",
  LITRE: "ltr", L: "ltr", MTR: "mtr", METER: "mtr", METRE: "mtr", M: "mtr",
  ROLL: "roll", ROLLS: "roll", PAIR: "pair", PAIRS: "pair", DOZ: "dozen",
  DOZEN: "dozen", BAG: "bag", BAGS: "bag", DRUM: "drum", CAN: "can",
};

export function cleanUnit(raw?: string | null): string {
  const key = (raw || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!key) return "pcs";
  return UNIT_ALIASES[key] ?? (key.length <= 6 ? key.toLowerCase() : "pcs");
}
