import EdFrame from "./EdFrame";

/**
 * Page 2 — Inside Cover.
 * Hero set in Tiro Devanagari Hindi — a calligraphic, epigraphic face built
 * for inscriptional use; reads as carved-into-stone rather than digital.
 * Single line, flat ink (no faux emboss — premium-print convention).
 */
export default function EdInsideCover() {
  return (
    <EdFrame pageNumber={2} showFooter={false} className="ed-p2">
      <div className="content">
        <div className="invocation">॥ श्री गणेशाय नमः ॥</div>

        <div className="flourish" aria-hidden="true">
          <span className="rule" />
          <span className="diamond" />
          <span className="rule" />
        </div>

        <h1 className="hindi-tag">पत्थर से प्रतिमा तक</h1>
        <span className="hero-rule" aria-hidden="true" />
        <p className="subtitle">From Stone to Deity</p>

        <div className="signature">Mateshwari Temples · Since 1971</div>
      </div>
    </EdFrame>
  );
}
