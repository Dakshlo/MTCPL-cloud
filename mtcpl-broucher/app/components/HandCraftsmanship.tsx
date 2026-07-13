import PageFrame from "./PageFrame";

export default function HandCraftsmanship() {
  return (
    <PageFrame pageNumber={19} variant="dark" chapter="The Craft" className="page-hands">
      <div className="bg" />

      <div className="top-caption">
        <div className="label">The Craft · By Hand</div>
        <div className="side">
          Sirohi · Rajasthan<br />
          Master carver, second generation
        </div>
      </div>

      <div className="content">
        <div className="kicker">Chapter · Hand Craftsmanship</div>

        <h1>
          The hand that<br />
          <em>shapes</em> divinity.
        </h1>

        <span className="gold-line" />

        <div className="body">
          <div>
            <p>
              Five generations of hands. Every line you see on one of our temples
              began here — a human hand, a chisel, and a prayer the carver keeps
              quietly to himself.
            </p>
            <p>
              Machines can match a <em>measurement,</em> but not a soul. A plinth
              can be cut by a router; a bhaav — the small softening around a
              deity's eye, the breath along a flute — must be found by a finger
              that has worked stone for forty years.
            </p>
            <p>
              That is why, for all the CNC in our yard, the last pass over every
              sacred stone is still done by hand.
            </p>
          </div>

          <blockquote className="pull">
            “When the chisel slows, it is because the stone has started
            speaking. We just listen.”
            <small>— A master carver, Sirohi yard</small>
          </blockquote>
        </div>
      </div>
    </PageFrame>
  );
}
