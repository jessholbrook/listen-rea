import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema } from "../src/lib/domain";
import { prototypeGuide, alphaPrototype } from "./prototypes-fixture";
import { compileConceptGuide } from "../src/lib/concepts";
import {
  guideFields,
  guideSource,
  applyFields,
  validateFields,
} from "../src/lib/localization";
import { translatedFields } from "./localization-fixture";
test("Prototype URLs require explicit HTTPS without credentials/controls and task instructions; concept assignment preserves static URL bytes", () => {
  const g = prototypeGuide();
  assert.ok(guideSchema.safeParse(g).success);
  for (const prototypeUrl of [
    "javascript:alert(1)",
    "data:text/html,test",
    "http://example.test",
    "https://user:pass@example.test",
    "https:example.test",
    "https://example.test/a b",
    "https://example.test/\\path",
    "https://example.test/\tpath",
  ]) {
    const bad = structuredClone(g);
    bad.conceptTest!.concepts[0].prototypeUrl = prototypeUrl;
    assert.equal(guideSchema.safeParse(bad).success, false, prototypeUrl);
  }
  const bad = structuredClone(g);
  bad.conceptTest!.concepts[0].taskInstructions = " ";
  assert.equal(guideSchema.safeParse(bad).success, false);
  bad.conceptTest!.concepts[0].prototypeUrl = null;
  bad.conceptTest!.concepts[0].taskInstructions = "A text-only task.";
  assert.ok(guideSchema.safeParse(bad).success);
  const compiled = compileConceptGuide(g, () => 0);
  g.conceptTest!.concepts[0].prototypeUrl = "https://changed.example.test";
  assert.equal(
    compiled.guide.conceptTest!.concepts[0].prototypeUrl,
    alphaPrototype,
  );
});
test("Task instructions translate with stable URLs/IDs and invalidate old translation fingerprints on edits", () => {
  const g = prototypeGuide(),
    original = guideSource(g);
  assert.ok(guideFields(g).some((f) => f.label.includes("taskInstructions")));
  for (const language of ["es", "fr"] as const) {
    const fields = translatedFields(g, language);
    validateFields(g, fields);
    const out = guideSchema.parse(applyFields(g, fields));
    assert.notEqual(
      out.conceptTest!.concepts[0].taskInstructions,
      g.conceptTest!.concepts[0].taskInstructions,
    );
    assert.equal(out.conceptTest!.concepts[0].prototypeUrl, alphaPrototype);
    assert.equal(
      out.conceptTest!.concepts[0].id,
      g.conceptTest!.concepts[0].id,
    );
  }
  g.conceptTest!.concepts[0].taskInstructions = "Changed task.";
  assert.notEqual(guideSource(g), original);
});
