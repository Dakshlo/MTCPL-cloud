"use client";

import { useEffect } from "react";

/**
 * "Fit to one page" for the rate-breakup quotation (Daksh, Aug 2026).
 *
 * A long breakup — two master groups, thirty particulars — naturally runs onto
 * a second sheet, and the office would rather hand over one. This measures the
 * document at TRUE A4 geometry and shrinks it with `zoom` until it fits.
 *
 * `zoom` rather than `transform: scale()` on purpose: zoom reflows, so the
 * browser's own pagination still sees a document that ends before the page
 * does. A transform only paints smaller — the page break stays where it was.
 *
 * The wrap is already forced to A4 width in fit mode (see `.wrap.fit`), so what
 * you read on screen is exactly what comes out of the printer.
 */

/** A4 portrait at 96dpi, and the floor below which shrinking stops being
 *  readable — past that we leave it and let the quotation run to two pages. */
const A4_H = 1123;
const MIN_SCALE = 0.5;

export function FitToPage({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    const wrap = document.querySelector<HTMLElement>(".wrap");
    const note = document.getElementById("fit-note");
    if (!wrap) return;

    if (!enabled) {
      wrap.style.zoom = "";
      if (note) note.textContent = "";
      return;
    }

    /** Shrink, then CHECK — one division overshoots, because changing the zoom
     *  reflows the document and can change its height again. Measure the VISUAL
     *  box (getBoundingClientRect) each pass: scrollHeight on a zoomed element
     *  reports unzoomed layout pixels, and dividing that by the scale compounds
     *  the error until it hits the floor. */
    const measure = () => {
      const visual = () => wrap.getBoundingClientRect().height;
      wrap.style.zoom = "1";
      let scale = 1;
      let clipped = false;

      for (let pass = 0; pass < 5; pass++) {
        const h = visual();
        // 4px of slack — a document measured to the exact pixel can still tip
        // onto page 2 on a printer that rounds the other way.
        if (h <= A4_H - 4) break;
        const want = scale * ((A4_H - 4) / h);
        if (want < MIN_SCALE) { scale = MIN_SCALE; clipped = true; wrap.style.zoom = String(scale); break; }
        scale = want;
        wrap.style.zoom = String(scale);
      }

      if (scale >= 1) {
        wrap.style.zoom = "";
        if (note) note.textContent = "already fits on one page";
        return;
      }
      if (note) {
        note.textContent = clipped
          ? `at ${Math.round(MIN_SCALE * 100)}% — still too long for one page`
          : `scaled to ${Math.round(scale * 100)}% to fit one page`;
      }
    };

    measure();
    // Fonts land after first paint and change the height; re-measure once they do.
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled]);

  return null;
}
