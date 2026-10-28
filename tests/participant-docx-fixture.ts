import JSZip from "jszip";
import { participantPDFGuide } from "./participant-pdfs-fixture";
export const wordNS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export function participantDOCXGuide() {
  const g = participantPDFGuide();
  g.questions[0].participantPDFs = false;
  (g.questions[0] as any).participantDOCX = true;
  return g;
}
export async function sampleDOCX(body?: string, change?: (zip: JSZip) => void) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${wordNS}"><w:body>${body || "<w:p><w:r><w:t>Synthetic DOCX research note</w:t></w:r></w:p><w:p><w:hyperlink><w:r><w:t>Save draft before review.</w:t></w:r></w:hyperlink><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN-SENTINEL</w:t></w:r><w:del><w:r><w:delText>DELETED-SENTINEL</w:delText></w:r></w:del></w:p>"}</w:body></w:document>`,
  );
  zip.file("docProps/core.xml", "<metadata>PRIVATE-AUTHOR-SENTINEL</metadata>");
  zip.file(
    "word/comments.xml",
    "<comments>PRIVATE-COMMENT-SENTINEL</comments>",
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships><Relationship Target="https://docx-external.example.test/" TargetMode="External"/></Relationships>',
  );
  change?.(zip);
  zip.forEach((_, entry) => {
    entry.date = new Date("2000-01-01T00:00:00.000Z");
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
