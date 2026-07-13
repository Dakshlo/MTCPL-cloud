import PageFrame from "./PageFrame";

export default function FacilityMosaic() {
  return (
    <PageFrame pageNumber={11} variant="white" chapter="Our Facility" className="page-facility">
      <div className="header">
        <span className="chapter-label">Our Facility</span>
        <h2>Where stone<br />becomes <em>art.</em></h2>
        <p className="lead">
          Our yard in Sirohi, Rajasthan — a working temple of its own. Gang saws, wire saws,
          CNC routers and gantry cranes move block after block through a house run by
          <em> hand, not by the hour.</em>
        </p>
        <span className="gold-line" />
      </div>

      <div className="mosaic">
        <div className="tile large" style={{ backgroundImage: "url(/images/yard-panorama.jpg)" }}>
          <div className="cap">
            Main Yard · Sirohi
            <em>The panorama of the working floor.</em>
          </div>
        </div>
        <div className="tile" style={{ backgroundImage: "url(/images/howwework-cnc.png)" }}>
          <div className="cap">
            CNC Hall
            <em>Precision routing &amp; 5-axis cuts.</em>
          </div>
        </div>
        <div className="tile" style={{ backgroundImage: "url(/images/howwework-cnc2.jpg)" }}>
          <div className="cap">
            Machining Floor
            <em>Gang saws &amp; wire saws.</em>
          </div>
        </div>
      </div>

      <div className="facility-footer">
        <div className="stat">Location<b>Sirohi · Rajasthan</b></div>
        <div className="stat">Covered Area<b>50,000+ sq ft</b></div>
        <div className="stat">Open Yard<b>2+ acres</b></div>
        <div className="stat">Throughput<b>Round-the-clock</b></div>
      </div>
    </PageFrame>
  );
}
