import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { samplePDF } from "./participant-pdfs-fixture";
import { normalizePDF } from "../src/lib/pdf-validation";
import { extractPDFText } from "../src/lib/pdf-text-extraction";
import { validPassages } from "../src/lib/pdf-text-server";
test("prepared PDF text is extracted by physical page without executing embedded actions", async () => {
  const pdf = await normalizePDF(await samplePDF(2, true));
  const pages = await extractPDFText(pdf.data);
  assert.deepEqual(pages, [
    "Synthetic research PDF page 1",
    "Synthetic research PDF page 2",
  ]);
  assert.equal(
    validPassages(pages, [
      { page: 2, start: 0, end: pages[1].length, quote: pages[1] },
    ]),
    true,
  );
  for (const p of [
    { page: 1, start: 0, end: 28, quote: pages[1] },
    { page: 3, start: 0, end: 1, quote: "X" },
    { page: 1, start: 0, end: 0, quote: "" },
  ])
    assert.equal(validPassages(pages, [p]), false);
  const p = { page: 1, start: 0, end: pages[0].length, quote: pages[0] };
  assert.equal(validPassages(pages, [p, p]), false);
});
test("blank/scanned pages have no invented text and invalid PDFs fail extraction", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  assert.deepEqual(await extractPDFText(Buffer.from(await doc.save())), [""]);
  await assert.rejects(
    extractPDFText(Buffer.from("%PDF-1.7 invalid")),
    /Text extraction is unavailable/,
  );
});
