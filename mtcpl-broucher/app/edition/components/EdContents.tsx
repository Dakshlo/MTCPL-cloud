import EdFrame from "./EdFrame";

const ACT_I = {
  marker: "§ I",
  name: "Arrival",
  meta: "Cover & Opening · 5 Pages",
  rows: [
    { num: "01", label: "Cover" },
    { num: "02", label: "Inside Cover · Tagline" },
    { num: "03", label: "Atmospheric Opening" },
    { num: "04", label: "The Builders' Invocation" },
    { num: "05", label: "A Letter from the Lohar Brothers" },
  ],
};

const ACT_II = {
  marker: "§ II",
  name: "Founder & Heritage",
  meta: "1950 — 2021 · 6 Pages",
  rows: [
    { num: "06", label: "Memorial Portrait · Mancharamji" },
    { num: "07", label: "Tribute Essay · A life in stone" },
    { num: "08", label: "Timeline I · 1971 → 2000" },
    { num: "09", label: "Timeline II · 2010 → today" },
    { num: "10", label: "Interlude · Atmospheric" },
    { num: "11", label: "Contents · This page" },
  ],
};

function Column({
  data,
  side,
}: {
  data: typeof ACT_I;
  side: "left" | "right";
}) {
  return (
    <div className={`ctn-col ${side}`}>
      <div className="card-head">
        <div className="marker">{data.marker}</div>
        <div className="name">{data.name}</div>
        <div className="meta">{data.meta}</div>
      </div>
      {data.rows.map((r) => (
        <div key={r.num} className="ctn-row">
          <div className="num">{r.num}</div>
          <div className="label">{r.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function EdContents() {
  return (
    <EdFrame pageNumber={11} showFooter={false} className="ed-contents-page">
      {/* Top header */}
      <div className="ctn-head">
        <div className="om">॥ अनुक्रमणिका ॥</div>
        <h1>Contents.</h1>
        <p className="lead">
          Two acts · eleven pages · drafted so far.
        </p>
        <span className="gold-bar" />
      </div>

      {/* Two columns of acts */}
      <Column data={ACT_I} side="left" />
      <Column data={ACT_II} side="right" />

      {/* Bottom footer */}
      <div className="ctn-foot">
        <span>Mateshwari Temples Construction Pvt. Ltd.</span>
        <em>Edition 2026 · Pages 12 – 40 to come</em>
      </div>
    </EdFrame>
  );
}
