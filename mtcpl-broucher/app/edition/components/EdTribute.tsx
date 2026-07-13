import EdFrame from "./EdFrame";

/**
 * Page 7 — Tribute. Lean memorial editorial.
 * Two short paragraphs + a two-cell fact strip + pull quote + signoff.
 */
export default function EdTribute() {
  return (
    <EdFrame pageNumber={7} showFooter={false} className="ed-p8">
      <div className="running-head">
        <span>07 · Tribute</span>
        <span className="center">In Memoriam · Mancharam Lohar · 1950 — 2021</span>
        <span>07 / 40</span>
      </div>

      <div className="section-num">§ 02 · Memorial</div>

      <h1>A life in <em>stone</em>.</h1>

      <div className="essay">
        <p className="lede">
          Born into a family of carpenters in <em>Ajari</em>, Sirohi — where the
          Aravallis turn to red sandstone — he took up the chisel before he took
          up books, and learned to read a stone the way other men read newsprint.
        </p>

        <div className="fact-strip" aria-label="Key figures">
          <div className="fact">
            <span className="fig">1971</span>
            <span className="lbl">Firm Founded</span>
          </div>
          <div className="fact">
            <span className="fig">24</span>
            <span className="lbl">Years With Ayodhya</span>
          </div>
        </div>

        <div className="pull">
          &ldquo;A stone doesn&rsquo;t become a deity by accident. It becomes one
          because someone stayed with it — for years, if that&rsquo;s what it took.&rdquo;
        </div>

        <p className="close">
          In 2000, the call came from <em>Ayodhya</em>. He became the firm&rsquo;s
          principal sandstone partner to the Janmabhoomi work, and left us in 2021
          — three years before the Pran Pratishtha. The stone he had shaped carried
          his prayer through.
        </p>
      </div>

      <div className="signoff">
        <span>Mancharam Lohar · Founder · 1950 — 2021</span>
        <em>His shilpa lives in every stone we carve.</em>
      </div>
    </EdFrame>
  );
}
