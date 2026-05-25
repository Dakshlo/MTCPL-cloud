/**
 * /accounts/advances/new — Owner records a vendor advance.
 *
 * Daksh's dad: "Vendor wants money before sending the bill —
 * pay him now, count it against his future bill."
 *
 * Owner picks a vendor, types the amount + a short reason, and
 * submits. The new vendor_advances row lands at status='proposed';
 * owner then confirms on Pay Today, accountant marks paid after
 * the bank transfer. Once paid, it sits as a vendor credit until
 * accountant applies it to a real bill.
 *
 * Owner / developer only — accountants don't record advances
 * (advances move real money without a corresponding bill, so the
 * authorisation IS the record).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canRecordAdvance } from "@/lib/accounts-permissions";
import { recordAdvanceFormAction } from "../../actions";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  BUTTON_STYLES,
  INPUT_STYLE,
} from "../../_ui/components";
import { AdvanceVendorField } from "./vendor-field";

type Search = Promise<{ error?: string; vendor_id?: string }>;

export default async function NewAdvancePage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!canRecordAdvance(profile)) {
    redirect("/accounts/advances");
  }
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();
  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const vendors = ((vendorRows ?? []) as Array<{ id: string; name: string }>);

  return (
    <section className="page-card" style={{ maxWidth: 720 }}>
      <AccountsHero
        title="📥 Record vendor advance"
        description="Push money to a vendor before their bill arrives. Will appear on Pay Today for owner confirmation, then enters the regular HDFC payment flow."
        actions={
          <Link href="/accounts/advances" style={BUTTON_STYLES.secondary}>
            ← All advances
          </Link>
        }
      />

      {sp.error && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: ACCOUNTS_TOKENS.dangerLight,
            color: ACCOUNTS_TOKENS.danger,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {sp.error}
        </div>
      )}

      <form
        action={recordAdvanceFormAction}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: 18,
          background: "var(--surface)",
          border: `1px solid ${ACCOUNTS_TOKENS.border}`,
          borderRadius: 12,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={fieldLabel()}>Vendor *</span>
          <AdvanceVendorField
            vendors={vendors}
            defaultVendorId={sp.vendor_id ?? ""}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={fieldLabel()}>Amount (₹) *</span>
          <input
            type="number"
            name="amount"
            required
            min="1"
            step="0.01"
            placeholder="e.g. 50000"
            style={{
              ...INPUT_STYLE,
              padding: "10px 12px",
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
            }}
          />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Owner authorises this amount to move. Bank transfer happens via the
            regular HDFC CSV flow after owner confirms on Pay Today.
          </span>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={fieldLabel()}>Reason / description *</span>
          <input
            type="text"
            name="description"
            required
            maxLength={500}
            placeholder="e.g. Advance for raw stone order — bill due next week"
            style={{ ...INPUT_STYLE, padding: "10px 12px" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={fieldLabel()}>Note (optional)</span>
          <textarea
            name="note"
            rows={3}
            maxLength={500}
            placeholder="Anything else worth recording — PO number, vendor's commitment, etc."
            style={{
              ...INPUT_STYLE,
              padding: "10px 12px",
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </label>

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <Link href="/accounts/advances" style={BUTTON_STYLES.secondary}>
            Cancel
          </Link>
          <button type="submit" style={BUTTON_STYLES.primary}>
            📥 Record advance
          </button>
        </div>
      </form>

      <p
        style={{
          marginTop: 14,
          fontSize: 11,
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        <strong>What happens next:</strong> Advance enters Pay Today as a proposed
        payment. Owner confirms → accountant downloads HDFC CSV → bank transfer
        → accountant marks paid. After that the amount sits as the vendor&apos;s
        credit balance until you apply some/all of it to a real bill.
      </p>
    </section>
  );
}

function fieldLabel(): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 800,
    color: ACCOUNTS_TOKENS.neutral,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
}
