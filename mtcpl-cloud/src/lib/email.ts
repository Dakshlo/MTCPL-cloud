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
  /** Optional Content-ID for inline references. When set, the email
   *  body can reference this attachment via <img src="cid:<id>"> —
   *  reliable across Gmail / Outlook / Apple Mail (remote <img src>
   *  URLs often get blocked or 404 on mobile, which is what
   *  happened in the first cut). */
  contentId?: string;
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
      body.attachments = payload.attachments.map((a) => {
        const out: Record<string, unknown> = {
          filename: a.filename,
          content: a.content,
        };
        // Resend uses snake_case content_id for inline attachments.
        // When set, an <img src="cid:<id>"> in the HTML body
        // resolves to this attachment without ever fetching a
        // remote URL — bulletproof across email clients.
        if (a.contentId) out.content_id = a.contentId;
        return out;
      });
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

/** Renders the HTML email body for a payment voucher. Daksh (Mig 058
 *  follow-on) asked for a less-boring layout: branded dark header
 *  with logo, big hero amount block, highlight on key reference IDs
 *  (bill token + vendor bill no), cleaner footer.
 *
 *  Logo: pass a `logoCid` (the Content-ID of an inline attachment).
 *  The body references it as `<img src="cid:<id>">`. The earlier
 *  remote-URL variant was unreliable — mobile Gmail blocked /
 *  failed to load `https://…/logo-dark.png`. CID-embedded inline
 *  attachments always render. If `logoCid` is omitted, the email
 *  falls back to a first-letter chip (graceful degradation).
 */
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
  /** Content-ID of the logo attachment, referenced as cid:<id>. */
  logoCid?: string;
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
  const amountFmt = input.paidAmount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const amountStr = `INR ${amountFmt}`;
  const inrInline = `&#8377; ${amountFmt}`; // ₹ entity for HTML

  const logoBlock = input.logoCid
    ? `<img src="cid:${escapeHtml(input.logoCid)}" alt="${escapeHtml(input.companyName)}" width="42" height="42" style="display:block;border-radius:8px;background:#ffffff;padding:6px;">`
    : `<div style="width:42px;height:42px;border-radius:8px;background:#ffffff;color:#0f172a;display:inline-block;line-height:42px;text-align:center;font-weight:800;font-size:18px;">${escapeHtml(input.companyName.slice(0, 1))}</div>`;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#f1f5f9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06);">

          <!-- Dark header band: logo + company -->
          <tr>
            <td style="padding:22px 28px;background:#0f172a;color:#ffffff;">
              <table cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td style="vertical-align:middle;width:54px;">${logoBlock}</td>
                  <td style="vertical-align:middle;padding-left:14px;">
                    <div style="font-size:15px;font-weight:800;color:#ffffff;letter-spacing:-0.005em;">${escapeHtml(input.companyName)}</div>
                    <div style="font-size:11px;color:#94a3b8;margin-top:3px;">${input.companyAddressLines.map(escapeHtml).join(" · ")}</div>
                  </td>
                  <td style="vertical-align:middle;text-align:right;font-size:10px;font-weight:700;color:#fbbf24;letter-spacing:0.1em;text-transform:uppercase;">
                    Payment<br/>Notification
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO amount band -->
          <tr>
            <td style="padding:28px 28px 18px;background:linear-gradient(180deg,#fffbeb 0%,#ffffff 100%);border-bottom:1px solid #f1f5f9;">
              <div style="font-size:11px;font-weight:800;color:#92400e;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Amount transferred</div>
              <div style="font-family:'Courier New',monospace;font-size:38px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;line-height:1.1;">
                ${inrInline}
              </div>
              <div style="font-size:12px;color:#78350f;font-style:italic;margin-top:6px;">
                ${escapeHtml(input.amountInWords)}
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 28px 4px;">
              <h1 style="margin:0 0 12px;font-size:18px;color:#0f172a;font-weight:700;">Dear ${escapeHtml(input.vendorName)},</h1>
              <p style="font-size:14px;line-height:1.65;color:#334155;margin:0 0 22px;">
                We have transferred <strong style="color:#0f172a;">${amountStr}</strong> against your bill
                <code style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${escapeHtml(input.vendorBillNo)}</code>
                on <strong style="color:#0f172a;">${paidAtIst}</strong>.
              </p>

              <!-- Details -->
              <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin-bottom:22px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                ${detailRow("Amount paid", `<strong style="font-family:'Courier New',monospace;color:#0f172a;">${escapeHtml(amountStr)}</strong>`, true)}
                ${detailRow("Payment method", `<span style="font-weight:700;color:#0f172a;">${escapeHtml((input.paymentMethod ?? "—").toUpperCase())}</span>`)}
                ${detailRow("UTR / Reference", `<span style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${escapeHtml(input.paymentReference ?? "—")}</span>`, true)}
                ${detailRow("Bill token (our ref)", `<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${escapeHtml(input.billToken)}</span>`)}
                ${detailRow("Vendor bill no.", `<span style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:5px;font-family:'Courier New',monospace;font-weight:700;">${escapeHtml(input.vendorBillNo)}</span>`, true)}
                ${detailRow("Payment date", `<strong style="color:#0f172a;">${paidAtIst}</strong>`)}
              </table>

              <!-- Reassurance -->
              <div style="padding:14px 16px;background:#f1f5f9;border-left:3px solid #4f46e5;border-radius:6px;margin-bottom:8px;">
                <div style="font-size:13px;line-height:1.6;color:#334155;">
                  A formal payment voucher PDF is attached for your records. If you spot any discrepancy,
                  reply to this email and we'll reconcile.
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;background:#0f172a;color:#94a3b8;font-size:11px;line-height:1.6;">
              <strong style="color:#ffffff;">${escapeHtml(input.companyName)}</strong><br/>
              ${input.companyAddressLines.map(escapeHtml).join(", ")}<br/>
              <a href="mailto:account@mtcpl.co" style="color:#fbbf24;text-decoration:none;">account@mtcpl.co</a> · automated payment notification
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function detailRow(label: string, valueHtml: string, alt = false): string {
  const bg = alt ? "#f8fafc" : "#ffffff";
  return `<tr>
    <td style="padding:10px 14px;color:#64748b;width:200px;background:${bg};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</td>
    <td style="padding:10px 14px;background:${bg};">${valueHtml}</td>
  </tr>`;
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
    `Amount paid:     ${amount}`,
    `In words:        ${input.amountInWords}`,
    `Method:          ${input.paymentMethod ?? "—"}`,
    `UTR / Ref:       ${input.paymentReference ?? "—"}`,
    `Bill token:      ${input.billToken}`,
    `Vendor bill no.: ${input.vendorBillNo}`,
    `Payment date:    ${input.paidAtIso ? input.paidAtIso.slice(0, 10) : "—"}`,
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
