"use client";

/**
 * Shared selection state for the Cutting page — used to pick a subset
 * of blocks to print.
 *
 * There's an explicit "selection mode" flag: checkboxes are hidden at
 * rest and only appear once the user says "I want to pick specific
 * blocks" from the Print popover. That keeps the cutting cards clean
 * during normal work and exposes the feature only when it's asked for.
 *
 * State lives on the page (context is scoped below the SelectionProvider
 * which wraps the page body). Tab switches are full Next.js navigations
 * so the state resets naturally, which is the behaviour we want — stale
 * ids from another tab shouldn't carry over.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type SelectionCtxValue = {
  selected: Set<string>;
  /** When true, BlockSelector renders a checkbox on each card. */
  selectionMode: boolean;
  toggle(id: string): void;
  /** Enter selection mode (checkboxes appear) with an empty selection. */
  startSelection(): void;
  /** Exit selection mode and clear the selection. */
  cancelSelection(): void;
  /** Clear the selection but stay in selection mode. */
  clear(): void;
};

const SelectionCtx = createContext<SelectionCtxValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const value = useMemo<SelectionCtxValue>(() => ({
    selected,
    selectionMode,
    toggle(id: string) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    startSelection() {
      setSelected(new Set());
      setSelectionMode(true);
    },
    cancelSelection() {
      setSelected(new Set());
      setSelectionMode(false);
    },
    clear() {
      setSelected(new Set());
    },
  }), [selected, selectionMode]);

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

export function useSelection(): SelectionCtxValue {
  const v = useContext(SelectionCtx);
  if (!v) {
    throw new Error("useSelection must be used inside SelectionProvider");
  }
  return v;
}
