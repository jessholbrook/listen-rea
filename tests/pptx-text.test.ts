import test from "node:test";
import assert from "node:assert/strict";
import { validPPTXPassages } from "../src/lib/pptx-text";
test("PPTX citations require exact slides, offsets, nonblank quotations and distinct selections", () => {
  const slides = ["Repeat Repeat", "Repeat", "   "];
  const p = { slide: 1, start: 7, end: 13, quote: "Repeat" };
  assert.equal(validPPTXPassages(slides, [p]), true);
  assert.equal(validPPTXPassages(slides, []), true);
  for (const changed of [
    { ...p, slide: 2 },
    { ...p, slide: 0 },
    { ...p, slide: 4 },
    { ...p, start: 6 },
    { ...p, end: 14 },
    { ...p, start: -1 },
    { ...p, start: 7.1 },
    { ...p, end: 7 },
    { ...p, quote: "Invented" },
    { slide: 3, start: 0, end: 3, quote: "   " },
  ])
    assert.equal(validPPTXPassages(slides, [changed]), false);
  assert.equal(validPPTXPassages(slides, [p, p]), false);
  assert.equal(
    validPPTXPassages(
      ["a".repeat(1001)],
      [{ slide: 1, start: 0, end: 1001, quote: "a".repeat(1001) }],
    ),
    false,
  );
});
test("PPTX Unicode citations preserve prepared UTF-16 positions without splitting surrogate pairs", () => {
  const slides = ["Café 🧪 résumé\n次の行"];
  assert.equal(
    validPPTXPassages(slides, [{ slide: 1, start: 5, end: 7, quote: "🧪" }]),
    true,
  );
  assert.equal(
    validPPTXPassages(slides, [
      { slide: 1, start: 6, end: 7, quote: "\uDDEA" },
    ]),
    false,
  );
  assert.equal(
    validPPTXPassages(slides, [
      { slide: 1, start: 5, end: 6, quote: "\uD83E" },
    ]),
    false,
  );
  const start = slides[0].indexOf("次");
  assert.equal(
    validPPTXPassages(slides, [
      { slide: 1, start, end: start + 3, quote: "次の行" },
    ]),
    true,
  );
});
