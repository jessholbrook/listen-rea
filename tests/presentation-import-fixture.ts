import PptxGenJS from "pptxgenjs";
export async function staticDeck(
  title = "Original company slide",
  wide = false,
) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "Original", width: 10, height: 7.5 });
  pptx.layout = wide ? "LAYOUT_WIDE" : "Original";
  const slide = pptx.addSlide();
  slide.background = { color: "E8EEF8" };
  slide.addText(title, {
    x: 1,
    y: 1,
    w: 7,
    h: 1,
    color: "17205A",
    fontSize: 30,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 1,
    y: 3,
    w: 3,
    h: 1,
    fill: { color: "335577" },
  });
  slide.addNotes("Original speaker notes must stay intact.");
  return Buffer.from(
    (await pptx.write({ outputType: "nodebuffer" })) as Buffer,
  );
}
