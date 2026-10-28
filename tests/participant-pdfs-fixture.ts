import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { participantImageGuide } from "./participant-images-fixture";
export function participantPDFGuide() {
  const g = participantImageGuide();
  g.questions[0].participantImages = false;
  g.questions[0].participantPDFs = true;
  return g;
}
export async function samplePDF(pages = 2, active = false) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  doc.setTitle("Synthetic original private metadata");
  doc.setAuthor("Synthetic original author");
  for (let n = 0; n < pages; n++) {
    const p = doc.addPage([300, 240]);
    p.drawText("Synthetic research PDF page " + (n + 1), {
      x: 20,
      y: 190,
      size: 12,
    });
    if (active) {
      p.node.set(
        PDFName.of("Annots"),
        doc.context.obj([
          {
            Type: "Annot",
            Subtype: "Link",
            Rect: [0, 0, 200, 200],
            A: {
              Type: "Action",
              S: "URI",
              URI: PDFString.of("https://pdf-external.example.test/"),
            },
          },
        ]),
      );
      p.node.set(
        PDFName.of("AA"),
        doc.context.obj({
          O: {
            S: "JavaScript",
            JS: PDFString.of("globalThis.PDF_ACTION_EXECUTED=true"),
          },
        }),
      );
    }
  }
  if (active)
    doc.addJavaScript("fixtureAction", "globalThis.PDF_ACTION_EXECUTED=true");
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
