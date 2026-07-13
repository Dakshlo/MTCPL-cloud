import EdFrame from "./EdFrame";

/**
 * Page 8 — Timeline, Part I (1971–2000).
 * Left page of the spread. A single horizontal gold spine runs at a fixed
 * height across BOTH pages 8–9 — it bleeds off this page's right edge and
 * re-enters page 9 from the left, so in spread view it reads as one
 * continuous line of years. Events alternate above/below the line.
 */
const EVENTS = [
  {
    year: "1971",
    stage: "The Beginning",
    desc: "A first chisel at Ajari — the workshop opens.",
    photo: "/images/carving-detail.png",
    pos: "center",
    side: "above",
    hl: false,
  },
  {
    year: "1980s",
    stage: "Rajasthan Years",
    desc: "Jain & mata mandirs — Abu, Pali, Jodhpur.",
    photo: "/images/temple-arch.jpg",
    pos: "center",
    side: "below",
    hl: false,
  },
  {
    year: "1995",
    stage: "Incorporation",
    desc: "The family workshop becomes MTCPL.",
    photo: "/images/about-temple.jpg",
    pos: "center",
    side: "above",
    hl: false,
  },
  {
    year: "2000",
    stage: "The Ayodhya Call",
    desc: "Principal sandstone partner, Shri Ram Janmabhoomi.",
    photo: "/images/ed-arch-corridor.webp",
    pos: "center",
    side: "below",
    hl: true,
  },
];

export default function EdTimelineA() {
  return (
    <EdFrame pageNumber={8} showFooter={false} className="ed-p9 ed-timeline">
      <div className="running-head">
        <span>08 · Timeline</span>
        <span className="center">55 Years in Stone · Part I</span>
        <span>08 / 40</span>
      </div>

      <div className="section-num">§ 03 · The Legacy</div>

      <h1>Fifty-five years<br />in <em>stone.</em></h1>

      <div className="strap">Part I · 1971 — 2000</div>

      <div className="tl-zone">
        <span className="spine" aria-hidden />
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

      <div className="tl-foot">
        <span>Mahadev Shilp Kala Center · Ajari</span>
        <span>Part I of II →</span>
      </div>
    </EdFrame>
  );
}
