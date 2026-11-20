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
import { currentToolSession, toolRoster } from "@/lib/cnc-tool-session";
import { holdingsForPerson, machinesForVendor } from "@/lib/cnc-tool-usage";
import {
  guestTakeToolAction,
  keeperAddStockAction,
  keeperFixCountAction,
  keeperNewToolAction,
  sendToolSignInCodeAction,
  toolSignOutAction,
  verifyToolSignInCodeAction,
  guestRegisterAction,
  guestMyToolsAction,
  guestSettleHeldAction,
  guestUndoUsageAction,
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

  // ── Everything that depends only on the session, in ONE wave ────
  //
  // His account and his machines (mig 238), so the strip over the shelf
  // is right on first paint and the machine grid is already there when
  // he taps through to it. Both are small and both are useless to
  // anyone not signed in, so neither is fetched then.
  //
  // The roster of a vendor's men, the companies to enrol under and the
  // men's own holdings were fetched here too until Nov 2026, when the
  // per-man login came out.
  const [held, machines] = session
    ? await Promise.all([
        holdingsForPerson(session.profileId, session.operatorId),
        machinesForVendor(session.vendorId),
      ])
    : [[], []];

  // Only what can actually be taken. A tool at zero is not offered —
  // there is nothing on the shelf to hand over.
  // Everything on the shelf, empty ones included — an empty tool is
  // exactly the one a keeper has come to refill, so it must be in the
  // list he picks from even though nobody can take it.
  const keeperTools = session?.canKeep
    ? [...tools]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({
          id: t.id, name: t.name, spec: t.spec, unit: t.unit,
          stock: t.stock, imageUrl: t.imageUrl,
        }))
    : [];

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
              canKeep: session.canKeep,
            }
          : null
      }
      keeperTools={keeperTools}
      held={held}
      machines={machines.map((m) => ({
        id: m.id,
        code: m.code,
        vendorName: m.vendorName,
        machineType: m.machineType,
        busy: m.busy,
      }))}
      sendCodeAction={sendToolSignInCodeAction}
      verifyCodeAction={verifyToolSignInCodeAction}
      signOutAction={toolSignOutAction}
      takeAction={guestTakeToolAction}
      registerAction={guestRegisterAction}
      myToolsAction={guestMyToolsAction}
      settleAction={guestSettleHeldAction}
      undoUsageAction={guestUndoUsageAction}
      addStockAction={keeperAddStockAction}
      fixCountAction={keeperFixCountAction}
      newToolAction={keeperNewToolAction}
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
