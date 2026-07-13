import EdFrame from "./EdFrame";

/**
 * Page 19 — Flagship works. Six named commissions in a 2×3 plate grid.
 * Card I (Ayodhya) carries a gold border — the Dream Project.
 */
const WORKS = [
  {
    n: "I",
    name: "Shri Ram Janmabhoomi",
    loc: "Ayodhya · Uttar Pradesh",
    img: "/images/project-ram-mandir.jpg",
    pos: "center",
    featured: true,
  },
  {
    n: "II",
    name: "Sri Bhadravedi Ramanuja",
    loc: "Hyderabad · Telangana",
    img: "/images/project-ramanuja.jpg",
    pos: "center 30%",
  },
  {
    n: "III",
    name: "Shri Pipleshwar Mahadev",
    loc: "Mehsana · Gujarat",
    img: "/images/project-pipleshwar.jpg",
    pos: "center",
  },
  {
    n: "IV",
    name: "Sri Trivikrama Temple",
    loc: "Bhooja · Telangana",
    img: "/images/project-trivikrama.jpg",
    pos: "center",
  },
  {
    n: "V",
    name: "Shri Asht Laxmi Temple",
    loc: "Agroha · Haryana",
    img: "/images/temple-arch.jpg",
    pos: "center",
  },
  {
    n: "VI",
    name: "Shri Baba Mastnath Madh",
    loc: "Rohtak · Haryana",
    img: "/images/about-construction.jpg",
    pos: "center",
  },
];

export default function EdWorksFlagship() {
  return (
    <EdFrame pageNumber={19} showFooter={false} className="ed-p19 ed-works">
      <div className="running-head">
        <span>19 · The Works</span>
        <span className="center">Flagship Commissions</span>
        <span>19 / 40</span>
      </div>

      <div className="section-num">§ 07 · The Works</div>

      <h1>Six that shaped<br />the <em>house.</em></h1>

      <div className="strap">Flagship Commissions · I — VI</div>

      <div className="works-grid">
        {WORKS.map((w) => (
          <figure key={w.n} className={`wcard${w.featured ? " featured" : ""}`}>
            <div
              className="img"
              style={{ backgroundImage: `url(${w.img})`, backgroundPosition: w.pos }}
            />
            <figcaption>
              <span className="wnum">{w.n}</span>
              <span className="winfo">
                <strong>{w.name}</strong>
                <span className="wloc">{w.loc}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </EdFrame>
  );
}
