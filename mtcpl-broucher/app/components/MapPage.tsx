import PageFrame from "./PageFrame";
import IndiaMap from "./IndiaMap";

const PINS = [
  // ——— Rajasthan cluster (home turf — no labels, cluster density) ———
  { x: 318, y: 370, label: "Sirohi" },
  { x: 298, y: 380 },
  { x: 330, y: 360 },
  { x: 305, y: 345 },
  { x: 340, y: 390 },
  { x: 280, y: 355 },

  // ——— Gujarat ———
  { x: 300, y: 430, label: "Ahmedabad" },
  { x: 285, y: 440 },
  { x: 320, y: 420, label: "Mehsana" },

  // ——— Maharashtra ———
  { x: 345, y: 555, label: "Mumbai" },
  { x: 395, y: 530, label: "Pune" },
  { x: 455, y: 520 },

  // ——— Karnataka / Tamil Nadu ———
  { x: 440, y: 730, label: "Bangalore" },
  { x: 445, y: 758, label: "Ooty" },
  { x: 500, y: 760, label: "Chennai" },
  { x: 460, y: 835 },

  // ——— Telangana / Andhra ———
  { x: 465, y: 625, label: "Hyderabad" },
  { x: 490, y: 600 },

  // ——— Northern belt ———
  { x: 535, y: 320, label: "Ayodhya" },
  { x: 425, y: 295, label: "Delhi" },
  { x: 405, y: 275, label: "Rohtak" },
  { x: 385, y: 265, label: "Agroha" },

  // ——— Ongoing — eastern states ———
  { x: 660, y: 445, label: "Kolkata", ongoing: true },
  { x: 625, y: 500, label: "Cuttack", ongoing: true },
  { x: 540, y: 485, label: "Durg", ongoing: true },
  { x: 430, y: 450, label: "Bhopal", ongoing: true },
];

export default function MapPage() {
  return (
    <PageFrame pageNumber={13} variant="white" chapter="Geographic Reach" className="page-map">
      <div className="header">
        <span className="chapter-label">Geographic Reach</span>
        <h2>One hundred temples,<br />across <em>India.</em></h2>
        <p className="lead">
          A quiet map of fifty-four years of work — every gold pin below marks a temple,
          a deity or a shrine that left our yards in Sirohi.
        </p>
        <span className="gold-line" />
      </div>

      <div className="india-wrap">
        <IndiaMap pins={PINS} />
      </div>

      <div className="map-legend">
        <div className="item">
          <span className="dot" />
          Completed
          <span className="count">80<sup>+</sup></span>
        </div>
        <div className="item ongoing">
          <span className="dot" />
          Ongoing
          <span className="count">20<sup>+</sup></span>
        </div>
        <div className="item">
          States
          <span className="count">11</span>
        </div>
      </div>
    </PageFrame>
  );
}
