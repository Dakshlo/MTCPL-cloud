/**
 * Personal ledger (mig 174 — Daksh, private). Reached ONLY through the secret
 * hover+key+password trigger; not in any menu, and role-gated server-side:
 *   • owner Naresh / developer → Home (left) + Office (right) + pending approvals.
 *   • crosscheck ("manager")   → Office only.
 *
 * Renders as a FULL-SCREEN overlay so the app menu/topbar are hidden — the only
 * way out is the back arrow (Dashboard for owner, Maintenance for the manager).
 * NOT real cash — a shared record so there's no misunderstanding.
 */

import Link from "next/link";
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

  // Pending approvals (owner/dev) — the manager-receiving-from-home halves.
  const pending = scope === "both"
    ? rows.filter((r) => r.status === "pending" && r.account === "office" && r.direction === "receive")
    : [];
  const homeBalance = balanceOf("home");

  const back = scope === "office" ? { href: "/maintenance", label: "Maintenance" } : { href: "/", label: "Dashboard" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "var(--bg)", overflowY: "auto" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 18px 48px" }}>
        {/* Header — back arrow (the only way out, menu is hidden) + title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <Link href={back.href} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 800, color: "var(--text)", textDecoration: "none", padding: "9px 14px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface, #fff)" }}>
            ← {back.label}
          </Link>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>🔐 Personal Ledger</h1>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Private · not real cash</span>
          </div>
        </div>

        {sp.toast && (() => {
          const isErr = /could not|valid|wrong/i.test(sp.toast!);
          return (
            <div style={{ marginBottom: 14, fontSize: 13, fontWeight: 700, color: isErr ? "#b91c1c" : "#15803d", background: isErr ? "rgba(220,38,38,0.08)" : "rgba(22,101,52,0.08)", border: `1px solid ${isErr ? "rgba(220,38,38,0.3)" : "rgba(22,101,52,0.3)"}`, borderRadius: 10, padding: "9px 13px" }}>
              {sp.toast}
            </div>
          );
        })()}

        {pending.length > 0 && (
          <div style={{ marginBottom: 16, border: "1px solid #fcd34d", borderRadius: 14, background: "#fffbeb", padding: "13px 15px" }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#92400e", marginBottom: 4 }}>⏳ Office wants to receive from Home — needs your approval</div>
            <div style={{ fontSize: 11.5, color: "#92400e", marginBottom: 10 }}>Current Home balance: <strong style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(homeBalance)}</strong></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pending.map((p) => {
                const amt = Number(p.amount);
                const after = homeBalance - amt;
                return (
                  <div key={p.transfer_group ?? p.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "11px 13px", border: "1px solid #fde68a", borderRadius: 10, background: "#fff" }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15 }}>{rupee(amt)}</span>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      Home → Office · {new Date(`${p.entry_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: after < 0 ? "#b91c1c" : "var(--muted)" }}>
                      Home after: {rupee(after)}{after < 0 ? " ⚠ goes negative" : ""}
                    </span>
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
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: scope === "both" ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr", gap: 16, maxWidth: scope === "both" ? "none" : 520, margin: scope === "both" ? "0" : "0 auto" }}>
          {scope === "both" && (
            <LedgerCard account="home" title="Home" emoji="🏠" balance={balanceOf("home")} entries={viewOf("home")} canEdit options={["OFFICE", "Other"]} />
          )}
          <LedgerCard account="office" title="Office" emoji="🏢" balance={balanceOf("office")} entries={viewOf("office")} canEdit={scope === "office"} options={["HOME", "Other"]} />
        </div>
      </div>
    </div>
  );
}
