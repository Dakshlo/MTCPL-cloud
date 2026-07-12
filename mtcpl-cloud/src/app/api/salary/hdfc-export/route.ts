/**
 * GET /api/salary/hdfc-export?month=YYYY-MM&batch=<batch-id>
 *
 * Employees dept HDFC bulk-payment CSV (mig 189 + 193/194, Daksh Jul 2026).
 *
 * Produces the EXACT SAME .001 CSV as Finance's vendor-payment export
 * (src/lib/hdfc-export.ts — 28 columns, no header, quoted fields, CRLF, HDFC
 * client-code filename), so the same ENet upload tool eats it. Salary net pay
 * is the amount; employee bank + beneficiary name feed the bene columns.
 *
 * Per BATCH (`batch` param): rows = that batch's DRAFT rows; pre-flight refuses
 * on missing bank / by-attendance-without-attendance / zero net; generating
 * ATOMICALLY stamps the batch hdfc_generated_at so it can't be exported twice.
 * Without `batch` (legacy months) only UNBATCHED draft rows are included.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { canUseSalary } from "@/lib/salary-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { buildHdfcCsvFile, buildHdfcFilename, type HdfcExportRow } from "@/lib/hdfc-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();
    if (!canUseSalary(profile)) {
      return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
    }

    const raw = (req.nextUrl.searchParams.get("month") ?? "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (!m) return NextResponse.json({ ok: false, error: "Pass ?month=YYYY-MM" }, { status: 400 });
    const month = `${m[1]}-${m[2]}-01`;
    const batchId = (req.nextUrl.searchParams.get("batch") ?? "").trim() || null;

    const admin = createAdminSupabaseClient();

    // Batch mode: the batch must exist and must NOT already be in an HDFC file.
    if (batchId) {
      const { data: batch, error: bErr } = await admin
        .from("salary_batches").select("id, status, hdfc_generated_at").eq("id", batchId).maybeSingle();
      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
      if (!batch) return NextResponse.json({ ok: false, error: "Batch not found." }, { status: 404 });
      const b = batch as { status: string; hdfc_generated_at: string | null };
      if (b.status === "paid") return NextResponse.json({ ok: false, error: "This batch is already PAID." }, { status: 409 });
      if (b.hdfc_generated_at) {
        return NextResponse.json({ ok: false, error: "This batch is already IN an HDFC FILE — re-downloading is blocked to prevent a duplicate payment. Owner can re-allow it if the file was lost." }, { status: 409 });
      }
    }

    let q = admin
      .from("salary_payments")
      .select("id, net, status, batch_id, attendance_days, salary_employees(name, beneficiary_name, account_number, bank_name, ifsc, salary_type)")
      .eq("status", "draft");
    q = batchId ? q.eq("batch_id", batchId) : q.eq("month", month).is("batch_id", null);
    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type Emp = { name: string; beneficiary_name: string | null; account_number: string | null; bank_name: string | null; ifsc: string | null; salary_type: string | null };
    type Row = { id: string; net: number; attendance_days: number | null; salary_employees: Emp | Emp[] | null };
    const rows = ((data ?? []) as unknown as Row[]).map((r) => {
      const e = Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees;
      return {
        net: Number(r.net) || 0,
        attendance: r.attendance_days,
        variable: (e?.salary_type ?? "fixed") === "variable",
        name: e?.name ?? "—",
        beneficiary: (e?.beneficiary_name ?? e?.name ?? "").trim(),
        account: (e?.account_number ?? "").trim(),
        ifsc: (e?.ifsc ?? "").trim().toUpperCase(),
        bank: (e?.bank_name ?? "").trim(),
      };
    });

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No DRAFT rows to pay here — prepare a batch first (or everything is already paid)." }, { status: 400 });
    }
    // Pre-flight 1 — bank details (HDFC rejects the whole file otherwise).
    const missing = rows.filter((r) => !r.account || !r.beneficiary || !r.ifsc).map((r) => r.name);
    if (missing.length > 0) {
      return NextResponse.json({ ok: false, error: `Incomplete info for: ${missing.join(", ")}. Fill account number, IFSC + beneficiary name on the employee first.` }, { status: 400 });
    }
    // Pre-flight 2 — by-attendance employees need their attendance recorded.
    const noAtt = rows.filter((r) => r.variable && r.attendance == null).map((r) => r.name);
    if (noAtt.length > 0) {
      return NextResponse.json({ ok: false, error: `Attendance not recorded for: ${noAtt.join(", ")}. Enter days present on their row first.` }, { status: 400 });
    }
    const zero = rows.filter((r) => !(r.net > 0)).map((r) => r.name);
    if (zero.length > 0) {
      return NextResponse.json({ ok: false, error: `Net pay is 0 for: ${zero.join(", ")}. Fix the row or remove it from the batch.` }, { status: 400 });
    }

    // ── ATOMIC "IN HDFC FILE" claim — only ONE download can ever win. ──
    if (batchId) {
      const { data: claimed, error: cErr } = await admin
        .from("salary_batches")
        .update({ hdfc_generated_at: new Date().toISOString(), hdfc_generated_by: profile.id } as never)
        .eq("id", batchId)
        .is("hdfc_generated_at", null)
        .select("id");
      if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
      if ((claimed ?? []).length === 0) {
        return NextResponse.json({ ok: false, error: "This batch just went into an HDFC file in another tab — blocked to prevent a duplicate payment." }, { status: 409 });
      }
    }

    try {
      const now = new Date();
      const valueDate = now;
      const exportRows: HdfcExportRow[] = rows.map((r) => ({
        hdfcBeneName: r.beneficiary,
        accountNumber: r.account,
        ifsc: r.ifsc,
        bankName: r.bank,
        beneEmail: null, // falls back to the shared HDFC bounce email
        amountInr: r.net,
        valueDate,
      }));

      // Day sequence for the .NNN filename — count today's salary + finance
      // HDFC files (shared client code) so two files the same day never collide.
      const istNowMs = now.getTime() + IST_OFFSET_MS;
      const istMidnightMs = Math.floor(istNowMs / DAY_MS) * DAY_MS;
      const dayStart = new Date(istMidnightMs - IST_OFFSET_MS).toISOString();
      const dayEnd = new Date(istMidnightMs - IST_OFFSET_MS + DAY_MS - 1).toISOString();
      const { count } = await admin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .in("action", ["hdfc_export_generated", "salary_hdfc_export_generated"])
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);
      const daySequence = (count ?? 0) + 1;

      const csv = buildHdfcCsvFile(exportRows);
      const filename = buildHdfcFilename(now, daySequence, "001");

      const totalInr = exportRows.reduce((a, r) => a + r.amountInr, 0);
      void logAudit(profile.id, "salary_hdfc_export_generated", batchId ? "salary_batch" : "salary_month", batchId ?? month, { month, rows: exportRows.length, total_inr: totalInr, filename });

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store, must-revalidate",
        },
      });
    } catch (buildErr) {
      // Building failed AFTER the claim — release the lock so the batch isn't
      // stuck locked for a file that never existed.
      if (batchId) {
        await admin.from("salary_batches")
          .update({ hdfc_generated_at: null, hdfc_generated_by: null } as never)
          .eq("id", batchId)
          .then(() => undefined, () => undefined);
      }
      throw buildErr;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
