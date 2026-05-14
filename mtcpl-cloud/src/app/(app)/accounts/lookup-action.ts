"use server";

// ──────────────────────────────────────────────────────────────────
// Finance ID lookup (mig 042 follow-on / Daksh).
// ──────────────────────────────────────────────────────────────────
// Department-aware Find-ID query used by the topbar dropdown when
// the user's active department is Finance. Accepts free text and
// tries, in order:
//   1. Bill token match (T-YYYY-N, substring OK — case-insensitive)
//   2. Vendor name (fuzzy, like resolveTempleName)
//   3. Vendor's bill no (vendor_bill_no — the supplier's own
//      invoice number; leading zeros are already normalised by
//      mig 043 so "1" ≡ "001" within the same FY)
//   4. Payment reference (UTR / cheque no / UPI txn id)
//
// Returns a tagged union the client switches on. Result shape mirrors
// the production lookupId pattern — short stage-first context up top,
// then structured detail.
//
// Auth: developer / owner / accountant. The topbar only renders the
// component in Finance for these roles; this server action re-checks.
// ──────────────────────────────────────────────────────────────────

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type FinanceBillResult = {
  kind: "bill";
  bill: {
    id: string;
    token: string;
    vendorName: string;
    vendorBillNo: string;
    billDate: string;
    description: string;
    status: string;
    submittedAt: string | null;
    approvedAt: string | null;
    rejectionNote: string | null;
  };
  amounts: {
    subtotalInr: number;
    cgstPercent: number;
    cgstInr: number;
    sgstPercent: number;
    sgstInr: number;
    igstPercent: number;
    igstInr: number;
    gstPercent: number;
    gstInr: number;
    tdsPercent: number;
    tdsInr: number;
    tcsPercent: number;
    tcsInr: number;
    totalInr: number;
    payableToVendorInr: number;
    paidInr: number;
    outstandingInr: number;
  };
  payments: Array<{
    status: string;
    proposedAmountInr: number;
    paidAmountInr: number | null;
    paymentMethod: string | null;
    paymentReference: string | null;
    proposedAt: string | null;
    confirmedAt: string | null;
    paidAt: string | null;
  }>;
};

export type FinanceVendorResult = {
  kind: "vendor";
  vendor: {
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    phone: string | null;
    bankName: string | null;
    bankAccount: string | null;
    ifsc: string | null;
    paymentTermsDays: number | null;
    tdsApplicable: boolean;
    tcsApplicable: boolean;
    isActive: boolean;
  };
  lifetime: {
    billsCount: number;
    billedInr: number;
    paidInr: number;
    outstandingInr: number;
    tdsDeductedInr: number;
    tcsCollectedInr: number;
  };
  recentBills: Array<{
    token: string;
    vendorBillNo: string;
    billDate: string;
    status: string;
    amountTotalInr: number;
    amountOutstandingInr: number;
  }>;
};

export type FinancePaymentReferenceResult = {
  kind: "payment_reference";
  payment: {
    id: string;
    status: string;
    paymentMethod: string | null;
    paymentReference: string;
    paidAmountInr: number;
    paidAt: string | null;
    vendorName: string;
    billToken: string;
    billId: string;
  };
};

export type FinanceNotFoundResult = {
  kind: "not_found";
  query: string;
  suggestions: Array<{
    kind: "bill" | "vendor";
    label: string;
    hint: string;
  }>;
};

export type FinanceLookupResult =
  | FinanceBillResult
  | FinanceVendorResult
  | FinancePaymentReferenceResult
  | FinanceNotFoundResult;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function lookupFinance(query: string): Promise<FinanceLookupResult> {
  await requireAuth(["developer", "owner", "accountant"]);
  const admin = createAdminSupabaseClient();

  const q = query.trim();
  if (!q) return { kind: "not_found", query: "", suggestions: [] };

  // 1. Bill token — uppercase, exact-or-partial match.
  const qUpper = q.toUpperCase();
  const { data: tokenHits } = await admin
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, status, submitted_at, approved_at, rejection_note, " +
        "amount_subtotal, gst_percent, cgst_percent, sgst_percent, igst_percent, tds_percent, tcs_percent, " +
        "amount_gst, amount_cgst, amount_sgst, amount_igst, amount_tds, amount_tcs, amount_total, " +
        "amount_payable_to_vendor, amount_paid, amount_outstanding, " +
        "bill_vendors(id, name)",
    )
    .ilike("token", `%${qUpper.replace(/[%_]/g, (m) => `\\${m}`)}%`)
    .order("bill_date", { ascending: false })
    .limit(5);

  if (tokenHits && tokenHits.length === 1) {
    return await loadBillResult(admin, tokenHits[0] as unknown as Record<string, unknown>);
  }

  // 2. Vendor by name (fuzzy substring).
  const { data: vendorRows } = await admin
    .from("bill_vendors")
    .select("id, name, is_active")
    .order("name");
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = norm(q);
  const vendorMatches = (vendorRows ?? []).filter((v) => {
    const hay = norm((v as { name: string }).name);
    return hay.includes(needle) || needle.includes(hay);
  });
  if (vendorMatches.length === 1) {
    return await loadVendorResult(admin, (vendorMatches[0] as { id: string }).id);
  }

  // 3. Payment reference (UTR / cheque no — case-insensitive substring).
  const { data: payHits } = await admin
    .from("bill_payments")
    .select(
      "id, status, payment_method, payment_reference, paid_amount, paid_at, bill_id, bills(token, bill_vendors(name))",
    )
    .ilike("payment_reference", `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(3);

  if (payHits && payHits.length === 1) {
    const p = payHits[0] as unknown as Record<string, unknown>;
    const bill = Array.isArray(p.bills) ? (p.bills as Array<Record<string, unknown>>)[0] : (p.bills as Record<string, unknown> | null);
    const vendorEmbed = bill ? (Array.isArray(bill.bill_vendors) ? (bill.bill_vendors as Array<Record<string, unknown>>)[0] : (bill.bill_vendors as Record<string, unknown> | null)) : null;
    return {
      kind: "payment_reference",
      payment: {
        id: p.id as string,
        status: p.status as string,
        paymentMethod: (p.payment_method as string | null) ?? null,
        paymentReference: (p.payment_reference as string | null) ?? "",
        paidAmountInr: round2(Number(p.paid_amount ?? 0)),
        paidAt: (p.paid_at as string | null) ?? null,
        vendorName: (vendorEmbed?.name as string | undefined) ?? "Unknown",
        billToken: (bill?.token as string | undefined) ?? "—",
        billId: (p.bill_id as string | undefined) ?? "",
      },
    };
  }

  // 4. Nothing resolved → suggestions.
  const suggestions: FinanceNotFoundResult["suggestions"] = [];
  for (const rawT of tokenHits ?? []) {
    const t = rawT as unknown as Record<string, unknown>;
    const v = Array.isArray(t.bill_vendors)
      ? (t.bill_vendors as Array<{ name: string }>)[0]
      : (t.bill_vendors as { name: string } | null);
    suggestions.push({
      kind: "bill",
      label: (t as { token: string }).token,
      hint: `bill · ${v?.name ?? "—"} · ${(t as { status: string }).status}`,
    });
  }
  for (const v of vendorMatches.slice(0, 5)) {
    suggestions.push({
      kind: "vendor",
      label: (v as { name: string }).name,
      hint: "vendor",
    });
  }

  return { kind: "not_found", query: q, suggestions };
}

async function loadBillResult(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  raw: Record<string, unknown>,
): Promise<FinanceBillResult> {
  const v = Array.isArray(raw.bill_vendors)
    ? (raw.bill_vendors as Array<{ name: string }>)[0]
    : (raw.bill_vendors as { name: string } | null);

  const { data: pays } = await admin
    .from("bill_payments")
    .select(
      "status, proposed_amount, paid_amount, payment_method, payment_reference, proposed_at, confirmed_at, paid_at",
    )
    .eq("bill_id", raw.id as string)
    .order("proposed_at", { ascending: true });

  return {
    kind: "bill",
    bill: {
      id: raw.id as string,
      token: raw.token as string,
      vendorName: v?.name ?? "Unknown",
      vendorBillNo: raw.vendor_bill_no as string,
      billDate: raw.bill_date as string,
      description: (raw.description as string) ?? "",
      status: raw.status as string,
      submittedAt: (raw.submitted_at as string | null) ?? null,
      approvedAt: (raw.approved_at as string | null) ?? null,
      rejectionNote: (raw.rejection_note as string | null) ?? null,
    },
    amounts: {
      subtotalInr: round2(Number(raw.amount_subtotal)),
      cgstPercent: Number(raw.cgst_percent ?? 0),
      cgstInr: round2(Number(raw.amount_cgst ?? 0)),
      sgstPercent: Number(raw.sgst_percent ?? 0),
      sgstInr: round2(Number(raw.amount_sgst ?? 0)),
      igstPercent: Number(raw.igst_percent ?? 0),
      igstInr: round2(Number(raw.amount_igst ?? 0)),
      gstPercent: Number(raw.gst_percent),
      gstInr: round2(Number(raw.amount_gst)),
      tdsPercent: Number(raw.tds_percent ?? 0),
      tdsInr: round2(Number(raw.amount_tds ?? 0)),
      tcsPercent: Number(raw.tcs_percent ?? 0),
      tcsInr: round2(Number(raw.amount_tcs ?? 0)),
      totalInr: round2(Number(raw.amount_total)),
      payableToVendorInr: round2(Number(raw.amount_payable_to_vendor ?? raw.amount_total)),
      paidInr: round2(Number(raw.amount_paid)),
      outstandingInr: round2(Number(raw.amount_outstanding)),
    },
    payments: (pays ?? []).map((p) => ({
      status: (p as { status: string }).status,
      proposedAmountInr: round2(Number((p as { proposed_amount: number }).proposed_amount)),
      paidAmountInr: (p as { paid_amount?: number | null }).paid_amount != null
        ? round2(Number((p as { paid_amount: number }).paid_amount))
        : null,
      paymentMethod: ((p as { payment_method?: string | null }).payment_method) ?? null,
      paymentReference: ((p as { payment_reference?: string | null }).payment_reference) ?? null,
      proposedAt: ((p as { proposed_at?: string | null }).proposed_at) ?? null,
      confirmedAt: ((p as { confirmed_at?: string | null }).confirmed_at) ?? null,
      paidAt: ((p as { paid_at?: string | null }).paid_at) ?? null,
    })),
  };
}

async function loadVendorResult(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  vendorId: string,
): Promise<FinanceVendorResult> {
  const { data: vendor } = await admin
    .from("bill_vendors")
    .select("*")
    .eq("id", vendorId)
    .maybeSingle();
  if (!vendor) {
    return {
      kind: "vendor",
      vendor: {
        id: vendorId,
        name: "Unknown",
        category: null,
        gstin: null,
        phone: null,
        bankName: null,
        bankAccount: null,
        ifsc: null,
        paymentTermsDays: null,
        tdsApplicable: false,
        tcsApplicable: false,
        isActive: false,
      },
      lifetime: {
        billsCount: 0,
        billedInr: 0,
        paidInr: 0,
        outstandingInr: 0,
        tdsDeductedInr: 0,
        tcsCollectedInr: 0,
      },
      recentBills: [],
    };
  }

  const { data: bills } = await admin
    .from("bills")
    .select(
      "token, vendor_bill_no, bill_date, status, amount_total, amount_paid, amount_outstanding, amount_tds, amount_tcs",
    )
    .eq("bill_vendor_id", vendorId)
    .order("bill_date", { ascending: false });
  const all = bills ?? [];

  const lifetimeBilled = all.reduce((s, b) => s + Number((b as { amount_total: number }).amount_total), 0);
  const lifetimePaid = all.reduce((s, b) => s + Number((b as { amount_paid: number }).amount_paid), 0);
  const lifetimeOutstanding = all
    .filter((b) => (b as { status: string }).status === "approved")
    .reduce((s, b) => s + Number((b as { amount_outstanding: number }).amount_outstanding), 0);
  const lifetimeTds = all
    .filter((b) => {
      const st = (b as { status: string }).status;
      return st !== "cancelled" && st !== "rejected";
    })
    .reduce((s, b) => s + Number((b as { amount_tds?: number | null }).amount_tds ?? 0), 0);
  const lifetimeTcs = all
    .filter((b) => {
      const st = (b as { status: string }).status;
      return st !== "cancelled" && st !== "rejected";
    })
    .reduce((s, b) => s + Number((b as { amount_tcs?: number | null }).amount_tcs ?? 0), 0);

  return {
    kind: "vendor",
    vendor: {
      id: vendorId,
      name: (vendor as { name: string }).name,
      category: ((vendor as { category?: string | null }).category) ?? null,
      gstin: ((vendor as { gstin?: string | null }).gstin) ?? null,
      phone: ((vendor as { phone?: string | null }).phone) ?? null,
      bankName: ((vendor as { bank_name?: string | null }).bank_name) ?? null,
      bankAccount: ((vendor as { bank_account?: string | null }).bank_account) ?? null,
      ifsc: ((vendor as { ifsc?: string | null }).ifsc) ?? null,
      paymentTermsDays: ((vendor as { payment_terms_days?: number | null }).payment_terms_days) ?? null,
      tdsApplicable: Boolean((vendor as { tds_applicable?: boolean }).tds_applicable),
      tcsApplicable: Boolean((vendor as { tcs_applicable?: boolean }).tcs_applicable),
      isActive: Boolean((vendor as { is_active?: boolean }).is_active),
    },
    lifetime: {
      billsCount: all.length,
      billedInr: round2(lifetimeBilled),
      paidInr: round2(lifetimePaid),
      outstandingInr: round2(lifetimeOutstanding),
      tdsDeductedInr: round2(lifetimeTds),
      tcsCollectedInr: round2(lifetimeTcs),
    },
    recentBills: all.slice(0, 6).map((b) => ({
      token: (b as { token: string }).token,
      vendorBillNo: (b as { vendor_bill_no: string }).vendor_bill_no,
      billDate: (b as { bill_date: string }).bill_date,
      status: (b as { status: string }).status,
      amountTotalInr: round2(Number((b as { amount_total: number }).amount_total)),
      amountOutstandingInr: round2(Number((b as { amount_outstanding: number }).amount_outstanding)),
    })),
  };
}
