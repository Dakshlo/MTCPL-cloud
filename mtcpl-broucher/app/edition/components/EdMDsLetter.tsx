import EdFrame from "./EdFrame";

export default function EdMDsLetter() {
  return (
    <EdFrame pageNumber={5} showFooter={false} className="ed-p5">
      <div className="running-head">
        <span>05 · Foreword</span>
        <span className="center">MTCPL · Edition 2026</span>
        <span>05 / 40</span>
      </div>

      <div className="section-num">§ 01 · A Letter</div>

      <h1>A letter from the<br /><em>Lohar brothers.</em></h1>

      {/* Two separate portraits side by side */}
      <div className="mds-portraits">
        <figure className="md-portrait">
          <div
            className="photo"
            style={{ backgroundImage: "url(/images/naresh.jpg)" }}
          />
          <figcaption>
            <strong>Naresh Lohar</strong>
            <span>Managing Director</span>
          </figcaption>
        </figure>
        <figure className="md-portrait">
          <div
            className="photo"
            style={{ backgroundImage: "url(/images/rohit.jpg)" }}
          />
          <figcaption>
            <strong>Rohit Lohar</strong>
            <span>Managing Director</span>
          </figcaption>
        </figure>
      </div>

      <p className="letter">
        For fifty-five years, our family has spent its life with stone. Our father,
        <em> Mancharam Lohar,</em> opened a small workshop in Ajari in 1971. From
        that first stone, <em>more than a hundred temples</em> have been built
        across India. The work he gave most of his later years to was Ayodhya.
        He left us in 2021, before the shrine was opened — but the stone he had
        shaped carried his prayer through.
      </p>
      <p className="letter">
        What he left us was simple: a yard, a way of working, and a name that
        does not change with the market. We have tried to honour that. To temple
        trusts, we still come to the meeting ourselves. To contractors and
        tendering officers — L&amp;T, Tata Projects, the PSUs — we now bring
        machines, plans, dispatch records and a full capability dossier behind
        every project.
      </p>

      <div className="signoff-line">
        <span className="rule" />
        <em>— The Lohar Brothers</em>
        <span className="rule" />
      </div>
    </EdFrame>
  );
}
