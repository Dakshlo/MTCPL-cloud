import PageFrame from "./PageFrame";

export default function InsideCover() {
  return (
    <PageFrame pageNumber={2} variant="ivory" showFooter={false} className="page-inside-cover">
      <div className="content">
        <div className="omkar">॥ ॐ ॥</div>
        <div className="kicker">A Prayer</div>
        <span className="rule" />

        <div className="shloka">
          त्वमेव माता च पिता त्वमेव।<br />
          त्वमेव बन्धुश्च सखा त्वमेव॥
        </div>

        <p className="translation">
          “You alone are mother and father, you alone are kin and friend —
          you alone are everything.”
        </p>

        <div className="attribution">Traditional Sanskrit Prayer</div>

        <div className="dedication">
          <b>Dedicated To</b>
          Every stonemason, sculptor and sevak whose
          hands have carried the craft of the temple forward —
          from our founder to the youngest chisel in our yard today.
          <div className="signature">— The Lohar Family</div>
        </div>
      </div>
    </PageFrame>
  );
}
