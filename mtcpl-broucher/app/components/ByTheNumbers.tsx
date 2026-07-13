import PageFrame from "./PageFrame";

export default function ByTheNumbers() {
  return (
    <PageFrame pageNumber={10} variant="cream" chapter="By The Numbers" className="page-numbers">
      <div className="header">
        <span className="chapter-label">By The Numbers</span>
        <h2>A legacy in stone,<br />in <em>numbers.</em></h2>
        <p className="intro">
          Fifty-four years of work, quietly piled up — measured in cubic feet,
          in temples, in states, and in the hands that carried it all.
        </p>
        <span className="gold-line" />
      </div>

      <div className="num-grid">
        <div className="num-cell">
          <div className="num">12<em> L</em><sup>+</sup></div>
          <div className="lbl">Cubic Feet of Stone</div>
          <div className="sub">carved, finished and dispatched from our Sirohi yards to date.</div>
        </div>

        <div className="num-cell">
          <div className="num">100<sup>+</sup></div>
          <div className="lbl">Temples Delivered</div>
          <div className="sub">from village shrines to civilisational landmarks — each built one block at a time.</div>
        </div>

        <div className="num-cell">
          <div className="num">54</div>
          <div className="lbl">Years of Craftsmanship</div>
          <div className="sub">an unbroken line of work, from the first chisel in 1971 to this morning's shift.</div>
        </div>

        <div className="num-cell">
          <div className="num">7<sup>+</sup></div>
          <div className="lbl">States · Across India</div>
          <div className="sub">Rajasthan, Gujarat, UP, Maharashtra, Karnataka, Tamil Nadu, Telangana and beyond.</div>
        </div>
      </div>

      <div className="mission-2033">
        <div>
          <div className="tag">Mission · 2033</div>
          <div className="big">30<em> L</em><sup>+</sup></div>
        </div>
        <p className="copy">
          <b>The next decade of stone</b>
          By 2033, we aim to cross <em>thirty lakh cubic feet</em> of finished stone —
          more than doubling the work of our first fifty-four years.
        </p>
      </div>
    </PageFrame>
  );
}
