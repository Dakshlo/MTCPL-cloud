"use client";

/**
 * Shared selection state for the Cutting page.
 *
 * Each block card renders a <BlockSelector id={...}/> checkbox. When the
 * user ticks one or more blocks, PrintReportButton switches its label
 * from "Print In Progress" to "Print N Selected" and includes those IDs
 * in the report URL.
 *
 * Selection state is scoped to the page — navigating between tabs
 * (pending/in-progress/done) is a full Next.js navigation and clears the
 * state, which is the behaviour we want so stale IDs don't carry over.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type SelectionCtxValue = {
  selected: Set<string>;
  toggle(id: string): void;
  clear(): void;
};

const SelectionCtx = createContext<SelectionCtxValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const value = useMemo<SelectionCtxValue>(() => ({
    selected,
    toggle(id: string) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    clear() {
      setSelected(new Set());
    },
  }), [selected]);

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

export function useSelection(): SelectionCtxValue {
  const v = useContext(SelectionCtx);
  if (!v) {
    throw new Error("useSelection must be used inside SelectionProvider");
  }
  return v;
}
