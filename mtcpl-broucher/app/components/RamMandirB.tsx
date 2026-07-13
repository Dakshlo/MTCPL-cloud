import PageFrame from "./PageFrame";

export default function RamMandirB() {
  return (
    <PageFrame pageNumber={8} variant="ivory" chapter="Flagship Project" className="page-ram-b">
      <div className="stats">
        <div className="s">
          <div className="num">7<sup>L+</sup></div>
          <div className="lbl">Cubic Feet</div>
          <div className="sub">of sandstone carved and dispatched from Sirohi.</div>
        </div>
        <div className="s">
          <div className="num">4</div>
          <div className="lbl">Years · Execution</div>
          <div className="sub">from groundwork to the 2024 pran-pratishtha.</div>
        </div>
        <div className="s">
          <div className="num">500<sup>+</sup></div>
          <div className="lbl">Artisans</div>
          <div className="sub">engaged across the yard and the Ayodhya site.</div>
        </div>
      </div>

      <div className="body-grid">
        <div>
          <h3>
            The scale of a <em>generational</em><br />
            undertaking.
          </h3>
          <p>
            Over four years, the MTCPL yard in Sirohi ran around the clock — gang saws
            cutting the raw Bansi Paharpur blocks, CNC routers holding ±1mm tolerance on
            dimensional elements, and master carvers from Rajasthan and Odisha finishing
            every visible surface by hand.
          </p>
          <p>
            At peak activity, convoys of fifty-plus trucks a week moved finished stone
            from our facility to Ayodhya. The logistical coordination alone — matching
            individual carved blocks to their numbered positions inside the shrine — was
            built on the same blueprints our founder began studying in 2000.
          </p>
          <p>
            For us, the project was never a contract. It was a prayer the whole firm
            carried together.
          </p>
        </div>

        <div className="aside">
          <div className="label">Highlights</div>
          <div className="line"><b>Stone</b>Bansi Paharpur sandstone, hand-picked at quarry</div>
          <div className="line"><b>Tolerance</b>±1 mm dimensional precision via CNC</div>
          <div className="line"><b>Crew</b>Master carvers from Sirohi, Orissa &amp; Mount Abu</div>
          <div className="line"><b>Logistics</b>50+ truck dispatches per week at peak</div>
          <div className="line"><b>Role</b>Principal sandstone supplier &amp; carving partner</div>
        </div>
      </div>

      <div className="photo-strip">
        <div className="ph" style={{ backgroundImage: "url(/images/about-construction.jpg)" }} />
        <div className="ph" style={{ backgroundImage: "url(/images/temple-arch.jpg)" }} />
        <div className="ph" style={{ backgroundImage: "url(/images/carving-detail.png)" }} />
      </div>
    </PageFrame>
  );
}
