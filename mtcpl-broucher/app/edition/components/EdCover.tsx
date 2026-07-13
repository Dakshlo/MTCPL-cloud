import EdFrame from "./EdFrame";

export default function EdCover() {
  return (
    <EdFrame pageNumber={1} showFooter={false} className="ed-p1">
      {/* Full-bleed Ram Mandir shikhara photograph */}
      <div className="bg" />

      {/* Double gold inset frame */}
      <div className="frame" />

      {/* Top tagline */}
      <div className="top-mark">Mateshwari Temples Construction</div>

      {/* Centered logo — gold mandala + white MTCPL wordmark */}
      <div className="logo-stack">
        <img src="/logo/logo-white.png" alt="MTCPL" className="full-logo" />
        <div className="est">Since 1971</div>
      </div>

      {/* Bottom taglines — English + Hindi */}
      <div className="taglines">
        <p className="english">
          Preserving <em>Dharma,</em><br />
          through stone.
        </p>
        <span className="rule" />
        <div className="hindi">पत्थर से प्रतिमा तक</div>
      </div>
    </EdFrame>
  );
}
