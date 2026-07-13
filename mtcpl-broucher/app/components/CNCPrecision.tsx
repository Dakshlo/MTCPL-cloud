import PageFrame from "./PageFrame";

export default function CNCPrecision() {
  return (
    <PageFrame pageNumber={20} variant="white" chapter="Precision" className="page-cnc">
      <div className="header">
        <div>
          <span className="chapter-label">Precision</span>
          <h2>CNC at the service of <em>craft.</em></h2>
        </div>
        <div className="side">
          The Yard · Sirohi
          <b>Machine Floor</b>
        </div>
      </div>

      <p className="lead">
        What a router can cut in an hour, a chisel might take a week. What a
        chisel can find in a stone, no router ever will. The two belong together.
      </p>
      <span className="gold-line" />

      {/* Two larger photos — the heart of the floor */}
      <div className="cnc-top-mosaic">
        <div className="tile" style={{ backgroundImage: "url(/images/howwework-cnc.png)" }}>
          <div className="cap">
            Machine Floor
            <em>The CNC hall at the Sirohi yard.</em>
          </div>
        </div>
        <div className="tile" style={{ backgroundImage: "url(/images/howwework-cnc2.jpg)" }}>
          <div className="cap">
            5-Axis Router
            <em>Complex geometry.</em>
          </div>
        </div>
      </div>

      {/* Tight editorial band — no redundant spec table */}
      <div className="cnc-band">
        <div>
          <p>
            The plans are drawn by hand, refined on CAD, and then cut on CNC
            until every pillar, jaali and lintel is ready for a carver to sit
            with it. The last pass is always <em>human.</em>
          </p>
          <p>
            AI-assisted cutting plans now help us sequence blocks across the
            yard — matching each stone to its numbered place in a finished
            mandir, weeks before the first block leaves Sirohi.
          </p>
        </div>

        <blockquote className="aside">
          “A router can cut a line.<br />
          A carver makes a deity listen.”
          <small>— Alkesh Lohar · CAD/CAM Designer</small>
        </blockquote>
      </div>

      {/* Bottom trio — the process in motion */}
      <div className="cnc-bottom-strip">
        <div className="tile" style={{ backgroundImage: "url(/images/yard-panorama.jpg)" }}>
          <div className="lbl">The Yard</div>
        </div>
        <div className="tile" style={{ backgroundImage: "url(/images/trust-construction.jpg)" }}>
          <div className="lbl">Block Prep</div>
        </div>
        <div className="tile" style={{ backgroundImage: "url(/images/howwework-install.jpg)" }}>
          <div className="lbl">Dispatch</div>
        </div>
      </div>
    </PageFrame>
  );
}
