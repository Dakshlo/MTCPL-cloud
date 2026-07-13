import EdFrame from "./EdFrame";
import IndiaMap from "../../components/IndiaMap";

/**
 * Page 25 — § 09 · The Reach. Pinned India map beside a state register.
 * Every gold pin marks a temple that left the Pindwara yard.
 */
const PINS = [
  { x: 318, y: 370, label: "Sirohi" },
  { x: 298, y: 380 },
  { x: 330, y: 360 },
  { x: 305, y: 345 },
  { x: 340, y: 390 },
  { x: 280, y: 355 },
  { x: 300, y: 430, label: "Ahmedabad" },
  { x: 285, y: 440 },
  { x: 320, y: 420 },
  { x: 345, y: 555, label: "Mumbai" },
  { x: 395, y: 530, label: "Pune" },
  { x: 455, y: 520 },
  { x: 440, y: 730, label: "Bangalore" },
  { x: 445, y: 758 },
  { x: 500, y: 760, label: "Chennai" },
  { x: 460, y: 835 },
  { x: 465, y: 625, label: "Hyderabad" },
  { x: 490, y: 600 },
  { x: 535, y: 320, label: "Ayodhya" },
  { x: 425, y: 295, label: "Delhi" },
  { x: 405, y: 275 },
  { x: 385, y: 265 },
  { x: 660, y: 445, label: "Kolkata", ongoing: true },
  { x: 625, y: 500, label: "Cuttack", ongoing: true },
  { x: 540, y: 485, label: "Durg", ongoing: true },
  { x: 430, y: 450, label: "Bhopal", ongoing: true },
];

const STATES = [
  { name: "Rajasthan", region: "Sirohi · Jodhpur · Abu", count: "20+" },
  { name: "Gujarat", region: "Ahmedabad · Mehsana", count: "7+" },
  { name: "Uttar Pradesh", region: "Ayodhya · Hastinapur", count: "5+" },
  { name: "Maharashtra", region: "Mumbai · Pune", count: "4+" },
  { name: "Tamil Nadu", region: "Chennai · Ooty", count: "4+" },
  { name: "Madhya Pradesh", region: "Neemuch · Bhopal", count: "3+" },
  { name: "Haryana", region: "Rohtak · Agroha", count: "3+" },
  { name: "Karnataka", region: "Bangalore · Mysuru", count: "2+" },
  { name: "Telangana", region: "Hyderabad · Bhooja", count: "2+" },
  { name: "Odisha & East", region: "Cuttack · Kolkata · Durg", count: "5+" },
];

export default function EdReach() {
  return (
    <EdFrame pageNumber={25} showFooter={false} className="ed-p25 ed-works">
      <div className="running-head">
        <span>25 · The Reach</span>
        <span className="center">Geographic Reach</span>
        <span>25 / 40</span>
      </div>

      <div className="section-num">§ 09 · The Reach</div>

      <h1>Across seven-plus<br /><em>states.</em></h1>

      <div className="strap">Every Pin · A Temple Delivered</div>

      <div className="reach-body">
        <div className="map-wrap">
          <IndiaMap pins={PINS} />
        </div>

        <div className="state-reg">
          {STATES.map((s) => (
            <div key={s.name} className="srow">
              <div className="si">
                <strong>{s.name}</strong>
                <em>{s.region}</em>
              </div>
              <span className="sc">{s.count}</span>
            </div>
          ))}
          <p className="reach-note">…and Kerala, in planning.</p>
        </div>
      </div>
    </EdFrame>
  );
}
