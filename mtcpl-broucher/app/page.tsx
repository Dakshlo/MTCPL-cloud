"use client";

import Cover from "./components/Cover";
import InsideCover from "./components/InsideCover";
import Contents from "./components/Contents";
import AtAGlance from "./components/AtAGlance";
import LegacyTimeline from "./components/LegacyTimeline";
import Founder from "./components/Founder";
import RamMandirA from "./components/RamMandirA";
import RamMandirB from "./components/RamMandirB";
import WhatWeDo from "./components/WhatWeDo";
import ByTheNumbers from "./components/ByTheNumbers";
import FacilityMosaic from "./components/FacilityMosaic";
import PlantAndPeople from "./components/PlantAndPeople";
import MapPage from "./components/MapPage";
import StateList from "./components/StateList";
import FlagshipProjects from "./components/FlagshipProjects";
import SelectedProjects from "./components/SelectedProjects";
import PortfolioA from "./components/PortfolioA";
import PortfolioB from "./components/PortfolioB";
import HandCraftsmanship from "./components/HandCraftsmanship";
import CNCPrecision from "./components/CNCPrecision";
import Leadership from "./components/Leadership";
import FullTeam from "./components/FullTeam";
import Testimonials from "./components/Testimonials";
import Contact from "./components/Contact";
import BackCover from "./components/BackCover";

export default function Home() {
  return (
    <>
      <header className="toolbar">
        <div className="brand">
          MTCPL
          <small>Company Profile · 2026</small>
        </div>
        <button
          className="print-btn"
          onClick={() => window.print()}
          aria-label="Save as PDF or Print"
        >
          🖨️ Save as PDF / Print
        </button>
      </header>

      <main className="stage">
        <Cover />
        <InsideCover />
        <Contents />
        <AtAGlance />
        <LegacyTimeline />
        <Founder />
        <RamMandirA />
        <RamMandirB />
        <WhatWeDo />
        <ByTheNumbers />
        <FacilityMosaic />
        <PlantAndPeople />
        <MapPage />
        <StateList />
        <FlagshipProjects />
        <SelectedProjects />
        <PortfolioA />
        <PortfolioB />
        <HandCraftsmanship />
        <CNCPrecision />
        <Leadership />
        <FullTeam />
        <Testimonials />
        <Contact />
        <BackCover />
      </main>
    </>
  );
}
