import EdFrame from "./EdFrame";

/**
 * Page 13 — Sub-divider: The Crowning Work.
 *
 * Full-bleed atmospheric photograph of the Ram Mandir at twilight,
 * processed with a sepia + slight-darken filter to evoke dusk reverence.
 * No body copy, no running head, no footer page badge.
 *
 * Opens the Ayodhya chapter that follows.
 *
 * Image: /images/temple-twilight.jpg
 */
export default function EdAyodhyaDivider() {
  return (
    <EdFrame pageNumber={13} showFooter={false} className="ed-p13">
      <div className="bg" />
      <span className="section-mark">§ 02</span>
      <div className="shri-ram">॥ श्री राम ॥</div>
      <div className="center-block">
        <div className="kicker">THE CROWNING WORK</div>
        <div className="rule" />
        <div className="line">
          Where a life&rsquo;s work became a nation&rsquo;s prayer.
        </div>
        <div className="dates">Ayodhya &mdash; 2000 &mdash; 2024</div>
      </div>
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
    </EdFrame>
  );
}
