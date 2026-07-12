/**
 * GET /api/salary/hdfc-preview-export?month=YYYY-MM&batch=<batch-id>
 *
 * Employees dept — a VIEW copy of a batch's HDFC bulk-payment file in Excel, in
 * the EXACT 28-column HDFC layout (same buildHdfcXlsxBuffer Finance uses, WITH a
 * header row) so the team can eyeball what the .001 CSV will upload — names,
 * bank details, amounts, references — and confirm everything is proper.
 *
 * Unlike the CSV route this is unlocked: NO atomic claim, downloadable any number
 * of times, and it lists every row of the batch (draft AND paid) so it stays
 * useful after payment. Never blocks.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { canUseSalary } from "@/lib/salary-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildHdfcXlsxBuffer, type HdfcExportRow } from "@/lib/hdfc-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();
    if (!canUseSalary(profile)) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });

    const raw = (req.nextUrl.searchParams.get("month") ?? "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (!m) return NextResponse.json({ ok: false, error: "Pass ?month=YYYY-MM" }, { status: 400 });
    const month = `${m[1]}-${m[2]}-01`;
    const mm = `${m[1]}-${m[2]}`;
    const batchId = (req.nextUrl.searchParams.get("batch") ?? "").trim() || null;

    const admin = createAdminSupabaseClient();
    let q = admin
      .from("salary_payments")
      .select("net, salary_employees(name, beneficiary_name, account_number, bank_name, ifsc)");
    q = batchId ? q.eq("batch_id", batchId) : q.eq("month", month).is("batch_id", null);
    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type Emp = { name: string; beneficiary_name: string | null; account_number: string | null; bank_name: string | null; ifsc: string | null };
    type Row = { net: number; salary_employees: Emp | Emp[] | null };
    const now = new Date();
    const named = ((data ?? []) as unknown as Row[]).map((r) => {
      const e = (Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees) ?? ({} as Emp);
      const row: HdfcExportRow = {
        hdfcBeneName: (e.beneficiary_name ?? e.name ?? "").trim(),
        accountNumber: (e.account_number ?? "").trim(),
        ifsc: (e.ifsc ?? "").trim().toUpperCase(),
        bankName: (e.bank_name ?? "").trim(),
        beneEmail: null,
        amountInr: Number(r.net) || 0,
        valueDate: now,
      };
      return { name: e.name ?? "—", row };
    });
    named.sort((a, b) => a.name.localeCompare(b.name));
    const exportRows: HdfcExportRow[] = named.map((n) => n.row);

    if (exportRows.length === 0) {
      return NextResponse.json({ ok: false, error: "No rows in this batch yet." }, { status: 400 });
    }

    const buf = buildHdfcXlsxBuffer(exportRows);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="hdfc-preview-${mm}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
