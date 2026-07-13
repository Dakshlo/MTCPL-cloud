import EdFrame from "./EdFrame";

export default function EdYard() {
  return (
    <EdFrame pageNumber={11} showFooter={false} className="ed-p11">
      <div className="running-head">
        <span>11 · The Yard</span>
        <span className="center">Sirohi · Rajasthan</span>
        <span>11 / 40</span>
      </div>

      <div className="section-num">§ 03 · Where the Work Lives</div>

      <h1>The <em>Yard.</em></h1>
      <p className="lead">
        A working temple of its own. Gang saws, wire saws, CNC routers, gantry
        cranes and master carvers — all under one roof in Sirohi.
      </p>
      <span className="gold-line" />

      <div className="hero" style={{ backgroundImage: "url(/images/yard-panorama.jpg)" }}>
        <div className="cap">
          The Yard · Panorama
          <em>Where every block of MTCPL stone begins.</em>
        </div>
      </div>

      <div className="strip">
        <div className="ph" style={{ backgroundImage: "url(/images/howwework-cnc.png)" }}>
          <div className="lbl">CNC Hall</div>
        </div>
        <div className="ph" style={{ backgroundImage: "url(/images/howwework-cnc2.jpg)" }}>
          <div className="lbl">Machine Floor</div>
        </div>
        <div className="ph" style={{ backgroundImage: "url(/images/about-construction.jpg)" }}>
          <div className="lbl">Block Yard</div>
        </div>
        <div className="ph" style={{ backgroundImage: "url(/images/howwework-install.jpg)" }}>
          <div className="lbl">Dispatch</div>
        </div>
      </div>

      <p className="closing">
        Every step under <em>one roof</em> — design, carving, finishing, dispatch
        — answered for by the same family that has run this yard since 1971.
      </p>
    </EdFrame>
  );
}
