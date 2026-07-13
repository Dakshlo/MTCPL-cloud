import PageFrame from "./PageFrame";

const VOICES = [
  {
    name: "Champat Rai Ji",
    role: "General Secretary",
    desc: "Shri Ram Janmabhoomi Teerth Kshetra, Ayodhya",
    photo: "/images/voice-champat-rai.jpg",
    fallback: "/images/champat-rai.avif",
  },
  {
    name: "Mahant Balaknath Ji",
    role: "Member of Legislative Assembly",
    desc: "Rajasthan · Religious Leader & Temple Trustee",
    photo: "/images/voice-mahant-balaknath.jpg",
    fallback: "/images/mahant-balaknath.avif",
  },
  {
    name: "Jupally Rameshwar Rao",
    role: "Founder · My Home Group",
    desc: "Principal Donor · Statue of Equality, Hyderabad",
    photo: "/images/voice-jupally.jpg",
    fallback: "/images/contact-guru.avif",
  },
  {
    name: "Mohan Bhagwat Ji",
    role: "Sarsanghchalak · Chief",
    desc: "Rashtriya Swayamsevak Sangh (RSS)",
    photo: "/images/voice-mohan-bhagwat.jpg",
    fallback: "/images/founder.jpg",
  },
];

export default function Testimonials() {
  return (
    <PageFrame pageNumber={23} variant="white" showFooter={false} className="page-testimonials">
      <div className="running-head">
        <span>23 · Voices</span>
        <span className="center">MTCPL</span>
        <span>23 <span className="dot">/</span> 25</span>
      </div>

      <div className="section-num">§ 23 · Endorsements</div>

      <h2>Faith endorsed by<br /><em>distinguished leaders.</em></h2>

      <p className="lead">
        The custodians, patrons and statesmen who have stood beside MTCPL's work — at
        consecrations, on site visits, and at the trust tables where every commission begins.
      </p>

      <span className="header-rule" />

      <div className="voices-grid">
        {VOICES.map((v) => (
          <div key={v.name} className="voice-card">
            <div
              className="photo"
              style={{ backgroundImage: `url(${v.photo}), url(${v.fallback})` }}
            />
            <div className="cap">
              <h3 className="name">{v.name}</h3>
              <div className="role">{v.role}</div>
              <div className="desc">{v.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bottom">
        <div className="caption">
          Photographed at site visits, consecrations and felicitation events · 2022 — 2024
        </div>
        <div className="footer-row">
          <span>Mateshwari Temples Construction Pvt. Ltd.</span>
          <span className="ed">Company Profile · Edition 2026</span>
        </div>
      </div>
    </PageFrame>
  );
}
