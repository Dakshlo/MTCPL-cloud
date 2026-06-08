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
//   • Approved template .. "Your MATESHWARI PORTAL login OTP is
//                            {#numeric#} . Valid for 10 minutes.
//                            Do not share it."
//   • The MSG91 flow template id below maps ##var1## -> the OTP.
// The message MUST go out exactly as the registered template or the
// DLT operator blocks it — that's why we send via the template id and
// pass ONLY the numeric code as var1 (never free text).

const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow/";

// Not secret — the approved MSG91 "SEND_OTP" flow/template id.
const OTP_TEMPLATE_ID = "6a252460e3ddb4d18b0c412b";

/** Normalise a mobile to MSG91's "country code + number, no +" form
 *  (e.g. "919876543210"). Accepts +91…, 91…, or a bare 10-digit
 *  Indian number. */
export function toMsg91Mobile(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`; // bare 10-digit → add 91
  return digits; // already carries a country code (e.g. 919876543210)
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

  const res = await fetch(MSG91_FLOW_URL, {
    method: "POST",
    headers: {
      authkey: authKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      template_id: OTP_TEMPLATE_ID,
      short_url: "0",
      realTimeResponse: "1",
      recipients: [{ mobiles, var1: otp }],
    }),
  });

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
