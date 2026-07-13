import PageFrame from "./PageFrame";

const LEADERS = [
  {
    gen: "First Generation · Founder",
    name: "Mancharam Lohar",
    role: "Chairman",
    bio: "Opened the first workshop in 1971 at Ajari, Sirohi — and in 2000 answered the call to Ayodhya. Fifty-four years of stone begin at his chisel.",
    since: "Since 1971",
    phone: "Ajari · Sirohi",
    photo: "/images/founder.jpg",
  },
  {
    gen: "Second Generation · Managing Director",
    name: "Naresh Lohar",
    role: "Managing Director",
    bio: "Leads day-to-day operations, client relationships and the pan-India project desk. The steady hand between the yard and the shrine site.",
    since: "+91 99292 77566",
    phone: "Operations",
    photo: "/images/about-construction.jpg",
  },
  {
    gen: "Second Generation · Managing Director",
    name: "Rohit Lohar",
    role: "Managing Director",
    bio: "Runs the production floor — machinery, dispatch and quality. Brought CNC, 5-axis routing and modern planning into the Sirohi yard.",
    since: "+91 94143 74979",
    phone: "Production",
    photo: "/images/trust-construction.jpg",
  },
];

export default function Leadership() {
  return (
    <PageFrame pageNumber={21} variant="white" chapter="Leadership" className="page-leadership">
      <div className="header">
        <span className="chapter-label">Leadership</span>
        <h2>Three generations,<br />one <em>chisel.</em></h2>
        <p className="lead">
          Founded by a father. Carried forward by two sons. Every leadership
          decision in this firm is still made at a yard table in Sirohi.
        </p>
        <span className="gold-line" />
      </div>

      <div className="leaders-grid">
        {LEADERS.map((l) => (
          <div key={l.name} className="leader">
            <div className="photo" style={{ backgroundImage: `url(${l.photo})` }} />
            <div className="generation">{l.gen}</div>
            <h3 className="name">Mr. {l.name}</h3>
            <div className="role">{l.role}</div>
            <p className="bio">{l.bio}</p>
            <div className="meta">
              <span>{l.phone}</span>
              <b>{l.since}</b>
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
