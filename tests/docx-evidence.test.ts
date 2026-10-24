import test from "node:test";
import assert from "node:assert/strict";
import { docxEvidenceText } from "../src/lib/docx-evidence";
test("DOCX appendix labels localize, retain exact Unicode quotes and paragraph ranges, and omit empty evidence", () => {
  const e: any = {
    docxId: "docx",
    interviewId: "response",
    turnId: "turn",
    reviewerName: "Researcher",
    reviewedAt: "now",
    verificationVersion: 3,
    passages: [{ paragraph: 2, start: 8, end: 15, quote: "Café 🧪" }],
  };
  for (const [language, paragraph, characters] of [
    ["en", "DOCX paragraph", "characters"],
    ["es", "Párrafo del DOCX", "caracteres"],
    ["fr", "Paragraphe DOCX", "caractères"],
  ] as const) {
    const text = docxEvidenceText([e], language);
    assert.ok(text.includes(`${paragraph} 2 · ${characters} 9–15: “Café 🧪”`));
    assert.ok(text.includes("Researcher"));
    assert.ok(text.includes("DOCX: docx"));
  }
  assert.equal(docxEvidenceText(undefined), "");
  assert.equal(docxEvidenceText([]), "");
});
