// ──────────────────────────────────────────────────────────────────
// "Send more of this" — the tool store's stock-order WhatsApp.
// ──────────────────────────────────────────────────────────────────
//
// Daksh, Nov 2026: "for this needs ordering we need a thing we can send
// WhatsApp message [to] some mobile number for stock buy. Like for any
// product we have set warns at 10, then the message will trigger at 10.
// This way owner can directly add mobile number or select user who to
// send message, and how much. On tool store page itself."
//
// So there are two ways one goes out, and they send the SAME message:
//
//   automatic — a take drops a tool to or below its warn line. The
//               crossing is already detected by maybeWarnLowStock() in
//               tools/actions.ts, which has fired an in-app notice to
//               the developer since mig 227. This rides along with it,
//               so a WhatsApp obeys the same once-per-fall rule and
//               cannot spam a supplier on every issue.
//
//   by hand   — the keeper opens "Order stock" on /tools, ticks what he
//               wants and types how many of each.
//
// ── THE TEMPLATE ──────────────────────────────────────────────────
//
// Create it in MSG91 → WhatsApp → Templates, on the same integrated
// number the rest of the app uses. Category UTILITY (this is an
// operational request to a supplier, not marketing — a MARKETING
// template is slower to approve and can be muted by the recipient).
//
//   Name      tool_stock_order
//   Language  English (en)
//   Header    none
//   Footer    none
//   Buttons   none
//   Body
//     Stock needed at MTCPL.
//
//     Item: {{1}}
//     In store now: {{2}}
//     Please send: {{3}}
//
//     Asked by {{4}} — MTCPL CNC tool store.
//
// Sample values for Meta's approval form:
//   {{1}} DSZ 10.4-50(160)   {{2}} 0 pcs (warn line 10)
//   {{3}} 50 pcs             {{4}} low stock alert
//
// The body deliberately opens and closes with fixed text: Meta rejects
// a template whose body starts or ends with a variable, or that puts
// two variables side by side.
//
// Then set MSG91_WA_TOOL_STOCK_TEMPLATE=tool_stock_order on Vercel.
// Until that env var exists NOTHING sends — same dormancy as every
// other WhatsApp feature here (voucher, slab transfer, diary mention).
//
// ── WHY ONE MESSAGE PER ITEM ──────────────────────────────────────
//
// A tempting alternative was one message listing the whole "needs
// ordering" pile. WhatsApp template parameters may not contain a
// newline, a tab, or four consecutive spaces, so a list would have to
// be flattened onto one line — and a supplier reading "DSZ 10.4-50(160)
// 50pcs, DSZ 10.4-30(120) 25pcs, FP 10-25(150) 20pcs" on one line is
// worse off than a supplier reading three short messages he can reply
// to one at a time. The automatic alert is per-item anyway, so this
// keeps both paths on one approved template.

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { normalizeIndianMobile, sendWhatsAppTemplate } from "@/lib/wa-send";

/** app_settings row holding who gets these, and whether they go at all. */
export const WA_TOOL_STOCK_KEY = "wa_tool_stock_order";

export type ToolStockRecipient = {
  /** What to call them on screen. For a picked app user this is their
   *  profile name; for a typed number it is whatever the keeper wrote,
   *  which is usually the supplier's firm. */
  name: string;
  /** Raw digits as entered — normalised only at send time, so a number
   *  saved in a slightly odd shape is still editable rather than lost. */
  number: string;
  /** Set when the row came from the user picker rather than the keypad.
   *  Kept so the list can show "(app user)" and so a future rename could
   *  follow the profile. */
  profileId?: string | null;
};

export type ToolStockOrderSetting = {
  /** Master switch. OFF until somebody turns it on, so installing the
   *  template cannot by itself start messaging suppliers. */
  enabled: boolean;
  /** Also send automatically when a tool crosses its warn line. Separate
   *  from `enabled` on purpose: the keeper may well want the button and
   *  not want the cupboard texting a supplier at 11pm on its own. */
  autoOnLowStock: boolean;
  recipients: ToolStockRecipient[];
};

export const TOOL_STOCK_DEFAULT: ToolStockOrderSetting = {
  enabled: false,
  autoOnLowStock: false,
  recipients: [],
};

const digits = (n: string) => String(n ?? "").replace(/\D/g, "");

export async function getToolStockOrder(): Promise<ToolStockOrderSetting> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_TOOL_STOCK_KEY)
      .maybeSingle();
    const v = data?.value as Partial<ToolStockOrderSetting> | null;
    if (v && typeof v.enabled === "boolean") {
      const list = Array.isArray(v.recipients) ? v.recipients : [];
      return {
        enabled: v.enabled,
        autoOnLowStock: v.autoOnLowStock === true,
        recipients: list
          .map((r) => ({
            name: typeof r?.name === "string" ? r.name.trim().slice(0, 60) : "",
            number: digits(typeof r?.number === "string" ? r.number : ""),
            profileId: typeof r?.profileId === "string" ? r.profileId : null,
          }))
          .filter((r) => r.number.length >= 10),
      };
    }
  } catch {
    /* fall through to the default — a settings read must never 500 the
       store page, which is what shows the button in the first place. */
  }
  return { ...TOOL_STOCK_DEFAULT };
}

export async function saveToolStockOrder(
  next: ToolStockOrderSetting,
  updatedBy: string,
): Promise<{ ok: true; value: ToolStockOrderSetting } | { ok: false; error: string }> {
  const recipients: ToolStockRecipient[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(next.recipients) ? next.recipients : []) {
    const number = digits(r?.number ?? "");
    if (number.length < 10 || number.length > 12) {
      return { ok: false, error: `"${r?.name || number}" is not a valid 10-digit mobile number.` };
    }
    if (!normalizeIndianMobile(number)) {
      return { ok: false, error: `${number} does not look like an Indian mobile number.` };
    }
    const key = number.slice(-10); // 9468529933 and 919468529933 are one man
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      name: (r?.name ?? "").trim().slice(0, 60) || number,
      number,
      profileId: r?.profileId ?? null,
    });
  }
  if (next.enabled && recipients.length === 0) {
    return { ok: false, error: "Add at least one number before turning this on." };
  }

  const value: ToolStockOrderSetting = {
    enabled: !!next.enabled,
    autoOnLowStock: !!next.autoOnLowStock,
    recipients,
  };
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: WA_TOOL_STOCK_KEY,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value };
}

/**
 * Make a string safe to hand WhatsApp as a template parameter.
 *
 * Meta rejects the whole message — not the character — if a parameter
 * carries a newline, a tab, or four consecutive spaces, and it rejects
 * an EMPTY parameter too. A tool named over two lines, or a blank "who
 * asked", would therefore fail the send rather than look untidy, so
 * both are handled here instead of at four call sites.
 */
export function waSafe(raw: string, fallback: string, max = 160): string {
  const flat = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
  return flat || fallback;
}

export type ToolStockOrderLine = {
  /** The tool as the shelf names it. */
  toolName: string;
  /** What is on the shelf right now, with its unit — "0 pcs". */
  stockLabel: string;
  /** How many to send — "50 pcs", or the honest "please confirm
   *  quantity" when the keeper did not name one. */
  needLabel: string;
};

/**
 * Send one stock request per line, to every recipient at once.
 *
 * Never throws: both callers are in the middle of something the user
 * cares about far more than a WhatsApp (recording a take; closing a
 * sheet), and a failed send is reported, not fatal.
 */
export async function sendToolStockOrder(opts: {
  lines: ToolStockOrderLine[];
  /** "DAKSH", or "low stock alert" when the cupboard sent it itself. */
  askedBy: string;
  /** Normalised 91XXXXXXXXXX numbers. Empty = nothing to do. */
  to: string[];
}): Promise<{ sent: number; failed: number; reason?: string }> {
  const template = (process.env.MSG91_WA_TOOL_STOCK_TEMPLATE ?? "").trim();
  if (!template) {
    return { sent: 0, failed: 0, reason: "The WhatsApp template is not set up yet (MSG91_WA_TOOL_STOCK_TEMPLATE)." };
  }
  if (opts.to.length === 0) return { sent: 0, failed: 0, reason: "No one is set to receive these." };
  if (opts.lines.length === 0) return { sent: 0, failed: 0, reason: "Nothing was selected." };

  let sent = 0;
  let failed = 0;
  let reason: string | undefined;
  for (const line of opts.lines) {
    try {
      await sendWhatsAppTemplate({
        to: opts.to,
        templateName: template,
        components: {
          body_1: { type: "text", value: waSafe(line.toolName, "a tool from the store") },
          body_2: { type: "text", value: waSafe(line.stockLabel, "none left") },
          body_3: { type: "text", value: waSafe(line.needLabel, "please confirm quantity") },
          body_4: { type: "text", value: waSafe(opts.askedBy, "MTCPL tool store", 60) },
        },
      });
      sent += 1;
    } catch (e) {
      failed += 1;
      if (!reason) reason = e instanceof Error ? e.message : "WhatsApp send failed.";
    }
  }
  return { sent, failed, reason };
}

/** The numbers an order should go to right now, already normalised.
 *  Empty whenever the feature is off or nobody is listed. */
export async function toolStockRecipients(
  opts: { auto: boolean } = { auto: false },
): Promise<{ to: string[]; setting: ToolStockOrderSetting }> {
  const setting = await getToolStockOrder();
  if (!setting.enabled) return { to: [], setting };
  if (opts.auto && !setting.autoOnLowStock) return { to: [], setting };
  const to = setting.recipients
    .map((r) => normalizeIndianMobile(r.number))
    .filter((n): n is string => !!n);
  return { to, setting };
}
