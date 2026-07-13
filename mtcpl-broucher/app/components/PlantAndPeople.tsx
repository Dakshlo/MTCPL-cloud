import PageFrame from "./PageFrame";

const MACHINERY = [
  { name: "Gang Saws", note: "Block-cutting", count: "06" },
  { name: "CNC Routers · 3-Axis", note: "Dimensional elements", count: "04" },
  { name: "CNC Routers · 5-Axis", note: "Complex geometry", count: "02" },
  { name: "Wire Saws", note: "Profile cuts", count: "03" },
  { name: "Gantry Cranes", note: "Yard handling", count: "04" },
  { name: "Polishing Lines", note: "Marble & granite finish", count: "05" },
  { name: "Air Compressors", note: "Pneumatic carving", count: "08" },
];

const PEOPLE = [
  { name: "Skilled Carvers", note: "Master chisel hands", count: "150", plus: true },
  { name: "Super-Fine Artists · Orissa", note: "Figure & deity work", count: "50", plus: true },
  { name: "Semi-Skilled Carvers", note: "Supporting craft", count: "100", plus: true },
  { name: "Machine Operators", note: "CNC & gang saw", count: "20", plus: true },
  { name: "Site & Office Staff", note: "Drawing, dispatch, HR", count: "15", plus: true },
  { name: "Helpers", note: "Yard & logistics", count: "15", plus: true },
];

export default function PlantAndPeople() {
  return (
    <PageFrame pageNumber={12} variant="cream" chapter="Plant & People" className="page-plant">
      <div className="header">
        <span className="chapter-label">Plant &amp; People</span>
        <h2>Equipment &amp; <em>craftsmen.</em></h2>
        <p className="lead">
          A working house where machines and hands share the same floor — each one knowing
          exactly where its work ends and the other's begins.
        </p>
        <span className="gold-line" />
      </div>

      <div className="plant-grid">
        {/* LEFT — machinery */}
        <div className="plant-col">
          <h3>Plant · Major Machinery</h3>
          <p className="subtitle">The <em>metal</em> side of the yard.</p>

          {MACHINERY.map((m) => (
            <div key={m.name} className="plant-row">
              <div className="name">
                {m.name}
                <small>{m.note}</small>
              </div>
              <div className="count">{m.count}</div>
            </div>
          ))}

          <div className="plant-total">
            <div className="lbl">Total Installed Units</div>
            <div className="val">32<sup>+</sup></div>
          </div>
        </div>

        {/* RIGHT — people */}
        <div className="plant-col">
          <h3>People · Our Craftsmen</h3>
          <p className="subtitle">The <em>hands</em> behind the stone.</p>

          {PEOPLE.map((p) => (
            <div key={p.name} className="plant-row">
              <div className="name">
                {p.name}
                <small>{p.note}</small>
              </div>
              <div className="count">
                {p.count}{p.plus && <sup>+</sup>}
              </div>
            </div>
          ))}

          <div className="plant-total">
            <div className="lbl">Total Strength · On Rolls</div>
            <div className="val">350<sup>+</sup></div>
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
