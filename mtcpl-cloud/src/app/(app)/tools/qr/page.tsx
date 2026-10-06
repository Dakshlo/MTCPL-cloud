/**
 * The sticker you print and tape to the wardrobe door (mig 229).
 *
 * Shows the QR big enough to scan off paper, the plain URL under it for
 * anyone who would rather type, and how much it has been used today.
 * Store-managers only — whoever holds this sticker can write to the
 * register, so handing it out is a management act.
 *
 * The QR is drawn here on the server. The token never goes to an
 * external image service; it only ever reaches the paper.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageCncToolStore, canUseCncTools } from "@/lib/cnc-tool-permissions";
import { appBaseUrl } from "@/lib/wa-diary-mention";
import { istDayStartIso } from "@/lib/cnc-tool-guest";
import { createToolStoreLinkAction, revokeToolStoreLinkAction } from "../actions";
import { QrManager, type LinkCard } from "./qr-client";

export const dynamic = "force-dynamic";

export default async function ToolQrPage() {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");
  if (!canManageCncToolStore(profile)) redirect("/tools");

  const admin = createAdminSupabaseClient();
  const { data: rows } = await admin
    .from("cnc_tool_store_links")
    .select("id, token, label, is_active, daily_cap, created_at, revoked_at")
    .order("created_at", { ascending: false });

  type Row = {
    id: string; token: string; label: string; is_active: boolean;
    daily_cap: number; created_at: string; revoked_at: string | null;
  };
  const links = (rows ?? []) as Row[];

  // How much each sticker has been used since midnight IST — the number
  // that decides whether the cap is about to bite.
  const since = istDayStartIso();
  const usage = new Map<string, number>();
  if (links.length > 0) {
    const { data: moves } = await admin
      .from("cnc_tool_movements")
      .select("guest_link_id")
      .not("guest_link_id", "is", null)
      .gte("created_at", since);
    for (const m of (moves ?? []) as Array<{ guest_link_id: string }>) {
      usage.set(m.guest_link_id, (usage.get(m.guest_link_id) ?? 0) + 1);
    }
  }

  const base = appBaseUrl();
  const cards: LinkCard[] = await Promise.all(
    links.map(async (l) => {
      const url = `${base}/guest/tools/${l.token}`;
      // Only draw a QR for a live sticker — a revoked one is history and
      // printing it again would be a mistake waiting to happen.
      const svg = l.is_active && !l.revoked_at
        ? await QRCode.toString(url, {
            type: "svg",
            errorCorrectionLevel: "M",
            margin: 1,
            width: 320,
          })
        : null;
      return {
        id: l.id,
        label: l.label,
        url,
        svg,
        active: l.is_active && !l.revoked_at,
        dailyCap: l.daily_cap,
        usedToday: usage.get(l.id) ?? 0,
        createdAt: l.created_at,
        revokedAt: l.revoked_at,
      };
    }),
  );

  return (
    <section className="page-fluid tc-page" style={{ paddingBottom: 60 }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "var(--muted)", marginBottom: 5,
            }}
          >
            🧰 Tool store
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.4px", margin: 0 }}>
            Wardrobe QR
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "6px 0 0", maxWidth: "62ch", lineHeight: 1.55 }}>
            Print this and tape it to the cupboard door. Whoever opens the
            wardrobe scans it, says who they are and what they took — no
            login, on their own phone. It can only <strong>take</strong>:
            adding stock, scrap and fix-count still need a real login.
          </p>
        </div>
        <Link
          href="/tools"
          style={{
            marginLeft: "auto", padding: "10px 16px", fontSize: 13, fontWeight: 700,
            borderRadius: 11, textDecoration: "none", whiteSpace: "nowrap",
            border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
          }}
        >
          ← Store
        </Link>
      </header>

      <QrManager
        cards={cards}
        createAction={createToolStoreLinkAction}
        revokeAction={revokeToolStoreLinkAction}
      />
    </section>
  );
}
