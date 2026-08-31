// ──────────────────────────────────────────────────────────────────
// /time-check — developer-only page holding the server-vs-browser clock.
//
// Daksh, Aug 2026: "put that in a card like MTCPL AI." The check used
// to sit as a full-width panel at the top of the dashboard, which put a
// diagnostic ahead of the day's actual work every morning. It belongs
// where you go looking for it when a date looks wrong.
//
// Role is checked here AND in /api/time-check, so the numbers cannot be
// read by reaching the route directly.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { TimeCheckCard } from "../dashboard/time-check-card";

export const dynamic = "force-dynamic";

export default async function TimeCheckPage() {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") redirect("/dashboard");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 32 }}>
      <div className="record-head" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Developer
          </div>
          <h1 style={{ margin: "2px 0 0" }}>🕐 Server time check</h1>
        </div>
        <Link
          href="/dashboard"
          style={{ textDecoration: "none", alignSelf: "flex-start", padding: "9px 14px", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, color: "var(--text)", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}
        >
          ← Dashboard
        </Link>
      </div>

      <TimeCheckCard />

      <section className="page-card">
        <h2 style={{ margin: "0 0 8px", fontSize: 14 }}>What to look at</h2>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
          The app runs on the <strong>server</strong>{" "}clock, not the one on your machine — which is
          why both are shown. The hero clock on the dashboard reads your browser, so it looked
          perfectly correct on 27 Aug 2026 while the dashboard greeted you with
          &ldquo;Friday, 28 August&rdquo;; a date helper was applying the +5:30 IST offset twice.
          <br /><br />
          <strong>Drift</strong>{" "}under a minute is ordinary clock wander. Sixty seconds or more, or
          the two IST dates disagreeing, turns this card red — that is the point at which day
          boundaries can flip and reports get dated wrong. Screenshot it and send it over.
          <br /><br />
          <strong>Server timezone shows UTC on Vercel</strong>{" "}and IST on a laptop dev server. Both
          are fine. The IST values derived from it are the ones that have to be right.
        </p>
      </section>
    </div>
  );
}
