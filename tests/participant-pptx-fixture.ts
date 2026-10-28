import JSZip from "jszip";
import { participantDOCXGuide } from "./participant-docx-fixture";
export const presentationNS =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
export const drawingNS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
export const relationshipNS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const packageNS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export function participantPPTXGuide() {
  const g = participantDOCXGuide();
  g.questions[0].participantDOCX = false;
  (g.questions[0] as any).participantPPTX = true;
  return g;
}
export const pptxShape = (text: string, hidden = false) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="1" name="Text" hidden="${hidden ? 1 : 0}"/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
export const slideXML = (body: string, hidden = false) =>
  `<p:sld xmlns:p="${presentationNS}" xmlns:a="${drawingNS}" xmlns:r="${relationshipNS}" show="${hidden ? 0 : 1}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
export async function samplePPTX(
  slides = ["Synthetic PPTX research note", "Save draft before review."],
  change?: (zip: JSZip) => void,
) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, n) => `<Override PartName="/ppt/slides/slide${n + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="${packageNS}"><Relationship Id="root" Type="${relationshipNS}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  // Reverse physical ZIP numbering to verify that presentation relationships determine order.
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="${presentationNS}" xmlns:r="${relationshipNS}"><p:sldIdLst>${slides.map((_, n) => `<p:sldId id="${256 + n}" r:id="rId${slides.length - n}"/>`).join("")}</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="${packageNS}">${slides.map((_, n) => `<Relationship Id="rId${n + 1}" Type="${relationshipNS}/slide" Target="slides/slide${n + 1}.xml"/>`).join("")}</Relationships>`,
  );
  slides.forEach((text, n) =>
    zip.file(
      `ppt/slides/slide${slides.length - n}.xml`,
      slideXML(pptxShape(text)),
    ),
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    "<notes>PRIVATE-SPEAKER-NOTE-SENTINEL</notes>",
  );
  zip.file(
    "ppt/comments/comment1.xml",
    "<comments>PRIVATE-COMMENT-SENTINEL</comments>",
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    "<master>PRIVATE-MASTER-SENTINEL</master>",
  );
  zip.file("docProps/core.xml", "<metadata>PRIVATE-AUTHOR-SENTINEL</metadata>");
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships xmlns="${packageNS}"><Relationship Id="external" Type="${relationshipNS}/hyperlink" Target="https://pptx-external.example.test/" TargetMode="External"/></Relationships>`,
  );
  change?.(zip);
  zip.forEach((_, entry) => {
    entry.date = new Date("2000-01-01T00:00:00.000Z");
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
