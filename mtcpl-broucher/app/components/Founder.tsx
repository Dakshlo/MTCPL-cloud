import PageFrame from "./PageFrame";

export default function Founder() {
  return (
    <PageFrame pageNumber={6} variant="white" chapter="The Founder" className="page-founder">
      <div className="photo">
        <div className="badge">
          The Founder
          <em>Mr. Mancharam Lohar</em>
        </div>
      </div>

      <div className="content">
        <span className="chapter-label">Founder · Chairman · 1971 — 2021</span>

        <h2>Mr. Mancharam<br /><em>Lohar</em></h2>
        <div className="role">In Memoriam · The Founder</div>
        <span className="gold-line" />

        <p className="bio">
          The journey began in 1971 with a small firm — Mahadev Shilp Kala Center —
          in the family's home town of Ajari, Sirohi. From that first chisel, a life
          of stone began: Jammudeep at Hastinapur, and in 2000, the call to Ayodhya
          for the early work on the Ram Mandir.
        </p>
        <p className="bio">
          Mr. Mancharam Lohar passed away in <em>2021</em> — having shaped fifty
          years of stone with his own hands and watched a hundred temples leave his
          yard. His sons, Mr. Naresh Lohar and Mr. Rohit Lohar, now carry the chisel,
          the firm, and the prayer he began.
        </p>

        <div className="pull">
          "A stone doesn't become a deity by accident. It becomes one because
          someone stayed with it — for years, if that's what it took."
          <small>— Mr. Mancharam Lohar</small>
        </div>

        <div className="meta">
          <span>Sirohi · Rajasthan · India</span>
          <b>1971 — 2021</b>
        </div>
      </div>
    </PageFrame>
  );
}
