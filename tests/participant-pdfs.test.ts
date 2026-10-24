import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { normalizePDF } from "../src/lib/pdf-validation";
import { samplePDF } from "./participant-pdfs-fixture";
test("PDF preparation keeps static pages, removes document/page actions and annotations, and produces deterministic private retry bytes", async () => {
  const source = await samplePDF(2, true),
    a = await normalizePDF(source),
    b = await normalizePDF(source);
  assert.equal(a.pages, 2);
  assert.deepEqual(a.data, b.data);
  const prepared = await PDFDocument.load(a.data);
  assert.equal(prepared.getTitle(), undefined);
  assert.equal(prepared.getAuthor(), undefined);
  assert.equal(prepared.catalog.has(PDFName.of("Names")), false);
  assert.equal(prepared.catalog.has(PDFName.of("OpenAction")), false);
  for (const p of prepared.getPages()) {
    assert.equal(p.node.has(PDFName.of("Annots")), false);
    assert.equal(p.node.has(PDFName.of("AA")), false);
  }
  assert.equal(a.data.includes(Buffer.from("PDF_ACTION_EXECUTED")), false);
});
test("PDF preparation rejects invalid, oversized, over-page-limit, encrypted and interactive-form documents", async () => {
  await assert.rejects(normalizePDF(Buffer.from("%PDF-1.7\nnot a PDF")));
  await assert.rejects(normalizePDF(Buffer.alloc(3 * 1024 * 1024 + 1)));
  await assert.rejects(normalizePDF(await samplePDF(21)));
  const form = await PDFDocument.create();
  form.addPage();
  form.getForm().createTextField("secret");
  await assert.rejects(normalizePDF(Buffer.from(await form.save())));
  const encrypted = Buffer.from(
    (await samplePDF(1))
      .toString("latin1")
      .replace("trailer\n<<", "trailer\n<< /Encrypt 1 0 R"),
    "latin1",
  );
  await assert.rejects(normalizePDF(encrypted));
});
