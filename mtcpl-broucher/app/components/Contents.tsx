import PageFrame from "./PageFrame";

interface TocItem {
  pg: string;
  ttl: string;
  sub: string;
  spread?: boolean;
}

const LEFT: { heading: string; items: TocItem[] }[] = [
  {
    heading: "I · The Opening",
    items: [
      { pg: "02", ttl: "A Prayer", sub: "Dedication & Invocation" },
      { pg: "04", ttl: "At a Glance", sub: "The MTCPL Ledger" },
      { pg: "05", ttl: "Five Decades of Stone", sub: "The Legacy · Timeline" },
      { pg: "06", ttl: "The Founder", sub: "Mr. Mancharam Lohar" },
    ],
  },
  {
    heading: "II · The Dream Project",
    items: [
      { pg: "07 – 08", ttl: "Shri Ram Janmabhoomi", sub: "Ayodhya · Uttar Pradesh", spread: true },
    ],
  },
  {
    heading: "III · Capability",
    items: [
      { pg: "09", ttl: "End-to-End Temple Craft", sub: "What We Do" },
      { pg: "10", ttl: "A Legacy in Numbers", sub: "Stats & Mission 2033" },
      { pg: "11", ttl: "Where Stone Becomes Art", sub: "The Facility" },
      { pg: "12", ttl: "Equipment & Craftsmen", sub: "Plant & People" },
    ],
  },
];

const RIGHT: { heading: string; items: TocItem[] }[] = [
  {
    heading: "IV · Reach",
    items: [
      { pg: "13 – 14", ttl: "Across India", sub: "Map & State-wise Breakdown", spread: true },
    ],
  },
  {
    heading: "V · Projects",
    items: [
      { pg: "15 – 16", ttl: "Temples of Note", sub: "Flagship & Selected", spread: true },
      { pg: "17 – 18", ttl: "The Portfolio", sub: "Forty Temples in Detail", spread: true },
    ],
  },
  {
    heading: "VI · The Craft",
    items: [
      { pg: "19", ttl: "The Hand That Shapes", sub: "Craftsmanship" },
      { pg: "20", ttl: "CNC at the Service of Craft", sub: "Precision" },
    ],
  },
  {
    heading: "VII · People, Voices, Contact",
    items: [
      { pg: "21", ttl: "Leadership", sub: "Three Generations" },
      { pg: "22", ttl: "Our Team", sub: "The People Behind the Stone" },
      { pg: "23", ttl: "In Their Words", sub: "Testimonials" },
      { pg: "24", ttl: "Begin a Conversation", sub: "Contact" },
    ],
  },
];

function Row({ it }: { it: TocItem }) {
  return (
    <div className={`toc-row${it.spread ? " spread" : ""}`}>
      <div className="pg">{it.pg}</div>
      <div className="ttl">
        {it.ttl}
        <small>{it.sub}</small>
      </div>
      <div className="dots" />
    </div>
  );
}

function Section({ heading, items }: { heading: string; items: TocItem[] }) {
  return (
    <div className="toc-section">
      <h4>{heading}</h4>
      {items.map((it) => (
        <Row key={it.pg} it={it} />
      ))}
    </div>
  );
}

export default function Contents() {
  return (
    <PageFrame pageNumber={3} variant="ivory" showFooter={false} className="page-contents">
      <div className="toc-ornament">॥ अनुक्रमणिका ॥</div>

      <div className="header">
        <div>
          <span className="chapter-label">Contents</span>
          <h2>Inside this <em>volume.</em></h2>
          <p className="lead">
            A walk from a workshop in Sirohi in 1971 to the hundred-plus temples
            it has touched since — across twenty-four pages.
          </p>
        </div>

        <div className="header-stats">
          Chapters
          <b>VII</b>
          <small>25 pages</small>
        </div>
      </div>

      <span className="gold-line" />

      <div className="toc-grid">
        <div>
          {LEFT.map((s) => (
            <Section key={s.heading} {...s} />
          ))}
        </div>
        <div>
          {RIGHT.map((s) => (
            <Section key={s.heading} {...s} />
          ))}
        </div>
      </div>

      <div className="toc-footer">
        <span>Mateshwari Temple Construction · Sirohi</span>
        <em>Since 1971</em>
      </div>
    </PageFrame>
  );
}
