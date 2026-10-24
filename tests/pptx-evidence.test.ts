import test from "node:test";
import assert from "node:assert/strict";
import { pptxEvidenceText } from "../src/lib/pptx-evidence";
test("PPTX appendix labels localize, retain exact Unicode quotes and slide ranges, and omit empty evidence", () => {
  const e: any = {
    pptxId: "pptx",
    interviewId: "response",
    turnId: "turn",
    reviewerName: "Researcher",
    reviewedAt: "now",
    verificationVersion: 3,
    passages: [{ slide: 2, start: 8, end: 15, quote: "Café 🧪" }],
  };
  for (const [language, slide, characters] of [
    ["en", "PPTX slide", "characters"],
    ["es", "Diapositiva del PPTX", "caracteres"],
    ["fr", "Diapositive PPTX", "caractères"],
  ] as const) {
    const text = pptxEvidenceText([e], language);
    assert.ok(text.includes(`${slide} 2 · ${characters} 9–15: “Café 🧪”`));
    assert.ok(text.includes("Researcher"));
    assert.ok(text.includes("PPTX: pptx"));
  }
  assert.equal(pptxEvidenceText(undefined), "");
  assert.equal(pptxEvidenceText([]), "");
});
