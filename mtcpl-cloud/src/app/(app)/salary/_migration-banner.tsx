// Shared run-migration banners for the Employees dept pages.

export function MigrationBanner({ needsMigration, needs193 }: { needsMigration: boolean; needs193: boolean }) {
  const style: React.CSSProperties = { marginBottom: 16, border: "1px solid #fcd34d", borderRadius: 12, background: "#fffbeb", padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#92400e" };
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
  if (needsMigration) {
    return <div style={style}>⚠ Run migration <span style={mono}>189_salary_pf.sql</span> on Supabase to switch the Employees department on.</div>;
  }
  if (needs193) {
    return <div style={style}>⚠ Run migrations <span style={mono}>193_salary_esi_batches.sql</span> + <span style={mono}>194_salary_daily_wage.sql</span> on Supabase to enable ESI, payment batches and daily wages.</div>;
  }
  return null;
}
