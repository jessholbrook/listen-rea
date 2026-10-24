import test from "node:test";
import assert from "node:assert/strict";
import {
  samplePPTX,
  slideXML,
  pptxShape,
  presentationNS,
  drawingNS,
  relationshipNS,
  packageNS,
} from "./participant-pptx-fixture";
import { preparePPTX } from "../src/lib/pptx-preparation";
test("PPTX preparation follows presentation order, keeps Unicode/table text and excludes notes, masters, metadata, links and hidden content without collapsing slide numbers", async () => {
  const a = await preparePPTX(await samplePPTX()),
    b = await preparePPTX(await samplePPTX());
  assert.deepEqual(a, b);
  assert.equal(a.slides, 2);
  assert.deepEqual(JSON.parse(a.data.toString()).slides, [
    "Synthetic PPTX research note",
    "Save draft before review.",
  ]);
  assert.ok(!a.data.toString().includes("SENTINEL"));
  assert.ok(!a.data.toString().includes("https://"));
  const hidden = await preparePPTX(
    await samplePPTX(undefined, (z) => {
      z.file(
        "ppt/slides/slide2.xml",
        slideXML(pptxShape("PRIVATE-HIDDEN-SLIDE-SENTINEL"), true),
      );
      z.file(
        "ppt/slides/slide1.xml",
        slideXML(
          pptxShape("PRIVATE-HIDDEN-SHAPE-SENTINEL", true) +
            pptxShape("Español &amp; français 😊") +
            `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Table text</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
        ),
      );
    }),
  );
  assert.deepEqual(JSON.parse(hidden.data.toString()).slides, [
    "",
    "Español & français 😊\nTable text",
  ]);
  assert.ok(!hidden.data.toString().includes("SENTINEL"));
  const group = await preparePPTX(
    await samplePPTX(undefined, (z) =>
      z.file(
        "ppt/slides/slide2.xml",
        slideXML(
          `<p:grpSp><p:nvGrpSpPr><p:cNvPr hidden="1"/></p:nvGrpSpPr>${pptxShape("PRIVATE-HIDDEN-GROUP-SENTINEL")}</p:grpSp>` +
            pptxShape("Visible group sibling"),
        ),
      ),
    ),
  );
  assert.equal(
    JSON.parse(group.data.toString()).slides[0],
    "Visible group sibling",
  );
});
test("PPTX preparation rejects malformed, macro/embedded, encrypted, external/missing/duplicate slide references, unsafe XML and resource overflow without partial extraction", async () => {
  const cases = [
    Buffer.from("not a PPTX"),
    Buffer.alloc(0),
    await samplePPTX(undefined, (z) => z.file("ppt/vbaProject.bin", "macro")),
    await samplePPTX(undefined, (z) =>
      z.file("ppt/embeddings/object.bin", "embedded"),
    ),
    await samplePPTX(undefined, (z) =>
      z.file("[Content_Types].xml", "<Types/>"),
    ),
    await samplePPTX(["x".repeat(200001)]),
    await samplePPTX(new Array(101).fill("slide")),
    await samplePPTX([""]),
    await samplePPTX(undefined, (z) => z.remove("ppt/slides/slide1.xml")),
    await samplePPTX(undefined, (z) =>
      z.file(
        "ppt/slides/slide1.xml",
        `<!DOCTYPE x [<!ENTITY steal SYSTEM "file:///etc/passwd">]><p:sld xmlns:p="${presentationNS}"/>`,
      ),
    ),
    await samplePPTX(undefined, (z) =>
      z.file(
        "ppt/_rels/presentation.xml.rels",
        `<Relationships xmlns="${packageNS}"><Relationship Id="rId2" Type="${relationshipNS}/slide" Target="https://example.test/a.xml" TargetMode="External"/></Relationships>`,
      ),
    ),
    await samplePPTX(undefined, (z) =>
      z.file(
        "ppt/_rels/presentation.xml.rels",
        `<Relationships xmlns="${packageNS}"><Relationship Id="rId2" Type="${relationshipNS}/slide" Target="../private.xml"/></Relationships>`,
      ),
    ),
    await samplePPTX(undefined, (z) =>
      z.file(
        "ppt/presentation.xml",
        `<p:presentation xmlns:p="${presentationNS}" xmlns:r="${relationshipNS}"><p:sldIdLst><p:sldId id="1" r:id="rId1"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>`,
      ),
    ),
    await samplePPTX(undefined, (z) =>
      z.file(
        "ppt/slides/slide2.xml",
        slideXML(pptxShape("Depth") + "<a:x>".repeat(65) + "</a:x>".repeat(65)),
      ),
    ),
    await samplePPTX(undefined, (z) =>
      z.file("ppt/media/large.bin", Buffer.alloc(2 * 1024 * 1024 + 1)),
    ),
    await samplePPTX(undefined, (z) => {
      for (let i = 0; i < 1001; i++) z.file("extra/" + i, "x");
    }),
    await samplePPTX(undefined, (z) => z.file("../escape.txt", "bad")),
  ];
  for (const bytes of cases)
    await assert.rejects(preparePPTX(bytes), /Upload a PPTX/);
  const encrypted = await samplePPTX();
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  await assert.rejects(preparePPTX(encrypted), /Upload a PPTX/);
  await assert.rejects(
    preparePPTX(Buffer.alloc(3 * 1024 * 1024 + 1)),
    /at most 3 MB/,
  );
});
test("Real generated PowerPoint files preserve slide text and omit speaker notes", async () => {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck
    .addSlide()
    .addText("First real slide")
    .addNotes("PRIVATE-SPEAKER-NOTE-SENTINEL");
  deck.addSlide().addText("Second real slide");
  const result = await preparePPTX(
    Buffer.from((await deck.write({ outputType: "nodebuffer" })) as Buffer),
  );
  assert.deepEqual(JSON.parse(result.data.toString()).slides, [
    "First real slide",
    "Second real slide",
  ]);
  assert.ok(!result.data.toString().includes("SENTINEL"));
});
