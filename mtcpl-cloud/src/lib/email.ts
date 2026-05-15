// ──────────────────────────────────────────────────────────────────
// Email helper — sends payment voucher to vendors via Resend
// ──────────────────────────────────────────────────────────────────
// Uses Resend's HTTP API directly via fetch — no SDK dependency.
// API: https://resend.com/docs/api-reference/emails/send-email
//
// Activation requires:
//   1. RESEND_API_KEY env var set on Vercel (sign up at resend.com,
//      free tier covers 3000 emails/month).
//   2. Domain mtcpl.co verified in Resend dashboard (add DNS
//      records they show you).
//   3. A real mailbox at account@mtcpl.co (or wherever EMAIL_FROM
//      points) so vendor replies land somewhere.
//
// Until the env var is set, sendVendorPaymentEmail() silently
// no-ops and logs to console — payment marking always succeeds
// regardless of email outcome.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Default From address — override with EMAIL_FROM env var if you
 *  ever change the mailbox. The display name renders as "MTCPL
 *  Accounts" in most clients. */
const DEFAULT_FROM = "MTCPL Accounts <account@mtcpl.co>";

export type EmailAttachment = {
  filename: string;
  /** Base64 content. For pdf-lib Uint8Array, call Buffer.from(...).toString('base64'). */
  content: string;
};

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback for email clients that don't render HTML.
   *  Resend recommends always providing one. */
  text?: string;
  attachments?: EmailAttachment[];
  /** Optional reply-to address — useful if FROM is a no-reply but
   *  you want a real address to receive replies. */
  replyTo?: string;
};

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string; skipped?: boolean };

/** Send one email via Resend. Returns a tagged result; never throws.
 *  When RESEND_API_KEY is missing, returns ok:false + skipped:true
 *  so the caller can distinguish "intentionally not sent" from
 *  "send failed." */
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[email] RESEND_API_KEY not set — skipping email to",
      payload.to,
    );
    return {
      ok: false,
      skipped: true,
      error: "RESEND_API_KEY not configured",
    };
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  try {
    const body: Record<string, unknown> = {
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    };
    if (payload.text) body.text = payload.text;
    if (payload.replyTo) body.reply_to = payload.replyTo;
    if (payload.attachments && payload.attachments.length > 0) {
      body.attachments = payload.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      }));
    }

    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      return {
        ok: false,
        error: `Resend HTTP ${r.status}: ${errBody.slice(0, 200)}`,
      };
    }
    const json = (await r.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? "unknown" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown email error",
    };
  }
}

/** Renders a simple HTML email body for the payment voucher. Kept
 *  inline + small so it works without external image hosts. */
export function buildVoucherEmailHtml(input: {
  vendorName: string;
  billToken: string;
  vendorBillNo: string;
  paidAmount: number;
  amountInWords: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  paidAtIso: string | null;
  companyName: string;
  companyAddressLines: string[];
}): string {
  const paidAtIst = input.paidAtIso
    ? new Date(
        new Date(input.paidAtIso).getTime() + 5.5 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10)
        .split("-")
        .reverse()
        .join("/")
    : "—";
  const amountStr = `INR ${input.paidAmount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px;border-bottom:1px solid #e5e7eb;background:#fffbeb;">
              <div style="font-size:18px;font-weight:700;color:#92400e;">${escapeHtml(input.companyName)}</div>
              <div style="font-size:12px;color:#78350f;margin-top:4px;">${input.companyAddressLines.map(escapeHtml).join(", ")}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;">Payment Voucher</div>
              <h1 style="margin:6px 0 18px;font-size:22px;color:#111827;">Dear ${escapeHtml(input.vendorName)},</h1>
              <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 18px;">
                We have transferred <strong>${amountStr}</strong> against your bill
                <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-family:monospace;">${escapeHtml(input.vendorBillNo)}</code>
                on ${paidAtIst}.
              </p>

              <table cellpadding="6" cellspacing="0" style="width:100%;font-size:13px;margin-bottom:18px;">
                <tr>
                  <td style="color:#6b7280;width:200px;">Amount paid</td>
                  <td style="font-weight:700;color:#111827;">${amountStr}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;">Payment method</td>
                  <td style="font-weight:600;color:#111827;">${escapeHtml((input.paymentMethod ?? "—").toUpperCase())}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;">UTR / Reference</td>
                  <td style="font-weight:600;color:#111827;font-family:monospace;">${escapeHtml(input.paymentReference ?? "—")}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;">Bill token (our ref)</td>
                  <td style="font-weight:600;color:#111827;font-family:monospace;">${escapeHtml(input.billToken)}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;">Payment date</td>
                  <td style="font-weight:600;color:#111827;">${paidAtIst}</td>
                </tr>
              </table>

              <div style="padding:12px 14px;background:#fef3c7;border-left:4px solid #d97706;border-radius:6px;margin-bottom:18px;">
                <div style="font-size:11px;font-weight:700;color:#78350f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Amount in words</div>
                <div style="font-size:13px;color:#451a03;font-style:italic;">${escapeHtml(input.amountInWords)}</div>
              </div>

              <p style="font-size:13px;line-height:1.6;color:#4b5563;margin:0 0 4px;">
                A formal payment voucher PDF is attached for your records.
              </p>
              <p style="font-size:13px;line-height:1.6;color:#4b5563;margin:0;">
                If you spot any discrepancy, please reply to this email and we'll
                reconcile.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
              ${escapeHtml(input.companyName)} · account@mtcpl.co<br/>
              This is an automated payment notification.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text fallback body — short and to the point. */
export function buildVoucherEmailText(input: {
  vendorName: string;
  billToken: string;
  vendorBillNo: string;
  paidAmount: number;
  amountInWords: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  paidAtIso: string | null;
  companyName: string;
}): string {
  const amount = `INR ${input.paidAmount.toLocaleString("en-IN")}`;
  return [
    `Dear ${input.vendorName},`,
    ``,
    `We have transferred ${amount} against your bill ${input.vendorBillNo}.`,
    ``,
    `Amount paid:   ${amount}`,
    `In words:      ${input.amountInWords}`,
    `Method:        ${input.paymentMethod ?? "—"}`,
    `UTR / Ref:     ${input.paymentReference ?? "—"}`,
    `Bill token:    ${input.billToken}`,
    `Payment date:  ${input.paidAtIso ? input.paidAtIso.slice(0, 10) : "—"}`,
    ``,
    `Voucher PDF attached. Reply to this email if anything looks off.`,
    ``,
    `— ${input.companyName}`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
