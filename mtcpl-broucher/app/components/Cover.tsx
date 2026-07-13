import PageFrame from "./PageFrame";

export default function Cover() {
  return (
    <PageFrame pageNumber={1} variant="cover" showFooter={false}>
      {/* gold corner brackets */}
      <div className="cover-silver-brackets">
        <span className="tl" />
        <span className="tr" />
        <span className="bl" />
        <span className="br" />
      </div>

      <div className="cover-stage">
        {/* CENTRAL TYPOGRAPHY */}
        <div className="cover-center">
          <div className="cover-shree">॥ श्री ॥</div>
          <div className="kicker" style={{ marginTop: "12mm" }}>
            Mateshwari Temple Construction Pvt. Ltd.
          </div>
          <img src="/logo/logo-dark.png" alt="MTCPL" className="wordmark" />
          <div className="hindi-big">पत्थर से प्रतिमा तक</div>

          <div className="hr-row" style={{ marginTop: "12mm" }}>
            <span className="rule" />
            <span className="dot" />
            <span className="rule" />
          </div>

          <div className="display">
            Preserving <em>Dharma,</em><br />
            through stone.
          </div>
        </div>

        {/* BOTTOM BAR — centered */}
        <div className="cover-bottom-bar" style={{ justifyContent: "center" }}>
          <div className="center">
            A Company Profile
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
