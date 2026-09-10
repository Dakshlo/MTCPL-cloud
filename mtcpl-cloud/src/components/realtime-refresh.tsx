"use client";

import { useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/* ── Why this was making every action feel slow (Daksh, Sep 2026) ──
   "When we change or do any action on a page it seems slow."

   Every write to a watched table fires an event to EVERY connected
   tab, and each one answers with router.refresh() — a full server
   render. Three things fell out of that:

     • Your own action re-rendered TWICE. The server action already
       calls revalidatePath(), so the page in front of you is fresh
       before this component even hears about the write; the refresh
       450 ms later was a SECOND render of the page you just got.
       That redundant render, landing right after the click, is the
       lag being described.
     • Idle tabs re-rendered too. A board left open on a wall screen
       or a second monitor re-rendered on every slab anyone touched,
       all day, with nobody reading it.
     • Bulk work multiplied it. Approving a cutting session writes
       ~50 rows; at a 450 ms debounce that is roughly 20 refreshes
       per open tab, and every tab in the building hits the database
       at the same moment — so your own click waits behind the herd.

   Measured 10 Sep 2026: WAL polling for these subscriptions was 73%
   of ALL database time, and slab writes had gone from 10/day on
   1 Sep to 465/day. The load scales with how busy the office is,
   which is exactly when people notice it.

   The subscription stays — cross-screen freshness is a real feature
   (the accountant seeing the owner's payment land). What changed is
   what it costs.                                                   */

const WATCHED_TABLES = [
  // Production tables
  "blocks",
  "slab_requirements",
  "cut_sessions",
  "cut_session_blocks",
  "cut_session_slabs",
  "carving_items",
  "dispatch_logs",
  // Mig 052 follow-on (Daksh, May 2026): finance pages weren't
  // auto-refreshing when the owner confirmed a payment on his PC —
  // the accountant's screen stayed stale until manual reload. Same
  // for vendor edits, new bills, bank-reject flips. Adding the
  // three core accounting tables to the watch list — every page in
  // /accounts/* re-fetches on the next event.
  "bills",
  "bill_payments",
  "bill_vendors",
  // `notifications` used to be here and is deliberately gone: the
  // bell polls every 30 s by itself, so watching the table bought
  // nothing and made every notification anyone received re-render
  // every open page in the company.
] as const;

/** 450 ms was tuned to feel instant after a single edit. It also turned
 *  a 50-row bulk write into ~20 renders per tab. At 2.5 s a burst
 *  collapses into one refresh, and a lone edit still lands long before
 *  anyone looks over at another screen. */
const DEBOUNCE_MS = 2_500;

export function RealtimeRefresh() {
  const router = useRouter();
  const timeoutRef = useRef<number | null>(null);
  /** Something changed while this tab sat in the background. Refresh
   *  once when it comes back, instead of N times behind their back. */
  const missedRef = useRef(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase.channel("mtcpl-live-refresh");

    const doRefresh = () => {
      missedRef.current = false;
      startTransition(() => {
        router.refresh();
      });
    };

    const onChange = () => {
      // A hidden tab does not need re-rendering — nobody is reading it.
      // Note that it fell behind and catch up when it is looked at.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        missedRef.current = true;
        return;
      }
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(doRefresh, DEBOUNCE_MS);
    };

    WATCHED_TABLES.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
    });

    channel.subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible" && missedRef.current) doRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
