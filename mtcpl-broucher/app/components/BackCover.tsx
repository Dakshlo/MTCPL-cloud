import PageFrame from "./PageFrame";

export default function BackCover() {
  return (
    <PageFrame pageNumber={25} variant="cover" showFooter={false} className="page-back hero">
      {/* Full-bleed Ram Mandir background */}
      <div className="bg-photo" />

      {/* Double gold inset frame */}
      <div className="frame" />

      {/* Foreground content */}
      <div className="stack">
        {/* Logo only — already includes the MTCPL wordmark */}
        <div className="logo-row">
          <img src="/logo/logo-dark.png" alt="MTCPL" className="mandala" />
        </div>

        {/* Bottom block */}
        <div className="foot-block">
          <div className="ornament">
            <span className="rule" />
            <span className="gem">शुभम्</span>
            <span className="rule" />
          </div>

          <div className="company-name">
            Mateshwari Temples Construction Pvt. Ltd.
          </div>

          <div className="address">
            Opposite Ajari Fatak, Pindwara,<br />
            Sirohi, Rajasthan — 307022 · Bharat
          </div>

          <div className="contact">
            +91 99292 77566
            <span className="sep">·</span>
            +91 94143 74979
            <span className="sep">·</span>
            info@mateshwaritemple.in
          </div>

          <div className="website">www.mateshwaritemple.in</div>
        </div>
      </div>
    </PageFrame>
  );
}
