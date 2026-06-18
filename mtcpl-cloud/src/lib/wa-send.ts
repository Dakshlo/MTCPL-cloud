// ──────────────────────────────────────────────────────────────────
// Generic MSG91 WhatsApp template sender — Daksh, June 2026.
//
// Reuses the same MSG91 account (MSG91_AUTH_KEY) + integrated number as
// the daily work-report. Throws on failure so callers can audit; callers
// that must never bubble (e.g. the post-Mark-Paid vendor notification)
// wrap this in try/catch.
// ──────────────────────────────────────────────────────────────────

const WA_BULK_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

export type WaComponents = Record<
  string,
  { type: string; value: string; filename?: string }
>;

/** Normalise an Indian phone number to MSG91's `91XXXXXXXXXX` form
 *  (digits only, country code prefixed). Returns null if it doesn't look
 *  like a valid 10-digit mobile (optionally already 91-prefixed or
 *  0-prefixed). Tolerates spaces, dashes, +91, etc. */
export function normalizeIndianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  return null;
}

/** Send one approved WhatsApp template to one or more recipients. */
export async function sendWhatsAppTemplate(opts: {
  to: string[]; // already normalised, e.g. ["919414152740"]
  templateName: string;
  components: WaComponents;
  lang?: string;
}): Promise<void> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) throw new Error("MSG91_AUTH_KEY is not set in the environment.");
  const integrated = process.env.MSG91_WA_NUMBER || "917627065482";

  const body = {
    integrated_number: integrated,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.lang || "en", policy: "deterministic" },
        to_and_components: [{ to: opts.to, components: opts.components }],
      },
    },
  };

  const res = await fetch(WA_BULK_URL, {
    method: "POST",
    headers: { authkey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json: { type?: string; message?: string; hasError?: boolean } = {};
  try {
    json = JSON.parse(txt);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || json.type === "error" || json.hasError) {
    throw new Error(`MSG91 WhatsApp send failed: ${json.message || txt || `HTTP ${res.status}`}`);
  }
}
