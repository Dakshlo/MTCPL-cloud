import PageFrame from "./PageFrame";
import IndiaMap from "./IndiaMap";

const STATES = [
  { name: "Rajasthan", region: "Home · Sirohi, Jodhpur", count: "20", plus: true },
  { name: "Gujarat", region: "Ahmedabad, Mehsana", count: "7", plus: true },
  { name: "Uttar Pradesh", region: "Ayodhya, Hastinapur", count: "5", plus: true },
  { name: "Maharashtra", region: "Mumbai, Pune", count: "4", plus: true },
  { name: "Tamil Nadu", region: "Chennai, Ooty", count: "4", plus: true },
  { name: "Madhya Pradesh", region: "Neemuch, Bhopal", count: "3", plus: true },
  { name: "Karnataka", region: "Bangalore, Mysuru", count: "2", plus: true },

  { name: "Haryana", region: "Rohtak, Agroha", count: "3", plus: true },
  { name: "Telangana", region: "Hyderabad, Bhooja", count: "2", plus: true },
  { name: "Odisha", region: "Cuttack · Orissa artists", count: "2", plus: true },
  { name: "West Bengal", region: "Kolkata", count: "1", plus: true },
  { name: "Chhattisgarh", region: "Durg, Raipur", count: "2", plus: true },
  { name: "Punjab", region: "Selected temple work", count: "1", plus: true },
  { name: "Kerala & Others", region: "In planning", count: "—", plus: false },
];

// Ghost map — pins trailing in from the left page into this page
const GHOST_PINS = [
  { x: 318, y: 370 },
  { x: 300, y: 430 },
  { x: 345, y: 555 },
  { x: 440, y: 730 },
  { x: 500, y: 760 },
  { x: 465, y: 625 },
  { x: 535, y: 320 },
  { x: 425, y: 295 },
  { x: 660, y: 445 },
  { x: 625, y: 500 },
];

export default function StateList() {
  return (
    <PageFrame pageNumber={14} variant="cream" chapter="Geographic Reach · By State" className="page-states">
      {/* Ghost India outline + pins bleeding in from the left (transition from page 12) */}
      <div className="ghost-india">
        <IndiaMap pins={GHOST_PINS} showLabels={false} showRings={false} />
      </div>

      <div className="header">
        <span className="chapter-label">Geographic Reach · By State</span>
        <h2>Across seven-plus <em>states.</em></h2>
        <p className="lead">
          The same 100+ temples, counted the other way — state by state, region
          by region, in the order the work arrived.
        </p>
        <span className="gold-line" />
      </div>

      <div className="state-list">
        {STATES.map((s, i) => (
          <div key={s.name} className="state-row">
            <span className="rank">{String(i + 1).padStart(2, "0")}</span>
            <div className="name">
              {s.name}
              <small>{s.region}</small>
            </div>
            <div className="count">
              {s.count}{s.plus && <sup>+</sup>}
            </div>
          </div>
        ))}
      </div>

      <div className="state-summary">
        <div className="lbl">Temples · Across India</div>
        <div className="val">100<sup>+</sup></div>
      </div>
    </PageFrame>
  );
}
