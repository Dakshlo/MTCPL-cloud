/**
 * The wardrobe QR screen (migs 229 + 230).
 *
 * Scanned off a sticker on the cupboard door, on the taker's own phone.
 * No app login — but not anonymous either: you tap your name, a 4-digit
 * code comes to the number on your profile, and the register is signed
 * by that, not by whatever somebody typed.
 *
 * Mig 232 — and nothing else is asked. The company picker that used to
 * follow the code is gone: the person IS the account.
 *
 * Mig 234 — a vendor who signs in here also sees his own men, and can
 * add one. That is the second and last write this door can make, and
 * only for the man whose company it is; everything else on this screen
 * is still take-only, enforced in the database and not just here.
 */

import { loadStore, orderForTaking, stockSignature, type ToolRow } from "@/lib/cnc-tool-stock";
import { resolveToolStoreLink } from "@/lib/cnc-tool-guest";
import { currentToolSession, enrollableVendors, toolRoster } from "@/lib/cnc-tool-session";
import { allActiveOperators, operatorsForVendor } from "@/lib/cnc-tool-operators";
import {
  enrolOperatorAction,
  guestTakeToolAction,
  removeOperatorAction,
  sendToolSignInCodeAction,
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

  const [{ tools }, roster, session] = await Promise.all([
    loadStore(),
    toolRoster(),
    currentToolSession(token, link.id),
  ]);

  // His own men, ready on first paint — a vendor opening the team
  // panel should not watch a spinner to see three names. The developer
  // sees all three companies at once, so his list carries whose man
  // each one is, and he gets the list of companies to pick from.
  const anyVendor = session?.canEnrol && session.enrolScope === "any";
  const team = !session?.canEnrol
    ? []
    : anyVendor
      ? (await allActiveOperators()).map((o) => ({
          id: o.id, name: o.name, maskedPhone: o.maskedPhone, company: o.vendorName,
        }))
      : session.vendorId
        ? (await operatorsForVendor(session.vendorId)).map((o) => ({
            id: o.id, name: o.name, maskedPhone: o.maskedPhone,
          }))
        : [];
  const vendorChoices = anyVendor ? await enrollableVendors() : [];

  // Only what can actually be taken. A tool at zero is not offered —
  // there is nothing on the shelf to hand over.
  const takeable: TakeTool[] = orderForTaking(tools.filter((t: ToolRow) => t.stock > 0)).map((t) => ({
    id: t.id,
    name: t.name,
    spec: t.spec,
    unit: t.unit,
    stock: t.stock,
    level: t.level,
    imageUrl: t.imageUrl,
  }));

  return (
    <GuestTakeClient
      token={link.token}
      label={link.label}
      tools={takeable}
      // Over ALL live tools, not just the takeable ones — the last of
      // something going to zero has to count as the shelf moving.
      stockSig={stockSignature(tools)}
      roster={roster}
      session={
        session
          ? {
              name: session.name,
              company: session.vendorName,
              canEnrol: session.canEnrol,
              enrolScope: session.enrolScope,
            }
          : null
      }
      team={team}
      vendorChoices={vendorChoices}
      sendCodeAction={sendToolSignInCodeAction}
      verifyCodeAction={verifyToolSignInCodeAction}
      signOutAction={toolSignOutAction}
      takeAction={guestTakeToolAction}
      enrolAction={enrolOperatorAction}
      removeOperatorAction={removeOperatorAction}
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
