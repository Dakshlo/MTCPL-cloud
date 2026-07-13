import EdFrame from "./EdFrame";

/**
 * Page 21 — By the numbers. Four big figures + the Mission 2033 band.
 * Right-page closer for § 07.
 */
const NUMS = [
  {
    v: "12",
    sup: "L+",
    lbl: "Cubic Feet of Stone",
    sub: "carved, finished and dispatched since 1971.",
  },
  {
    v: "100",
    sup: "+",
    lbl: "Temples Delivered",
    sub: "from village shrines to civilisational landmarks.",
  },
  {
    v: "55",
    sup: "",
    lbl: "Years of Craft",
    sub: "an unbroken line, from the first chisel to this morning's shift.",
  },
  {
    v: "7",
    sup: "+",
    lbl: "States Across India",
    sub: "Rajasthan, Gujarat, UP, Maharashtra, Telangana and beyond.",
  },
];

export default function EdNumbers() {
  return (
    <EdFrame pageNumber={21} showFooter={false} className="ed-p21 ed-works">
      <div className="running-head">
        <span>21 · The Works</span>
        <span className="center">By the Numbers</span>
        <span>21 / 40</span>
      </div>

      <div className="section-num">§ 07 · The Works · closing</div>

      <h1>A legacy in stone,<br />in <em>numbers.</em></h1>

      <div className="strap">By the Numbers · 1971 — 2026</div>

      <div className="num-grid">
        {NUMS.map((n) => (
          <div key={n.lbl} className="ncell">
            <span className="nv">
              {n.v}
              {n.sup && <small>{n.sup}</small>}
            </span>
            <span className="nl">{n.lbl}</span>
            <span className="ns">{n.sub}</span>
          </div>
        ))}
      </div>

      <div className="mission">
        <span className="m-tag">Mission · 2033</span>
        <span className="m-num">
          30<small>L+</small>
        </span>
        <span className="m-line">
          Thirty lakh cubic feet — the scale we are building toward.
        </span>
      </div>

      <div className="nm-foot">
        <span>Mateshwari Temples Construction Pvt. Ltd.</span>
        <span>Edition 2026</span>
      </div>
    </EdFrame>
  );
}
