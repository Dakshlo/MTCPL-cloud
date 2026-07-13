import PageFrame from "./PageFrame";

const ENQUIRIES = [
  {
    title: "For a trust / private commission",
    sub: "Enquiries · Directors' office",
  },
  {
    title: "For tender submissions",
    sub: "Tender cell · capability dossier on request",
  },
  {
    title: "For collaborations & architects",
    sub: "Studio · partnerships desk",
  },
  {
    title: "For press & facility visits",
    sub: "Communications · scheduled walk-throughs",
  },
];

export default function Contact() {
  return (
    <PageFrame pageNumber={24} variant="white" showFooter={false} className="page-contact">
      <div className="running-head">
        <span>24 · Contact</span>
        <span className="center">MTCPL</span>
        <span>24 <span className="dot">/</span> 25</span>
      </div>

      <div className="section-num">§ 24</div>

      <h2>To <em>commission</em><br />a temple.</h2>

      <span className="header-rule" />

      <div className="contact-split">
        {/* LEFT */}
        <div className="contact-left">
          <p className="intro">
            For temple trusts, private patrons, tendering officers, and architectural
            studios — the same inbox. We read everything. Expect a considered reply
            within three working days.
          </p>

          <div className="lbl">Website</div>
          <div className="web">mateshwaritemple.in</div>

          <div className="enq-section">
            <div className="enq-head">Direction of Enquiry</div>
            {ENQUIRIES.map((e) => (
              <div key={e.title} className="enq-row">
                <div className="title">{e.title}</div>
                <div className="sub">{e.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — dark */}
        <div className="contact-right">
          <div className="lbl">Facility Visit</div>

          <h3>
            We keep the facility open to trusts and prospective patrons by appointment.
          </h3>

          <span className="gold-rule" />

          <p className="body">
            A typical visit runs ninety minutes — quarry yard, wire-saw, CNC floor,
            artisan bays, dry-fit hall. Directors are usually in attendance. Tea is served.
          </p>

          <p className="quote">
            "Please do come. The floor has a voice of its own."
          </p>
          <div className="attribution">— Directors</div>

          <img src="/logo/logo-light.png" alt="" className="ornament" />
        </div>
      </div>

      <div className="bottom">
        <div className="welcome">
          <span className="hi">स्वागतम्</span>
          <span className="sep">·</span>
          Welcome
        </div>
        <div className="footer-row">
          <span>Mateshwari Temples Construction Pvt. Ltd.</span>
          <span className="ed">Company Profile · Edition 2026</span>
        </div>
      </div>
    </PageFrame>
  );
}
