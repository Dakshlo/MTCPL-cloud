import PageFrame from "./PageFrame";

const STATS_TOP = [
  { num: "100", sup: "+", suffix: "Cr.", label: "Annual Turnover, INR" },
  { num: "55", sup: "+", suffix: "yrs", label: "Years in Stone Construction" },
  { num: "500", sup: "+", suffix: "", label: "Artisans & Site Workforce" },
];

const STATS_BOTTOM = [
  { num: "100", sup: "+", suffix: "", label: "Large-scale Temple Projects" },
  { num: "12L", sup: "+", suffix: "cft", label: "Stone Executed to Date" },
  { num: "30L", sup: "", suffix: "cft", label: "Target by 2033" },
];

const CAPS = [
  { t: "Turnkey", s: "Foundation → pran pratishtha" },
  { t: "Own quarry network", s: "Marble & sandstone" },
  { t: "CNC + wire saw", s: "Precision stone cutting" },
  { t: "Master artisans", s: "Traditional hand carving" },
  { t: "Pan-India sites", s: "Multi-state simultaneous" },
  { t: "Tender-ready", s: "PSU & trust compliant" },
];

export default function AtAGlance() {
  return (
    <PageFrame pageNumber={4} variant="white" showFooter={false} className="page-glance">
      <div className="running-head">
        <span>04 · Company at a glance</span>
        <span className="center">MTCPL</span>
        <span>04 <span className="dot">/</span> 25</span>
      </div>

      <div className="section-num">§ 04</div>

      <div className="header-row">
        <h2>At a <em>glance.</em></h2>
        <p className="intro">
          The measurable ledger of MTCPL — as of this edition. Every figure
          below is either closed on site or budgeted on contract.
        </p>
      </div>

      <span className="h-rule" />

      <div className="glance-stats">
        {STATS_TOP.map((s) => (
          <div key={s.label} className="glance-stat">
            <div className="num">
              {s.num}{s.sup && <sup>{s.sup}</sup>}
              {s.suffix && <sup style={{ fontStyle: "italic", marginLeft: "3px" }}>{s.suffix}</sup>}
            </div>
            <div className="label">{s.label}</div>
          </div>
        ))}
        {STATS_BOTTOM.map((s) => (
          <div key={s.label} className="glance-stat">
            <div className="num">
              {s.num}{s.sup && <sup>{s.sup}</sup>}
              {s.suffix && <sup style={{ fontStyle: "italic", marginLeft: "3px" }}>{s.suffix}</sup>}
            </div>
            <div className="label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="glance-cap">
        <div className="glance-cap-label">Capability in one paragraph</div>

        <div className="glance-body">
          <div className="glance-left">
            <p className="paragraph">
              MTCPL is a <em>turnkey temple construction</em> house. We
              process our own stone — marble and sandstone — through CNC
              routers and diamond wire-saws, detail it under master artisans,
              and install it with in-house site crews. Our work spans the full
              architectural grammar of a Hindu temple:{" "}
              <code>Garbhagriha · Mandap · Shikhara · Kalash</code> — and
              the civil engineering that anchors all of it.
            </p>

            <div className="glance-caps-grid">
              {CAPS.map((c) => (
                <div key={c.t} className="glance-cap-cell">
                  <div className="t">{c.t}</div>
                  <div className="s">{c.s}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glance-photo">
            <div className="photo-tag">Photo · Facility</div>
            <div className="photo-cap">
              <div className="lbl">Facility / Artisan</div>
              <p>Hand-carving detail on sandstone pillar — close-up of artisan chisel.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bottom">
        <span>Mateshwari Temples Construction Pvt. Ltd.</span>
        <span className="ed">Company Profile · Edition 2026</span>
      </div>
    </PageFrame>
  );
}
