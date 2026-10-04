// ──────────────────────────────────────────────────────────────────
// /tools/[toolId] — one tool's register (Migration 227)
// ──────────────────────────────────────────────────────────────────
// This is the page that replaces the paper. Every line that ever moved
// this tool, newest first, with the running balance beside it — so the
// number on the card can always be traced back to the entries that made
// it, which is the one thing a stock figure has to be able to do.
//
// Undone lines are STRUCK THROUGH, not hidden. A register you can
// silently erase is worth less than the paper one.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseCncTools } from "@/lib/cnc-tool-permissions";
import { fetchAllPaged } from "@/lib/paginate";
import { KIND_LABEL, levelOf, lowLineOf, type ToolMovementKind } from "@/lib/cnc-tool-stock";

export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";

export default async function ToolRegisterPage({
  params,
}: {
  params: Promise<{ toolId: string }>;
}) {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const { toolId } = await params;
  const admin = createAdminSupabaseClient();

  const { data: toolRow } = await admin
    .from("cnc_tools")
    .select("id, vendor_id, name, spec, unit, low_stock_qty, is_active")
    .eq("id", toolId)
    .maybeSingle();
  if (!toolRow) notFound();
  const tool = toolRow as {
    id: string; vendor_id: string; name: string; spec: string | null;
    unit: string; low_stock_qty: number | null; is_active: boolean;
  };

  const [{ data: vendorRow }, rows] = await Promise.all([
    admin.from("vendors").select("name").eq("id", tool.vendor_id).maybeSingle(),
    fetchAllPaged((from, to) =>
      admin
        .from("cnc_tool_movements")
        .select("id, kind, delta, taken_by, note, entered_by, created_at, undone_at")
        .eq("tool_id", toolId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  type Row = {
    id: string; kind: ToolMovementKind; delta: number; taken_by: string | null;
    note: string | null; entered_by: string | null; created_at: string; undone_at: string | null;
  };
  const moves = (rows ?? []) as Row[];

  // Oldest → newest so the running balance is a real running balance,
  // then flipped for display. A balance computed newest-first is the
  // classic way these pages end up lying.
  let running = 0;
  const withBalance = moves.map((m) => {
    if (!m.undone_at) running += Number(m.delta);
    return { ...m, balance: running };
  });
  const stock = running;
  const lowLine = lowLineOf(tool);
  const level = levelOf(stock, lowLine);

  // Names, resolved once rather than per row.
  const ids = [...new Set(withBalance.map((m) => m.entered_by).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await admin.from("profiles").select("id, full_name").in("id", ids);
    for (const p of (ps ?? []) as Array<{ id: string; full_name: string | null }>) {
      nameById.set(p.id, p.full_name ?? "—");
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      timeZone: IST, day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
    });

  const colour = level === "out" ? "var(--danger)" : level === "low" ? "var(--warning)" : "var(--success)";

  return (
    <section className="page-fluid allow-portrait" style={{ paddingBottom: 40 }}>
      <Link
        href={`/tools?vendor=${tool.vendor_id}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", marginBottom: 14,
          fontSize: 13, fontWeight: 700, textDecoration: "none", borderRadius: 10,
          border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
        }}
      >
        ← {(vendorRow as { name?: string } | null)?.name ?? "Crib"}
      </Link>

      <header
        style={{
          display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap",
          padding: "20px 22px", marginBottom: 18, borderRadius: 16,
          border: "1px solid var(--border)", background: "var(--surface)",
          borderLeft: `4px solid ${colour}`,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Register
          </div>
          <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.025em", margin: "3px 0 0", color: "var(--text)" }}>
            {tool.name}
          </h1>
          {tool.spec && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{tool.spec}</div>}
          {!tool.is_active && (
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 6 }}>Archived</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: colour, fontFamily: "ui-monospace, monospace", letterSpacing: "-0.03em" }}>
            {stock}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700, marginTop: 4 }}>
            {tool.unit} in the crib
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>warns at {lowLine}</div>
        </div>
      </header>

      {withBalance.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 14, border: "1px dashed var(--border)", borderRadius: 14 }}>
          Nothing has moved yet.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
          {[...withBalance].reverse().map((m, i) => {
            const voided = !!m.undone_at;
            const positive = Number(m.delta) > 0;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "13px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border-light)",
                  opacity: voided ? 0.5 : 1,
                  background: voided ? "var(--surface-alt)" : undefined,
                }}
              >
                <div
                  style={{
                    width: 54, textAlign: "right", flex: "0 0 auto",
                    fontSize: 17, fontWeight: 800, fontFamily: "ui-monospace, monospace",
                    color: voided ? "var(--muted)" : positive ? "var(--success)" : "var(--danger)",
                    textDecoration: voided ? "line-through" : undefined,
                  }}
                >
                  {positive ? "+" : ""}{m.delta}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", textDecoration: voided ? "line-through" : undefined }}>
                    {KIND_LABEL[m.kind]}
                    {m.taken_by && <> · <span style={{ color: "var(--gold-dark)" }}>{m.taken_by}</span></>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.45 }}>
                    {fmt(m.created_at)}
                    {m.entered_by && <> · entered by {nameById.get(m.entered_by) ?? "—"}</>}
                    {m.note && <> · {m.note}</>}
                    {voided && <> · <strong style={{ color: "var(--danger)" }}>undone</strong></>}
                  </div>
                </div>

                <div
                  style={{
                    flex: "0 0 auto", textAlign: "right", fontSize: 14, fontWeight: 700,
                    fontFamily: "ui-monospace, monospace",
                    color: voided ? "var(--muted)" : "var(--text)",
                  }}
                  title="Stock after this line"
                >
                  {voided ? "—" : m.balance}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.6 }}>
        The right-hand column is the stock after that line. Undone entries stay on the register,
        struck through, and count for nothing — nothing is ever deleted.
      </p>
    </section>
  );
}
