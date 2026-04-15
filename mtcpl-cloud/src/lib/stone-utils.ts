export type StoneTypeDef = {
  id?: string;
  name: string;
  color_top: string;
  color_front: string;
  color_side: string;
  is_active?: boolean;
  sort_order?: number;
};

// Built-in fallback palettes — always available even if DB is empty
const BUILT_IN: Record<string, { top: string; front: string; side: string }> = {
  PinkStone:  { top: "#EDCFC2", front: "#C87A60", side: "#DDA88A" },
  WhiteStone: { top: "#E8E6DC", front: "#B8B6AC", side: "#D0CEC4" },
};

/** Get 3-face palette for a stone type, with DB override and fallback. */
export function getStonePalette(
  name: string,
  stoneTypes?: Pick<StoneTypeDef, "name" | "color_top" | "color_front" | "color_side">[]
): { top: string; front: string; side: string } {
  const fromDb = stoneTypes?.find((s) => s.name === name);
  if (fromDb) return { top: fromDb.color_top, front: fromDb.color_front, side: fromDb.color_side };
  const builtin = BUILT_IN[name];
  if (builtin) return builtin;
  // Generic grey fallback for unknown types
  return { top: "#D8D4CC", front: "#A09C94", side: "#B8B4AC" };
}

/** Strip "Stone" suffix for display: "PinkStone" → "Pink", "RedStone" → "Red" */
export function stoneDisplayName(name: string): string {
  return name.replace(/Stone$/i, "").trim() || name;
}
