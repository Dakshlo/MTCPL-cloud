"use client";

// ──────────────────────────────────────────────────────────────────
// Keep-your-place on a long list (Daksh — Due Bills Oct 2026,
// Vendor Account Nov 2026).
//
// Step into a row and come back, and the list puts you where you
// were with the row you opened lit for a couple of seconds. Written
// first for Due Bills because Naresh works a 600-row queue and was
// being thrown to the top every time he opened a bill; lifted into
// here unchanged when the Vendor Account list (323 rows) needed the
// same thing.
//
// WHAT IS STORED IS AN ANCHOR, NOT A SCROLL POSITION. "This row sat
// N px down the window" survives the list coming back a different
// shape — rows paid off, archived, filtered out, re-sorted, taller.
// A raw scrollTop does not.
//
// Each list passes its own `scope` (its storage keys) and the row
// attribute it stamps on every <tr>.
//
//   const { onOpen } = useKeepYourPlace("due-bills", "data-bill-id");
//   …
//   <style>{KEEP_YOUR_PLACE_CSS}</style>
//   <tr data-bill-id={r.id}>
//     <Link href={…} onClick={() => onOpen(r.id)}>…
// ──────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

export const KYP_FLASH_CLASS = "kyp-flash";
export const KYP_FLASH_MS = 2200;

/** Put this in a <style> inside any list that uses the hook. The
 *  animation is on the CELLS, not the <tr>: rows carry an inline
 *  zebra background that a class cannot beat. */
export const KEEP_YOUR_PLACE_CSS = `
  tr.${KYP_FLASH_CLASS} > td {
    animation: kypFlash ${KYP_FLASH_MS}ms ease-out 1;
  }
  @keyframes kypFlash {
    0%, 65% { background: rgba(234,179,8,0.34); }
    100%    { background: transparent; }
  }
  @media (prefers-reduced-motion: reduce) {
    tr.${KYP_FLASH_CLASS} > td { animation: none; background: rgba(234,179,8,0.22); }
  }
`;

type ScrollAnchor = { id: string; offset: number };

/** Whatever actually scrolls these rows: usually the window, but the
 *  app shell scrolls its own main on some layouts. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
  }
  return null; // → the window
}

export function useKeepYourPlace(
  scope: string,
  rowAttr: string,
): { onOpen: (id: string) => void } {
  const scrollKey = `mtcpl:${scope}:scroll`;
  /** Holds the id of the row they opened — so it both says "they are
   *  coming back" and names the row to light up on landing. */
  const returnKey = `mtcpl:${scope}:return`;

  const rowEl = (id: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(
      `tr[${rowAttr}="${CSS.escape(id)}"]`,
    );

  /** The topmost row still on screen, and how far down the window it
   *  sits. That pair is the view. */
  const readAnchor = (): ScrollAnchor | null => {
    const rows = document.querySelectorAll<HTMLElement>(`tr[${rowAttr}]`);
    for (const row of rows) {
      const top = row.getBoundingClientRect().top;
      if (top > -row.offsetHeight) {
        const id = row.getAttribute(rowAttr);
        if (id) return { id, offset: Math.round(top) };
      }
    }
    return null;
  };

  const saveAnchor = () => {
    const a = readAnchor();
    if (!a) return;
    try {
      sessionStorage.setItem(scrollKey, JSON.stringify(a));
    } catch {
      // Private mode / quota — worst case they land at the top, as before.
    }
  };

  /** Put the list back. False when the anchor row is gone (paid,
   *  archived, filtered out) so the caller can fall back. */
  const restoreAnchor = (a: ScrollAnchor): boolean => {
    const row = rowEl(a.id);
    if (!row) return false;
    const delta = row.getBoundingClientRect().top - a.offset;
    if (Math.abs(delta) < 2) return true;
    const sc = scrollerOf(row);
    if (sc) sc.scrollTop += delta;
    else window.scrollBy(0, delta);
    return true;
  };

  // Track where they are. rAF-throttled, and the work is a handful of
  // getBoundingClientRect calls, not a layout of all 600 rows.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        saveAnchor();
      });
    };
    // Capture phase as well: scroll doesn't bubble, so a listener on
    // the window alone would miss a layout where an inner shell scrolls.
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ...and put them back when they return. Only then — returnKey is
  // written by the row link and cleared once we land, so opening the
  // page fresh from the sidebar still starts at the top.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || restoredRef.current) return;
    let openedId: string | null = null;
    let anchor: ScrollAnchor | null = null;
    try {
      openedId = sessionStorage.getItem(returnKey);
      if (!openedId) return;
      const raw = sessionStorage.getItem(scrollKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ScrollAnchor>;
        if (typeof parsed?.id === "string" && typeof parsed?.offset === "number") {
          anchor = { id: parsed.id, offset: parsed.offset };
        }
      }
    } catch {
      return;
    }
    const opened = openedId;

    // Stop fighting them the moment they take over.
    let userMoved = false;
    const yieldToUser = () => {
      userMoved = true;
    };
    const YIELD_ON = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const ev of YIELD_ON) {
      window.addEventListener(ev, yieldToUser, { passive: true });
    }

    const apply = () => {
      if (userMoved) return;
      // The anchor row first; if it has left the list, settle for the
      // one they opened; if both are gone there is nothing sensible to
      // aim at, so leave them at the top.
      if (!(anchor && restoreAnchor(anchor))) {
        rowEl(opened)?.scrollIntoView({ block: "center" });
      }
    };

    // Three passes, not one. A plain <Link> back scrolls the new page
    // to the top AFTER we have run, and a server re-render can replace
    // the rows a moment later; each pass is a no-op once the view is
    // already right.
    const frame = requestAnimationFrame(() => {
      apply();
      const row = rowEl(opened);
      if (row) {
        row.classList.add(KYP_FLASH_CLASS);
        window.setTimeout(() => row.classList.remove(KYP_FLASH_CLASS), KYP_FLASH_MS);
      }
    });
    const t1 = window.setTimeout(apply, 350);
    const t2 = window.setTimeout(() => {
      apply();
      // Spent — and only now. Clearing it up front would lose the
      // return trip entirely under React's development double-mount,
      // which tears the first run down before any of these passes fire.
      restoredRef.current = true;
      try {
        sessionStorage.removeItem(returnKey);
      } catch {
        // ignore
      }
    }, 900);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      for (const ev of YIELD_ON) window.removeEventListener(ev, yieldToUser);
    };
    // Must run once per mount — the rows it looks up are in the first commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Call from the row's link. They are stepping out and will come
   *  straight back; save the view now, while the row positions are
   *  still the ones on screen. */
  const onOpen = (id: string) => {
    saveAnchor();
    try {
      sessionStorage.setItem(returnKey, id);
    } catch {
      // No storage — they just land at the top, as before.
    }
  };

  return { onOpen };
}
