/**
 * Personal ledger (mig 174 — Daksh, private). Reached ONLY through the secret
 * hover+key+password trigger; not in any menu, and role-gated server-side:
 *   • owner Naresh / developer → Home (left) + Office (right) + pending approvals.
 *   • crosscheck ("manager")   → Office only.
 *
 * NOT real cash — a shared record so there's no misunderstanding.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ledgerScope } from "@/lib/ledger-access";
import { rupee } from "@/lib/challan-pricing";
import { LedgerCard, type EntryView } from "./ledger-card";
import { approveLedgerTransferAction, rejectLedgerTransferAction } from "./actions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  account: "home" | "office";
  direction: "receive" | "pay";
  amount: number | string;
  counterparty: string;
  status: "confirmed" | "pending" | "rejected";
  is_transfer: boolean;
  transfer_group: string | null;
  requires_approval: boolean;
  entry_date: string;
};

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  const { profile } = await requireAuth();
  const scope = ledgerScope(profile);
  if (!scope) redirect("/");
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();

  const accounts: Array<"home" | "office"> = scope === "both" ? ["home", "office"] : ["office"];
  const { data } = await admin
    .from("personal_ledger_entries")
    .select("id, account, direction, amount, counterparty, status, is_transfer, transfer_group, requires_approval, entry_date")
    .in("account", accounts)
    .neq("status", "rejected")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];

  const balanceOf = (acc: "home" | "office") =>
    rows
      .filter((r) => r.account === acc && r.status === "confirmed")
      .reduce((s, r) => s + (r.direction === "receive" ? Number(r.amount) : -Number(r.amount)), 0);

  const viewOf = (acc: "home" | "office"): EntryView[] =>
    rows
      .filter((r) => r.account === acc)
      .map((r) => ({ id: r.id, date: r.entry_date, direction: r.direction, amount: Number(r.amount), counterparty: r.counterparty, status: r.status, isTransfer: r.is_transfer }));

  // Pending approvals (owner/dev only) — the manager-receiving-from-home halves.
  // One card per transfer_group; show the office-receive side.
  const pending = scope === "both"
    ? rows.filter((r) => r.status === "pending" && r.account === "office" && r.direction === "receive")
    : [];

  return (
    <section className="page-card" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>🔐 Personal Ledger</h1>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Private record-keeping · not real cash</span>
      </div>

      {sp.toast && (() => {
        const isErr = /could not|valid|wrong/i.test(sp.toast);
        return (
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: isErr ? "#b91c1c" : "#15803d", background: isErr ? "rgba(220,38,38,0.08)" : "rgba(22,101,52,0.08)", border: `1px solid ${isErr ? "rgba(220,38,38,0.3)" : "rgba(22,101,52,0.3)"}`, borderRadius: 8, padding: "8px 12px" }}>
            {sp.toast}
          </div>
        );
      })()}

      {pending.length > 0 && (
        <div style={{ marginTop: 14, border: "1px solid #fcd34d", borderRadius: 12, background: "#fffbeb", padding: "12px 14px" }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#92400e", marginBottom: 8 }}>⏳ Pending — Office wants to receive from Home (needs your approval)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((p) => (
              <div key={p.transfer_group ?? p.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", border: "1px solid #fde68a", borderRadius: 8, background: "#fff" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14 }}>{rupee(Number(p.amount))}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Home → Office · {new Date(`${p.entry_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <form action={approveLedgerTransferAction}>
                    <input type="hidden" name="group" value={p.transfer_group ?? ""} />
                    <button type="submit" style={{ fontSize: 12, fontWeight: 800, padding: "8px 14px", borderRadius: 8, border: "none", color: "#fff", background: "#15803d", cursor: "pointer" }}>✓ Approve</button>
                  </form>
                  <form action={rejectLedgerTransferAction}>
                    <input type="hidden" name="group" value={p.transfer_group ?? ""} />
                    <button type="submit" style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1.5px solid rgba(220,38,38,0.4)", color: "#b91c1c", background: "var(--bg)", cursor: "pointer" }}>✕ Reject</button>
                  </form>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: scope === "both" ? "repeat(auto-fit, minmax(330px, 1fr))" : "1fr", gap: 16, maxWidth: scope === "both" ? "none" : 520 }}>
        {scope === "both" && (
          <LedgerCard
            account="home"
            title="Home"
            emoji="🏠"
            balance={balanceOf("home")}
            entries={viewOf("home")}
            canEdit
            options={["OFFICE", "Other"]}
          />
        )}
        <LedgerCard
          account="office"
          title="Office"
          emoji="🏢"
          balance={balanceOf("office")}
          entries={viewOf("office")}
          canEdit={scope === "office"}
          options={["HOME", "Other"]}
        />
      </div>
    </section>
  );
}
