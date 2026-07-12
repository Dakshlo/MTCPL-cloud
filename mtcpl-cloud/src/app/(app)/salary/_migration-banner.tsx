// Shared run-migration banners for the Employees dept pages.

export function MigrationBanner({ needsMigration, needs193, needs198 = false }: { needsMigration: boolean; needs193: boolean; needs198?: boolean }) {
  const style: React.CSSProperties = { marginBottom: 16, border: "1px solid #fcd34d", borderRadius: 12, background: "#fffbeb", padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#92400e" };
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
  if (needsMigration) {
    return <div style={style}>⚠ Run migration <span style={mono}>189_salary_pf.sql</span> on Supabase to switch the Employees department on.</div>;
  }
  if (needs193) {
    return <div style={style}>⚠ Run migrations <span style={mono}>193_salary_esi_batches.sql</span>, <span style={mono}>194_salary_daily_wage.sql</span> + <span style={mono}>196_salary_tds.sql</span> on Supabase to enable ESI, batches, daily wages and TDS.</div>;
  }
  if (needs198) {
    return <div style={style}>⚠ Run migration <span style={mono}>198_salary_batch_approval.sql</span> on Supabase to turn on owner approval for salary batches. Until then batches skip approval.</div>;
  }
  return null;
}
