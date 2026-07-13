import EdFrame from "./EdFrame";

/**
 * Page 23 — § 08 · The machine floor. Two workshop plates over an
 * eight-cell machinery register (counts from the plant roster).
 */
const MACHINES = [
  { count: "06", name: "Gang Saws", note: "block-cutting" },
  { count: "04", name: "CNC Routers · 3-Axis", note: "dimensional elements" },
  { count: "02", name: "CNC Routers · 5-Axis", note: "complex geometry" },
  { count: "03", name: "Wire Saws", note: "profile cuts" },
  { count: "04", name: "Gantry Cranes", note: "yard handling" },
  { count: "05", name: "Polishing Lines", note: "marble & granite finish" },
  { count: "08", name: "Air Compressors", note: "pneumatic carving" },
  { count: "32", name: "Machines", note: "on the floor, in total", total: true },
];

export default function EdPlant() {
  return (
    <EdFrame pageNumber={23} showFooter={false} className="ed-p23 ed-works">
      <div className="running-head">
        <span>23 · The Craft</span>
        <span className="center">Plant · Major Machinery</span>
        <span>23 / 40</span>
      </div>

      <div className="section-num">§ 08 · The Craft · continued</div>

      <h1>The metal side<br />of the <em>yard.</em></h1>

      <div className="strap">Plant · Major Machinery</div>

      <div className="plant-plates">
        <figure className="plate">
          <div
            className="img"
            style={{ backgroundImage: "url(/images/temple-sunset.jpg)" }}
          />
          <figcaption>The gang-saw line · Pindwara Works</figcaption>
        </figure>
      </div>

      <div className="plant-grid">
        {MACHINES.map((m) => (
          <div key={m.name} className={`mcell${m.total ? " total" : ""}`}>
            <span className="mc">{m.count}</span>
            <span className="mn">
              {m.name}
              <em>{m.note}</em>
            </span>
          </div>
        ))}
      </div>
    </EdFrame>
  );
}
