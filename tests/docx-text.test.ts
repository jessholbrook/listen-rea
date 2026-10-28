import test from "node:test";
import assert from "node:assert/strict";
import { validDOCXPassages } from "../src/lib/docx-text";
test("DOCX citations require exact paragraphs, offsets, nonblank quotations and distinct selections", () => {
  const paragraphs = ["Repeat Repeat", "Repeat", "   "];
  const p = { paragraph: 1, start: 7, end: 13, quote: "Repeat" };
  assert.equal(validDOCXPassages(paragraphs, [p]), true);
  assert.equal(validDOCXPassages(paragraphs, []), true);
  for (const changed of [
    { ...p, paragraph: 2 },
    { ...p, paragraph: 0 },
    { ...p, paragraph: 4 },
    { ...p, start: 6 },
    { ...p, end: 14 },
    { ...p, start: -1 },
    { ...p, start: 7.1 },
    { ...p, end: 7 },
    { ...p, quote: "Invented" },
    { paragraph: 3, start: 0, end: 3, quote: "   " },
  ])
    assert.equal(validDOCXPassages(paragraphs, [changed]), false);
  assert.equal(validDOCXPassages(paragraphs, [p, p]), false);
  assert.equal(
    validDOCXPassages(
      ["a".repeat(1001)],
      [{ paragraph: 1, start: 0, end: 1001, quote: "a".repeat(1001) }],
    ),
    false,
  );
});
test("DOCX Unicode citations preserve prepared UTF-16 positions without splitting surrogate pairs", () => {
  const paragraphs = ["Café 🧪 résumé\n次の行"];
  assert.equal(
    validDOCXPassages(paragraphs, [
      { paragraph: 1, start: 5, end: 7, quote: "🧪" },
    ]),
    true,
  );
  assert.equal(
    validDOCXPassages(paragraphs, [
      { paragraph: 1, start: 6, end: 7, quote: "\uDDEA" },
    ]),
    false,
  );
  assert.equal(
    validDOCXPassages(paragraphs, [
      { paragraph: 1, start: 5, end: 6, quote: "\uD83E" },
    ]),
    false,
  );
  const start = paragraphs[0].indexOf("次");
  assert.equal(
    validDOCXPassages(paragraphs, [
      { paragraph: 1, start, end: start + 3, quote: "次の行" },
    ]),
    true,
  );
});
