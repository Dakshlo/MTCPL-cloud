/**
 * The wardrobe QR screen (migs 229 + 230).
 *
 * Scanned off a sticker on the cupboard door, on the taker's own phone.
 * No app login — but not anonymous either: you tap your name, a 4-digit
 * code comes to the number on your profile, and the register is signed
 * by that, not by whatever somebody typed.
 *
 * It shows tool names and counts and nothing else. Taking is the only
 * write it can make, and the database enforces that, not just this page.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadStore, orderForTaking, type ToolRow } from "@/lib/cnc-tool-stock";
import { resolveToolStoreLink } from "@/lib/cnc-tool-guest";
import { currentToolSession, toolRoster } from "@/lib/cnc-tool-session";
import {
  guestTakeToolAction,
  sendToolSignInCodeAction,
  setToolSessionVendorAction,
  toolSignOutAction,
  verifyToolSignInCodeAction,
} from "./guest-actions";
import { GuestTakeClient, type TakeTool } from "./guest-take-client";

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

  const [{ tools }, roster, session, { data: vendorRows }] = await Promise.all([
    loadStore(),
    toolRoster(),
    currentToolSession(token, link.id),
    admin.from("vendors").select("id, name").order("name"),
  ]);

  // Only what can actually be taken. A tool at zero is not offered —
  // there is nothing on the shelf to hand over.
  const takeable: TakeTool[] = orderForTaking(tools.filter((t: ToolRow) => t.stock > 0)).map((t) => ({
    id: t.id,
    name: t.name,
    spec: t.spec,
    unit: t.unit,
    stock: t.stock,
    level: t.level,
  }));

  return (
    <GuestTakeClient
      token={link.token}
      label={link.label}
      tools={takeable}
      roster={roster}
      vendors={((vendorRows ?? []) as Array<{ id: string; name: string }>).map((v) => ({
        id: v.id,
        name: v.name,
      }))}
      session={
        session
          ? {
              name: session.name,
              vendorId: session.vendorId,
              vendorName: session.vendorName,
            }
          : null
      }
      sendCodeAction={sendToolSignInCodeAction}
      verifyCodeAction={verifyToolSignInCodeAction}
      setVendorAction={setToolSessionVendorAction}
      signOutAction={toolSignOutAction}
      takeAction={guestTakeToolAction}
    />
  );
}

function DeadLink({ title, note }: { title: string; note: string }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f4f5f7",
        color: "#1a1d22",
        display: "grid",
        placeItems: "center",
        padding: 24,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <div style={{ fontSize: 46, marginBottom: 12 }} aria-hidden>🔒</div>
        <h1 style={{ fontSize: 21, fontWeight: 800, margin: "0 0 8px" }}>{title}</h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5c636e", margin: 0 }}>{note}</p>
      </div>
    </main>
  );
}
