/**
 * GET /api/salary/hdfc-export?month=YYYY-MM&batch=<batch-id>
 *
 * Employees dept HDFC bulk-payment sheet (mig 189 + 193, Daksh Jul 2026) — the
 * SAME ENet upload format Finance uses for vendor payments
 * (/api/accounts/hdfc-payment-export), which itself mirrors HDFC's working
 * salary-file template:
 *
 *   Sheet "Bulk Payment", 9 columns —
 *   CBX Reference number (bank fills) · Transfer From (picked in ENet) ·
 *   Transfer To (employee a/c) · Amount (net pay) · Initiation date ·
 *   Value date · Beneficiary name (UPPERCASE, must match the ENet
 *   Beneficiary Master) · Input user (bank) · Input Date time (bank).
 *
 * Mig 193 — the sheet is generated PER BATCH (`batch` param):
 *   • rows = that batch's DRAFT rows;
 *   • pre-flight refuses on missing bank details, and on by-attendance
 *     employees whose attendance isn't recorded yet (net 0);
 *   • generating ATOMICALLY stamps the batch's hdfc_generated_at ("IN HDFC
 *     FILE") — a second download attempt gets a 409, so the same batch can
 *     never be exported twice → no duplicate payment. Owner/developer can
 *     re-allow via unlockBatchHdfcAction.
 * Without `batch` (legacy months) only UNBATCHED draft rows are included, so
 * batched rows can never leak into a month-wide file.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireAuth } from "@/lib/auth";
import { canUseSalary } from "@/lib/salary-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** DD/MM/YYYY HH:MM:SS AM/PM — matches the finance ENet sheet exactly. */
function initiationStamp(d: Date): string {
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(h)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}
/** DD-MM-YYYY value date — same as the finance sheet. */
function valueStamp(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

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
      .select("id, net, gross, status, batch_id, attendance_days, salary_employees(name, beneficiary_name, account_number, bank_name, salary_type)")
      .eq("status", "draft");
    q = batchId ? q.eq("batch_id", batchId) : q.eq("month", month).is("batch_id", null);
    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type Emp = { name: string; beneficiary_name: string | null; account_number: string | null; bank_name: string | null; salary_type: string | null };
    type Row = { id: string; net: number; attendance_days: number | null; salary_employees: Emp | Emp[] | null };
    const rows = ((data ?? []) as unknown as Row[]).map((r) => {
      const e = Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees;
      return {
        id: r.id,
        net: Number(r.net) || 0,
        attendance: r.attendance_days,
        variable: (e?.salary_type ?? "fixed") === "variable",
        name: e?.name ?? "—",
        beneficiary: (e?.beneficiary_name ?? e?.name ?? "").trim().toUpperCase(),
        account: (e?.account_number ?? "").trim(),
      };
    });

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No DRAFT rows to pay here — prepare a batch first (or everything is already paid)." }, { status: 400 });
    }
    // Pre-flight 1 — bank details (HDFC rejects the whole file otherwise).
    const missing = rows.filter((r) => !r.account || !r.beneficiary).map((r) => r.name);
    if (missing.length > 0) {
      return NextResponse.json({ ok: false, error: `Incomplete info (bank details) for: ${missing.join(", ")}. Fill account number + beneficiary name on the employee first.` }, { status: 400 });
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
      // ── Build the sheet — EXACT ENet Bulk Payment layout. ──────────
      const now = new Date();
      const initiation = initiationStamp(now);
      const value = valueStamp(now);
      const sheetRows = rows.map((r) => ({
        "CBX Reference number": "",
        "Transfer From": "",
        "Transfer To": r.account,
        "Amount": r.net,
        "Initiation date": initiation,
        "Value date": value,
        "Beneficiary name": r.beneficiary,
        "Input user": "",
        "Input Date time": "",
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws, "Bulk Payment");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

      const totalInr = rows.reduce((a, r) => a + r.net, 0);
      void logAudit(profile.id, "salary_hdfc_export_generated", batchId ? "salary_batch" : "salary_month", batchId ?? month, { month, rows: rows.length, total_inr: totalInr });

      const fname = `salary-bulk-payment-${m[1]}-${m[2]}${batchId ? `-batch-${batchId.slice(0, 8)}` : ""}.xlsx`;
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fname}"`,
          "Cache-Control": "no-store, must-revalidate",
        },
      });
    } catch (buildErr) {
      // Building failed AFTER the claim — release the lock so the batch isn't
      // stuck showing "IN HDFC FILE" for a file that never existed.
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
