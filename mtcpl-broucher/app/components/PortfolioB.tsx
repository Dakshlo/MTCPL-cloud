import PageFrame from "./PageFrame";
import { PORTFOLIO } from "../data/portfolio";

export default function PortfolioB() {
  const items = PORTFOLIO.slice(20, 40);
  return (
    <PageFrame pageNumber={18} variant="ivory" chapter="Portfolio" className="page-portfolio ivory">
      <span className="thread right-end" />

      <div className="header">
        <div>
          <span className="chapter-label">Portfolio · 21 – 40</span>
          <h2>…and <em>twenty</em> more.</h2>
        </div>
        <div className="side">
          Part 2 of 2
          <b>Selected Works</b>
        </div>
      </div>
      <p className="sub">
        From the Jain temples of Pune and Chennai to Mataji shrines across
        Gujarat — the quiet body of work that sits between our flagship
        commissions.
      </p>
      <span className="gold-line" />

      <div className="portfolio-grid">
        {items.map((p, i) => (
          <div key={`${p.name}-${i}`} className="thumb-card">
            <div className="img" style={{ backgroundImage: `url(${p.img})` }} />
            <div className="cap">
              <div className="idx">{String(i + 21).padStart(2, "0")}</div>
              <div className="name">{p.name}</div>
              <div className="loc">{p.loc}</div>
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
