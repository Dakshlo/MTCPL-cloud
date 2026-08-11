/**
 * Mig 060 — Various Costing landing. RETIRED Aug 2026.
 *
 * Daksh: "that page just increases resistance so remove it — instead
 * when you press Various Costing it will give directly 2 options on
 * the dashboard."
 *
 * The page's whole job was to show two cards, CNC and Cutter. Those
 * two now sit as buttons on the dashboard's Various Costing card
 * (components/various-costing-entry-card.tsx), and both report pages
 * point their back-link at /dashboard, so nothing links here any more.
 *
 * Kept as a redirect rather than deleted: the route is a year old, so
 * it's in browser histories and bookmarks, and cutting/expenses/
 * actions.ts still calls revalidatePath("/reports/various-costing").
 * A redirect turns all of those into a harmless bounce instead of a
 * 404. The two child routes (/cnc, /cutter) are untouched and remain
 * the real reports.
 */

import { redirect } from "next/navigation";

export default async function VariousCostingLanding() {
  redirect("/dashboard");
}
