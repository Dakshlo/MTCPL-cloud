import EdFrame from "./EdFrame";

/**
 * Page 14 — Ayodhya · In Frames.
 * Editorial 5-image photo gallery on dark ground.
 * Facing p15 (cream scope panel) and following p13 (sepia divider).
 */
export default function EdRamMandirHero() {
  return (
    <EdFrame pageNumber={14} showFooter={false} className="ed-p14">
      <div className="vignette" aria-hidden />

      <header className="running-head">
        <span>14 · The Flagship · Ayodhya</span>
        <span className="center">MTCPL · Edition 2026</span>
        <span>14 / 40</span>
      </header>

      <div className="ed-head">
        <div className="section-num">§ 05 · The Flagship</div>
        <h2 className="ed-title">
          Ayodhya <span className="dot">·</span> <em>In Frames</em>
        </h2>
      </div>

      <div className="gallery">
        <figure className="g g-hero">
          <div className="g-img" style={{ backgroundImage: "url('/images/ram-mandir-gallery/hero-banner.jpg')" }} />
          <figcaption className="g-cap">
            <span className="g-num">I</span>
            <span className="g-text">East Facade</span>
          </figcaption>
        </figure>

        <figure className="g g-tall">
          <div className="g-img" style={{ backgroundImage: "url('/images/ram-mandir-gallery/about-temple.jpg')" }} />
          <figcaption className="g-cap">
            <span className="g-num">II</span>
            <span className="g-text">Garbhagriha Approach</span>
          </figcaption>
        </figure>

        <figure className="g g-small">
          <div className="g-img" style={{ backgroundImage: "url('/images/ram-mandir-gallery/temple-arch.jpg')" }} />
          <figcaption className="g-cap">
            <span className="g-num">III</span>
            <span className="g-text">Carved Arch</span>
          </figcaption>
        </figure>

        <figure className="g g-mid">
          <div className="g-img" style={{ backgroundImage: "url('/images/ram-mandir-panorama.jpg')" }} />
          <figcaption className="g-cap">
            <span className="g-num">IV</span>
            <span className="g-text">Western Approach</span>
          </figcaption>
        </figure>

        <figure className="g g-wide">
          <div className="g-img" style={{ backgroundImage: "url('/images/ram-mandir-gallery/rm-gallery-1.jpg')" }} />
          <figcaption className="g-cap">
            <span className="g-num">V</span>
            <span className="g-text">Shikhara Rise</span>
          </figcaption>
        </figure>
      </div>

      <div className="ed-foot">
        <span>Photographic plate · 2024</span>
        <span>Ayodhya · Uttar Pradesh</span>
      </div>
    </EdFrame>
  );
}
