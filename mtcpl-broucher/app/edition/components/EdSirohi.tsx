import EdFrame from "./EdFrame";

/**
 * Page 12 — Pindwara: Where We Are.
 *
 * MTCPL is located at Pindwara (Sirohi district, Rajasthan). The Aravallis
 * pass close by, but the stone we work is brought here from elsewhere —
 * Bansipaharpur red sandstone, Makrana white marble, Jaisalmer yellow.
 * This page is about LOCATION (the yard, the place) — not stone origin.
 */
export default function EdSirohi() {
  return (
    <EdFrame pageNumber={12} showFooter={false} className="ed-p12">
      <div className="running-head">
        <span>12 · Pindwara</span>
        <span className="center">Where We Are</span>
        <span>12 / 40</span>
      </div>

      <div className="section-num">§ 04 · The Yard</div>

      <h1>Pindwara.</h1>
      <h2 className="subtitle">
        Our home. Our <em>yard.</em>
      </h2>
      <p className="lead">
        Where the Aravallis fall toward the desert plains of Rajasthan,
        MTCPL has worked the same yard since 1971 — one address, one family,
        one chisel passed down.
      </p>
      <span className="gold-line" />

      <div
        className="hero"
        style={{ backgroundImage: "url(/images/cutted-yard-2.jpg)" }}
      >
        <div className="cap">Pindwara · Sirohi District · Rajasthan</div>
      </div>

      <div className="body-grid">
        <div className="prose">
          <p>
            Pindwara sits in the <em>Sirohi district</em> of southern
            Rajasthan, at the southern shoulder of the Aravalli range. The
            firm was founded here in 1971 and has not moved since.
          </p>
          <p>
            The stone we work is not from Pindwara. Our red sandstone comes
            from <em>Bansipaharpur</em> in Bharatpur, hundreds of kilometres
            away. Our marble comes from <em>Makrana</em>. Yellow sandstone
            from <em>Jaisalmer</em>. Every block arrives here, at our yard
            — and only then does its journey to a temple begin.
          </p>
        </div>

        <aside className="data-block">
          <div className="cell">
            <div className="k">Location</div>
            <div className="v">Pindwara · Sirohi District</div>
          </div>
          <div className="cell">
            <div className="k">State</div>
            <div className="v">Rajasthan · India</div>
          </div>
          <div className="cell">
            <div className="k">Stone Sourced From</div>
            <div className="v">
              Bansipaharpur · Makrana · Jaisalmer
            </div>
          </div>
          <div className="cell">
            <div className="k">Years Here</div>
            <div className="v">1971 — present</div>
          </div>
        </aside>
      </div>
    </EdFrame>
  );
}
