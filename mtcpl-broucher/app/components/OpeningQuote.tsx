import PageFrame from "./PageFrame";

export default function OpeningQuote() {
  return (
    <PageFrame pageNumber={3} variant="cream" chapter="Philosophy" className="page-quote">
      <div className="chapter-label">Philosophy</div>

      <span className="corner-ornament tl">॥</span>
      <span className="corner-ornament br">॥</span>

      <div className="content">
        <div className="quote-mark">“</div>
        <blockquote>
          Every stone we shape<br />
          carries a <em>prayer.</em><br />
          Every temple we build<br />
          is an <em>offering.</em>
        </blockquote>
        <div className="rule" />
        <div className="attribution">
          The MTCPL Philosophy
          <small>Since 1971</small>
        </div>
      </div>
    </PageFrame>
  );
}
