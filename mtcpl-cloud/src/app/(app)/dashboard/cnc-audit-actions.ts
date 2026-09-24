"use server";

/**
 * CNC Audit — server actions behind the dashboard panel.
 *
 * Gated to the office: this sends a WhatsApp on the company's number to
 * somebody's personal phone, so it is not something any signed-in user
 * should be able to fire.
 */

import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { listAuditRecipients, sendCncAudit, type AuditRecipient } from "@/lib/cnc-audit-send";

const AUDIT_ROLES = [
  "developer",
  "owner",
  "carving_head",
  "senior_incharge",
  "team_head",
  "tender_manager",
] as const;

export async function listCncAuditRecipientsAction(): Promise<{
  ok: true; people: Array<{ id: string; name: string; role: string }>;
} | { ok: false; error: string }> {
  try {
    await requireAuth([...AUDIT_ROLES]);
    const people = await listAuditRecipients();
    // Phone numbers stay on the server. The picker only ever needs the
    // name and the role; there is no reason to ship everyone's mobile
    // into the browser to render a checkbox list.
    return { ok: true, people: people.map((p) => ({ id: p.id, name: p.name, role: p.role })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load the list." };
  }
}

export async function sendCncAuditAction(
  recipientIds: string[],
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  let profileId = "";
  try {
    const { profile } = await requireAuth([...AUDIT_ROLES]);
    profileId = profile.id;

    const ids = [...new Set(recipientIds.filter(Boolean))];
    if (ids.length === 0) return { ok: false, error: "Pick at least one person." };

    // Re-resolve the phones server-side from the ids. The browser sends
    // ids only, so a tampered form cannot post an arbitrary number and
    // use the company's WhatsApp to message a stranger.
    const all = await listAuditRecipients();
    const chosen: AuditRecipient[] = all
      .filter((p) => ids.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, phone: p.phone }));
    if (chosen.length === 0) {
      return { ok: false, error: "Those people have no usable mobile number on file." };
    }

    const { stamp, totals, pdfUrl, sentTo } = await sendCncAudit(chosen);

    await logAudit(profileId, "cnc_audit_sent", "cnc_audit", stamp, {
      recipients: chosen.map((c) => ({ id: c.id, name: c.name })),
      numbers: sentTo.length,
      machines: totals.machines,
      running: totals.running,
      slabs: totals.slabs,
      pdf: pdfUrl,
    });

    const names = chosen.map((c) => c.name).join(", ");
    return {
      ok: true,
      summary:
        `Sent to ${names} — ${totals.running} of ${totals.machines} machines running, ` +
        `${totals.slabs} slabs listed.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed.";
    // Worth a trail even when it fails: a WhatsApp that did not arrive is
    // exactly the thing someone asks about a day later.
    if (profileId) {
      await logAudit(profileId, "cnc_audit_send_failed", "cnc_audit", new Date().toISOString(), {
        error: msg,
      }).catch(() => {});
    }
    return { ok: false, error: msg };
  }
}
