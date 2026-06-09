// ──────────────────────────────────────────────────────────────────
// /api/accounts/vendor-outstanding-export — vendor-wise outstanding .xlsx
// ──────────────────────────────────────────────────────────────────
// Audit export for Finance → Reconcile. One row per vendor with their
// current GRAND outstanding (plus billed / paid / held / open-bill
// count), so it can be cross-checked against external books (Tally).
//
// Auth: same audience as the Reconcile page — developer / owner /
// accountant_star.
//
// Source data is identical to the Reconcile page query (approved,
// non-cancelled bills with amount_outstanding > 0) so the exported
// totals tie out exactly to what's on screen. Read-only — writes
// nothing except an audit-log event.

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export async function GET() {
  // Top-level guard so any runtime error returns JSON the user can
  // read, not an HTML 500 page that the browser tries to "download".
  try {
    return await handleExport();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[/api/accounts/vendor-outstanding-export] crashed", e);
    return NextResponse.json(
      { error: "Vendor outstanding export failed: " + msg },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function handleExport() {
  const { profile } = await requireAuth();
  // Mirror the Reconcile page audience exactly.
  const allowed =
    profile.role === "developer" ||
    profile.role === "owner" ||
    profile.role === "accountant_star";
  if (!allowed) {
    return NextResponse.json(
      { error: "Only developer / owner / accountant★ can export this." },
      { status: 403 },
    );
  }

  const admin = createAdminSupabaseClient();

  // Same filter the Reconcile page uses for its source set.
  const { data: billRows, error } = await admin
    .from("bills")
    .select(
      "amount_total, amount_paid, amount_outstanding, held_amount, bill_vendor_id, bill_vendors(id, name, nickname, category)",
    )
    .gt("amount_outstanding", 0)
    .eq("status", "approved")
    .is("cancelled_at", null)
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Vendor = { id: string; name: string; nickname: string | null; category: string | null };
  type Raw = {
    amount_total: number | string;
    amount_paid: number | string;
    amount_outstanding: number | string;
    held_amount: number | string | null;
    bill_vendor_id: string;
    bill_vendors: Vendor | Vendor[] | null;
  };

  type Agg = {
    name: string;
    nickname: string;
    category: string;
    count: number;
    billed: number;
    paid: number;
    held: number;
    outstanding: number;
  };
  const byVendor = new Map<string, Agg>();

  for (const r of (billRows ?? []) as Raw[]) {
    const v = Array.isArray(r.bill_vendors) ? r.bill_vendors[0] ?? null : r.bill_vendors;
    const key = r.bill_vendor_id || v?.id || "unknown";
    const cur =
      byVendor.get(key) ??
      {
        name: v?.name ?? "—",
        nickname: v?.nickname ?? "",
        category: v?.category ?? "",
        count: 0,
        billed: 0,
        paid: 0,
        held: 0,
        outstanding: 0,
      };
    cur.count += 1;
    cur.billed += Number(r.amount_total ?? 0);
    cur.paid += Number(r.amount_paid ?? 0);
    cur.held += Number(r.held_amount ?? 0);
    cur.outstanding += Number(r.amount_outstanding ?? 0);
    byVendor.set(key, cur);
  }

  // Highest outstanding first — the order an auditor wants to scan.
  const rows = [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding);

  const totals = rows.reduce(
    (s, r) => {
      s.count += r.count;
      s.billed += r.billed;
      s.paid += r.paid;
      s.held += r.held;
      s.outstanding += r.outstanding;
      return s;
    },
    { count: 0, billed: 0, paid: 0, held: 0, outstanding: 0 },
  );

  // IST wall-clock date for the title + filename (UTC + 5:30). Direct
  // offset math — toLocaleString has crashed on Vercel's ICU build.
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");

  const header = [
    "#",
    "Vendor",
    "Nickname",
    "Category",
    "Open Bills",
    "Total Billed (₹)",
    "Total Paid (₹)",
    "Held (₹)",
    "Outstanding (₹)",
  ];
  const dataRows = rows.map((r, i) => [
    i + 1,
    r.name,
    r.nickname || "",
    r.category || "",
    r.count,
    round2(r.billed),
    round2(r.paid),
    round2(r.held),
    round2(r.outstanding),
  ]);
  const totalRow = [
    "",
    "TOTAL",
    "",
    "",
    totals.count,
    round2(totals.billed),
    round2(totals.paid),
    round2(totals.held),
    round2(totals.outstanding),
  ];

  const aoa: (string | number)[][] = [
    ["MATESHWARI TEMPLE CONSTRUCTION PVT LTD — Vendor Outstanding"],
    [`As on ${dd}-${mm}-${yyyy} (IST) · ${rows.length} vendors`],
    [],
    header,
    ...dataRows,
    [],
    totalRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 4 }, // #
    { wch: 34 }, // Vendor
    { wch: 16 }, // Nickname
    { wch: 16 }, // Category
    { wch: 10 }, // Open Bills
    { wch: 16 }, // Total Billed
    { wch: 16 }, // Total Paid
    { wch: 14 }, // Held
    { wch: 18 }, // Outstanding
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendor Outstanding");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  void logAudit(profile.id, "vendor_outstanding_exported", "report", `vendors_${rows.length}`, {
    vendor_count: rows.length,
    grand_outstanding: round2(totals.outstanding),
    as_on: `${yyyy}-${mm}-${dd}`,
  });

  const filename = `MTCPL-Vendor-Outstanding-${yyyy}-${mm}-${dd}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
