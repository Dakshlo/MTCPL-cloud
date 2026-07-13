import EdFrame from "./EdFrame";

export default function EdShloka() {
  return (
    <EdFrame pageNumber={4} showFooter={false} className="ed-p4">
      <div className="content">
        <div className="omkar">॥ ॐ ॥</div>
        <div className="kicker">The Builders' Invocation</div>
        <span className="rule" />

        <div className="shloka">
          विश्वकर्मन् <span className="gold">नमस्तुभ्यं</span>।<br />
          विश्वात्मन् विश्वसम्भव॥<br />
          अपहत्य च ये विघ्नान् <span className="gold">सर्वकर्मसु सिद्धिदः</span>॥
        </div>

        <p className="translation">
          Salutations to <em>Vishvakarma</em> — soul of the universe,
          source of all creation. May every obstacle fall away, and may
          every stone we shape <em>find its perfection.</em>
        </p>

        <div className="attribution">
          Vishvakarma Stuti
          <em>Traditional · Recited at the laying of the first stone</em>
        </div>
      </div>
    </EdFrame>
  );
}
