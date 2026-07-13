import EdFrame from "./EdFrame";

/**
 * Page 9 — Timeline, Part II (2010–2024).
 * Right page of the spread. The gold spine enters from the left edge
 * (continuing page 8's line through the gutter) and terminates in a
 * filled diamond. Closes with the story told in four numbers.
 */
const EVENTS = [
  {
    year: "2010",
    stage: "South India",
    desc: "Statue of Equality rises at Hyderabad.",
    photo: "/images/project-ramanuja.jpg",
    pos: "center 30%",
    side: "above",
    hl: false,
  },
  {
    year: "2020",
    stage: "Peak Output",
    desc: "Weekly stone convoys leave Pindwara for Ayodhya.",
    photo: "/images/project-ram-mandir.jpg",
    pos: "center",
    side: "below",
    hl: false,
  },
  {
    year: "2021",
    stage: "In Memoriam",
    desc: "Mancharamji passes. The yard keeps carving.",
    photo: "/images/mancharam-ji.png",
    pos: "center 15%",
    side: "above",
    hl: true,
  },
  {
    year: "2024",
    stage: "Pran Pratishtha",
    desc: "The Mandir is consecrated at Ayodhya.",
    photo: "/images/ram-mandir-hero.jpg",
    pos: "center 40%",
    side: "below",
    hl: true,
  },
];

const STATS = [
  { num: "55", small: "", lbl: "Years in Stone" },
  { num: "100", small: "+", lbl: "Temples Delivered" },
  { num: "7", small: "L+", lbl: "Ft³ for Ayodhya" },
  { num: "2", small: "", lbl: "Generations" },
];

export default function EdTimelineB() {
  return (
    <EdFrame pageNumber={9} showFooter={false} className="ed-p10 ed-timeline">
      <div className="running-head">
        <span>09 · Timeline</span>
        <span className="center">55 Years in Stone · Part II</span>
        <span>09 / 40</span>
      </div>

      <div className="section-num">§ 03 · The Legacy · continued</div>

      <h1>Through Ayodhya,<br /><em>and onwards.</em></h1>

      <div className="strap">Part II · 2010 — Today</div>

      <div className="tl-zone">
        <span className="spine" aria-hidden />
        <span className="spine-end" aria-hidden />
        {EVENTS.map((e, i) => (
          <div
            key={e.year}
            className={`ev ${e.side}${e.hl ? " hl" : ""}`}
            style={{ gridColumn: i + 1 }}
          >
            {e.side === "above" ? (
              <>
                <div
                  className="photo"
                  style={{ backgroundImage: `url(${e.photo})`, backgroundPosition: e.pos }}
                />
                <span className="era">{e.stage}</span>
                <p className="desc">{e.desc}</p>
                <span className="year">{e.year}</span>
              </>
            ) : (
              <>
                <span className="year">{e.year}</span>
                <span className="era">{e.stage}</span>
                <p className="desc">{e.desc}</p>
                <div
                  className="photo"
                  style={{ backgroundImage: `url(${e.photo})`, backgroundPosition: e.pos }}
                />
              </>
            )}
          </div>
        ))}
        {EVENTS.map((e, i) => (
          <span
            key={`n-${e.year}`}
            className={`node${e.hl ? " filled" : ""}`}
            style={{ gridColumn: i + 1 }}
            aria-hidden
          />
        ))}
      </div>

      <div className="tl-stats">
        {STATS.map((s) => (
          <div key={s.lbl} className="cell">
            <span className="num">
              {s.num}
              {s.small && <small>{s.small}</small>}
            </span>
            <span className="lbl">{s.lbl}</span>
          </div>
        ))}
      </div>
    </EdFrame>
  );
}
