import PageFrame from "./PageFrame";

const FLAGSHIP = [
  { name: "Shri Ram Janmabhoomi", loc: "Ayodhya · Uttar Pradesh", img: "/images/project-ram-mandir.jpg", featured: true },
  { name: "Sri Bhadravedi Ramanuja", loc: "Hyderabad · Telangana", img: "/images/project-ramanuja.jpg", featured: true },
  { name: "Shri Pipleshwar Mahadev", loc: "Mehsana · Gujarat", img: "/images/project-pipleshwar.jpg", featured: true },
  { name: "Sri Trivikrama Temple", loc: "Bhooja · Telangana", img: "/images/project-trivikrama.jpg", featured: true },
  { name: "Shri Asht Laxmi Temple", loc: "Agroha · Haryana", img: "/images/temple-arch.jpg", featured: true },
  { name: "Shri Baba Mastnath Madh", loc: "Rohtak · Haryana", img: "/images/about-construction.jpg", featured: true },
];

export default function FlagshipProjects() {
  return (
    <PageFrame pageNumber={15} variant="white" chapter="Flagship Temples" className="page-projects">
      <span className="thread left-end" />

      <div className="header">
        <div className="left">
          <span className="chapter-label">Flagship Temples</span>
          <h2>Six that <em>shaped</em> the house.</h2>
        </div>
        <div className="side">
          Part 1 of 2
          <b>Flagship Works</b>
        </div>
      </div>

      <p className="lead">
        From our Dream Project at Ayodhya to the great Ramanuja statue at Hyderabad —
        six commissions that carried the name of Sirohi across India.
      </p>
      <span className="gold-line" />

      <div className="proj-grid">
        {FLAGSHIP.map((p, i) => (
          <div key={p.name} className="proj-card featured">
            <div className="img" style={{ backgroundImage: `url(${p.img})` }}>
              <span className="num">Project · {String(i + 1).padStart(2, "0")}</span>
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
