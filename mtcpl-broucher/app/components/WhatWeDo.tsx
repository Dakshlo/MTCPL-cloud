import PageFrame from "./PageFrame";

const SERVICES = [
  {
    num: "01",
    sym: "✦",
    img: "/images/about-temple.jpg",
    title: "Temple Design & Drawing",
    desc: "Traditional shilpa-shastra principles rendered in modern CAD — plans, elevations and shikhar geometry, ready for carving.",
  },
  {
    num: "02",
    sym: "⎈",
    img: "/images/craft-detail.jpg",
    title: "Hand Stone Carving",
    desc: "Generations of master carvers — from Sirohi, Mount Abu and Orissa — shaping sandstone, marble and granite by chisel.",
  },
  {
    num: "03",
    sym: "◈",
    img: "/images/howwework-cnc.png",
    title: "CNC & 5-Axis Precision",
    desc: "Routers and wire saws holding ±1 mm tolerance on pillars, jaalis and dimensional elements that feed hand work downstream.",
  },
  {
    num: "04",
    sym: "⍟",
    img: "/images/installation-site.jpg",
    title: "On-Site Installation",
    desc: "Site-ready blocks, numbered and sequenced; our own teams travel to set and finish the shrine, parkota and mandapa.",
  },
  {
    num: "05",
    sym: "✴",
    img: "/images/temple-sunset.jpg",
    title: "Temple Restoration",
    desc: "Heritage repair, extension of old shrines, and sympathetic replacement of eroded stonework — stone matched to the original.",
  },
  {
    num: "06",
    sym: "❂",
    img: "/images/project-ramanuja.jpg",
    title: "Deity Statues & Murtis",
    desc: "Full-figure murtis and large-scale deity statues — including works above one hundred feet in height.",
  },
];

export default function WhatWeDo() {
  return (
    <PageFrame pageNumber={9} variant="white" chapter="What We Do" className="page-services">
      <div className="header">
        <span className="chapter-label">What We Do</span>
        <h2>End-to-end temple <em>craft.</em></h2>
        <p className="intro">
          From the first line in CAD to the last chisel on site — a single house for every
          stage of building a temple.
        </p>
        <span className="gold-line" />
      </div>

      <div className="svc-grid">
        {SERVICES.map((s) => (
          <div key={s.num} className="svc">
            <div className="thumb" style={{ backgroundImage: `url(${s.img})` }}>
              <span className="sym">{s.sym}</span>
            </div>
            <div className="num">{s.num} · Service</div>
            <h3 className="title">{s.title}</h3>
            <p className="desc">{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="svc-workflow">
        <p className="copy">
          <em>Every step under one roof</em> — nothing outsourced.
          The hand that shapes the stone answers to the same house that draws the shikhar.
        </p>
        <div className="flow">
          Design <span>›</span> Carve <span>›</span> CNC <span>›</span> Finish <span>›</span> Install
        </div>
      </div>
    </PageFrame>
  );
}
