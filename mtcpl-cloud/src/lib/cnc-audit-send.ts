/**
 * CNC Audit → WhatsApp.
 *
 * Builds the audit sheet, parks it in the same public bucket the daily
 * report uses, and sends it as a WhatsApp document to whoever was picked.
 *
 * ON THE TEMPLATE. Meta will not accept a free-form WhatsApp message to
 * someone who has not messaged us first, and a template's text variables
 * cannot contain newlines — so a machine-by-machine list can only travel
 * as an attached document, which is exactly how the daily report already
 * works. MSG91_WA_CNC_AUDIT_TEMPLATE names a template of its own; until
 * one is approved it falls back to the daily-report template, whose shape
 * is identical (a document header plus one text variable). The fallback
 * DELIVERS — the covering line will just read in the daily report's
 * wording, with the audit's own filename and stamp. Worth knowing before
 * anyone wonders why the covering text says "report".
 */

import crypto from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildCncAuditPdf, type CncAuditTotals } from "@/lib/cnc-audit-report";
import { normalizeIndianMobile } from "@/lib/wa-send";

const WA_BULK_URL = "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const INTEGRATED_NUMBER = process.env.MSG91_WA_NUMBER || "917627065482";
const TEMPLATE_LANG = process.env.MSG91_WA_TEMPLATE_LANG || "en";
const TEMPLATE_NAME =
  process.env.MSG91_WA_CNC_AUDIT_TEMPLATE || process.env.MSG91_WA_TEMPLATE || "mtcpl_daily_report";

export type AuditRecipient = { id: string; name: string; phone: string };

/** Everyone who can be sent an audit: active users with a usable Indian
 *  mobile. Vendors are deliberately included — the CNC operators are the
 *  people standing next to the machines, so they are the most useful
 *  person to hand a floor check to. */
export async function listAuditRecipients(): Promise<
  Array<{ id: string; name: string; role: string; phone: string }>
> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, role, phone, is_active")
    .eq("is_active", true)
    .order("full_name");
  const out: Array<{ id: string; name: string; role: string; phone: string }> = [];
  for (const p of (data ?? []) as Array<{
    id: string; full_name: string | null; role: string; phone: string | null; is_active: boolean;
  }>) {
    const phone = normalizeIndianMobile(p.phone);
    if (!phone) continue;
    out.push({ id: p.id, name: (p.full_name ?? "").trim() || "—", role: p.role, phone });
  }
  return out;
}

/** Build, upload and send. Returns what was sent and to whom so the
 *  caller can audit-log it and show an honest toast. */
export async function sendCncAudit(
  recipients: AuditRecipient[],
): Promise<{ stamp: string; totals: CncAuditTotals; pdfUrl: string; sentTo: string[] }> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) throw new Error("MSG91_AUTH_KEY is not set — WhatsApp sending is not configured.");
  if (recipients.length === 0) throw new Error("Pick at least one person to send it to.");

  const admin = createAdminSupabaseClient();
  const { bytes, totals, stamp } = await buildCncAuditPdf();

  const path = `cnc-audit/${stamp.replace(/[^\w]+/g, "-")}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await admin.storage
    .from("whatsapp_reports")
    .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`Audit PDF upload failed: ${upErr.message}`);
  const pdfUrl = admin.storage.from("whatsapp_reports").getPublicUrl(path).data.publicUrl;

  // One covering line. It has to survive being a template variable, so:
  // no newlines, and nothing Meta will read as a stray placeholder.
  const caption =
    `CNC Audit ${stamp} - ${totals.running} of ${totals.machines} machines running, ` +
    `${totals.slabs} slabs on the floor`;

  const to = [...new Set(recipients.map((r) => r.phone))];
  const body = {
    integrated_number: INTEGRATED_NUMBER,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG, policy: "deterministic" },
        to_and_components: [
          {
            to,
            components: {
              header_1: { type: "document", value: pdfUrl, filename: "MTCPL-CNC-Audit.pdf" },
              body_1: { type: "text", value: caption },
            },
          },
        ],
      },
    },
  };

  const res = await fetch(WA_BULK_URL, {
    method: "POST",
    headers: { authkey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json: { type?: string; message?: string; hasError?: boolean } = {};
  try { json = JSON.parse(raw); } catch { /* non-JSON */ }
  if (!res.ok || json.type === "error" || json.hasError) {
    throw new Error(`WhatsApp send failed: ${json.message || raw || `HTTP ${res.status}`}`);
  }

  return { stamp, totals, pdfUrl, sentTo: to };
}
