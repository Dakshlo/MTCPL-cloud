/**
 * Tender / Price-Breakdown shared model (Daksh, Aug 2026). Plain module —
 * imported by the server action, the page loader AND the client
 * workspace, so it must carry no server-only or client-only code.
 */

export type TenderItemMode = "amount" | "per_cft" | "percent";

export type TenderItem = {
  id: string;
  title: string;
  mode: TenderItemMode;
  /** ₹ for amount, ₹/CFT for per_cft, 0-100 for percent. */
  value: number;
};

export type TenderGroup = {
  id: string;
  title: string;
  items: TenderItem[];
};

export type TenderAnalysis = {
  id: string;
  name: string;
  /** Project quantity in CFT — powers ₹/CFT rows + the per-CFT total.
   *  null = lump-sum sheet (per_cft rows then contribute 0). */
  qty: number | null;
  groups: TenderGroup[];
  createdAt: string;
  updatedAt: string;
};

/** app_settings key holding every sheet. */
export const TENDER_KEY = "tender_analyses";
