"use client";

import { useState } from "react";
import "./edition.css";
import EdCover from "./components/EdCover";
import EdInsideCover from "./components/EdInsideCover";
import EdAtmospheric from "./components/EdAtmospheric";
import EdShloka from "./components/EdShloka";
import EdMDsLetter from "./components/EdMDsLetter";
import EdContents from "./components/EdContents";
import EdMemorial from "./components/EdMemorial";
import EdTribute from "./components/EdTribute";
import EdTimelineA from "./components/EdTimelineA";
import EdTimelineB from "./components/EdTimelineB";
import EdInterlude from "./components/EdInterlude";
import EdSirohi from "./components/EdSirohi";
import EdAyodhyaDivider from "./components/EdAyodhyaDivider";
import EdRamMandirHero from "./components/EdRamMandirHero";
import EdRamMandirScope from "./components/EdRamMandirScope";
import EdProcessA from "./components/EdProcessA";
import EdProcessB from "./components/EdProcessB";
import EdWorksDivider from "./components/EdWorksDivider";
import EdWorksFlagship from "./components/EdWorksFlagship";
import EdWorksSelected from "./components/EdWorksSelected";
import EdNumbers from "./components/EdNumbers";
import EdServices from "./components/EdServices";
import EdPlant from "./components/EdPlant";
import EdPeople from "./components/EdPeople";
import EdReach from "./components/EdReach";

export default function EditionPage() {
  const [view, setView] = useState<"single" | "spread">("single");

  return (
    <>
      <header className="ed-toolbar">
        <div className="brand">
          MTCPL · Edition 2026
          <small>40-page Company Profile · Pages 1–25</small>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="ed-view-toggle">
            <button
              className={view === "single" ? "active" : ""}
              onClick={() => setView("single")}
            >
              📄 Single
            </button>
            <button
              className={view === "spread" ? "active" : ""}
              onClick={() => setView("spread")}
            >
              📖 Spread
            </button>
          </div>

          <button className="print-btn" onClick={() => window.print()}>
            🖨️ Save as PDF / Print
          </button>
        </div>
      </header>

      <main className={`ed-stage${view === "spread" ? " spread-mode" : ""}`}>
        <EdCover />        {/* 01 */}
        <EdInsideCover />  {/* 02 */}
        <EdAtmospheric />  {/* 03 */}
        <EdShloka />       {/* 04 */}
        <EdMDsLetter />    {/* 05 */}
        <EdMemorial />     {/* 06 */}
        <EdTribute />      {/* 07 */}
        <EdTimelineA />    {/* 08 */}
        <EdTimelineB />    {/* 09 */}
        <EdInterlude />    {/* 10 — full-bleed atmospheric image */}
        <EdContents />     {/* 11 */}
        <EdSirohi />       {/* 12 */}
        <EdAyodhyaDivider /> {/* 13 */}
        <EdRamMandirHero /> {/* 14 */}
        <EdRamMandirScope /> {/* 15 */}
        <EdProcessA />     {/* 16 */}
        <EdProcessB />     {/* 17 */}
        <EdWorksDivider /> {/* 18 */}
        <EdWorksFlagship /> {/* 19 */}
        <EdWorksSelected /> {/* 20 */}
        <EdNumbers />      {/* 21 */}
        <EdServices />     {/* 22 */}
        <EdPlant />        {/* 23 */}
        <EdPeople />       {/* 24 */}
        <EdReach />        {/* 25 */}
      </main>
    </>
  );
}
