import test from "node:test";
import assert from "node:assert/strict";
import { sampleDOCX, wordNS } from "./participant-docx-fixture";
import { prepareDOCX } from "../src/lib/docx-preparation";
test("DOCX preparation keeps readable ordered body text and strips hidden/deleted text, metadata, comments and external targets", async () => {
  const a = await prepareDOCX(await sampleDOCX()),
    b = await prepareDOCX(await sampleDOCX());
  assert.deepEqual(a, b);
  assert.equal(a.paragraphs, 2);
  assert.deepEqual(JSON.parse(a.data.toString()).paragraphs, [
    "Synthetic DOCX research note",
    "Save draft before review.",
  ]);
  assert.ok(!a.data.toString().includes("SENTINEL"));
  assert.ok(!a.data.toString().includes("https://"));
  const hidden = await prepareDOCX(
    await sampleDOCX(
      "<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>PRIVATE-PARAGRAPH</w:t></w:r></w:p><w:p><w:r><w:t>Visible paragraph</w:t></w:r></w:p>",
    ),
  );
  assert.deepEqual(JSON.parse(hidden.data.toString()).paragraphs, [
    "Visible paragraph",
  ]);
  const unicode = await prepareDOCX(
    await sampleDOCX(
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Español &amp; français 😊</w:t><w:tab/><w:t>Next</w:t><w:br/><w:t>Line</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    ),
  );
  assert.equal(
    JSON.parse(unicode.data.toString()).paragraphs[0],
    "Español & français 😊\tNext\nLine",
  );
});
test("Malformed, encrypted/macro archives, unsafe XML, excessive expansion, depth, entries, paragraphs and text are rejected without partial extraction", async () => {
  const cases = [
    Buffer.from("not a DOCX"),
    Buffer.alloc(0),
    await sampleDOCX(undefined, (z) => z.file("word/vbaProject.bin", "macro")),
    await sampleDOCX(undefined, (z) =>
      z.file("[Content_Types].xml", "<Types/>"),
    ),
    await sampleDOCX(undefined, (z) =>
      z.file(
        "word/document.xml",
        `<!DOCTYPE x [<!ENTITY steal SYSTEM "file:///etc/passwd">]><w:document xmlns:w="${wordNS}"><w:body><w:p><w:r><w:t>&steal;</w:t></w:r></w:p></w:body></w:document>`,
      ),
    ),
    await sampleDOCX(
      "<w:p><w:r><w:t>" + "x".repeat(200001) + "</w:t></w:r></w:p>",
    ),
    await sampleDOCX("<w:p/>".repeat(2001)),
    await sampleDOCX(
      "<w:sdt>".repeat(65) +
        "<w:p><w:r><w:t>Deep</w:t></w:r></w:p>" +
        "</w:sdt>".repeat(65),
    ),
    await sampleDOCX(undefined, (z) =>
      z.file("word/media/large.bin", Buffer.alloc(2 * 1024 * 1024 + 1)),
    ),
    await sampleDOCX(undefined, (z) => {
      for (let i = 0; i < 301; i++) z.file("extra/" + i, "x");
    }),
    await sampleDOCX(undefined, (z) => z.file("../escape.txt", "bad")),
    await sampleDOCX(undefined, (z) =>
      z.file(
        "word/styles.xml",
        `<w:styles xmlns:w="${wordNS}"><w:style><w:rPr><w:vanish/></w:rPr></w:style></w:styles>`,
      ),
    ),
  ];
  for (const bytes of cases)
    await assert.rejects(prepareDOCX(bytes), /Upload a DOCX/);
  const invalid = await sampleDOCX();
  invalid.writeUInt16LE(invalid.readUInt16LE(6) | 1, 6);
  await assert.rejects(prepareDOCX(invalid), /Upload a DOCX/);
  await assert.rejects(
    prepareDOCX(Buffer.alloc(3 * 1024 * 1024 + 1)),
    /at most 3 MB/,
  );
});
