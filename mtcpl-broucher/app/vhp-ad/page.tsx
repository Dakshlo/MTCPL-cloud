"use client";

export default function VHPAdPage() {
  return (
    <>
      <header className="vhp-toolbar">
        <div className="brand">
          MTCPL · VHP Back Cover Ad
          <small>4.5 × 7.5 in · Full Page</small>
        </div>
        <button className="print-btn" onClick={() => window.print()}>
          🖨️ Save as PDF / Print
        </button>
      </header>

      <main className="vhp-stage">
        <article className="vhp-ad">
          <span className="c-tl" />
          <span className="c-tr" />
          <span className="c-bl" />
          <span className="c-br" />

          <div className="vhp-top">
            <div className="om">॥ श्री राम ॥</div>
            <div className="kicker">With Reverence · Jai Shri Ram</div>
          </div>

          <div className="vhp-hero">
            <div className="cap">
              <small>Flagship Project</small>
              Shri Ram Janmabhoomi · Ayodhya
            </div>
          </div>

          <div className="vhp-portraits">
            <div className="vhp-portrait">
              <div className="photo" style={{ backgroundImage: "url(/images/naresh.jpg)" }} />
              <div className="name">Shri Naresh Lohar</div>
            </div>
            <div className="vhp-portrait">
              <div className="photo" style={{ backgroundImage: "url(/images/rohit.jpg)" }} />
              <div className="name">Shri Rohit Lohar</div>
            </div>
          </div>

          <div className="vhp-ornament">
            <span className="rule" />
            <span className="dot" />
            <span className="rule" />
          </div>

          <div className="vhp-bottom">
            <img src="/logo/logo-dark.png" alt="MTCPL" className="logo" />

            <div className="brand">
              Mateshwari Temples<br />
              Construction <em>Pvt. Ltd.</em>
            </div>

            <div className="addr">
              Opposite Ajari Fatak, Pindwara,<br />
              Sirohi · Rajasthan · India
            </div>

            <div className="web">mateshwaritemple.in</div>

            <div className="since">Established 1971</div>
          </div>
        </article>
      </main>
    </>
  );
}
