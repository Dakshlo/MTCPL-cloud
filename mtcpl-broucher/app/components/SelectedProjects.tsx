import PageFrame from "./PageFrame";

const SELECTED = [
  { name: "Jain Mandir", loc: "Mount Abu · Rajasthan", img: "/images/temple-sunset.jpg" },
  { name: "Shri Hanuman Mandir", loc: "Mumbai · Maharashtra", img: "/images/about-temple.jpg" },
  { name: "Jain Mandir", loc: "Chennai · Tamil Nadu", img: "/images/welcome-temple.avif" },
  { name: "Baba Ramdev Mandir", loc: "Cuttack · Odisha", img: "/images/craft-detail.jpg" },
  { name: "Jain Temple", loc: "Kolkata · West Bengal", img: "/images/carving-detail.png" },
  { name: "Uavasagaram Jain Tirth", loc: "Durg · Chhattisgarh", img: "/images/temple-arch.jpg" },
];

export default function SelectedProjects() {
  return (
    <PageFrame pageNumber={16} variant="ivory" chapter="Selected Projects" className="page-projects ivory">
      <span className="thread right-end" />

      <div className="header">
        <div className="left">
          <span className="chapter-label">Selected Projects</span>
          <h2>Across faiths, <em>across</em> India.</h2>
        </div>
        <div className="side">
          Part 2 of 2
          <b>Selected Works</b>
        </div>
      </div>

      <p className="lead">
        Jain tirths, Hanuman mandirs, regional shrines — the quiet breadth of the work
        that fills the years between the headline temples.
      </p>
      <span className="gold-line" />

      <div className="proj-grid">
        {SELECTED.map((p, i) => (
          <div key={`${p.name}-${p.loc}`} className="proj-card">
            <div className="img" style={{ backgroundImage: `url(${p.img})` }}>
              <span className="num">Project · {String(i + 7).padStart(2, "0")}</span>
            </div>
            <div className="caption">
              <h3 className="name">{p.name}</h3>
              <div className="loc">{p.loc}</div>
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
