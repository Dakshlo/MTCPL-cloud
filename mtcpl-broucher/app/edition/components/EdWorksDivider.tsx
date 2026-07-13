import EdFrame from "./EdFrame";

/**
 * Page 18 — Section divider for § 07 · The Works.
 * Full-bleed temple at dusk, echo of the page-13 Ayodhya divider:
 * gradient band, centred serif line, corner brackets, no page furniture.
 */
export default function EdWorksDivider() {
  return (
    <EdFrame pageNumber={18} showFooter={false} className="ed-p18">
      <div className="bg" />
      <div className="content">
        <div className="caps">§ 07 · The Works</div>
        <span className="rule" />
        <div className="line">
          One hundred temples,<br /><em>one discipline.</em>
        </div>
        <div className="dates">1971 — 2026 · Across Seven States</div>
      </div>
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
    </EdFrame>
  );
}
