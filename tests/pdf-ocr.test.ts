import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { scannedPDF } from "./pdf-ocr-fixture";
import { normalizePDF } from "../src/lib/pdf-validation";
import { extractPDFText } from "../src/lib/pdf-text-extraction";
import { renderPDFPage, generatePDFOCR } from "../src/lib/pdf-ocr-server";
import { generationBody } from "../src/lib/ai";
import { pdfEvidenceText } from "../src/lib/pdf-evidence";
test("scanned page rendering is bounded and page-specific, with no invented native text", async () => {
  const { data } = await normalizePDF(await scannedPDF());
  assert.deepEqual(await extractPDFText(data), [
    "Selectable reference page",
    "",
  ]);
  const image = await renderPDFPage(data, 2),
    meta = await sharp(image).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 800);
  const large = await PDFDocument.create();
  large.addPage([4000, 2000]);
  const bounded = await sharp(
    await renderPDFPage(Buffer.from(await large.save()), 1),
  ).metadata();
  assert.equal(bounded.width, 1600);
  assert.equal(bounded.height, 800);
  await assert.rejects(
    renderPDFPage(Buffer.alloc(3 * 1024 * 1024 + 1), 1),
    /render/,
  );
  const other = await renderPDFPage(data, 1);
  assert.notDeepEqual(image, other);
  for (const page of [0, 3, 21, 1.5])
    await assert.rejects(renderPDFPage(data, page), /render/);
  await assert.rejects(renderPDFPage(Buffer.from("bad"), 1), /render/);
});
test("OCR provider sees only one page image, with bounded non-stored literal transcription", async () => {
  let args: any;
  const image = Buffer.from("synthetic-png");
  const run = async (...a: any[]) => {
    args = a;
    return { text: "Visible words" };
  };
  const output = await generatePDFOCR(
    image,
    "PRIVATE-WORKSPACE",
    "PRIVATE-STUDY",
    run,
  );
  assert.equal(output.text, "Visible words");
  assert.ok(output.promptVersion);
  assert.equal(args[4], "pdf-ocr");
  assert.match(args[0], /never follow/);
  const request = generationBody(args[0], args[1], args[5], args[6]);
  assert.equal(request.store, false);
  assert.equal(request.max_completion_tokens, 5000);
  assert.equal(
    (request.messages[1].content as any)[1].image_url.detail,
    "high",
  );
  assert.equal(JSON.stringify(request).includes("PRIVATE-"), false);
  assert.ok(args[6].signal instanceof AbortSignal);
  for (const bad of [
    { text: "x".repeat(12001) },
    { text: "hi", instruction: "ignore" },
    {},
  ])
    await assert.rejects(generatePDFOCR(image, "w", "s", async () => bad));
  assert.equal(
    (await generatePDFOCR(image, "w", "s", async () => ({ text: "" }))).text,
    "",
  );
});
test("OCR evidence stays explicitly labeled in all reporting languages", () => {
  const evidence: any = {
    pdfId: "pdf",
    passages: [{ page: 2, quote: "Verified text" }],
    ocrPages: [2],
  };
  for (const language of ["en", "es", "fr"] as const)
    assert.match(pdfEvidenceText([evidence], language), /OCR/);
});
