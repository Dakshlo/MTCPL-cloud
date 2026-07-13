import PageFrame from "./PageFrame";
import { PORTFOLIO } from "../data/portfolio";

export default function PortfolioA() {
  const items = PORTFOLIO.slice(0, 20);
  return (
    <PageFrame pageNumber={17} variant="white" chapter="Portfolio" className="page-portfolio">
      <span className="thread left-end" />

      <div className="header">
        <div>
          <span className="chapter-label">Portfolio · 01 – 20</span>
          <h2>Forty temples, <em>one page</em> each.</h2>
        </div>
        <div className="side">
          Part 1 of 2
          <b>Selected Works</b>
        </div>
      </div>
      <p className="sub">
        A compact index of forty more mandirs — across Rajasthan, Gujarat,
        Maharashtra, Tamil Nadu and beyond — that left our yards over the last
        three decades.
      </p>
      <span className="gold-line" />

      <div className="portfolio-grid">
        {items.map((p, i) => (
          <div key={`${p.name}-${i}`} className="thumb-card">
            <div className="img" style={{ backgroundImage: `url(${p.img})` }} />
            <div className="cap">
              <div className="idx">{String(i + 1).padStart(2, "0")}</div>
              <div className="name">{p.name}</div>
              <div className="loc">{p.loc}</div>
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
