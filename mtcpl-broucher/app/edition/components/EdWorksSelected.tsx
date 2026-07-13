import EdFrame from "./EdFrame";

/**
 * Page 20 — Selected works register. Pure typographic index:
 * numeral, name + place, tradition tag. No photographs — the
 * quiet breadth between the flagships, set like a ledger.
 */
const WORKS = [
  {
    n: "VII",
    name: "Jain Mandir",
    loc: "Mount Abu · Rajasthan",
    tag: "Jain Tirth",
  },
  {
    n: "VIII",
    name: "Shri Hanuman Mandir",
    loc: "Mumbai · Maharashtra",
    tag: "Hanuman Mandir",
  },
  {
    n: "IX",
    name: "Jain Mandir",
    loc: "Chennai · Tamil Nadu",
    tag: "Jain Tirth",
  },
  {
    n: "X",
    name: "Baba Ramdev Mandir",
    loc: "Cuttack · Odisha",
    tag: "Regional Shrine",
  },
  {
    n: "XI",
    name: "Jain Temple",
    loc: "Kolkata · West Bengal",
    tag: "Jain Tirth",
  },
  {
    n: "XII",
    name: "Uavasagaram Jain Tirth",
    loc: "Durg · Chhattisgarh",
    tag: "Jain Tirth",
  },
];

export default function EdWorksSelected() {
  return (
    <EdFrame pageNumber={20} showFooter={false} className="ed-p20 ed-works">
      <div className="running-head">
        <span>20 · The Works</span>
        <span className="center">Selected Works</span>
        <span>20 / 40</span>
      </div>

      <div className="section-num">§ 07 · The Works · continued</div>

      <h1>Across faiths,<br />across <em>India.</em></h1>

      <div className="strap">Selected Works · VII — XII</div>

      <div className="register">
        {WORKS.map((w) => (
          <div key={w.n} className="rrow">
            <span className="rnum">{w.n}</span>
            <div className="rinfo">
              <strong>{w.name}</strong>
              <span className="rloc">{w.loc}</span>
            </div>
            <span className="rtag">{w.tag}</span>
          </div>
        ))}
      </div>

      <p className="reg-note">
        …and the ninety more, in towns and villages we still visit.
      </p>
    </EdFrame>
  );
}
