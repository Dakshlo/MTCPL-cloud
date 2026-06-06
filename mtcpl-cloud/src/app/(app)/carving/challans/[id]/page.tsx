import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge"];

function inr(n: number): string {
  return "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d.length <= 10 ? `${d}T00:00:00+05:30` : d).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return d;
  }
}

export default async function CarvingChallanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: chRow } = await admin
    .from("carving_challans")
    .select(
      "id, challan_number, challan_date, vendor_name, amount_subtotal, gst_pct, gst_amount, is_rcm, amount_total, notes, cancelled_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!chRow) redirect("/carving/challans?toast=Challan+not+found");
  const ch = chRow as {
    challan_number: string;
    challan_date: string | null;
    vendor_name: string;
    amount_subtotal: number;
    gst_pct: number | null;
    gst_amount: number;
    is_rcm: boolean;
    amount_total: number;
    notes: string | null;
    cancelled_at: string | null;
  };

  const { data: itemRows } = await admin
    .from("carving_challan_items")
    .select("description, quantity, unit, rate, amount, position")
    .eq("challan_id", id)
    .order("position", { ascending: true });
  const items = ((itemRows ?? []) as Array<{
    description: string;
    quantity: number | string;
    unit: string;
    rate: number | string;
    amount: number | string;
  }>);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32, maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <Link href="/carving/challans" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
          ← Jobwork challans
        </Link>
        <a
          href={`/api/carving/challan-pdf/${id}`}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
            background: "var(--gold-dark)",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          ⬇ Download PDF
        </a>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Jobwork Challan
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{ch.challan_number}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{fmtDate(ch.challan_date)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Vendor</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{ch.vendor_name}</div>
            {ch.cancelled_at && (
              <span style={{ display: "inline-block", marginTop: 4, fontSize: 11, fontWeight: 800, color: "#991b1b", background: "rgba(220,38,38,0.1)", borderRadius: 999, padding: "2px 8px" }}>
                CANCELLED
              </span>
            )}
          </div>
        </div>

        <table style={{ width: "100%", marginTop: 18, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <th style={{ padding: "6px 4px" }}>Description</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "6px 4px", textAlign: "center" }}>Unit</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Rate</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 4px" }}>{it.description}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{Number(it.quantity).toFixed(2)}</td>
                <td style={{ padding: "8px 4px", textAlign: "center", textTransform: "uppercase" }}>{it.unit}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{inr(Number(it.rate))}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{inr(Number(it.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 14, marginLeft: "auto", width: 280, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>Subtotal</span>
            <span style={{ fontFamily: "ui-monospace, monospace" }}>{inr(Number(ch.amount_subtotal))}</span>
          </div>
          {ch.gst_pct != null && Number(ch.gst_pct) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
              <span>GST @ {Number(ch.gst_pct)}%{ch.is_rcm ? " (RCM — by recipient)" : ""}</span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{inr(Number(ch.gst_amount))}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 15, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <span>Total payable</span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--gold-dark)" }}>{inr(Number(ch.amount_total))}</span>
          </div>
        </div>

        {ch.is_rcm && (
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
            GST is payable by the recipient under Reverse Charge Mechanism (RCM); not added to the amount payable to the vendor.
          </div>
        )}
        {ch.notes && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>Note: {ch.notes}</div>
        )}
      </div>
    </div>
  );
}
