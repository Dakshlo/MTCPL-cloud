import EdFrame from "./EdFrame";

/**
 * Page 17 — The Making, Part II (stages 04–06).
 * Right page of the process spread; same ledger anatomy as page 16.
 * Closes the Ram Mandir section with a three-cell delivery record.
 */
const STAGES = [
  {
    num: "04",
    name: "The Hand",
    desc: "Chisels find the lines machines cannot.",
    stat: "500+",
    unit: "artisans at peak",
    photo: "/images/carving-detail.png",
    pos: "center",
  },
  {
    num: "05",
    name: "The Dispatch",
    desc: "Each stone leaves knowing its place.",
    stat: "100%",
    unit: "pre-numbered shipments",
    photo: "/images/craft-detail.jpg",
    pos: "center 35%",
  },
  {
    num: "06",
    name: "The Raising",
    desc: "From foundation to kalash, set exactly as drawn.",
    stat: "100+",
    unit: "temples delivered",
    photo: "/images/temple-arch.jpg",
    pos: "center 30%",
  },
];

const RECORD = [
  { v: "100%", l: "On-Time · Ayodhya" },
  { v: "0", l: "Site Rejections" },
  { v: "24", l: "Years Continuous" },
];

export default function EdProcessB() {
  return (
    <EdFrame pageNumber={17} showFooter={false} className="ed-p17 ed-making">
      <div className="running-head">
        <span>17 · The Making</span>
        <span className="center">From Stone to Deity · Part II</span>
        <span>17 / 40</span>
      </div>

      <div className="section-num">§ 06 · From Stone to Deity · continued</div>

      <h1>Shaped by hand,<br /><em>set in place.</em></h1>

      <div className="strap">The Making · Stages 04 — 06</div>

      <div className="ledger">
        {STAGES.map((s) => (
          <div key={s.num} className="lrow">
            <span className="lnum">{s.num}</span>
            <div className="lbody">
              <span className="lname">{s.name}</span>
              <p className="ldesc">{s.desc}</p>
            </div>
            <div className="lstat">
              <span className="v">{s.stat}</span>
              <span className="u">{s.unit}</span>
            </div>
            <div
              className="lphoto"
              style={{ backgroundImage: `url(${s.photo})`, backgroundPosition: s.pos }}
            />
          </div>
        ))}
      </div>

      <div className="mk-record">
        {RECORD.map((r) => (
          <div key={r.l} className="cell">
            <span className="v">{r.v}</span>
            <span className="l">{r.l}</span>
          </div>
        ))}
      </div>
    </EdFrame>
  );
}
