"use client";

// ──────────────────────────────────────────────────────────────────
// Keep the number on the screen honest (mig 236).
//
// Daksh, Nov 2026: "stock should update every second."
//
// Mig 235 made the WRITES safe — two men can no longer take the same
// last bit, whatever either screen says. This is the other half: not
// leaving a stale number sitting in front of somebody while the shelf
// empties behind them.
//
// It polls one short string — the whole shelf as "id:count|id:count".
// When it matches, nothing happens at all: no state, no re-render, no
// data fetched. When it differs, the page is refreshed and React
// re-renders from the server's own numbers, so there is never a second
// copy of the stock to drift out of step with the first.
//
// It stops while the tab is hidden, which on a phone in a pocket is
// most of the time, and catches up the moment it comes back.
// ──────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function useLiveStock({
  signature,
  everyMs,
  token,
  enabled = true,
}: {
  /** The shelf as the page currently has it, from stockSignature(). */
  signature: string;
  everyMs: number;
  /** The sticker token, on the cupboard QR, which has no app login. */
  token?: string;
  enabled?: boolean;
}) {
  const router = useRouter();

  // The newest signature, parked in a ref so changing it does not
  // restart the timer — otherwise every refresh would reset the clock
  // and a busy store would poll far more often than asked.
  const sigRef = useRef(signature);
  sigRef.current = signature;

  // One refresh in flight at a time. router.refresh() is not instant,
  // and firing a second while the first is still landing just makes
  // the server do the work twice.
  const refreshing = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let dead = false;
    const url = token
      ? `/api/tools/stock?token=${encodeURIComponent(token)}`
      : "/api/tools/stock";

    async function look() {
      if (dead || document.visibilityState !== "visible") return;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return; // signed out, sticker revoked — stop bothering
        const body = (await r.json()) as { sig?: string };
        if (dead || typeof body.sig !== "string") return;
        if (body.sig === sigRef.current) return; // nothing moved
        if (refreshing.current) return;
        refreshing.current = true;
        // Assume the refresh lands; if it does not, the next poll will
        // see the same difference and try again.
        sigRef.current = body.sig;
        router.refresh();
        window.setTimeout(() => { refreshing.current = false; }, 1200);
      } catch {
        // Offline in a shed. Say nothing and try again next tick.
      }
    }

    const id = window.setInterval(look, everyMs);
    // Coming back to the tab is the moment the number is most likely
    // to be wrong, so check then too rather than waiting out the tick.
    const onShow = () => { if (document.visibilityState === "visible") void look(); };
    document.addEventListener("visibilitychange", onShow);

    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [enabled, everyMs, token, router]);
}
