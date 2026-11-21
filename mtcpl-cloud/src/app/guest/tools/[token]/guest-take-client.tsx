"use client";

/**
 * The wardrobe screen, in a thumb.
 *
 *   name → a 4-digit code to that person's own phone → in for the shift
 *   tool → what are you taking?
 *   qty  → how many?
 *   done → a tick, and "Take another" with the person still signed in
 *
 * Oct 2026 — the company step is gone. Daksh: "why you ask vendors
 * selection, no need of that — eg Mohit login, then if he take any stock
 * that means its taken from his account." The OTP already proves who is
 * standing there, and that is the whole signature; asking a man who he
 * works for, at a cupboard, every time, was a screen that told us
 * nothing we did not know.
 *
 * Colour does real work here. This is read at arm's length, in a bright
 * office, by someone holding a tool in the other hand — so the stock
 * level is a colour before it is a number, the live step is the only
 * bright thing on the screen, and the only button that writes anything
 * is the big green one.
 *
 * Everything here is take-only. Adding stock, scrap and fix-count are
 * not in this file because they are not reachable from this door.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useLiveStock } from "@/lib/use-live-stock";
import { KEEPER_CSS, KeeperSheet, type KeeperTool } from "./keeper-sheet";
import { useLongPress } from "@/lib/use-long-press";
import type {
  GuestTakeResult,
  GuestUndoResult,
  RegisterLine,
  RegisterResult,
  TakeSlip,
} from "./guest-actions";

export type TakeTool = {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
  stock: number;
  level: "out" | "low" | "ok";
  /** Mig 233 — the photo. A man holding the tool recognises it here
   *  faster than he reads "450mm tool". */
  imageUrl: string | null;
};
export type RosterPerson = {
  id: string;
  kind: "profile" | "operator";
  name: string;
  maskedPhone: string;
  /** The company he belongs to. Null for the developer. */
  company: string | null;
  /** The man whose company it is — he heads his own group. */
  isPrincipal: boolean;
};
/*
 * TeamMate / ManLite / VendorChoice lived here — a vendor's enrolled
 * men, and what each was carrying. Removed Nov 2026 with the per-man
 * login itself; see lib/cnc-tool-session.ts for why.
 */

/** Mig 238 — a tool he has taken and not yet spent or given back. */
export type HeldLite = {
  toolId: string;
  name: string;
  spec: string | null;
  unit: string;
  qty: number;
  imageUrl: string | null;
};

/** Mig 238 — a CNC he may spend a tool on. His own company's only; the
 *  office sees all of them. The database checks it again. */
export type MachineLite = {
  id: string;
  code: string;
  vendorName: string | null;
  machineType: string;
  /** Carving right now. Drawn as a dot, so filing against a machine
   *  that is not even running looks like the slip it usually is. */
  busy: boolean;
};
type Session = {
  name: string;
  company: string | null;
  /** The office three: may fill the shelf from the cupboard itself. */
  canKeep: boolean;
};

type SendRes = { ok: true; sentTo: string } | { ok: false; error: string };
type KeeperRes = { ok: true; message: string } | { ok: false; error: string };
type VerifyRes =
  | {
      ok: true;
      name: string;
      company: string | null;
      canKeep: boolean;
    }
  | { ok: false; error: string; attemptsLeft?: number };
/* Hand-copied until Nov 2026, when the take grew a slip and the copy
   quietly went stale — the compiler caught it, but only because the
   card read a field the copy did not have. It is the action's own type
   now, so the two cannot drift again. */
type TakeRes = GuestTakeResult;
type MyToolsRes =
  | { ok: true; items: HeldLite[] }
  | { ok: false; error: string; signedOut?: boolean };
/** Both answers to "what happened to it" come back the same shape, and
 *  both carry his whole account afterwards — so the number on screen is
 *  the number in the database with no second round trip. */
type SettleRes =
  | {
      ok: true;
      outcome: "used" | "returned";
      usageId: string | null;
      toolName: string;
      qty: number;
      machine: string | null;
      left: number;
      items: HeldLite[];
    }
  | { ok: false; error: string; signedOut?: boolean };

/* "done" is gone — a take drops you straight back on the shelf with a
   popup over it, rather than parking on a screen whose only two
   answers were "take something else" and "sign out".
   "register" is the cupboard's own timeline: who took what, when. */
type RegisterRes = RegisterResult;

// ── The shed's day, not the browser's ─────────────────────────────
//
// A phone at the cupboard is on IST, but a register that silently
// reads differently on a laptop in another timezone is a register
// people stop trusting. Shift by +5:30 and read the UTC parts, which
// is how the rest of this codebase buckets a day.
const IST_MS = 5.5 * 60 * 60 * 1000;
const istParts = (iso: string) => new Date(new Date(iso).getTime() + IST_MS);

function istDay(iso: string): string {
  return istParts(iso).toISOString().slice(0, 10);
}

function istTime(iso: string): string {
  const d = istParts(iso);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

/** Date and time together, for the slip and for what gets shared. The
 *  slip may be read on another phone in another week, so it spells the
 *  date out rather than saying "Today". */
function istStamp(iso: string): string {
  const d = istParts(iso);
  return `${d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  })}, ${istTime(iso)}`;
}

/** "Today" and "Yesterday" by the same IST day the lines are grouped
 *  on, so the heading can never disagree with the group under it. */
function dayLabel(iso: string): string {
  const day = istDay(iso);
  const today = istDay(new Date().toISOString());
  const yest = istDay(new Date(Date.now() - 86400000).toISOString());
  if (day === today) return "Today";
  if (day === yest) return "Yesterday";
  const d = istParts(iso);
  return d.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}

/* "mine" is his account — what he took and has not accounted for yet.
   "use" is the one screen that empties it: spent on a machine, or back
   on the shelf (mig 238). */
type Step = "who" | "code" | "tool" | "qty" | "register" | "team" | "mine" | "use";

const DIGITS = 4;

/** One colour per person, picked from their name so it is the same every
 *  morning — the men recognise their own tile before they read it. */
// Was six rainbow colours picked off a hash of the name — indigo, sky,
// emerald, amber, pink, violet. Daksh, Nov 2026: the module reads as
// childish on a phone, and a screen of candy-coloured circles is most
// of why. The names are the information; the circle only has to look
// like a person. One company tone, one office tone, and the list is
// already grouped under its headings.
const PERSON_COLOURS = ["#2D2410"];
function colourFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PERSON_COLOURS[h % PERSON_COLOURS.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** How often the cupboard asks whether the shelf moved. Two men can
 *  genuinely be standing here at once, so this one is quick — it is a
 *  few hundred bytes and it stops dead while the phone is pocketed. */
const QR_POLL_MS = 2500;

/** How long the slip stays up on its own. Daksh asked for four
 *  seconds; the first touch cancels it, because four seconds is not
 *  long enough to photograph a QR and he should not have to race it. */
const SLIP_MS = 4000;

export function GuestTakeClient({
  token, label, tools, stockSig, roster, session,
  sendCodeAction, verifyCodeAction, signOutAction, takeAction,
  registerAction,
  keeperTools, addStockAction, fixCountAction, newToolAction,
  held: initialHeld, machines, myToolsAction, settleAction, undoUsageAction,
  undoTakeAction,
}: {
  token: string;
  label: string;
  tools: TakeTool[];
  /** The shelf as the server last rendered it (mig 236). */
  stockSig: string;
  roster: RosterPerson[];
  session: Session | null;
  sendCodeAction: (fd: FormData) => Promise<SendRes>;
  verifyCodeAction: (fd: FormData) => Promise<VerifyRes>;
  signOutAction: (fd: FormData) => Promise<{ ok: boolean }>;
  takeAction: (fd: FormData) => Promise<TakeRes>;
  registerAction: (fd: FormData) => Promise<RegisterRes>;
  /** Every live tool, for the keeper's sheet. Empty for everyone else. */
  keeperTools: KeeperTool[];
  addStockAction: (fd: FormData) => Promise<KeeperRes>;
  fixCountAction: (fd: FormData) => Promise<KeeperRes>;
  newToolAction: (fd: FormData) => Promise<KeeperRes>;
  /** Mig 238 — his account, rendered on the server so the strip over the
   *  shelf is right on first paint. A man who is holding four things
   *  should not have to wait for a fetch to be told so. */
  held: HeldLite[];
  /** The CNCs he may file against. Empty for nobody — everyone who can
   *  sign in here belongs to a company or to the office. */
  machines: MachineLite[];
  myToolsAction: (fd: FormData) => Promise<MyToolsRes>;
  settleAction: (fd: FormData) => Promise<SettleRes>;
  undoUsageAction: (fd: FormData) => Promise<SettleRes>;
  /** Nov 2026 — the Undo on the slip. The office has had this since
   *  mig 227; the cupboard never did, so the man who made the mistake
   *  had to find somebody at a desk to fix it. */
  undoTakeAction: (fd: FormData) => Promise<GuestUndoResult>;
}) {
  const [who, setWho] = useState<Session | null>(session);
  // Signed in lands on HIS TOOLS, not on the shelf. Daksh, Nov 2026:
  // "when they login they go to their dashboard — means what tools they
  // have. And if they want they can go to store to get new tools."
  //
  // The shelf was the home page because taking was the only thing this
  // door could do. It is not any more: most visits now are a man saying
  // what he did with something he already has, and making him walk past
  // a shelf full of things he is not taking to get to it was backwards.
  const [step, setStep] = useState<Step>(session ? "mine" : "who");
  const [picked, setPicked] = useState<RosterPerson | null>(null);
  /** A tool held down in the list, handed to the keeper sheet so it
   *  opens on that tool instead of on a list of every tool. */
  const [jump, setJump] = useState<KeeperTool | null>(null);
  /** Opens the keeper sheet straight on New tool, from the header. */
  const [wantNew, setWantNew] = useState(false);
  /**
   * The slip for the take he has just made — a full-page card, not the
   * line that used to slide up from the bottom.
   *
   * Daksh, Nov 2026: "after take 1 pcs it only gives a small feedback.
   * Instead it should give a full page card that this is taken, and it
   * will be there for 4 seconds, and on that card there will be an undo
   * button... and a QR they can save."
   *
   * `slip` is null when the write came back without a movement id,
   * which should not happen; the card then shows the take without a QR
   * rather than claiming nothing was taken.
   */
  const [done, setDone] = useState<{
    slip: TakeSlip | null;
    toolName: string;
    qty: number;
    left: number;
    undone: boolean;
    /** Daksh, Nov 2026: "if there is item image then card should also
     *  show item image." Taken from the shelf row he just pressed
     *  rather than fetched again — the phone already has it, and the
     *  take path is the one place on this screen where latency is felt
     *  with somebody waiting at the cupboard. */
    imageUrl: string | null;
    spec: string | null;
  } | null>(null);
  /** The four seconds are a DEFAULT, not a deadline. Four seconds is
   *  plenty to read "4 taken" and nowhere near enough to photograph a
   *  QR, so the first touch anywhere on the card cancels the timer and
   *  the card stays until he closes it. */
  const [pinned, setPinned] = useState(false);
  /** The cupboard's register. Loaded when it is opened, not before —
   *  most visits are somebody taking one thing and leaving. */
  const [reg, setReg] = useState<RegisterLine[] | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [regMine, setRegMine] = useState(false);
  const [regTrunc, setRegTrunc] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [tool, setTool] = useState<TakeTool | null>(null);
  const [qty, setQty] = useState(1);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [tally, setTally] = useState<Array<{ toolName: string; qty: number }>>([]);
  const [taken, setTaken] = useState<Record<string, number>>({});
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement | null>(null);
  /** What the keeper's sheet just did. Its own line, because it is a
   *  different kind of news from "you took two". */
  const [kept, setKept] = useState<string | null>(null);

  // ── his account, and what leaves it (mig 238) ───────────────────
  /** Everything he is holding. Server-rendered, then kept in step by
   *  every take and every settle rather than refetched. */
  const [held, setHeld] = useState<HeldLite[]>(initialHeld);
  /** The one he is accounting for. */
  const [holding, setHolding] = useState<HeldLite | null>(null);
  const [useQty, setUseQty] = useState(1);
  const [machine, setMachine] = useState<MachineLite | null>(null);
  const [mineBusy, setMineBusy] = useState(false);
  /** The usage he just filed, while it can still be taken back. Not the
   *  flash: the flash clears itself in under three seconds and a wrong
   *  machine number deserves longer than that, because it is going
   *  straight into a costing report. */
  const [justUsed, setJustUsed] = useState<
    { usageId: string; toolName: string; qty: number; unit: string; machine: string } | null
  >(null);

  // Only while somebody is actually looking at the shelf. On the name
  // and code steps there is no number on screen to go stale.
  useLiveStock({
    signature: stockSig,
    everyMs: QR_POLL_MS,
    token,
    enabled: step === "tool" || step === "qty",
  });

  // `taken` is what THIS visit has taken, held locally so the shelf
  // drops the moment he taps rather than waiting for a round trip.
  // Once the poll pulls fresh numbers in, the server's figure already
  // includes those takes — so the local tally has to be dropped at the
  // same instant or it would be subtracted twice and the shelf would
  // read short. The signature changing IS that instant.
  useEffect(() => {
    setTaken({});
  }, [stockSig]);

  const stockOf = (t: TakeTool) => Math.max(0, t.stock - (taken[t.id] ?? 0));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const live = tools.filter((t) => Math.max(0, t.stock - (taken[t.id] ?? 0)) > 0);
    if (!needle) return live;
    return live.filter(
      (t) => t.name.toLowerCase().includes(needle) || (t.spec ?? "").toLowerCase().includes(needle),
    );
  }, [tools, q, taken]);

  // "Send again" is deliberately slow to come back — every tap is a real
  // SMS to somebody's phone.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") {
      const id = window.setTimeout(() => codeRef.current?.focus(), 120);
      return () => window.clearTimeout(id);
    }
  }, [step]);

  function sendCode(p: RosterPerson) {
    setPicked(p);
    setErr(null);
    setCode("");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("person_kind", p.kind);
      fd.set("person_id", p.id);
      const r = await sendCodeAction(fd);
      if (!r.ok) { setErr(r.error); return; }
      setSentTo(r.sentTo);
      setCooldown(30);
      setStep("code");
    });
  }

  function verify(typed: string) {
    if (!picked || typed.length !== DIGITS) return;
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("person_kind", picked.kind);
      fd.set("person_id", picked.id);
      fd.set("code", typed);
      const r = await verifyCodeAction(fd);
      if (!r.ok) {
        setErr(r.attemptsLeft != null
          ? `${r.error} ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left.`
          : r.error);
        setCode("");
        codeRef.current?.focus();
        return;
      }
      // Straight from the server. This used to be worked out here from
      // the roster tile that was tapped, and got the developer wrong:
      // his tile is not a principal, so the panel never appeared.
      setWho({
        name: r.name,
        company: r.company,
        canKeep: r.canKeep,
      });
      // Onto his own tools. The page was rendered before anyone was
      // signed in, so it had no account to hand over — fetch it here
      // rather than drop him on an empty dashboard.
      setStep("mine");
      setMineBusy(true);
      void (async () => {
        try {
          const mf = new FormData();
          mf.set("token", token);
          const mine = await myToolsAction(mf);
          if (mine.ok) setHeld(mine.items);
        } catch {
          // A dropped network here must not take the screen down with
          // it: he is signed in, and an empty list he can refresh beats
          // an unhandled rejection on a phone at a cupboard.
        } finally {
          setMineBusy(false);
        }
      })();
    });
  }

  // The card takes itself away after four seconds — unless he has
  // touched it, or the take has been undone and he is being told so.
  useEffect(() => {
    if (!done || pinned || done.undone) return;
    const t = setTimeout(() => setDone(null), SLIP_MS);
    return () => clearTimeout(t);
  }, [done, pinned]);

  /**
   * Take it back, inside the ten minutes.
   *
   * Optimism would be wrong here: the whole point of the button is that
   * the man is unsure, so nothing on screen changes until the server
   * has actually voided the row. What does change is local — the pcs
   * come straight back out of his account and off his tally, so the
   * strip over the shelf is right before the card has even closed.
   */
  function undoTake() {
    const d = done;
    if (!d?.slip) return;
    setErr(null);
    setPinned(true);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("movement_id", d.slip!.id);
      const r = await undoTakeAction(fd);
      if (!r.ok) {
        setErr(r.error);
        if (r.signedOut) { setWho(null); setPicked(null); setStep("who"); }
        setDone(null);
        return;
      }
      setHeld((prev) =>
        prev
          .map((h) => (h.toolId === r.toolId ? { ...h, qty: h.qty - r.qty } : h))
          .filter((h) => h.qty > 0),
      );
      setTaken((prev) => {
        const left = (prev[r.toolId] ?? 0) - r.qty;
        const next = { ...prev };
        if (left > 0) next[r.toolId] = left; else delete next[r.toolId];
        return next;
      });
      setTally((prev) => prev.slice(1));
      // The card stays, saying so. A man who has just undone something
      // wants to be told it worked, not shown an empty shelf.
      setDone({ ...d, undone: true });
      router.refresh();
    });
  }

  function openRegister() {
    setStep("register");
    setErr(null);
    if (reg) return;
    setRegBusy(true);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      const r = await registerAction(fd);
      setRegBusy(false);
      if (!r.ok) {
        setErr(r.error);
        if (r.signedOut) { setWho(null); setPicked(null); setStep("who"); }
        return;
      }
      setReg(r.lines);
      setRegTrunc(r.truncated);
    });
  }

  /**
   * His account — what he took and has not accounted for yet (mig 238).
   *
   * Daksh, Nov 2026: "Mohit took 5 pcs of some tool, then this 5 pcs
   * will show in his account."
   *
   * Refetched on the way in rather than trusted: the cupboard may have
   * been open on this phone since the morning, and he may have filed
   * something from the office screen in between.
   */
  function openMine() {
    setStep("mine");
    setErr(null);
    setHolding(null);
    setMineBusy(true);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      const r = await myToolsAction(fd);
      setMineBusy(false);
      if (!r.ok) {
        setErr(r.error);
        if (r.signedOut) { setWho(null); setPicked(null); setStep("who"); }
        return;
      }
      setHeld(r.items);
    });
  }

  /** Through to the shelf. Clears the search the last visit left
   *  behind, so it never opens filtered to something he has forgotten
   *  he typed. */
  function openStore() {
    setQ("");
    setTool(null);
    setErr(null);
    setStep("tool");
  }

  function openUse(h: HeldLite) {
    setHolding(h);
    setUseQty(1);
    // No mode to set any more. Until Nov 2026 this screen asked "used
    // on a machine, or given back?", and the second answer was picked
    // by mistake often enough that the usage log could not be trusted.
    // Daksh: "remove that gave it back thing. if we think we need this
    // feature we will do in future." So a settle is always a USE now,
    // and a pc that genuinely comes back to the shelf is put back by
    // the keeper, who is the only one who can see the shelf anyway.
    // One machine in the list is no choice at all — pick it for him.
    setMachine(machines.length === 1 ? machines[0] : null);
    setErr(null);
    setJustUsed(null);
    setStep("use");
  }

  /** One pc leaves his hands: spent on a machine, or back on the shelf. */
  function settle() {
    if (!holding) return;
    if (!machine) {
      setErr("Which machine? Tap one first.");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("tool_id", holding.toolId);
      fd.set("outcome", "used");
      fd.set("qty", String(useQty));
      fd.set("machine_id", machine.id);
      const r = await settleAction(fd);
      if (!r.ok) {
        setErr(r.error);
        if (r.signedOut) { setWho(null); setPicked(null); setStep("who"); }
        return;
      }
      setHeld(r.items);
      setHolding(null);
      if (r.outcome === "used" && r.usageId) {
        setJustUsed({
          usageId: r.usageId,
          toolName: r.toolName,
          qty: r.qty,
          unit: holding.unit,
          machine: r.machine ?? "?",
        });
      } else {
        // A return puts stock back on the shelf, so the shelf he is
        // about to look at is out of date by exactly that much.
        setJustUsed(null);
        setKept(`${r.qty} × ${r.toolName} back on the shelf.`);
        router.refresh();
      }
      setStep("mine");
    });
  }

  /** Took the wrong machine number. Ten minutes to say so. */
  function undoUse() {
    if (!justUsed) return;
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("usage_id", justUsed.usageId);
      const r = await undoUsageAction(fd);
      if (!r.ok) {
        setErr(r.error);
        if (r.signedOut) { setWho(null); setPicked(null); setStep("who"); }
        return;
      }
      setHeld(r.items);
      setJustUsed(null);
      setKept(`${r.qty} × ${r.toolName} is back in your hands.`);
    });
  }

  function submit() {
    if (!tool) return;
    setErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("tool_id", tool.id);
      fd.set("qty", String(qty));
      const r = await takeAction(fd);
      if (!r.ok) {
        setErr(r.error);
        if (r.signedOut) { setWho(null); setPicked(null); setStep("who"); }
        return;
      }
      setTaken((p) => ({ ...p, [tool.id]: (p[tool.id] ?? 0) + r.qty }));
      setTally((p) => [{ toolName: r.toolName, qty: r.qty }, ...p]);
      // Into his account at the same instant it leaves the shelf —
      // merged locally rather than refetched, so the strip over the
      // shelf is already right when the popup clears.
      setHeld((prev) => {
        const i = prev.findIndex((h) => h.toolId === tool.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], qty: next[i].qty + r.qty };
          return next;
        }
        return [
          ...prev,
          {
            toolId: tool.id, name: r.toolName, spec: tool.spec,
            unit: tool.unit, qty: r.qty, imageUrl: tool.imageUrl,
          },
        ];
      });
      // Daksh, Nov 2026: "if they take anything in phone it gives 2
      // options, take something else and sign out — instead take back
      // to home page, directly after pop up."
      //
      // The old screen was a dead end that asked a question nobody at a
      // cupboard has. A man takes a bit, then he takes the next bit; he
      // signs out when he walks away, and Sign out is in the header on
      // every screen anyway. So the confirmation is a popup over the
      // shelf, and he is already back where the next tool is.
      setPinned(false);
      setDone({
        slip: r.slip,
        toolName: r.toolName,
        qty: r.qty,
        left: r.left,
        undone: false,
        imageUrl: tool.imageUrl,
        spec: tool.spec,
      });
      setTool(null);
      setQ("");
      setStep("tool");
    });
  }

  function signOut() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      await signOutAction(fd);
      setWho(null); setPicked(null); setTally([]); setTaken({});
      setTool(null); setDone(null); setCode(""); setErr(null);
      // His account goes with him. Leaving it on screen would show the
      // next man at the cupboard what the last one is carrying.
      setHeld([]); setHolding(null); setMachine(null); setJustUsed(null);
      setStep("who");
    });
  }

  const max = tool ? stockOf(tool) : 1;
  /** Everything in his hands, and what the shelf still has to offer —
   *  both shown on the other page's way-in, so each side says what is
   *  waiting on the other. */
  const heldTotal = held.reduce((a, h) => a + h.qty, 0);
  const shelfCount = tools.filter((t) => stockOf(t) > 0).length;

  /**
   * Which of the two places he is standing in.
   *
   * Daksh, Nov 2026, for the second time: "it's really confusing where
   * we are — in store or dashboard. Make the UI this good, it's obvious
   * that we are in store or in dashboard."
   *
   * A heading and a coloured band were not enough, and on reflection
   * that is not surprising: both are things you have to look AT. A man
   * glancing down at a phone with a bit in his other hand reads the
   * page before he reads anything on it.
   *
   * So the whole screen changes colour. Gold paper for the store, plain
   * paper for his own tools — different before a single word is read,
   * and still different out of the corner of your eye.
   */
  const where: "store" | "mine" | "plain" =
    step === "tool" || step === "qty" ? "store"
      : step === "mine" || step === "use" ? "mine"
        : "plain";

  return (
    <main className="gt allow-portrait" data-where={where}>
      <style>{CSS}</style>
      <style>{KEEPER_CSS}</style>

      <header className="gt-head">
        <div className="gt-head-row">
          {/* "Tool store" leads, the door name sits under it. Daksh,
              Nov 2026 — what the thing IS matters more at a glance
              than which cupboard it is, and the door name still has to
              be there because a second shed gets its own sticker. */}
          <div className="gt-brand">
            <span className="gt-logo" aria-hidden>🧰</span>
            {/* Once signed in the words go and the tile carries it alone.
                The header now holds a name, Sign out, the men and the
                register, and on a 375px phone "Tool store" was being
                squeezed to "T…" — which tells nobody anything. Whoever
                is reading it scanned the sticker a minute ago. */}
            <div className={who ? "gt-brand-text gt-brand-gone" : "gt-brand-text"}>
              <div className="gt-brand-label">Tool store</div>
              {/* The door name only before you are signed in. Once you
                  are, you scanned the sticker thirty seconds ago and
                  know which cupboard you are standing at — and the
                  header has a man's name and a Sign out in it by then,
                  which is all the room there is. */}
              {!who && <div className="gt-brand-sub">{label}</div>}
            </div>
          </div>

          {/* New tool. The only survivor of the bottom-centre menu —
              add stock and fix count are on a long hold now, so this is
              all that was left of it, and it belongs up here with the
              other things you open rather than behind two taps. */}
          {who?.canKeep && step === "tool" && (
            <button
              type="button"
              className="gt-men"
              onClick={() => setWantNew(true)}
              aria-label="New tool"
              title="Something the store has never had"
            >
              <span aria-hidden>＋</span>
            </button>
          )}

          {who && (
            <button
              type="button"
              className="gt-men"
              data-on={step === "register" ? "1" : undefined}
              onClick={() => (step === "register" ? setStep("tool") : openRegister())}
              aria-label="The register"
              title="Who took what, and when"
            >
              <span aria-hidden>🕑</span>
            </button>
          )}

          {who && (
            <button type="button" className="gt-me" onClick={signOut} disabled={pending}>
              <span className="gt-me-dot" style={{ background: colourFor(who.name) }}>
                {initials(who.name)}
              </span>
              <span className="gt-me-name">{who.name}</span>
              <span className="gt-me-out">Sign out</span>
            </button>
          )}
        </div>

        {/* Where you are, in three dots — so a man knows the screen is
            going somewhere and how far is left. */}
        {who && step !== "register" && step !== "team" && step !== "mine" && step !== "use" && (
          <div className="gt-steps" aria-hidden>
            <i data-on={step === "tool" ? "1" : undefined} data-done={step !== "tool" ? "1" : undefined} />
            <i data-on={step === "qty" ? "1" : undefined} />
          </div>
        )}
      </header>

      {kept && (
        <div className="gt-kept" role="status">
          <span aria-hidden>✓</span>
          <span>{kept}</span>
          <button type="button" onClick={() => setKept(null)} aria-label="Close">✕</button>
        </div>
      )}

      {err && (
        <div className="gt-err" role="alert">
          <span aria-hidden>⚠</span>
          <span>{err}</span>
          <button type="button" onClick={() => setErr(null)} aria-label="Close">✕</button>
        </div>
      )}

      {/* ── 1. who ─────────────────────────────────────────────── */}
      {step === "who" && (
        <section className="gt-body">
          <h1 className="gt-q">Who is taking?</h1>
          <p className="gt-hint">Tap your name — a code comes to your phone.</p>
          {roster.length === 0 ? (
            <div className="gt-blank">
              Nobody is set up for this cupboard yet. Ask the office.
            </div>
          ) : (
            <div className="gt-people">
              {roster.map((p, i) => {
                // A heading each time the company changes — but only
                // where it earns its line. A heading saying MANTHAN
                // directly above a single row saying MANTHAN is the
                // word twice for nothing; it is worth printing when
                // there are several names under it to tell apart.
                const prev = i > 0 ? roster[i - 1] : null;
                const newGroup = !prev || prev.company !== p.company;
                const groupSize = roster.filter((x) => x.company === p.company).length;
                return (
                  <div key={p.id} className="gt-pgroup">
                    {newGroup && groupSize > 1 && (
                      <div className="gt-pco">{p.company ?? "Office"}</div>
                    )}
                    <button
                      type="button"
                      className="gt-person"
                      data-under={p.kind === "operator" ? "1" : undefined}
                      style={{ ["--who" as string]: colourFor(p.name) }}
                      onClick={() => sendCode(p)}
                      disabled={pending}
                    >
                      <span className="gt-pface">{initials(p.name)}</span>
                      {/* The name and nothing else. The masked number
                          used to ride along on every row and said the
                          same thing six times over; the very next
                          screen tells you where the code went, which
                          is the moment it matters. */}
                      <span className="gt-pname">{p.name}</span>
                      <span className="gt-pgo" aria-hidden>›</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── 2. code ────────────────────────────────────────────── */}
      {step === "code" && picked && (
        <section className="gt-body">
          <h1 className="gt-q">Your code</h1>
          <p className="gt-hint">
            Sent to <strong>{sentTo || picked.maskedPhone}</strong> — {picked.name}
          </p>

          <div className="gt-otp" onClick={() => codeRef.current?.focus()}>
            {Array.from({ length: DIGITS }).map((_, i) => (
              <span key={i} className="gt-otp-box" data-filled={code[i] ? "1" : undefined} data-live={code.length === i ? "1" : undefined}>
                {code[i] ?? ""}
              </span>
            ))}
            <input
              ref={codeRef}
              className="gt-otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={DIGITS}
              value={code}
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, DIGITS);
                setCode(v);
                if (v.length === DIGITS) verify(v);
              }}
              aria-label="4-digit code"
            />
          </div>

          <div className="gt-code-actions">
            <button
              type="button"
              className="gt-ghost"
              onClick={() => { setStep("who"); setCode(""); setErr(null); }}
              disabled={pending}
            >
              ← Not me
            </button>
            <button
              type="button"
              className="gt-ghost"
              onClick={() => sendCode(picked)}
              disabled={pending || cooldown > 0}
            >
              {cooldown > 0 ? `Send again in ${cooldown}s` : "Send again"}
            </button>
          </div>
        </section>
      )}

      {/* ── 3. tool ────────────────────────────────────────────── */}
      {step === "tool" && (
        <section className="gt-body">
          {/* ── you are in the store ───────────────────────────
              Daksh, Nov 2026, after the page tint went in: "the UI is
              good, just it's confusing where currently I am —
              dashboard or tools."

              The tint was too quiet to answer it, and underneath the
              tint the real problem was still there: .gt-storehead (a
              TITLE on this page) and .gt-store-go (the BUTTON on the
              dashboard) were byte-for-byte the same style. Gold fill,
              gold-dark border, 12px radius, 64px tall, white text,
              toolbox in a tinted tile. One is a heading and one goes
              somewhere, and only a › told them apart.

              Colour cannot fix it — gold has to keep meaning "store"
              in both places or the button stops matching its
              destination. So the SHAPES part company:

                full-bleed band, page named in the corner   you are here
                inset rounded card with a chevron           tapping goes

              Nothing tappable on these pages touches the edge of the
              glass; nothing touching the edge can be tapped.

              The three stacked headings go too. A back link, then a
              card saying "The store", then an h1 asking "What are you
              taking?" — two titles arguing over one page with the
              count printed in both. The question is the title now. */}
          <header className="gt-band gt-band-store">
            <div className="gt-band-top">
              <button type="button" className="gt-band-back" onClick={openMine}>
                ‹ Your tools
                {heldTotal > 0 && <i>{heldTotal}</i>}
              </button>
              <span className="gt-band-tag">Store</span>
            </div>
            <div className="gt-band-main">
              <span className="gt-band-ico" aria-hidden>🧰</span>
              <span className="gt-band-text">
                <strong>What are you taking?</strong>
                <em>
                  {shelfCount === 0
                    ? "Nothing on the shelf"
                    : `${shelfCount} ${shelfCount === 1 ? "tool" : "tools"} on the shelf`}
                </em>
              </span>
            </div>
          </header>

          {tools.length > 6 && (
            <div className="gt-search">
              <span aria-hidden>🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search the shelf…"
                aria-label="Search tools"
              />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear">✕</button>}
            </div>
          )}

          {shown.length === 0 ? (
            <div className="gt-blank">
              {q ? `Nothing matches “${q}”.` : "The shelf is empty. Tell the office."}
            </div>
          ) : (
            <div className="gt-tools">
              {shown.map((t) => (
                <ToolButton
                  key={t.id}
                  tool={t}
                  left={stockOf(t)}
                  disabled={pending}
                  // Only the office three and the vendor principals can
                  // keep the shelf. For everyone else a hold does
                  // nothing, because there is nothing it could do.
                  canKeep={!!who?.canKeep}
                  onTake={() => { setTool(t); setQty(1); setStep("qty"); }}
                  onHold={() => setJump(keeperTools.find((k) => k.id === t.id) ?? null)}
                />
              ))}
            </div>
          )}

          {tally.length > 0 && (
            <div className="gt-tally">
              <span className="gt-tally-head">Taken just now</span>
              {tally.map((t, i) => (
                <span key={i} className="gt-tally-chip">
                  {t.qty} × {t.toolName}
                </span>
              ))}
            </div>
          )}

        </section>
      )}

      {/* ── 4. qty ─────────────────────────────────────────────── */}
      {step === "qty" && tool && (
        <section className="gt-body">
          <button type="button" className="gt-back" onClick={() => { setTool(null); setStep("tool"); }}>
            ← Pick another tool
          </button>

          <h1 className="gt-q">How many?</h1>
          <div className="gt-chosen">
            <span className="gt-thumb gt-thumb-lg" data-empty={tool.imageUrl ? undefined : "1"}>
              {tool.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={tool.imageUrl} alt="" />
                : <i>{tool.name.trim().charAt(0).toUpperCase() || "?"}</i>}
            </span>
            <span className="gt-chosen-text">
              <strong>{tool.name}</strong>
              {tool.spec && <span>{tool.spec}</span>}
              <em>{max} {tool.unit} on the shelf</em>
            </span>
          </div>

          <div className="gt-stepper">
            <button
              type="button"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
              disabled={pending || qty <= 1}
              aria-label="One less"
            >
              −
            </button>
            <div className="gt-qty">
              <b>{qty}</b>
              <i>{tool.unit}</i>
            </div>
            <button
              type="button"
              onClick={() => setQty((n) => Math.min(max, n + 1))}
              disabled={pending || qty >= max}
              aria-label="One more"
            >
              +
            </button>
          </div>

          <button type="button" className="gt-take" onClick={submit} disabled={pending}>
            {pending ? "Recording…" : `Take ${qty} ${tool.unit}`}
          </button>
          <p className="gt-fine">Signed by <strong>{who?.name}</strong></p>
        </section>
      )}

      {/* ── 5. his account (mig 238) ───────────────────────────── */}
      {step === "mine" && (
        <section className="gt-body">
          {/* ── whose page this is ─────────────────────────────
              The same band as the store, in the other colour, with the
              word written in the corner — so it is never a matter of
              remembering which colour meant which.

              The initial sits on a white tile rather than in his own
              colour: the palette went to one ink months ago, so "his
              colour" and the band would be the same brown, and a dark
              circle on a dark band is not a circle. */}
          <header className="gt-band gt-band-mine">
            <div className="gt-band-top">
              <span className="gt-band-who">{who?.company ?? "Office"}</span>
              <span className="gt-band-tag">Dashboard</span>
            </div>
            <div className="gt-band-main">
              <span className="gt-band-ico gt-band-dot" aria-hidden>
                {initials(who?.name ?? "")}
              </span>
              <span className="gt-band-text">
                <strong>{who?.name}</strong>
                <em>
                  {heldTotal > 0
                    ? `${heldTotal} ${heldTotal === 1 ? "pc" : "pcs"} in your hands`
                    : "Nothing in your hands"}
                </em>
              </span>
            </div>
          </header>

          {/* A section label, not a title. The band is the only thing
              on the page allowed to read as a heading. */}
          <div className="gt-sect">
            <strong>Tools you have</strong>
            {held.length > 0 && (
              <em>{held.length} {held.length === 1 ? "kind" : "kinds"}</em>
            )}
          </div>

          {/* The usage just filed, while it can still be taken back. A
              wrong machine number is the easy mistake on this screen. */}
          {justUsed && (
            <div className="gt-undo" role="status">
              <span className="gt-undo-text">
                <strong>
                  {justUsed.qty} {justUsed.unit} of {justUsed.toolName}
                </strong>
                <em>used on machine {justUsed.machine}</em>
              </span>
              <button type="button" onClick={undoUse} disabled={pending}>
                {pending ? "…" : "Undo"}
              </button>
            </div>
          )}

          {mineBusy && <div className="gt-reg-wait">Reading your account…</div>}

          {!mineBusy && held.length === 0 ? (
            <div className="gt-blank">Nothing in your hands right now.</div>
          ) : (
            <div className="gt-mine">
              {held.map((h) => (
                <button
                  key={h.toolId}
                  type="button"
                  className="gt-mine-row"
                  onClick={() => openUse(h)}
                  disabled={pending}
                >
                  <span className="gt-thumb" data-empty={h.imageUrl ? undefined : "1"}>
                    {h.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={h.imageUrl} alt="" />
                      : <i>{h.name.trim().charAt(0).toUpperCase() || "?"}</i>}
                  </span>
                  <span className="gt-mine-text">
                    <strong>{h.name}</strong>
                    {h.spec && <span>{h.spec}</span>}
                  </span>
                  <span className="gt-mine-qty">
                    <b>{h.qty}</b>
                    <i>{h.unit}</i>
                  </span>
                  <span className="gt-hand-go" aria-hidden>›</span>
                </button>
              ))}
            </div>
          )}

          {/* ── the way to the shelf ───────────────────────────
              The store is a SECOND place now, not the page he landed
              on. Daksh: "if they want they can go to store to get new
              tools in their dashboard." So it is one card, below his
              own tools, which is the order he described them in. */}
          <button type="button" className="gt-store-go" onClick={openStore} disabled={pending}>
            <span className="gt-store-ico" aria-hidden>🧰</span>
            <span className="gt-store-text">
              <strong>Take from the store</strong>
              <em>
                {shelfCount === 0
                  ? "The shelf is empty"
                  : `${shelfCount} ${shelfCount === 1 ? "tool" : "tools"} waiting`}
              </em>
            </span>
            {/* A chevron in a circle, not a loose ›. The old one was a
                14px character the same colour as the text beside it,
                which on a card that looked like a heading anyway was
                the entire evidence that this thing could be pressed. */}
            <span className="gt-store-chev" aria-hidden>›</span>
          </button>

        </section>
      )}

      {/* ── 6. what happened to it (mig 238) ───────────────────── */}
      {step === "use" && holding && (
        <section className="gt-body">
          <button
            type="button"
            className="gt-back"
            onClick={() => { setHolding(null); setStep("mine"); }}
          >
            ← Back to your hands
          </button>

          <h1 className="gt-q">What happened to it?</h1>

          <div className="gt-chosen">
            <span className="gt-thumb gt-thumb-lg" data-empty={holding.imageUrl ? undefined : "1"}>
              {holding.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={holding.imageUrl} alt="" />
                : <i>{holding.name.trim().charAt(0).toUpperCase() || "?"}</i>}
            </span>
            <span className="gt-chosen-text">
              <strong>{holding.name}</strong>
              {holding.spec && <span>{holding.spec}</span>}
              <em>{holding.qty} {holding.unit} in your hands</em>
            </span>
          </div>

          {/* "Gave it back" was the second answer here until Nov 2026.
              Daksh: "in the dashboard, when we say what happened to it,
              we have 2 options — used on machine and gave it back.
              Remove that gave-it-back thing. If we think we need this
              feature we will do it in future."

              The database side is untouched: cnc_tool_settle_held still
              takes outcome='returned', mig 239 still lets a sticker
              write a return, and the ten returns already on the record
              still read correctly. Only the button is gone, so turning
              it back on is this block and nothing else. */}
          <div className="gt-stepper">
            <button
              type="button"
              onClick={() => setUseQty((n) => Math.max(1, n - 1))}
              disabled={pending || useQty <= 1}
              aria-label="One less"
            >
              −
            </button>
            <div className="gt-qty">
              <b>{useQty}</b>
              <i>{holding.unit}</i>
            </div>
            <button
              type="button"
              onClick={() => setUseQty((n) => Math.min(holding.qty, n + 1))}
              disabled={pending || useQty >= holding.qty}
              aria-label="One more"
            >
              +
            </button>
          </div>

          {(
            <>
              <h2 className="gt-mach-q">Which machine?</h2>
              {machines.length === 0 ? (
                <div className="gt-blank">
                  No machine is listed against your company. Tell the office.
                </div>
              ) : (
                <div className="gt-mach">
                  {machines.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="gt-mach-btn"
                      data-on={machine?.id === m.id ? "1" : undefined}
                      data-busy={m.busy ? "1" : undefined}
                      onClick={() => { setMachine(m); setErr(null); }}
                      disabled={pending}
                      title={m.busy ? "Carving now" : "Idle"}
                    >
                      <b>{m.code}</b>
                      {m.machineType === "lathe" && <i>lathe</i>}
                    </button>
                  ))}
                </div>
              )}
              {/* The office sees every company's machines, so it has to
                  say whose one it just picked. A vendor's man only ever
                  sees his own and does not need telling. */}
              {machine?.vendorName && !who?.company && (
                <p className="gt-fine">Machine {machine.code} · {machine.vendorName}</p>
              )}
            </>
          )}

          <button
            type="button"
            className="gt-take"
            onClick={settle}
            disabled={pending || !machine}
          >
            {pending
              ? "Recording…"
              : machine
                ? `Used ${useQty} ${holding.unit} on ${machine.code}`
                : "Pick a machine"}
          </button>
          <p className="gt-fine">Signed by <strong>{who?.name}</strong></p>
        </section>
      )}

      {/* ── the office three can fill the shelf from here ──────
          Tucked behind one button at the bottom of the screen, where
          a thumb is, and only on the steps where a shelf is in view.
          A man taking a tool never sees it. */}
      {who?.canKeep && step === "tool" && (
        <KeeperSheet
          token={token}
          tools={keeperTools}
          jump={jump}
          onJumpHandled={() => setJump(null)}
          newTool={wantNew}
          onNewToolHandled={() => setWantNew(false)}
          addStockAction={addStockAction}
          fixCountAction={fixCountAction}
          newToolAction={newToolAction}
          onDone={(m) => {
            setKept(m);
            setErr(null);
            // Pull the new numbers in rather than make him reload.
            router.refresh();
          }}
        />
      )}

      {/* ── the slip ──────────────────────────────────────────── */}
      {done && (
        <div
          className="gt-slip"
          role="status"
          data-state={done.undone ? "undone" : "ok"}
          /* The first touch anywhere on the card cancels the four
             seconds. Pointer, not click: he should not have to hit a
             button to stop it closing under his thumb. */
          onPointerDown={() => setPinned(true)}
        >
          <div className="gt-slip-card">
            {!pinned && !done.undone && (
              <i className="gt-slip-bar" aria-hidden style={{ animationDuration: `${SLIP_MS}ms` }} />
            )}

            <header className="gt-slip-top">
              <span className="gt-slip-logo" aria-hidden>🧰</span>
              <span className="gt-slip-org">
                <strong>MTCPL tool store</strong>
                <em>{label}</em>
              </span>
              <button
                type="button"
                className="gt-slip-x"
                onClick={() => setDone(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {done.undone ? (
              <div className="gt-slip-undone">
                <strong>Taken back</strong>
                <span>
                  {done.qty} × {done.toolName} is on the shelf again. Nothing is
                  recorded against you, and this slip no longer works.
                </span>
              </div>
            ) : (
              <div className="gt-slip-tick" aria-hidden>✓</div>
            )}

            <div className="gt-slip-what">
              {/* The photograph, where the tool has one. A part code
                  tells a storeman which bit it is; a picture tells the
                  man holding it, and he is the one reading this. */}
              {done.imageUrl && (
                <span className="gt-slip-pic">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={done.imageUrl} alt="" />
                </span>
              )}
              <b>{done.qty}</b>
              <span>
                <strong>{done.toolName}</strong>
                {done.spec && <i className="gt-slip-spec">{done.spec}</i>}
                <em>{done.left} left on the shelf</em>
              </span>
            </div>

            {done.slip && (
              <>
                <dl className="gt-slip-rows">
                  <div>
                    <dt>Taken by</dt>
                    <dd>
                      {done.slip.takenBy}
                      {done.slip.company && done.slip.company !== done.slip.takenBy && (
                        <i> · {done.slip.company}</i>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>When</dt>
                    <dd>{istStamp(done.slip.at)}</dd>
                  </div>
                </dl>

              </>
            )}

            <div className="gt-slip-acts">
              {!done.undone && done.slip && (
                <button
                  type="button"
                  className="gt-slip-undo"
                  onClick={undoTake}
                  disabled={pending}
                >
                  {pending ? "…" : "Undo this take"}
                </button>
              )}
              <button type="button" className="gt-slip-ok" onClick={() => setDone(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── the register ──────────────────────────────────────── */}
      {step === "register" && (
        <section className="gt-body">
          <div className="gt-reg-top">
            <h1 className="gt-h1">The register</h1>
            <p className="gt-sub">
              Who took what, what went into a machine, and when. Everyone can read it.
            </p>
          </div>

          <div className="gt-reg-seg" role="group" aria-label="Whose lines">
            <button type="button" className={!regMine ? "on" : ""} onClick={() => setRegMine(false)}>
              Everyone
            </button>
            <button type="button" className={regMine ? "on" : ""} onClick={() => setRegMine(true)}>
              Just me
            </button>
          </div>

          {regBusy && <div className="gt-reg-wait">Reading the register…</div>}

          {!regBusy && reg && (() => {
            const lines = regMine ? reg.filter((l) => l.mine) : reg;
            if (lines.length === 0) {
              return (
                <div className="gt-blank">
                  {regMine ? "You have not taken anything yet." : "Nothing in the last six weeks."}
                </div>
              );
            }
            // Grouped by IST day: the shed's day, not the browser's.
            const days: Array<{ key: string; label: string; lines: RegisterLine[] }> = [];
            for (const l of lines) {
              const key = istDay(l.at);
              const last = days[days.length - 1];
              if (last && last.key === key) last.lines.push(l);
              else days.push({ key, label: dayLabel(l.at), lines: [l] });
            }
            return (
              <div className="gt-tl">
                {days.map((d) => (
                  <div key={d.key} className="gt-tl-day">
                    <div className="gt-tl-date">
                      <span>{d.label}</span>
                      <i>{d.lines.length} line{d.lines.length === 1 ? "" : "s"}</i>
                    </div>
                    <div className="gt-tl-rail">
                      {d.lines.map((l) => {
                        // Daksh, Nov 2026: "the timeline is still
                        // confusing — what is minus, what is plus. The
                        // difference between count corrected, stock in
                        // and someone issued should be obvious."
                        //
                        // It was keyed on the SIGN, so a take and a
                        // downward count correction were both an amber
                        // minus and looked identical — even though one
                        // is a man walking off with four bits and the
                        // other is nothing leaving the cupboard at all.
                        //
                        // Keyed on the ACTION now. Three of them, three
                        // colours, three glyphs, and the word written
                        // out. The sign is still there but it is no
                        // longer carrying the meaning on its own.
                        //
                        // Mig 238 added a fourth: a tool SPENT on a
                        // machine. It is the one line here that does
                        // not move the shelf at all — it moves a pc out
                        // of a man's hands — so it gets its own colour
                        // and its own glyph rather than being dressed
                        // up as a take.
                        const act: "in" | "out" | "fix" | "use" =
                          l.kind === "receive"
                            ? "in"
                            : l.kind === "adjust"
                              ? "fix"
                              : l.kind === "use"
                                ? "use"
                                : "out";
                        const qty = Math.abs(l.delta);
                        const word =
                          act === "in" ? "Stock in"
                          : act === "out" ? (l.kind === "return" ? "Given back" : "Taken")
                          : act === "use" ? `Used · ${l.machineCode ?? "?"}`
                          : "Count fixed";
                        const glyph =
                          act === "in" ? "↓" : act === "out" ? "↑" : act === "use" ? "⚙" : "=";
                        const sign =
                          act === "in" ? "+" : act === "use" ? "−"
                          : act === "out" ? (l.delta > 0 ? "+" : "−")
                          : l.delta < 0 ? "−" : "+";
                        // A correction moves no goods, so it says what it
                        // did to the BOOK rather than naming a person who
                        // carried something away.
                        // The company is dropped when it IS the name —
                        // a vendor principal signs for himself, and
                        // "VIVEK · VIVEK" tells nobody anything.
                        const whoPart = l.personName
                          ? `${l.mine ? "You" : l.personName}${
                              l.company && !l.mine && l.company !== l.personName
                                ? ` · ${l.company}`
                                : ""
                            }`
                          : act === "fix"
                            ? `Register ${l.delta < 0 ? "lowered" : "raised"} by ${qty} · nothing was taken`
                            : act === "in"
                              ? "Onto the shelf"
                              : "Store";
                        // Spelled out, because this is the one line that
                        // does not move the shelf: the pc came out of a
                        // man's hands, where the take had already put
                        // it, and went into a machine.
                        const who =
                          act === "use"
                            ? `${whoPart} · out of ${l.mine ? "your" : "his"} hands into machine ${l.machineCode ?? "?"}`
                            : whoPart;
                        return (
                          <div
                            key={l.id}
                            className="gt-tl-row"
                            data-act={act}
                            data-mine={l.mine ? "1" : undefined}
                            data-void={l.undone ? "1" : undefined}
                          >
                            <span className="gt-tl-time">{istTime(l.at)}</span>
                            <span className="gt-tl-dot" aria-hidden>{glyph}</span>
                            <span className="gt-tl-body">
                              <span className="gt-tl-head">
                                <span className="gt-tl-badge">{word}</span>
                                <b className="gt-tl-qty">{sign}{qty}</b>
                              </span>
                              <span className="gt-tl-tool">{l.toolName}</span>
                              <span className="gt-tl-who">
                                {who}
                                {l.note && <> · {l.note}</>}
                                {l.undone && <> · <b className="gt-tl-undone">undone</b></>}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {regTrunc && (
                  <p className="gt-tl-more">
                    Showing the most recent lines. The office screen has the whole book.
                  </p>
                )}
              </div>
            );
          })()}

          <button type="button" className="gt-ghost gt-wide" onClick={() => setStep("tool")}>
            Back to the shelf
          </button>
        </section>
      )}

    </main>
  );
}

const CSS = `
.gt {
  --ink:#15181d; --dim:#6b7280; --line:#e6e4df; --card:#ffffff;
  /* The app is warm paper, dark brown and gold. This screen was indigo
     into violet with a purple glow under it — a different product
     entirely, and the one people actually hold in their hand. */
  --brand:#2D2410; --brand2:#3A2F16;
  --gold:#C9973A; --gold-dark:#A67B28; --gold-light:#E8C572;
  --ok:#059669; --okbg:#ecfdf5; --low:#d97706; --lowbg:#fffbeb;
  /* Daksh, Nov 2026: "change that green colour on items to black so it
     will look more minimal."
     The green was marking the NORMAL state — a tool that is simply in
     stock, which is nearly every row. Colouring the ordinary case
     leaves nothing for the unusual one to stand out against, so a
     shelf of healthy stock arrived as a wall of green and the two rows
     that actually needed attention were just more colour.
     In stock is now ink on paper. Amber and red keep their jobs. */
  --rest:#2D2410; --restbg:#F1EFEA;
  --out:#dc2626; --outbg:#fef2f2;
  /* The whole screen, not just the pressable rows.
     Blocking selection on a row only stops the selection ANCHORING
     inside it; the phone then anchors on the nearest selectable thing
     and drags out from there, which is how a long press ended up
     selecting the entire page with the Copy bar over it.
     This is a cupboard screen — a name, a number and a button. Nothing
     on it was ever meant to be copied, so nothing on it is selectable,
     and the fields below get it back explicitly. */
  -webkit-touch-callout:none; -webkit-user-select:none; user-select:none;
  min-height:100dvh; background:#f6f6f4; color:var(--ink);
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  padding-bottom:40px; -webkit-text-size-adjust:100%;
}
.gt *, .gt *::before, .gt *::after { box-sizing:border-box; }
/* Typing still needs a caret, a double-tap and a paste. */
.gt input, .gt textarea, .gt [contenteditable] {
  -webkit-user-select:text; user-select:text; -webkit-touch-callout:default;
}

/* ── header ─────────────────────────────────────────────── */
.gt-head {
  background:var(--brand);
  color:#fff; padding:16px 16px 14px; border-radius:0 0 14px 14px;
  box-shadow:0 4px 16px rgba(45,36,16,.18);
}
.gt-head-row { display:flex; align-items:center; gap:12px; }
.gt-brand { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
.gt-brand-text { min-width:0; }
.gt-brand-gone { display:none; }
.gt-logo {
  width:40px; height:40px; flex:0 0 auto; border-radius:6px; font-size:20px;
  display:grid; place-items:center; background:rgba(201,151,58,.22);
}
.gt-brand-label { font-size:16px; font-weight:700; letter-spacing:-.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gt-brand-sub {
  /* Sentence case and no tracking: "OFFICE WARDROBE" in caps with
     letter-spacing wrapped to two lines next to the men button and
     the signed-in pill, which is a lot of header for a door name. */
  font-size:11.5px; font-weight:600; color:rgba(255,255,255,.75);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.gt-me {
  margin-left:auto; display:flex; align-items:center; gap:7px; max-width:44%;
  padding:6px 10px 6px 6px; border-radius:999px; border:none; cursor:pointer;
  background:rgba(255,255,255,.17); color:#fff; font:inherit;
}
.gt-me-dot { width:26px; height:26px; flex:0 0 auto; border-radius:50%;
  display:grid; place-items:center; font-size:11px; font-weight:700; color:#fff;
  box-shadow:0 0 0 2px rgba(255,255,255,.45); }
.gt-me-name { font-size:12.5px; font-weight:700; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.gt-me-out { font-size:10px; font-weight:700; opacity:.8; white-space:nowrap; }
.gt-men {
  margin-left:auto; position:relative; flex:0 0 auto; cursor:pointer; font:inherit;
  width:38px; height:38px; border-radius:50%; border:none; font-size:17px;
  background:rgba(255,255,255,.17); color:#fff; display:grid; place-items:center;
}
.gt-men[data-on] { background:#fff; }
.gt-men i {
  position:absolute; top:-3px; right:-3px; min-width:17px; height:17px; padding:0 4px;
  border-radius:8px; background:#fff; color:var(--brand);
  font-style:normal; font-size:10.5px; font-weight:700; line-height:17px;
}
/* With the men button present, the signed-in pill no longer needs to
   push itself to the right — the button does. */
.gt-men + .gt-me { margin-left:8px; }
.gt-steps { display:flex; gap:6px; margin:12px 2px 0; }
.gt-steps i { height:4px; flex:1; border-radius:8px; background:rgba(255,255,255,.28); }
.gt-steps i[data-done] { background:rgba(255,255,255,.62); }
.gt-steps i[data-on] { background:#fff; }

/* ── shared body ────────────────────────────────────────── */
.gt-body { padding:20px 16px 0; max-width:560px; margin:0 auto; }
.gt-q { font-size:23px; font-weight:700; letter-spacing:-.4px; margin:0 0 6px; }
/* The same heading as a question step, for the two pages that are not
   a question: the register and the men. */
.gt-h1 { font-size:23px; font-weight:700; letter-spacing:-.4px; margin:0 0 5px; }
.gt-sub { font-size:13.5px; color:var(--dim); line-height:1.5; margin:0 0 16px; }
.gt-hint { font-size:14px; color:var(--dim); line-height:1.5; margin:0 0 18px; }
.gt-blank { padding:26px 18px; text-align:center; font-size:14.5px; color:var(--dim);
  background:var(--card); border:1px dashed var(--line); border-radius:8px; }
.gt-kept {
  display:flex; align-items:center; gap:10px; margin:14px 16px 0;
  padding:13px 15px; border-radius:8px; font-size:14px; font-weight:700;
  background:var(--okbg); color:var(--ok); border:1px solid rgba(5,150,105,.3);
}
.gt-kept span:first-child { font-size:16px; }
.gt-kept span:nth-child(2) { flex:1; min-width:0; }
.gt-kept button {
  border:none; background:none; color:inherit; font:inherit; cursor:pointer;
  opacity:.65; font-size:13px; padding:2px 4px;
}

.gt-err {
  display:flex; align-items:center; gap:9px; margin:14px 16px 0; padding:12px 14px;
  background:var(--outbg); border:1px solid #fecaca; border-radius:8px;
  color:#991b1b; font-size:13.5px; font-weight:600; line-height:1.4;
}
.gt-err button { margin-left:auto; background:none; border:none; color:inherit;
  font-size:15px; cursor:pointer; padding:0 2px; }
.gt-back { background:none; border:none; padding:0 0 12px; font:inherit;
  font-size:13.5px; font-weight:700; color:var(--brand); cursor:pointer; }

/* ── people ─────────────────────────────────────────────── */
/* ── the name list ──────────────────────────────────────────
   Daksh, Nov 2026: "that page where all names show to choose from,
   that[s] too much — make it minimal."
   It was six fat cards with a shadow, a 46px tile and a masked phone
   number apiece, which is a lot of furniture for "tap your name".
   Now: one quiet row per person, the initial, the name, a chevron. */
.gt-people { display:flex; flex-direction:column; gap:2px; }
.gt-person {
  display:flex; align-items:center; gap:12px; width:100%; text-align:left;
  padding:11px 12px; border-radius:8px; cursor:pointer; font:inherit;
  background:transparent; border:none; color:var(--ink);
}
.gt-person + .gt-person { box-shadow:inset 0 1px 0 var(--line); }
.gt-person:active { background:rgba(201,151,58,.10); }
.gt-person:disabled { opacity:.5; }
.gt-pface {
  width:34px; height:34px; flex:0 0 auto; border-radius:6px; color:#fff;
  display:grid; place-items:center; font-size:12.5px; font-weight:700;
  background:var(--who);
}
.gt-pname {
  flex:1; min-width:0; font-size:16px; font-weight:700; letter-spacing:-.01em;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.gt-pgo { font-size:19px; color:#c9c6bf; font-weight:400; }

/* Company by company. The heading is quiet; the names are the UI. */
.gt-pgroup { display:flex; flex-direction:column; }
/* A company with no heading still gets a breath before it. */
.gt-pgroup + .gt-pgroup:not(:has(.gt-pco)) { margin-top:2px; }
.gt-pco {
  font-size:10px; font-weight:700; letter-spacing:.11em; text-transform:uppercase;
  color:#a3a3a3; padding:16px 12px 5px;
}
.gt-pgroup:first-child .gt-pco { padding-top:2px; }
/* A man under a vendor sits in from the edge, so the shape of the
   list says who works for whom before you read a word of it. */
.gt-person[data-under] { padding-left:30px; }
.gt-person[data-under] .gt-pface { width:28px; height:28px; border-radius:6px; font-size:11px;
  background:var(--gold-dark); }
.gt-person[data-under] .gt-pname { font-size:14.5px; font-weight:600; color:var(--dim); }

/* ── otp ────────────────────────────────────────────────── */
.gt-otp { position:relative; display:flex; gap:10px; justify-content:center; margin:6px 0 20px; }
.gt-otp-box {
  width:60px; height:72px; border-radius:8px; display:grid; place-items:center;
  font-size:30px; font-weight:700; background:var(--card);
  border:2px solid var(--line); color:var(--ink);
}
.gt-otp-box[data-filled] { border-color:var(--brand); background:#eef2ff; }
.gt-otp-box[data-live] { border-color:var(--brand); box-shadow:0 0 0 4px rgba(79,70,229,.14); }
.gt-otp-input { position:absolute; inset:0; width:100%; height:100%;
  opacity:0; border:none; background:transparent; font-size:30px; }
.gt-code-actions { display:flex; gap:10px; justify-content:space-between; }
.gt-ghost { padding:12px 14px; border-radius:8px; font:inherit; font-size:13.5px;
  font-weight:700; cursor:pointer; background:var(--card);
  border:1.5px solid var(--line); color:var(--ink); }
.gt-ghost:disabled { opacity:.5; }
.gt-wide { display:block; width:100%; margin-top:10px; }

/* ── tools ──────────────────────────────────────────────── */
.gt-search {
  display:flex; align-items:center; gap:9px; padding:0 14px; margin-bottom:14px;
  background:var(--card); border:1.5px solid var(--line); border-radius:8px;
}
.gt-search input { flex:1; min-width:0; border:none; outline:none; background:none;
  font:inherit; font-size:15.5px; padding:14px 0; color:var(--ink); }
.gt-search button { background:none; border:none; color:var(--dim); font-size:15px; cursor:pointer; }
.gt-tools { display:flex; flex-direction:column; gap:11px; }
/* Clearance for the keeper's floating button, so the last tool on the
   shelf is never left sitting underneath it. Only when it is there. */
.gt:has(.ks-fab) { padding-bottom:110px; }
.gt-tool {
  /* The hold here is the keeper's only way in, so the phone's text
     selection and Copy bar must stay out of it entirely. */
  -webkit-touch-callout:none; -webkit-user-select:none; user-select:none;
  display:flex; align-items:center; gap:12px; width:100%; text-align:left;
  padding:15px 15px 15px 18px; border-radius:8px; cursor:pointer; font:inherit;
  background:var(--card); border:1.5px solid var(--line); position:relative;
  overflow:hidden; box-shadow:0 2px 10px rgba(20,20,30,.05);
}
.gt-tool::before { content:""; position:absolute; left:0; top:0; bottom:0; width:6px; }
.gt-tool[data-level="ok"]::before  { background:var(--rest); }
.gt-tool[data-level="low"]::before { background:var(--low); }
.gt-tool[data-level="out"]::before { background:var(--out); }
.gt-tool:active { transform:scale(.99); }
.gt-tool-main { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; }
.gt-tool-main strong { font-size:16.5px; font-weight:700; }
.gt-tool-spec { font-size:12.5px; color:var(--dim); }
.gt-tool-left { flex:0 0 auto; display:flex; flex-direction:column; align-items:center;
  min-width:58px; padding:7px 10px; border-radius:8px; }
.gt-tool-left b { font-size:21px; font-weight:700; line-height:1; }
.gt-tool-left i { font-style:normal; font-size:10px; font-weight:700;
  letter-spacing:.06em; text-transform:uppercase; opacity:.75; }
.gt-tool[data-level="ok"]  .gt-tool-left { background:var(--restbg); color:var(--rest); }
.gt-tool[data-level="low"] .gt-tool-left { background:var(--lowbg); color:var(--low); }
.gt-tool[data-level="out"] .gt-tool-left { background:var(--outbg); color:var(--out); }

/* ── quantity ───────────────────────────────────────────── */
.gt-chosen { background:var(--card); border:1.5px solid var(--line); border-radius:8px;
  padding:14px 16px; margin-bottom:18px; display:flex; align-items:center; gap:13px; }
.gt-chosen-text { display:flex; flex-direction:column; gap:3px; min-width:0; }
.gt-chosen strong { font-size:18px; font-weight:700; }
.gt-chosen-text span { font-size:13px; color:var(--dim); }
.gt-chosen em { font-style:normal; font-size:12.5px; font-weight:700; color:var(--ok); margin-top:4px; }

/* the photo (mig 233) — or the tool's initial in its level colour, so a
   tool without one still reads as a tool rather than a broken box */
/* Daksh, Nov 2026: "in phone the image thumbnail should be more big."
   He is right — the photo is there so a man holding the thing
   recognises it without reading, and 52px was a stamp. These are the
   biggest that still leave the name and the count room on one row. */
.gt-thumb { width:74px; height:74px; flex:0 0 auto; border-radius:8px; overflow:hidden;
  display:grid; place-items:center; background:#f1f1ee; }
.gt-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.gt-thumb i { font-style:normal; font-size:28px; font-weight:700; }
.gt-thumb-lg { width:104px; height:104px; border-radius:8px; }
.gt-thumb-lg i { font-size:40px; }
@media (max-width: 360px) {
  /* The oldest phones in the shed. Still bigger than it was. */
  .gt-thumb { width:62px; height:62px; border-radius:8px; }
  .gt-thumb i { font-size:24px; }
}
.gt-tool[data-level="ok"]  .gt-thumb[data-empty] { background:var(--restbg); color:var(--rest); }
.gt-tool[data-level="low"] .gt-thumb[data-empty] { background:var(--lowbg); color:var(--low); }
.gt-tool[data-level="out"] .gt-thumb[data-empty] { background:var(--outbg); color:var(--out); }
.gt-chosen .gt-thumb[data-empty] { background:var(--restbg); color:var(--rest); }
.gt-stepper { display:flex; align-items:center; gap:14px; margin-bottom:20px; }
.gt-stepper button {
  width:74px; height:74px; flex:0 0 auto; border-radius:8px; font-size:34px;
  font-weight:700; cursor:pointer; background:var(--card); color:var(--brand);
  border:2px solid var(--line); line-height:1;
}
.gt-stepper button:disabled { opacity:.35; }
.gt-stepper button:active:not(:disabled) { background:#eef2ff; }
.gt-qty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:var(--gold); color:#fff;
  border-radius:8px; padding:12px 8px; box-shadow:0 8px 22px rgba(79,70,229,.3); }
.gt-qty b { font-size:42px; font-weight:700; line-height:1; }
.gt-qty i { font-style:normal; font-size:11px; font-weight:700; letter-spacing:.08em;
  text-transform:uppercase; opacity:.85; margin-top:3px; }
.gt-take {
  display:block; width:100%; padding:19px; border-radius:8px; border:none;
  font:inherit; font-size:17.5px; font-weight:700; color:#fff; cursor:pointer;
  background:var(--ok);
  box-shadow:0 10px 24px rgba(5,150,105,.34);
}
.gt-take:disabled { opacity:.6; }
.gt-take:active:not(:disabled) { transform:translateY(1px); }
.gt-fine { text-align:center; font-size:12.5px; color:var(--dim); margin:12px 0 0; }

/* ── done ───────────────────────────────────────────────── */
.gt-donestep { text-align:center; padding-top:34px; }
.gt-tick { width:88px; height:88px; margin:0 auto 18px; border-radius:50%;
  display:grid; place-items:center; font-size:44px; color:#fff;
  background:var(--ok);
  box-shadow:0 12px 30px rgba(16,185,129,.4); animation:gtPop .32s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes gtPop { from { transform:scale(.6); opacity:0; } to { transform:scale(1); opacity:1; } }
.gt-donetitle { font-size:25px; font-weight:700; letter-spacing:-.4px; margin:0 0 8px; }
.gt-donesub { font-size:14.5px; color:var(--dim); line-height:1.6; margin:0 0 24px; }

/* ── tally ──────────────────────────────────────────────── */
.gt-tally { display:flex; flex-wrap:wrap; gap:7px; align-items:center;
  margin-top:22px; padding-top:16px; border-top:1px dashed var(--line); }
.gt-tally-head { width:100%; font-size:10.5px; font-weight:700; letter-spacing:.08em;
  text-transform:uppercase; color:var(--dim); margin-bottom:2px; }
.gt-tally-chip { font-size:12.5px; font-weight:700; padding:6px 11px; border-radius:999px;
  background:var(--okbg); color:var(--ok); border:1px solid #a7f3d0; }

@media (prefers-reduced-motion: reduce) { .gt-tick { animation:none; } }

/* ── the slip ──────────────────────────────────────────── */
/*
   Nov 2026 — this was a line that slid up from the bottom and cleared
   itself in 2.8 seconds. Daksh: "it only gives a small feedback.
   Instead it should give a full page card... and on that card there
   will be an undo button... and a QR they can save."

   A full-page card, over everything, because a take is the one thing
   that happens on this screen and the man should not have to wonder
   whether it landed. It still leaves on its own after four seconds —
   the common case is somebody taking one thing and walking off — but
   the countdown bar is visible and the first touch stops it, because
   four seconds is nowhere near long enough to photograph a QR.
*/
.gt-slip {
  position:fixed; inset:0; z-index:90;
  display:flex; align-items:center; justify-content:center;
  padding:18px; background:rgba(45,36,16,.46);
  backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px);
  animation:gt-slip-fade .16s ease-out;
  /* It may not fit on a small phone once the QR is in. */
  overflow-y:auto;
}
@keyframes gt-slip-fade { from { opacity:0; } }

.gt-slip-card {
  position:relative; width:100%; max-width:360px; margin:auto;
  background:var(--card, #fff); color:var(--ink, #2D2410);
  border-radius:18px; padding:0 18px 16px;
  box-shadow:0 18px 44px rgba(45,36,16,.34);
  animation:gt-slip-rise .2s cubic-bezier(.2,.8,.3,1);
  overflow:hidden;
}
@keyframes gt-slip-rise { from { opacity:0; transform:translateY(14px) scale(.98); } }

/* The four seconds, drawn. A timer you cannot see is a timer that
   feels like a glitch when it fires. */
.gt-slip-bar {
  position:absolute; top:0; left:0; height:3px; width:100%;
  background:var(--gold, #C9973A); transform-origin:left center;
  animation:gt-slip-run linear forwards;
}
@keyframes gt-slip-run { from { transform:scaleX(1); } to { transform:scaleX(0); } }

.gt-slip-top {
  display:flex; align-items:center; gap:10px;
  padding:15px 0 12px; border-bottom:1px solid var(--line, #E4DDD2);
}
.gt-slip-logo { font-size:22px; }
.gt-slip-org { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
.gt-slip-org strong { font-size:13px; font-weight:800; letter-spacing:-.01em; }
.gt-slip-org em { font-style:normal; font-size:11px; color:var(--dim, #7A6A52);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gt-slip-x {
  width:30px; height:30px; flex:0 0 auto; border-radius:999px; cursor:pointer;
  border:1px solid var(--line, #E4DDD2); background:transparent;
  color:var(--dim, #7A6A52); font-size:12px; font-family:inherit;
}

.gt-slip-tick {
  width:48px; height:48px; margin:16px auto 2px; border-radius:999px;
  display:grid; place-items:center; font-size:24px; font-weight:800;
  background:rgba(22,163,74,.12); color:var(--ok, #16A34A);
}

.gt-slip-undone {
  margin:14px 0 2px; padding:12px 13px; border-radius:11px;
  display:flex; flex-direction:column; gap:4px;
  background:rgba(220,38,38,.08); border:1px solid rgba(220,38,38,.26);
}
.gt-slip-undone strong { font-size:14px; font-weight:800; color:var(--out, #DC2626); }
.gt-slip-undone span { font-size:12px; line-height:1.55; color:var(--dim, #7A6A52); }

.gt-slip-what {
  display:flex; align-items:center; justify-content:center; gap:13px;
  padding:14px 0 12px; text-align:left;
}
.gt-slip-what b {
  font-size:40px; font-weight:800; letter-spacing:-.03em; line-height:1;
  font-variant-numeric:tabular-nums;
}
.gt-slip-what span { display:flex; flex-direction:column; gap:2px; min-width:0; }
.gt-slip-what strong { font-size:15.5px; font-weight:800; line-height:1.25;
  overflow-wrap:anywhere; }
.gt-slip-what em { font-style:normal; font-size:11.5px; color:var(--dim, #7A6A52); }
.gt-slip[data-state="undone"] .gt-slip-what { opacity:.5; }
.gt-slip[data-state="undone"] .gt-slip-what strong { text-decoration:line-through; }

.gt-slip-rows { display:flex; flex-direction:column; border-top:1px solid var(--line, #E4DDD2); }
.gt-slip-rows > div {
  display:flex; align-items:baseline; justify-content:space-between; gap:12px;
  padding:9px 0; border-bottom:1px solid var(--line, #E4DDD2);
}
.gt-slip-rows dt {
  font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
  color:var(--dim, #7A6A52); flex:0 0 auto;
}
.gt-slip-rows dd { font-size:12.5px; font-weight:700; text-align:right; min-width:0;
  overflow-wrap:anywhere; }
.gt-slip-rows dd i { font-style:normal; font-weight:600; color:var(--dim, #7A6A52); }

.gt-slip-acts { display:flex; gap:8px; flex-wrap:wrap; padding-top:14px; }
.gt-slip-acts button {
  flex:1 1 auto; min-height:46px; padding:12px 14px; border-radius:11px;
  font:inherit; font-size:13.5px; font-weight:800; cursor:pointer;
}
.gt-slip-undo {
  flex-basis:100%; border:1px solid rgba(220,38,38,.4); background:transparent;
  color:var(--out, #DC2626);
}
.gt-slip-undo:disabled { opacity:.55; }
/* The item's photograph on the slip. Square and small — it is there to
   say "this bit", not to be looked at; the number beside it is still
   the biggest thing on the card. */
/* Scoped under .gt-slip-what on purpose: the rule for the TEXT span
   beside it is ".gt-slip-what span", which also matches this one and
   out-specifies a bare .gt-slip-pic. Without the extra class here the
   photo quietly becomes a flex column. */
.gt-slip-what .gt-slip-pic {
  flex:0 0 auto; width:58px; height:58px; border-radius:12px; overflow:hidden;
  border:1px solid var(--line); background:#fff; display:block; min-width:58px;
}
.gt-slip-what .gt-slip-pic img { width:100%; height:100%; object-fit:cover; display:block; }
.gt-slip-spec {
  display:block; font-style:normal; font-size:11.5px; color:var(--dim); margin-top:1px;
}
.gt-slip-ok { border:none; background:var(--brand, #2D2410); color:#fff; }

@media (max-height: 680px) {
  /* A short phone with the QR in: the tick is the first thing to go,
     because the card itself already says it worked. */
  .gt-slip-tick { display:none; }
}

/* ── the register ──────────────────────────────────────── */
.gt-reg-top { margin-bottom:12px; }
.gt-reg-seg {
  display:flex; gap:3px; padding:3px; border-radius:8px; margin-bottom:14px;
  background:#eeece7; border:1px solid var(--line);
}
.gt-reg-seg button {
  flex:1; padding:8px; font:inherit; font-size:13px; font-weight:600;
  border:none; background:none; color:var(--dim); border-radius:6px; cursor:pointer;
}
.gt-reg-seg button.on { background:var(--card); color:var(--ink);
  box-shadow:0 1px 2px rgba(45,36,16,.1); }
.gt-reg-wait { padding:26px 0; text-align:center; font-size:13px; color:var(--dim); }

.gt-tl { display:flex; flex-direction:column; gap:18px; }
.gt-tl-date {
  display:flex; align-items:baseline; justify-content:space-between; gap:10px;
  margin-bottom:7px;
}
.gt-tl-date span { font-size:12px; font-weight:700; color:var(--ink); letter-spacing:.02em; }
.gt-tl-date i { font-style:normal; font-size:11px; color:var(--dim); }

/* One line down the page with a dot per entry, so a day reads as a
   sequence rather than as a stack of cards. */
.gt-tl-rail { position:relative; }
.gt-tl-row {
  position:relative; display:grid; grid-template-columns:52px 24px minmax(0,1fr);
  align-items:start; gap:9px; padding:9px 0;
}
.gt-tl-row::before {
  content:""; position:absolute; left:63px; top:0; bottom:0; width:1.5px;
  background:var(--line);
}
.gt-tl-row:first-child::before { top:16px; }
.gt-tl-row:last-child::before { bottom:calc(100% - 16px); }
.gt-tl-time { font-size:11px; color:var(--dim); text-align:right; padding-top:4px;
  font-variant-numeric:tabular-nums; white-space:nowrap; }

/* The dot carries the action's own glyph, so the three kinds are told
   apart by SHAPE before any colour or word is read — which is the only
   part of this that survives a cracked screen in bad light. */
.gt-tl-dot {
  position:relative; z-index:1; width:22px; height:22px; margin:1px auto 0;
  border-radius:50%; display:grid; place-items:center;
  font-size:12px; font-weight:700; line-height:1;
  color:#fff; box-shadow:0 0 0 3px #f6f6f4;
}
.gt-tl-row[data-act="out"] .gt-tl-dot { background:var(--low); }
.gt-tl-row[data-act="in"]  .gt-tl-dot { background:var(--ok); }
/* Spent on a machine: the end of the road for that pc, so it gets the
   darkest tone on the screen. Not amber — amber is "a man is carrying
   it", and the whole point of this line is that nobody is any more. */
.gt-tl-row[data-act="use"] .gt-tl-dot { background:var(--brand); }
/* A correction is bookkeeping, not goods moving — hollow on purpose,
   so it never reads as a thing that left the cupboard. */
.gt-tl-row[data-act="fix"] .gt-tl-dot {
  background:#fff; color:#6b7280; border:1.5px solid #c9c6bf;
}
/* Your own lines keep the gold ring. */
.gt-tl-row[data-mine] .gt-tl-dot { box-shadow:0 0 0 3px #f6f6f4, 0 0 0 5px var(--gold); }
.gt-tl-row[data-void] { opacity:.45; }
.gt-tl-row[data-void] .gt-tl-tool { text-decoration:line-through; }

.gt-tl-body { min-width:0; display:flex; flex-direction:column; gap:2px; }
.gt-tl-head { display:flex; align-items:baseline; gap:8px; }
.gt-tl-badge {
  font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
  padding:2px 7px; border-radius:999px; white-space:nowrap;
}
.gt-tl-qty { margin-left:auto; font-size:15px; font-weight:700; line-height:1.2;
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.gt-tl-row[data-act="out"] .gt-tl-badge { background:var(--lowbg); color:var(--low); }
.gt-tl-row[data-act="out"] .gt-tl-qty   { color:var(--low); }
.gt-tl-row[data-act="in"]  .gt-tl-badge { background:var(--okbg);  color:var(--ok); }
.gt-tl-row[data-act="in"]  .gt-tl-qty   { color:var(--ok); }
.gt-tl-row[data-act="fix"] .gt-tl-badge { background:#eeece7; color:#5b5750; }
.gt-tl-row[data-act="fix"] .gt-tl-qty   { color:#5b5750; font-weight:600; }
.gt-tl-row[data-act="use"] .gt-tl-badge { background:#efe9dc; color:var(--brand); }
.gt-tl-row[data-act="use"] .gt-tl-qty   { color:var(--brand); }

/* ── his account, and what leaves it (mig 238) ───────────────────── */

.gt-hand-go { margin-left:auto; flex:none; font-size:20px; color:#b9b4a8; }

/* The count riding on the way back to his own tools. */

/* ── which page am I on ─────────────────────────────────────────
   Two bands that cannot be mistaken for one another: his own name on
   a pale card with his initial, and the shelf in gold with the same
   toolbox as the card that leads to it. */
/* ── WHERE AM I ──────────────────────────────────────────────
   Three signals, not one. The paper colour (below), the band, and
   the heading — so it survives a glance, a squint and a sideways
   look at a phone on a bench.

   His own tools: dark, filled, his name in white on it. The store:
   gold. They were a white card with a thin left border and a gold
   card, which at arm's length were two light rectangles. */
.gt[data-where="store"] { background:#FAF2E2; }
/* The header is brand-dark on every screen, so it cannot carry the
   signal itself — but a gold edge under it ties it to the gold band
   below and the gold paper behind. */
.gt[data-where="store"] .gt-head { box-shadow:0 3px 0 0 var(--gold), 0 6px 18px rgba(45,36,16,.18); }

/* ── which page am I on ────────────────────────────────
   A BAND, not a card. Full bleed, the page named in the corner, and
   nothing else on either page is shaped like it.

     full-bleed band     you are here
     inset rounded card  tapping it goes somewhere

   It sits a breath below .gt-head and carries the same rounded bottom,
   so the two read as a stack of headers. Flush and gold, the bar's own
   rounded corners would have shown two gold triangles underneath it. */
.gt-band {
  margin:-6px -16px 18px; padding:13px 16px 15px;
  border-radius:0 0 16px 16px;
  display:flex; flex-direction:column; gap:11px;
}
.gt-band-top { display:flex; align-items:center; gap:10px; min-height:24px; }
.gt-band-tag {
  margin-left:auto; flex:none; padding:3px 9px; border-radius:999px;
  font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
}
.gt-band-main { display:flex; align-items:center; gap:13px; }
.gt-band-ico {
  flex:none; width:46px; height:46px; border-radius:13px;
  display:grid; place-items:center; font-size:23px;
  background:rgba(255,255,255,.18);
}
.gt-band-dot {
  border-radius:50%; font-size:16px; font-weight:800; letter-spacing:.02em;
  background:rgba(255,255,255,.2);
}
.gt-band-text { min-width:0; display:flex; flex-direction:column; gap:3px; }
.gt-band-text strong {
  font-size:22px; font-weight:800; letter-spacing:-.45px; line-height:1.14;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.gt-band-text em { font-style:normal; font-size:12.5px; font-weight:600; }

.gt-band-mine { background:var(--brand2); color:#fff; }
.gt-band-mine .gt-band-tag { background:rgba(255,255,255,.15); color:#fff; }
.gt-band-mine .gt-band-text em { color:rgba(255,255,255,.72); }
.gt-band-who {
  min-width:0; font-size:11px; font-weight:800; letter-spacing:.12em;
  text-transform:uppercase; color:rgba(255,255,255,.58);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

.gt-band-store { background:var(--gold); color:#fff; }
.gt-band-store .gt-band-tag { background:rgba(255,255,255,.24); color:#fff; }
.gt-band-store .gt-band-text em { color:rgba(255,255,255,.86); }

.gt-band-back {
  display:inline-flex; align-items:center; gap:7px;
  margin:0; padding:5px 11px 5px 8px; min-height:30px;
  background:rgba(255,255,255,.17); border:0; border-radius:999px;
  cursor:pointer; font:inherit; font-size:12.5px; font-weight:700; color:#fff;
}
.gt-band-back:active { background:rgba(255,255,255,.32); }
.gt-band-back i {
  font-style:normal; font-size:10.5px; font-weight:800; padding:1px 6px;
  border-radius:999px; background:rgba(255,255,255,.28);
  font-variant-numeric:tabular-nums;
}

/* A label for a section WITHIN a page. Small and grey on purpose: the
   band is the only thing allowed to read as a heading, or we are back
   to three titles arguing over one screen. */
.gt-sect {
  display:flex; align-items:baseline; gap:8px; margin:0 0 9px;
  padding-bottom:7px; border-bottom:1px solid var(--line);
}
.gt-sect strong {
  font-size:11.5px; font-weight:800; color:var(--dim);
  text-transform:uppercase; letter-spacing:.07em;
}
.gt-sect em {
  margin-left:auto; font-style:normal; font-size:11.5px; font-weight:700;
  color:var(--brand); font-variant-numeric:tabular-nums;
}

/* ── the way through to the shelf ───────────────────────────────
   Below his own tools, because the shelf is the second place now and
   not the page he landed on. Gold-filled rather than outlined: it is
   the only thing on the dashboard that goes somewhere new, and on an
   empty dashboard it is the only thing to do at all. */
.gt-store-go {
  display:flex; align-items:center; gap:13px; width:100%; text-align:left;
  margin:20px 0 0; padding:14px 15px; min-height:72px;
  background:var(--gold); border:1px solid var(--gold-dark); border-radius:16px;
  cursor:pointer; font:inherit; color:#fff;
  /* Lifted, and it moves under the thumb. Gold goes on meaning "store"
     in both places, so this and the band cannot be told apart by
     colour — they are told apart by one lying flat against the page
     and the other sitting on top of it. */
  box-shadow:0 3px 0 var(--gold-dark), 0 8px 20px rgba(201,151,58,.32);
}
.gt-store-go:active {
  background:var(--gold-dark); transform:translateY(3px);
  box-shadow:0 0 0 var(--gold-dark), 0 2px 8px rgba(201,151,58,.26);
}
.gt-store-go:disabled { opacity:.6; }
.gt-store-chev {
  flex:none; margin-left:auto; width:34px; height:34px; border-radius:50%;
  background:rgba(255,255,255,.22); display:grid; place-items:center;
  font-size:21px; line-height:1; padding-bottom:3px;
}
.gt-store-ico {
  flex:none; width:38px; height:38px; border-radius:10px;
  background:rgba(255,255,255,.22); display:grid; place-items:center; font-size:19px;
}
.gt-store-text { min-width:0; display:flex; flex-direction:column; gap:2px; }
.gt-store-text strong { font-size:14.5px; font-weight:700; }
.gt-store-text em { font-style:normal; font-size:11.5px; color:rgba(255,255,255,.85); }
.gt-store-go .gt-hand-go { color:rgba(255,255,255,.7); }

.gt-mine { display:flex; flex-direction:column; gap:8px; }
.gt-mine-row {
  display:flex; align-items:center; gap:11px; width:100%; text-align:left;
  /* 60px: this is pressed on a shop floor, sometimes with a glove on. */
  min-height:60px; padding:9px 11px; font:inherit; color:var(--ink);
  background:var(--card); border:1px solid var(--line); border-radius:12px;
  cursor:pointer;
}
.gt-mine-row:active { background:#faf9f6; }
.gt-mine-row:disabled { opacity:.5; }
.gt-mine-text { min-width:0; display:flex; flex-direction:column; gap:1px; }
.gt-mine-text strong {
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:13px; font-weight:600; font-variant-numeric:tabular-nums;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.gt-mine-text span { font-size:11px; color:var(--dim); }
.gt-mine-qty {
  margin-left:auto; flex:none; display:flex; align-items:baseline; gap:3px;
  font-variant-numeric:tabular-nums;
}
.gt-mine-qty b { font-size:19px; font-weight:800; }
.gt-mine-qty i { font-style:normal; font-size:10.5px; color:var(--dim); }

/* The ten-minute take-back. Deliberately plainer than the green flash:
   it is not news, it is a last chance. */
.gt-undo {
  display:flex; align-items:center; gap:10px; margin:0 0 12px;
  padding:9px 11px; border-radius:10px;
  background:#efe9dc; border:1px solid #ddd2ba; color:var(--brand);
}
.gt-undo-text { min-width:0; display:flex; flex-direction:column; gap:1px; }
.gt-undo-text strong { font-size:12.5px; font-weight:700; }
.gt-undo-text em { font-style:normal; font-size:11px; opacity:.8; }
.gt-undo button {
  margin-left:auto; flex:none; padding:8px 14px; min-height:38px;
  border-radius:8px; border:1px solid var(--brand); background:transparent;
  color:var(--brand); font:inherit; font-size:12.5px; font-weight:700;
  cursor:pointer;
}
.gt-undo button:active { background:rgba(45,36,16,.08); }

.gt-mach-q { margin:16px 0 8px; font-size:14px; font-weight:700; color:var(--ink); }
/* A grid of codes, not a dropdown. Forty machines in a list is a scroll
   and a mis-tap; forty in a grid is one glance and one thumb. The cells
   are wide enough for "R7" and for a 44px target. */
.gt-mach {
  display:grid; grid-template-columns:repeat(auto-fill, minmax(58px, 1fr)); gap:7px;
}
.gt-mach-btn {
  position:relative; min-height:50px; padding:5px 3px; border-radius:10px;
  background:var(--card); border:1px solid var(--line); color:var(--ink);
  font:inherit; cursor:pointer; display:grid; place-items:center; gap:1px;
}
.gt-mach-btn b { font-size:17px; font-weight:700; font-variant-numeric:tabular-nums; }
.gt-mach-btn i { font-style:normal; font-size:9px; color:var(--dim); letter-spacing:.04em; }
.gt-mach-btn[data-busy]::after {
  content:""; position:absolute; top:6px; right:6px;
  width:6px; height:6px; border-radius:50%; background:var(--ok);
}
.gt-mach-btn[data-on] {
  background:var(--brand); border-color:var(--brand); color:#fff;
  box-shadow:0 0 0 2px var(--gold);
}
.gt-mach-btn[data-on] i { color:rgba(255,255,255,.7); }
.gt-mach-btn[data-on][data-busy]::after { background:var(--gold-light); }
.gt-mach-btn:disabled { opacity:.5; }

.gt-tl-tool {
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:13px; font-weight:600; color:var(--ink);
  font-variant-numeric:tabular-nums;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.gt-tl-who { font-size:11.5px; color:var(--dim); line-height:1.45; }
.gt-tl-undone { color:var(--out); font-weight:700; }
.gt-tl-more { margin:4px 0 0; font-size:11px; color:var(--dim); text-align:center; }
`;

/**
 * One tool in the cupboard list.
 *
 * TAP takes it — that is what everybody standing at the cupboard is
 * here to do, and it must stay the cheapest gesture on the screen.
 *
 * HOLD is for the few who keep the shelf, and opens that tool's jobs
 * straight away. Daksh, Nov 2026: "to add stock and fix count you have
 * to press fix count and choose which tool — instead maybe we can long
 * press." The tool was already under his thumb; the old route made him
 * let go of it, press a button, pick a verb, then find it again in a
 * list of part codes that differ by one digit.
 *
 * A component of its own because a hook cannot be called inside a map,
 * and at module scope because a component declared inside another one
 * is a new type on every render — which remounts it, and a remounting
 * list loses the press halfway through.
 */
function ToolButton({
  tool, left, disabled, canKeep, onTake, onHold,
}: {
  tool: TakeTool;
  left: number;
  disabled: boolean;
  canKeep: boolean;
  onTake: () => void;
  onHold: () => void;
}) {
  const press = useLongPress(onHold, { disabled: !canKeep });
  const lvl = left <= 0 ? "out" : tool.level === "ok" ? "ok" : "low";

  return (
    <button
      type="button"
      className="gt-tool"
      data-level={lvl}
      disabled={disabled}
      onPointerDown={press.onPointerDown}
      onPointerMove={press.onPointerMove}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onLostPointerCapture={press.onLostPointerCapture}
      onContextMenu={press.onContextMenu}
      onClick={(e) => {
        // Swallows the click a completed hold leaves behind, so holding
        // a tool opens the keeper sheet instead of ALSO taking one.
        press.onClick(e);
        if (!e.defaultPrevented) onTake();
      }}
    >
      <span className="gt-thumb" data-empty={tool.imageUrl ? undefined : "1"}>
        {tool.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={tool.imageUrl} alt="" loading="lazy" />
          : <i>{tool.name.trim().charAt(0).toUpperCase() || "?"}</i>}
      </span>
      <span className="gt-tool-main">
        <strong>{tool.name}</strong>
        <span className="gt-tool-spec">{tool.spec ? tool.spec : `counted in ${tool.unit}`}</span>
      </span>
      <span className="gt-tool-left">
        <b>{left}</b>
        <i>{tool.unit}</i>
      </span>
    </button>
  );
}
