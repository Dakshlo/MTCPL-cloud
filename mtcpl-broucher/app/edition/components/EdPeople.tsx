import EdFrame from "./EdFrame";

/**
 * Page 24 — § 08 · The people. Workforce ledger — the yard's living
 * strength — closing with the 350+ band.
 */
const PEOPLE = [
  { count: "150+", name: "Skilled Carvers", note: "master chisel hands" },
  { count: "50+", name: "Super-Fine Artists", note: "Orissa · figure & deity work" },
  { count: "100+", name: "Semi-Skilled Carvers", note: "supporting craft" },
  { count: "20+", name: "Machine Operators", note: "CNC & gang saw" },
  { count: "15+", name: "Site & Office Staff", note: "drawing, dispatch, HR" },
  { count: "15+", name: "Helpers", note: "yard & logistics" },
];

export default function EdPeople() {
  return (
    <EdFrame pageNumber={24} showFooter={false} className="ed-p24 ed-works">
      <div className="running-head">
        <span>24 · The Craft</span>
        <span className="center">People · On the Rolls</span>
        <span>24 / 40</span>
      </div>

      <div className="section-num">§ 08 · The Craft · continued</div>

      <h1>Three hundred and<br />fifty <em>hands.</em></h1>

      <div className="strap">People · On the Rolls</div>

      <div className="crew">
        {PEOPLE.map((p) => (
          <div key={p.name} className="crow">
            <span className="cc">{p.count}</span>
            <div className="ci">
              <strong>{p.name}</strong>
              <em>{p.note}</em>
            </div>
          </div>
        ))}
      </div>

      <div className="crew-band">
        <span className="b-tag">On the rolls today</span>
        <span className="b-num">
          350<small>+</small>
        </span>
        <span className="b-line">
          Many trained by Mancharamji himself — the yard&rsquo;s living strength.
        </span>
      </div>
    </EdFrame>
  );
}
