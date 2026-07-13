import EdFrame from "./EdFrame";

/**
 * Page 10 — Atmospheric Interlude.
 * Full-bleed image. No text. The pause between Founder section
 * and Contents/Ram Mandir section.
 *
 * Image: /images/carving-detail.png (swap the file to change visual).
 */
export default function EdInterlude() {
  return (
    <EdFrame pageNumber={10} showFooter={false} className="ed-p10-interlude">
      <div className="bg" />
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
    </EdFrame>
  );
}
