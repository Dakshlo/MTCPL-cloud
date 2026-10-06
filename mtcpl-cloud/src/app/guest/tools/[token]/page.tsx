/**
 * The wardrobe QR screen (mig 229).
 *
 * Scanned off a sticker on the cupboard door, on the taker's own phone,
 * with no login. It does exactly what the paper register did: who are
 * you, what did you take, how many.
 *
 * It shows tool names and counts and nothing else — no money, no vendor
 * balances, no bills. Taking is the only write it can make, and the
 * database enforces that, not just this page.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadStore, orderForTaking, type ToolRow } from "@/lib/cnc-tool-stock";
import { resolveToolStoreLink } from "@/lib/cnc-tool-guest";
import { guestTakeToolAction } from "./guest-actions";
import { GuestTakeClient, type KnownPerson, type TakeTool } from "./guest-take-client";

export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

export default async function GuestToolsPage({ params }: { params: Params }) {
  const { token } = await params;
  const resolved = await resolveToolStoreLink(token);

  if ("problem" in resolved) {
    return (
      <DeadLink
        title={resolved.problem === "revoked" ? "This QR is switched off" : "This QR is not valid"}
        note={
          resolved.problem === "revoked"
            ? "The office has replaced this sticker. Ask them for the new one, and keep using the paper register until then."
            : "Nothing is wrong with your phone — this link is not one of ours. Ask the office for the sticker on the wardrobe."
        }
      />
    );
  }

  const link = resolved.link;
  const admin = createAdminSupabaseClient();

  const [{ tools, movements }, { data: vendorRows }] = await Promise.all([
    loadStore(),
    admin.from("vendors").select("id, name").order("name"),
  ]);

  const vendors = ((vendorRows ?? []) as Array<{ id: string; name: string }>).map((v) => ({
    id: v.id,
    name: v.name,
  }));
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

  // Who has taken from this store before, most recent first, each with the
  // company they took for. One tap for anyone who has been here; only a
  // genuinely new person has to type.
  const seen = new Map<string, { vendorId: string; at: number }>();
  for (const m of movements) {
    if (m.undone_at || m.kind !== "issue" || !m.taken_by || !m.vendor_id) continue;
    const name = m.taken_by.trim();
    if (!name) continue;
    const at = new Date(m.created_at).getTime();
    const prev = seen.get(name.toLowerCase());
    if (!prev || at > prev.at) seen.set(name.toLowerCase(), { vendorId: m.vendor_id, at });
  }
  const people: KnownPerson[] = [...seen.entries()]
    .map(([key, v]) => ({
      // Keep the spelling actually used last time, not the lowercased key.
      name:
        movements.find(
          (m) => (m.taken_by ?? "").trim().toLowerCase() === key && !m.undone_at,
        )?.taken_by?.trim() ?? key,
      vendorId: v.vendorId,
      vendorName: vendorName.get(v.vendorId) ?? "—",
      at: v.at,
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 24)
    .map(({ name, vendorId, vendorName }) => ({ name, vendorId, vendorName }));

  // Only what can actually be taken. A tool at zero is not offered —
  // there is nothing on the shelf to hand over.
  const takeable: TakeTool[] = orderForTaking(tools.filter((t: ToolRow) => t.stock > 0)).map(
    (t) => ({
      id: t.id,
      name: t.name,
      spec: t.spec,
      unit: t.unit,
      stock: t.stock,
      level: t.level,
    }),
  );

  return (
    <GuestTakeClient
      token={link.token}
      label={link.label}
      tools={takeable}
      vendors={vendors}
      people={people}
      takeAction={guestTakeToolAction}
    />
  );
}

function DeadLink({ title, note }: { title: string; note: string }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#0f1115",
        color: "#e8eaed",
        display: "grid",
        placeItems: "center",
        padding: 24,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <div style={{ fontSize: 46, marginBottom: 12 }} aria-hidden>🔒</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>{title}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#9aa0a6", margin: 0 }}>{note}</p>
      </div>
    </main>
  );
}
