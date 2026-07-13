import EdFrame from "./EdFrame";

export default function EdAtmospheric() {
  return (
    <EdFrame pageNumber={3} showFooter={false} className="ed-p3">
      <div className="bg" />
      <span className="corner-tl" />
      <span className="corner-tr" />
      <span className="corner-bl" />
      <span className="corner-br" />
    </EdFrame>
  );
}
