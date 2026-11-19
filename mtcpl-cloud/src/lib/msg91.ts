// ──────────────────────────────────────────────────────────────────
// MSG91 SMS sender (DLT-compliant) — used to deliver login OTPs.
// ──────────────────────────────────────────────────────────────────
//
// Background (Daksh, June 2026): phone-OTP delivery moved off Twilio
// onto MSG91 to (a) stop burning the last Twilio credits and (b) send
// through our own Airtel DLT registration. Supabase still GENERATES
// and VERIFIES the OTP — it only calls our Send SMS hook
// (src/app/api/auth/sms-hook/route.ts) with the freshly minted code,
// and we forward that code to MSG91 here. So the login screen and
// supabase.auth.verifyOtp() are unchanged; only the SMS pipe swapped.
//
// DLT facts (Airtel, via MSG91):
//   • Sender / header .... MATSHW (DLT registered)
//   • Live template ...... "Your MATESHWARI PORTAL login OTP is
//                            {#numeric#} . Valid for 10 minutes.
//                            Do not share it."
//   • Pending (Aug 2026) .. "MTCPL Login OTP Short" — "Your login OTP
//                            is {#numeric#}. Valid for 10 minutes. Do
//                            not share it." Daksh's dad wanted the
//                            brand name out of the body; the header
//                            still identifies us. DLT content is
//                            IMMUTABLE once approved, so any wording
//                            change means a new template AND a new
//                            MSG91 flow id — hence the env override
//                            on OTP_TEMPLATE_ID below.
//   • The MSG91 flow template id below maps ##var1## -> the OTP.
// The message MUST go out exactly as the registered template or the
// DLT operator blocks it — that's why we send via the template id and
// pass ONLY the numeric code as var1 (never free text).

import { sendWhatsAppTemplate, type WaComponents } from "@/lib/wa-send";

const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow/";

/**
 * The approved MSG91 "SEND_OTP" flow id. Not secret.
 *
 * Env-overridable so swapping templates is a Vercel setting rather
 * than a deploy: paste the new flow id into MSG91_OTP_TEMPLATE_ID and
 * it takes effect on the next request; clear the variable and it falls
 * straight back to the known-good id below. Logins never wait on a
 * build, and a bad swap is a one-field undo.
 *
 * ⚠ This is the MSG91 FLOW id, NOT the DLT template id (the long
 * numeric one, e.g. 1007616171429714115). Two different values —
 * only the flow id belongs here.
 */
const OTP_TEMPLATE_ID =
  process.env.MSG91_OTP_TEMPLATE_ID?.trim() || "6a252460e3ddb4d18b0c412b";

/**
 * Deliver the login OTP over WhatsApp instead of SMS.
 *
 * Daksh (Aug 2026) wanted the code in bold — SMS is plain text and
 * physically cannot do it, WhatsApp can. Meta's Authentication-category
 * templates bold the code automatically and can carry a "Copy code"
 * button, so the person taps once instead of reading digits off a
 * notification.
 *
 * Dormant until MSG91_WA_OTP_TEMPLATE names an approved template —
 * `isWhatsAppOtpEnabled()` is what the hook checks before offering the
 * channel at all. Throws on any failure so the caller can fall back to
 * SMS rather than leave someone unable to log in.
 *
 * ⚠ If the approved template carries a Copy-code button, Meta requires
 * the code to be passed for the BUTTON as well as the body, or the send
 * is rejected. MSG91's exact key for that isn't documented in the
 * account we already use (every existing template here is body/header
 * only), so it's sent only when MSG91_WA_OTP_BUTTON=1 and the shape may
 * need one correction against the real template. That's safe to get
 * wrong: a rejected WhatsApp send throws, the hook catches it, and the
 * SMS goes out as normal.
 */
export async function sendOtpWhatsApp(mobileRaw: string, otp: string): Promise<void> {
  const templateName = process.env.MSG91_WA_OTP_TEMPLATE?.trim();
  if (!templateName) throw new Error("MSG91_WA_OTP_TEMPLATE is not set.");

  const mobiles = toMsg91Mobile(mobileRaw);
  if (!/^\d{12}$/.test(mobiles)) {
    throw new Error(`Bad recipient mobile "${mobileRaw}" (normalised "${mobiles}").`);
  }

  const components: WaComponents = {
    body_1: { type: "text", value: otp },
  };
  if (process.env.MSG91_WA_OTP_BUTTON === "1") {
    components.button_1 = { type: "text", value: otp, subtype: "url", index: "0" };
  }

  await sendWhatsAppTemplate({
    to: [mobiles],
    templateName,
    lang: process.env.MSG91_WA_OTP_LANG?.trim() || "en",
    components,
  });
}

/** True once an approved WhatsApp OTP template is configured. The login
 *  screen asks the server this so it doesn't offer a button that can
 *  only fail. */
export function isWhatsAppOtpEnabled(): boolean {
  return Boolean(process.env.MSG91_WA_OTP_TEMPLATE?.trim());
}

/** Normalise a mobile to MSG91's "country code + number, no +" form
 *  (e.g. "919876543210"). Accepts +91…, 91…, or a bare 10-digit
 *  Indian number. */
export function toMsg91Mobile(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`; // bare 10-digit → add 91
  return digits; // already carries a country code (e.g. 919876543210)
}

// ── Nothing here may hang for ever ─────────────────────────────────
//
// Daksh, Nov 2026, with a screenshot of Safari's "This page couldn't
// load" taken at the cupboard: "this inventory phone module has some
// bug, it shows this error even at OTP login time."
//
// A `fetch` with no signal waits as long as the other end wants. MSG91
// is a third party on the far side of the internet, and the OTP send
// happens inside a SERVER ACTION — so a gateway that accepts the
// connection and then goes quiet does not fail, it just never answers.
// The phone sits on a spinner until the browser gives up on the request
// itself, which is drawn as "This page couldn't load" and looks to the
// man holding it like the app is broken.
//
// A timeout turns that into an ordinary error the screen can explain
// and he can retry, which is the difference between a bad minute and a
// dead cupboard. It is not a claim about what caused any particular
// failure; it is removing the one path that could hang indefinitely.
const OTP_SEND_TIMEOUT_MS = 15_000;
const TEMPLATE_SEND_TIMEOUT_MS = 20_000;

async function msg91Fetch(
  body: unknown,
  authKey: string,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(MSG91_FLOW_URL, {
      method: "POST",
      headers: {
        authkey: authKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // AbortSignal.timeout throws TimeoutError; a dropped connection
    // throws something else. Both say the same thing to the caller, in
    // words a person at a cupboard can act on.
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    throw new Error(
      timedOut
        ? `MSG91 did not answer within ${Math.round(timeoutMs / 1000)}s. Try again.`
        : `MSG91 could not be reached: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Send the login OTP via MSG91's DLT-approved template. Throws on any
 *  non-success so the caller (the SMS hook) can report it back to
 *  Supabase. */
export async function sendOtpSms(mobileRaw: string, otp: string): Promise<void> {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    throw new Error("MSG91_AUTH_KEY is not set in the environment.");
  }

  const mobiles = toMsg91Mobile(mobileRaw);
  if (!/^\d{12}$/.test(mobiles)) {
    throw new Error(`Bad recipient mobile "${mobileRaw}" (normalised "${mobiles}").`);
  }

  const res = await msg91Fetch(
    {
      template_id: OTP_TEMPLATE_ID,
      short_url: "0",
      realTimeResponse: "1",
      recipients: [{ mobiles, var1: otp }],
    },
    authKey,
    // Somebody is standing at a cupboard with a phone in their hand.
    OTP_SEND_TIMEOUT_MS,
  );

  const text = await res.text();
  let json: { type?: string; message?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body — fall back to raw text in the error below */
  }

  if (!res.ok || json.type === "error") {
    const detail = json.message || text || `HTTP ${res.status}`;
    throw new Error(`MSG91 send failed: ${detail}`);
  }
}

/** Generic DLT-template SMS send via the MSG91 v5 flow API. Pass the
 *  approved template id + the recipient + the template variables
 *  (e.g. { var1: "...", var2: "..." }). Used for notifications such as
 *  the urgent-maintenance alert. The template MUST be DLT-approved —
 *  the login-OTP template can't be reused for other wording. Throws on
 *  any non-success so callers can decide whether to swallow it. */
export async function sendTemplateSms(opts: {
  templateId: string;
  mobile: string;
  vars: Record<string, string>;
}): Promise<void> {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) throw new Error("MSG91_AUTH_KEY is not set in the environment.");
  const mobiles = toMsg91Mobile(opts.mobile);
  if (!/^\d{12}$/.test(mobiles)) throw new Error(`Bad recipient mobile "${opts.mobile}".`);

  const res = await msg91Fetch(
    {
      template_id: opts.templateId,
      short_url: "0",
      recipients: [{ mobiles, ...opts.vars }],
    },
    authKey,
    TEMPLATE_SEND_TIMEOUT_MS,
  );
  const text = await res.text();
  let json: { type?: string; message?: string } = {};
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok || json.type === "error") {
    throw new Error(`MSG91 send failed: ${json.message || text || `HTTP ${res.status}`}`);
  }
}
