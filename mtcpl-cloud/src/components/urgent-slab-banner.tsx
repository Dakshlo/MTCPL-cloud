import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type UrgentSlab = {
  id: string;
  label: string;
  temple: string;
  deadline: string | null;
  priority_note: string | null;
};

export async function UrgentSlabBanner() {
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("slab_requirements")
    .select("id, label, temple, deadline, priority_note")
    .eq("priority", true)
    .in("status", ["open", "planned", "cutting"])
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(10);

  const slabs = (data ?? []) as UrgentSlab[];
  if (slabs.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div style={{
      background: "rgba(220,38,38,0.06)",
      border: "1.5px solid rgba(220,38,38,0.25)",
      borderRadius: 10,
      padding: "12px 16px",
      marginBottom: 18,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15 }}>🔔</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>
          {slabs.length} Urgent Slab{slabs.length !== 1 ? "s" : ""} — Action Needed
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {slabs.map(s => {
          const dl = s.deadline ? new Date(s.deadline) : null;
          const daysLeft = dl ? Math.ceil((dl.getTime() - today.getTime()) / 86400000) : null;
          const overdue  = daysLeft !== null && daysLeft < 0;
          const dueSoon  = daysLeft !== null && daysLeft <= 2;

          return (
            <div key={s.id} style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              padding: "8px 12px",
              background: overdue ? "rgba(220,38,38,0.08)" : "rgba(217,119,6,0.06)",
              border: `1px solid ${overdue ? "rgba(220,38,38,0.2)" : "rgba(217,119,6,0.2)"}`,
              borderRadius: 8,
              minWidth: 160,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                  {s.id}
                </span>
                {daysLeft !== null && (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: overdue ? "#DC2626" : dueSoon ? "#D97706" : "#16A34A",
                    background: overdue ? "rgba(220,38,38,0.12)" : dueSoon ? "rgba(217,119,6,0.12)" : "rgba(22,163,74,0.12)",
                    padding: "1px 6px", borderRadius: 8,
                  }}>
                    {overdue ? "Overdue!" : daysLeft === 0 ? "Due today" : daysLeft === 1 ? "Tomorrow" : `${daysLeft}d`}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.temple} · {s.label}</div>
              {s.priority_note && (
                <div style={{ fontSize: 11, color: "var(--gold-dark)", fontStyle: "italic" }}>"{s.priority_note}"</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
