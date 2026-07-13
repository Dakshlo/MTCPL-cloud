import EdFrame from "./EdFrame";

/**
 * Page 16 — The Making, Part I (stages 01–03).
 * Left page of the process spread. A three-row ledger: ghosted stage
 * number, name + one line, one bold stat, photo. Hairline row rules.
 * Continues overleaf on page 17 (04–06).
 */
const STAGES = [
  {
    num: "01",
    name: "The Stone",
    desc: "Bansipaharpur red from Bharatpur — chosen block by block.",
    stat: "7L+",
    unit: "ft³ for Ayodhya",
    photo: "/images/yard-panorama.jpg",
    pos: "center 60%",
  },
  {
    num: "02",
    name: "The Journey",
    desc: "Every block travels home to the Pindwara yard.",
    stat: "50+",
    unit: "trucks a week · peak",
    photo: "/images/cutted-yard.png",
    pos: "center",
  },
  {
    num: "03",
    name: "The Cut",
    desc: "CAD-mapped and CNC-cut before the first chisel.",
    stat: "±1",
    unit: "mm tolerance",
    photo: "/images/howwework-cnc.png",
    pos: "center",
  },
];

export default function EdProcessA() {
  return (
    <EdFrame pageNumber={16} showFooter={false} className="ed-p16 ed-making">
      <div className="running-head">
        <span>16 · The Making</span>
        <span className="center">From Stone to Deity · Part I</span>
        <span>16 / 40</span>
      </div>

      <div className="section-num">§ 06 · From Stone to Deity</div>

      <h1>From Pindwara,<br />to <em>Garbhagriha.</em></h1>

      <div className="strap">The Making · Stages 01 — 03</div>

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

      <div className="mk-foot">
        <span>Pindwara Works · Sirohi District</span>
        <span>Stages 04 — 06 overleaf →</span>
      </div>
    </EdFrame>
  );
}
