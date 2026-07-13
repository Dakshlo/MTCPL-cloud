import PageFrame from "./PageFrame";

export default function RamMandirA() {
  return (
    <PageFrame pageNumber={7} variant="white" chapter="Flagship Project" className="page-ram-a">
      <div className="hero">
        <div className="overlay">
          <div className="kicker">Flagship Project · Ayodhya</div>
          <h2>
            Shri Ram Janmabhoomi<br />
            <em>Teerth Kshetra</em>
          </h2>
        </div>
      </div>

      <div className="lower">
        <div>
          <span className="chapter-label">Flagship Project</span>
          <p className="lead">
            A <em>civilisational</em> moment — built in part from the stone yards of Sirohi.
          </p>
          <p className="body">
            MTCPL's work on the Ayodhya Ram Mandir began in 2000 with our founder's
            involvement in the earliest phase. Two decades later, the firm supplied over
            seven lakh cubic feet of Bansi Paharpur sandstone to the construction of the
            main shrine and surrounding parkota — a scale of hand-finished temple work
            unseen in modern India.
          </p>
          <p className="body">
            Each block was planned at our Sirohi facility, pre-cut on CNC to dimensional
            tolerance, and hand-finished by master carvers before being dispatched to
            Ayodhya for installation.
          </p>
        </div>

        <div>
          <div className="meta">Project Brief</div>
          <div className="meta-row">
            <div>
              Client
              <b>Shri Ram Janmabhoomi Teerth Kshetra</b>
            </div>
            <div>
              Location
              <b>Ayodhya, Uttar Pradesh</b>
            </div>
            <div>
              Material
              <b>Bansi Paharpur Sandstone</b>
            </div>
            <div>
              Status
              <b>Inaugurated 2024</b>
            </div>
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
