/**
 * GET /api/salary/hdfc-export?month=YYYY-MM
 *
 * Salary department's HDFC bulk-payment sheet (mig 189, Daksh Jul 2026) — the
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
 * Rows = the month's DRAFT salary rows (the ones about to be paid). Pre-flight
 * refuses with a clear list if any included employee is missing bank details.
 * Reads ONLY salary_payments + salary_employees — no other tables touched.
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

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("salary_payments")
      .select("id, net, status, salary_employees(name, beneficiary_name, account_number, bank_name)")
      .eq("month", month)
      .eq("status", "draft");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    type Row = { id: string; net: number; salary_employees: { name: string; beneficiary_name: string | null; account_number: string | null; bank_name: string | null } | Array<{ name: string; beneficiary_name: string | null; account_number: string | null; bank_name: string | null }> | null };
    const rows = ((data ?? []) as Row[]).map((r) => {
      const e = Array.isArray(r.salary_employees) ? r.salary_employees[0] : r.salary_employees;
      return { id: r.id, net: Number(r.net) || 0, name: e?.name ?? "—", beneficiary: (e?.beneficiary_name ?? e?.name ?? "").trim().toUpperCase(), account: (e?.account_number ?? "").trim() };
    });

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No DRAFT salary rows for this month — Prepare the month first (or everything is already paid)." }, { status: 400 });
    }
    // Pre-flight: every row needs an account + beneficiary name (HDFC rejects
    // the whole file otherwise). Refuse with the exact list to fix.
    const missing = rows.filter((r) => !r.account || !r.beneficiary).map((r) => r.name);
    if (missing.length > 0) {
      return NextResponse.json({ ok: false, error: `Missing bank details for: ${missing.join(", ")}. Fill account number + beneficiary name on the employee first.` }, { status: 400 });
    }
    const zero = rows.filter((r) => !(r.net > 0)).map((r) => r.name);
    if (zero.length > 0) {
      return NextResponse.json({ ok: false, error: `Net pay is 0 for: ${zero.join(", ")}. Fix the row or remove it from the month.` }, { status: 400 });
    }

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
    void logAudit(profile.id, "salary_hdfc_export_generated", "salary_month", month, { month, rows: rows.length, total_inr: totalInr });

    const fname = `salary-bulk-payment-${m[1]}-${m[2]}.xlsx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
