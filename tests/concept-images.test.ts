import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guideSchema } from "../src/lib/domain";
import { imageGuide } from "./concept-images-fixture";
import { compileConceptGuide } from "../src/lib/concepts";
import { publicInterview } from "../src/lib/http";
import { emotionInterview } from "./emotion-fixture";
test("Uploaded concept schema requires exclusive image source, an accessible description and valid asset IDs; assignments freeze references and current-only projections", () => {
  const ids = [randomUUID(), randomUUID()],
    g = imageGuide(ids);
  assert.ok(guideSchema.safeParse(g).success);
  for (const patch of [
    { imageAssetId: "bad-id" },
    { imageAlt: "" },
    { imageUrl: "https://example.test/image.png" },
  ]) {
    const bad = structuredClone(g);
    Object.assign(bad.conceptTest!.concepts[0], patch);
    assert.equal(guideSchema.safeParse(bad).success, false);
  }
  const compiled = compileConceptGuide(g, () => 0).guide;
  g.conceptTest!.concepts[0].imageAssetId = randomUUID();
  assert.equal(compiled.conceptTest!.concepts[0].imageAssetId, ids[0]);
  const i = { ...emotionInterview(), guide: compiled, current: 1 };
  const safe = publicInterview(i, true);
  assert.equal(safe.guide.conceptTest!.concepts.length, 1);
  assert.equal(safe.guide.conceptTest!.concepts[0].imageAssetId, ids[0]);
  assert.equal(JSON.stringify(safe).includes(ids[1]), false);
});
