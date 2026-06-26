// ──────────────────────────────────────────────────────────────────
// Cutting-approved WhatsApp alert — Daksh, June 2026.
//
// When a cutting audit is APPROVED, a configured mobile number gets a
// WhatsApp message: cutter operator, block number, the slabs that came
// out (codes) + their location, with a PDF attached carrying the full
// per-slab detail (size, label, description, category).
//
// Mirrors the vendor-payment voucher pattern: build a PDF (reuses the
// Cutting-Done generator) → upload to the public whatsapp_reports bucket
// → send the approved MSG91 template (header = document, body = summary).
// Gated on env MSG91_WA_CUTTING_TEMPLATE — dormant until that's set, so
// it never sends by accident before the template is approved.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// ── Recipients (app_settings → env → default) ──────────────────────
export const WA_CUTTING_SETTINGS_KEY = "wa_cutting_recipients";
export const WA_CUTTING_DEFAULT_RECIPIENTS = ["8003689760"];

const digits = (n: string) => String(n).replace(/\D/g, "");

/** Raw 10-digit recipient list. Precedence: app_settings → env → default. */
export async function getCuttingAlertRecipients(): Promise<string[]> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_CUTTING_SETTINGS_KEY)
      .maybeSingle();
    const nums = (data?.value as { numbers?: unknown } | null)?.numbers;
    if (Array.isArray(nums)) {
      const clean = nums.map(digits).filter(Boolean);
      if (clean.length > 0) return clean;
    }
  } catch {
    /* fall through to env / default */
  }
  const raw = process.env.MSG91_WA_CUTTING_TO;
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : WA_CUTTING_DEFAULT_RECIPIENTS;
  return list.map(digits).filter(Boolean);
}

export async function saveCuttingAlertRecipients(
  numbers: string[],
  updatedBy: string,
): Promise<{ ok: true; numbers: string[] } | { ok: false; error: string }> {
  const clean = [...new Set((Array.isArray(numbers) ? numbers : []).map(digits).filter((n) => n.length >= 10 && n.length <= 12))];
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: WA_CUTTING_SETTINGS_KEY,
    value: { numbers: clean },
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, numbers: clean };
}

// ── Per-operator phones (operator_id → mobile) ─────────────────────
// So each cutter operator ALSO gets their own block's message, while the
// master recipients above get every block. Stored as a map keyed by
// operators.id; operator-less blocks just go to the master list.
export const WA_CUTTING_OPERATOR_PHONES_KEY = "wa_cutting_operator_phones";

export async function getOperatorPhones(): Promise<Record<string, string>> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", WA_CUTTING_OPERATOR_PHONES_KEY)
      .maybeSingle();
    const v = (data?.value as { phones?: Record<string, unknown> } | null)?.phones;
    if (v && typeof v === "object") {
      const out: Record<string, string> = {};
      for (const [id, num] of Object.entries(v)) {
        const d = digits(typeof num === "string" ? num : "");
        if (id && d) out[id] = d;
      }
      return out;
    }
  } catch {
    /* default empty */
  }
  return {};
}

export async function saveOperatorPhones(
  phones: Record<string, string>,
  updatedBy: string,
): Promise<{ ok: true; phones: Record<string, string> } | { ok: false; error: string }> {
  const clean: Record<string, string> = {};
  for (const [id, num] of Object.entries(phones ?? {})) {
    const d = digits(num);
    if (id && d.length >= 10 && d.length <= 12) clean[id] = d;
  }
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_settings").upsert({
    key: WA_CUTTING_OPERATOR_PHONES_KEY,
    value: { phones: clean },
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, phones: clean };
}

// ── Send ───────────────────────────────────────────────────────────

// Every slab that physically came out of a block, regardless of how it
// got there (planned / +ADDED / transferred). Same set the done-pdf uses.
const POST_CUT_STATUSES = [
  "cut_done",
  "carving_assigned",
  "carving_in_progress",
  "completed",
  "dispatched",
  "rejected",
] as const;

function fmtIstDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Fire-and-forget: send the cutting-approved WhatsApp for one just-approved
 * cut_session_block. NEVER throws (callers are fire-and-forget). Silently
 * no-ops (with an audit row) when the template env or recipients are absent.
 */
export async function sendCuttingApprovedWhatsApp(
  sessionBlockId: string,
  actorId: string,
): Promise<void> {
  try {
    const templateName = process.env.MSG91_WA_CUTTING_TEMPLATE;
    if (!templateName || !process.env.MSG91_AUTH_KEY) {
      await logAudit(actorId, "cut_approval_wa_skipped", "cut_session_block", sessionBlockId, {
        reason: !templateName ? "MSG91_WA_CUTTING_TEMPLATE not configured" : "MSG91_AUTH_KEY not configured",
      });
      return;
    }

    const admin = createAdminSupabaseClient();

    const { data: csb } = await admin
      .from("cut_session_blocks")
      .select("id, block_id, updated_at, cut_session_id, layout, operator_id, approved_by")
      .eq("id", sessionBlockId)
      .maybeSingle();
    if (!csb) {
      await logAudit(actorId, "cut_approval_wa_skipped", "cut_session_block", sessionBlockId, { reason: "block row missing" });
      return;
    }
    const block = csb as {
      id: string; block_id: string; updated_at: string | null; cut_session_id: string;
      layout: { blk?: { stone?: string; yard?: number; l?: number; w?: number; h?: number } } | null;
      operator_id: string | null; approved_by: string | null;
    };

    // Slabs that came out of this block (every post-cut status, any link path).
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, temple, length_ft, width_ft, thickness_ft, label, description, additional_description, component_section, component_element, stock_location")
      .eq("source_block_id", block.block_id)
      .in("status", [...POST_CUT_STATUSES]);
    const slabs = ((slabRows ?? []) as Array<Record<string, unknown>>)
      .map((s) => ({
        id: s.id as string,
        temple: (s.temple as string | null) ?? "-",
        length_ft: Number(s.length_ft) || 0,
        width_ft: Number(s.width_ft) || 0,
        thickness_ft: Number(s.thickness_ft) || 0,
        label: (s.label as string | null) ?? null,
        description: (s.description as string | null) ?? null,
        additional: (s.additional_description as string | null) ?? null,
        section: (s.component_section as string | null) ?? null,
        element: (s.component_element as string | null) ?? null,
        stock_location: (s.stock_location as string | null) ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (slabs.length === 0) {
      await logAudit(actorId, "cut_approval_wa_skipped", "cut_session_block", sessionBlockId, { reason: "no slabs cut", block: block.block_id });
      return;
    }

    // Block meta + people.
    const [{ data: blockMeta }, { data: opRow }, { data: sessRow }] = await Promise.all([
      admin.from("blocks").select("stone, tonnes, yard").eq("id", block.block_id).maybeSingle(),
      block.operator_id
        ? admin.from("operators").select("name").eq("id", block.operator_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("cut_sessions").select("session_code, planned_by").eq("id", block.cut_session_id).maybeSingle(),
    ]);
    const meta = (blockMeta ?? {}) as { stone?: string | null; tonnes?: number | string | null; yard?: number | null };
    const operatorName = (opRow as { name?: string | null } | null)?.name ?? "-";
    const session = (sessRow ?? {}) as { session_code?: string | null; planned_by?: string | null };

    const { getProfilesMap } = await import("@/lib/profiles");
    const profilesMap = await getProfilesMap();
    const plannerName = session.planned_by ? profilesMap[session.planned_by] ?? "-" : "-";
    const approvedByName = block.approved_by ? profilesMap[block.approved_by] ?? "-" : "-";

    const tonnes = meta.tonnes != null ? Number(meta.tonnes) : null;
    const blk = block.layout?.blk;
    const blockDims = tonnes && tonnes > 0
      ? `${tonnes.toFixed(3)} T`
      : blk?.l && blk?.w && blk?.h ? `${blk.l}×${blk.w}×${blk.h}″` : "-";

    // Build the PDF (single block) via the shared Cutting-Done generator.
    const { generateCuttingDonePdf } = await import("@/lib/cutting-done-pdf");
    const generatedAt = fmtIstDateTime(new Date().toISOString());
    const pdfBytes = await generateCuttingDonePdf({
      title: `Block ${block.block_id} — cutting approved`,
      subtitle: `${slabs.length} slab${slabs.length === 1 ? "" : "s"} cut · ${meta.stone ?? blk?.stone ?? "-"}`,
      generatedAt,
      generatedBy: approvedByName,
      blocks: [{
        cutSessionBlockId: block.id,
        blockCode: block.block_id,
        stone: meta.stone ?? blk?.stone ?? "-",
        yard: `Yard ${meta.yard ?? blk?.yard ?? "-"}`,
        blockDims,
        cutDate: fmtIstDateTime(block.updated_at),
        operator: operatorName,
        planGenerator: plannerName,
        sessionCode: session.session_code ?? "-",
        approvedBy: approvedByName,
        slabs: slabs.map((s) => ({
          id: s.id,
          temple: s.temple,
          dims: `${s.length_ft}×${s.width_ft}×${s.thickness_ft}″`,
          label: s.label,
          description: s.description,
          additional: s.additional,
          section: s.section,
          element: s.element,
        })),
      }],
    });

    // Upload → public URL (WhatsApp documents need a fetchable URL).
    const objectPath = `cutting/${block.block_id}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await admin.storage
      .from("whatsapp_reports")
      .upload(objectPath, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: false });
    if (upErr) {
      await logAudit(actorId, "cut_approval_wa_failed", "cut_session_block", sessionBlockId, { reason: `pdf upload failed: ${upErr.message}` });
      return;
    }
    const pdfUrl = admin.storage.from("whatsapp_reports").getPublicUrl(objectPath).data.publicUrl;

    // Recipients = the master list (gets EVERY block) + this block's own
    // operator (gets only their blocks), if a phone is on file for them.
    const { normalizeIndianMobile } = await import("@/lib/wa-send");
    const masterRaw = await getCuttingAlertRecipients();
    let operatorRaw: string[] = [];
    if (block.operator_id) {
      const phones = await getOperatorPhones();
      const own = phones[block.operator_id];
      if (own) operatorRaw = [own];
    }
    const to = [...new Set([...masterRaw, ...operatorRaw].map((n) => normalizeIndianMobile(n)).filter((n): n is string => !!n))];
    if (to.length === 0) {
      await logAudit(actorId, "cut_approval_wa_skipped", "cut_session_block", sessionBlockId, { reason: "no valid recipient configured" });
      return;
    }

    // Body summary. Codes capped so a big block doesn't overflow the param;
    // the PDF carries the full list anyway.
    const codes = slabs.map((s) => s.id);
    const codesText = codes.length <= 12 ? codes.join(", ") : `${codes.slice(0, 12).join(", ")} +${codes.length - 12} more`;
    const locations = [...new Set(slabs.map((s) => (s.stock_location ?? "").trim()).filter(Boolean))];
    const locationText = locations.length > 0 ? locations.join(", ") : "-";

    const { sendWhatsAppTemplate } = await import("@/lib/wa-send");
    await sendWhatsAppTemplate({
      to,
      templateName,
      components: {
        header_1: { type: "document", value: pdfUrl, filename: `Cutting-${block.block_id}.pdf` },
        body_1: { type: "text", value: operatorName },                 // cutter operator
        body_2: { type: "text", value: block.block_id },               // block number
        body_3: { type: "text", value: String(slabs.length) },         // how many slabs
        body_4: { type: "text", value: codesText },                    // their codes
        body_5: { type: "text", value: locationText },                 // their location(s)
      },
    });

    await logAudit(actorId, "cut_approval_wa_sent", "cut_session_block", sessionBlockId, {
      block: block.block_id, operator: operatorName, slab_count: slabs.length, to,
      operator_phoned: operatorRaw.length > 0,
    });
  } catch (e) {
    console.warn("[sendCuttingApprovedWhatsApp] failed", e);
    try {
      await logAudit(actorId, "cut_approval_wa_failed", "cut_session_block", sessionBlockId, {
        error: e instanceof Error ? e.message : String(e),
      });
    } catch {
      /* final swallow */
    }
  }
}
