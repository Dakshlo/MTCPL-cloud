import EdFrame from "./EdFrame";

/**
 * Page 15 — Ram Mandir Scope Panel (right of RM spread 1).
 *
 * Cream-paged editorial detail page facing the dark hero of page 14.
 * Carries the data block (5 rows) on the left of the body grid, and a
 * Champat Rai Ji pull-quote panel (portrait + italic Cormorant quote)
 * on the right. Closes with a tiny location stamp.
 */
export default function EdRamMandirScope() {
  return (
    <EdFrame pageNumber={15} showFooter={false} className="ed-p15">
      <div className="running-head">
        <span>15 · Flagship · Ram Janmabhoomi</span>
        <span className="center">MTCPL · Edition 2026</span>
        <span>15 / 40</span>
      </div>

      <div className="section-num">§ 05 · The Flagship Project</div>

      <h1>
        Shri <em>Ram</em> Janmabhoomi
      </h1>
      <h2 className="subtitle">
        Teerth Kshetra <span className="dot-sep">·</span> <em>Ayodhya</em>
      </h2>

      <p className="lead">
        For twenty-four unbroken years, MTCPL stood as the principal
        sandstone partner to the temple at Ayodhya — sourcing,
        carving and dispatching every block of Bansipaharpur red.
      </p>

      <span className="gold-line" />

      <div className="body-grid">
        {/* LEFT — 5-row scope data block */}
        <aside className="scope-block">
          <div className="row hero-row">
            <div className="k">Stone Executed</div>
            <div className="v-hero">
              <span className="num">7 Lakh+</span>
              <span className="unit">cubic feet</span>
            </div>
          </div>

          <div className="row">
            <div className="k">Material</div>
            <div className="v">Bansipaharpur Sandstone</div>
          </div>

          <div className="row">
            <div className="k">Timeline</div>
            <div className="v">2000 — 2024</div>
          </div>

          <div className="row">
            <div className="k">Peak Workforce</div>
            <div className="v">500+ Artisans &amp; Site Staff</div>
          </div>

          <div className="row last">
            <div className="k">MTCPL Role</div>
            <div className="v">Principal Sandstone Partner</div>
          </div>
        </aside>

        {/* RIGHT — Champat Rai Ji pull-quote panel */}
        <aside className="quote-panel">
          <div
            className="portrait"
            style={{ backgroundImage: "url(/images/champat-rai.avif)" }}
            aria-label="Shri Champat Rai Ji"
          />

          <div className="quotemark" aria-hidden="true">
            &ldquo;
          </div>

          <blockquote className="quote">
            The stone that left Pindwara for Ayodhya was not just
            material. It was <em>shraddha</em>, shaped by hands that
            understood what they were carrying.
          </blockquote>

          <div className="attribution">
            <div className="name">— Shri Champat Rai Ji</div>
            <div className="role">
              General Secretary · Shri Ram Janmabhoomi Teerth Kshetra
            </div>
          </div>
        </aside>
      </div>

      <div className="location-stamp">
        Ayodhya · Uttar Pradesh · India
      </div>
    </EdFrame>
  );
}
