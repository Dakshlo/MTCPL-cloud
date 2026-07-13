import PageFrame from "./PageFrame";

const TEAM = [
  { name: "Mr. Naresh Lohar", role: "Managing Director", desk: "Operations", initial: "N" },
  { name: "Mr. Rohit Lohar", role: "Managing Director", desk: "Production", initial: "R" },
  { name: "Mr. Ramesh Lohar", role: "Head · Design & Drawing", desk: "CAD Studio", initial: "R" },
  { name: "Mr. Kalpesh Lohar", role: "Head · Production", desk: "Yard Floor", initial: "K" },
  { name: "Mr. VP Singh Rajput", role: "Head · HRD", desk: "People & Admin", initial: "V" },
  { name: "Mr. Govind Mali", role: "Head · Accounts", desk: "Finance", initial: "G" },
  { name: "Mr. Mafat Rajpurohit", role: "Accountant", desk: "Finance", initial: "M" },
  { name: "Mr. Alkesh Lohar", role: "CAD/CAM Designer · CNC", desk: "Machine Planning", initial: "A" },
  { name: "Mr. Rajesh Suthar", role: "Office Coordinator", desk: "Client Desk", initial: "R" },
];

export default function FullTeam() {
  return (
    <PageFrame pageNumber={22} variant="cream" chapter="Our Team" className="page-team">
      <div className="header">
        <span className="chapter-label">Our Team</span>
        <h2>The people behind<br />the <em>stone.</em></h2>
        <p className="lead">
          Every shikhar, every deity, every block dispatched from our yard passes
          through these nine hands first.
        </p>
        <span className="gold-line" />
      </div>

      <div className="team-grid">
        {TEAM.map((m) => (
          <div key={m.name} className="team-card">
            <div className="avatar">
              <span className="initial">{m.initial}</span>
            </div>
            <h3 className="name">{m.name}</h3>
            <div className="role">
              {m.role}
              <small>{m.desk}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="team-footer">
        <span>Core Team · On Rolls</span>
        <b>9<sup>+</sup> members · 350<sup>+</sup> craftsmen</b>
      </div>
    </PageFrame>
  );
}
