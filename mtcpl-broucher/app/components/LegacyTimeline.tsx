import PageFrame from "./PageFrame";

const EVENTS = [
  {
    year: "1971",
    stage: "The Beginning",
    title: "Mahadev Shilp Kala Center is founded",
    desc: "Mr. Mancharam Lohar opens a small carving workshop in Ajari, Sirohi. The first commission — a stone for the Hastinapur temple — sets the course for a dharma-led craft.",
  },
  {
    year: "1990s",
    stage: "Growth",
    title: "Pan-India work begins",
    desc: "Commissions arrive from Gujarat, MP and Maharashtra. The team doubles, then triples; sandstone and marble start leaving Sirohi for sites across India.",
  },
  {
    year: "1995",
    stage: "Incorporation",
    title: "Mateshwari Temples Construction Pvt. Ltd.",
    desc: "The family formalises the firm — the same craft, now under a company built to take on multi-crore temple complexes and long-term deity projects.",
  },
  {
    year: "2000 — 2004",
    stage: "Dream Project",
    title: "Shri Ram Janmabhoomi — first chapter",
    desc: "Mr. Mancharam joins the earliest phase of the Ayodhya Ram Mandir — the work that will shape the firm for two decades.",
  },
  {
    year: "2010s",
    stage: "Next Generation",
    title: "Naresh & Rohit Lohar take the reins",
    desc: "CNC routers and 5-axis machines enter the yard — without losing a single hand-carved line. The craft is passed on, not replaced.",
  },
  {
    year: "2024",
    stage: "Completion",
    title: "Ram Mandir opens its doors",
    desc: "After 7+ lakh cubic feet of sandstone, 500+ artisans and four years on-site, pran-pratishtha is held at Ayodhya.",
  },
  {
    year: "Today",
    stage: "The Legacy",
    title: "100+ temples across 7+ states",
    desc: "Over 12 lakh cubic feet of stone carved to date. A third generation is at the chisel — which has not stopped for 54 years.",
  },
];

export default function LegacyTimeline() {
  return (
    <PageFrame pageNumber={5} variant="white" chapter="The Legacy" className="page-timeline">
      <div className="header">
        <span className="chapter-label">The Legacy</span>
        <h2>Five decades<br />of <em>stone.</em></h2>
        <p className="intro">
          A family workshop in Sirohi, a first chisel in 1971, and a line of temples that now
          stretches from Rajasthan to Tamil Nadu. This is how it unfolded.
        </p>
        <span className="gold-line" />
      </div>

      <div className="timeline">
        {EVENTS.map((e) => (
          <div key={e.year} className="t-event">
            <div className="year">
              {e.year}
              <small>{e.stage}</small>
            </div>
            <div>
              <h3 className="title">{e.title}</h3>
              <p className="desc">{e.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
