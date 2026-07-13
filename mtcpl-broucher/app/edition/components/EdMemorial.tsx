import EdFrame from "./EdFrame";

export default function EdMemorial() {
  return (
    <EdFrame pageNumber={6} showFooter={false} className="ed-p7">
      <div className="shri">॥ श्री ॥</div>

      <img
        src="/images/mancharam-ji.png"
        alt="Mr. Mancharam Lohar — Founder"
        className="portrait"
      />

      <div className="memorial">
        <div className="lbl">The Founder</div>
        <h1>Mancharam Lohar</h1>
        <div className="years">1950 — 2021</div>
        <span className="rule" />
      </div>
    </EdFrame>
  );
}
