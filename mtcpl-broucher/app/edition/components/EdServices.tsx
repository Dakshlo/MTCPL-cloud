import EdFrame from "./EdFrame";

/**
 * Page 22 — § 08 · The Craft. Six services in a hairline six-cell grid,
 * pure typography: numeral, discipline, one italic line.
 */
const SERVICES = [
  {
    n: "I",
    title: "Temple Design & Drawing",
    line: "Shilpa-shastra principles, rendered in modern CAD.",
  },
  {
    n: "II",
    title: "Hand Stone Carving",
    line: "Master carvers of Sirohi, Abu and Orissa.",
  },
  {
    n: "III",
    title: "CNC & 5-Axis Precision",
    line: "±1 mm on pillars, jaalis and dimensional elements.",
  },
  {
    n: "IV",
    title: "On-Site Installation",
    line: "Numbered blocks; our own teams set the shrine.",
  },
  {
    n: "V",
    title: "Temple Restoration",
    line: "Heritage repair, stone matched to the original.",
  },
  {
    n: "VI",
    title: "Deity Statues & Murtis",
    line: "Full-figure works above one hundred feet.",
  },
];

export default function EdServices() {
  return (
    <EdFrame pageNumber={22} showFooter={false} className="ed-p22 ed-works">
      <div className="running-head">
        <span>22 · The Craft</span>
        <span className="center">What We Do</span>
        <span>22 / 40</span>
      </div>

      <div className="section-num">§ 08 · The Craft</div>

      <h1>Six crafts,<br />one <em>roof.</em></h1>

      <div className="strap">What We Do · Services</div>

      <div className="svc-grid">
        {SERVICES.map((s) => (
          <div key={s.n} className="scell">
            <span className="sn">{s.n}</span>
            <span className="st">{s.title}</span>
            <span className="sl">{s.line}</span>
          </div>
        ))}
      </div>

      <div className="svc-foot">
        <span>Design → Carve → Install</span>
        <span>One responsibility</span>
      </div>
    </EdFrame>
  );
}
