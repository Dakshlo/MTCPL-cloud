/**
 * GET /api/salary/employee-timeline?id=<employee-id>
 *
 * The change history of one employee — added, every edit (with what changed),
 * activate/deactivate — read from audit_logs (entity_type='salary_employee').
 * Owner / developer ONLY. Powers the "🕑 Timeline" modal on the employee card
 * so the team can see salary rises and other changes over time.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Change = { field: string; from: string; to: string };
type Event = { id: string; action: string; createdAt: string; actor: string | null; added: boolean; changes: Change[] };

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: "Owner only." }, { status: 403 });
  }
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Pass ?id=" }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("id, user_id, action, details, created_at")
    .eq("entity_type", "salary_employee")
    .eq("entity_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  type Row = { id: string; user_id: string | null; action: string; details: Record<string, unknown> | null; created_at: string };
  const rows = (data ?? []) as Row[];

  // Resolve actor names in one query.
  const actorIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
      names.set(p.id, (p.full_name ?? "").trim() || "—");
    }
  }

  const events: Event[] = rows.map((r) => {
    const d = r.details ?? {};
    const changes = Array.isArray(d.changes) ? (d.changes as Change[]) : [];
    return {
      id: String(r.id),
      action: r.action,
      createdAt: r.created_at,
      actor: r.user_id ? names.get(r.user_id) ?? null : null,
      added: d.added === true || r.action === "salary_employee_added",
      changes,
    };
  });

  return NextResponse.json({ ok: true, events }, { headers: { "Cache-Control": "no-store" } });
}
