"use client";

// ──────────────────────────────────────────────────────────────────
// Drop-in keep-your-place for a table rendered by a SERVER component.
//
// The hook in lib/use-keep-your-place needs an onClick on every row
// link, which is easy in a client table (Due Bills, the vendor list)
// and awkward in a server one — the vendor profile's bill history is
// 986 lines of server JSX and does not deserve a "use client" just to
// remember a scroll position.
//
// So this renders nothing but the flash CSS and listens for clicks on
// the way down, works out which row was clicked, and tells the hook.
// Capture phase, so it runs before Next's router takes the click.
//
//   <tr data-bill-id={b.id}> … <Link href={`/accounts/bills/${b.id}`}>
//   <KeepYourPlace scope={`vendor-bills:${vendorId}`} rowAttr="data-bill-id" />
// ──────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

import { KEEP_YOUR_PLACE_CSS, useKeepYourPlace } from "@/lib/use-keep-your-place";

export function KeepYourPlace({
  scope,
  rowAttr,
}: {
  /** Storage scope. Include the parent id when the same table appears
   *  under many records — one vendor's anchor must not move another's. */
  scope: string;
  rowAttr: string;
}) {
  const { onOpen } = useKeepYourPlace(scope, rowAttr);

  // The hook hands back a fresh closure each render; park it in a ref
  // so the listener below can be attached exactly once.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Let the browser have modified clicks (new tab, download…) —
      // the list is not being left, so there is nothing to come back to.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!link) return;
      const row = link.closest(`tr[${rowAttr}]`);
      const id = row?.getAttribute(rowAttr);
      if (id) onOpenRef.current(id);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [rowAttr]);

  return <style>{KEEP_YOUR_PLACE_CSS}</style>;
}
