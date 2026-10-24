import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guideSchema } from "../src/lib/domain";
import { guideFields, applyFields } from "../src/lib/localization";
import { optionImageGuide } from "./option-images-fixture";
import { translatedFields } from "./localization-fixture";
import { advanceInterview, optionsFor } from "../src/lib/mixed";
import { publicInterview } from "../src/lib/http";
import { currentImageOptions } from "../src/lib/option-images";

test("Image choice validation and translation preserve immutable image/option IDs and require accessible descriptions", () => {
  const g = optionImageGuide([randomUUID(), randomUUID()]);
  for (const patch of [
    { imageAssetId: "bad" },
    { imageAlt: " " },
    { imageAlt: "x".repeat(501) },
  ]) {
    const bad = structuredClone(g);
    Object.assign(bad.questions[0].options[0], patch);
    assert.equal(guideSchema.safeParse(bad).success, false);
  }
  const bad = structuredClone(g);
  bad.questions[0].type = "matrix";
  assert.equal(guideSchema.safeParse(bad).success, false);
  assert.ok(
    guideFields(g).some((f) => f.text === "Green design image description"),
  );
  for (const language of ["es", "fr"] as const) {
    const translated = applyFields(g, translatedFields(g, language));
    assert.equal(
      translated.questions[0].options[0].imageAssetId,
      g.questions[0].options[0].imageAssetId,
    );
    assert.match(
      translated.questions[0].options[0].imageAlt!,
      language === "es" ? /^ES / : /^FR /,
    );
  }
});
test("Randomization/carry-forward preserve image identity; participant projections and image gates reveal only answerable current options", () => {
  const g = optionImageGuide([randomUUID(), randomUUID(), randomUUID()]);
  const i: any = {
    id: "i",
    guide: g,
    current: 0,
    status: "active",
    turns: [],
    version: 0,
  };
  advanceInterview(i, -1, () => 0);
  assert.deepEqual(
    optionsFor(i, g.questions[0]).map((o) => o.id),
    ["b", "a"],
  );
  assert.equal(
    currentImageOptions(i)[0].imageAssetId,
    g.questions[0].options[1].imageAssetId,
  );
  let dto = publicInterview(i, true);
  assert.equal(dto.guide.questions[3].options[0].imageAssetId, undefined);
  i.turns.push({ questionId: "pick", optionId: "a", followUp: false });
  advanceInterview(i, 0);
  assert.equal(
    optionsFor(i, g.questions[1])[0].imageAssetId,
    g.questions[0].options[1].imageAssetId,
  );
  dto = publicInterview(i, true);
  assert.equal(dto.optionAssignments!.pick[0].imageAssetId, undefined);
  assert.equal(
    dto.optionAssignments!.remaining[0].imageAssetId,
    g.questions[0].options[1].imageAssetId,
  );
  advanceInterview(i, 1);
  assert.equal(
    optionsFor(i, g.questions[2])[0].imageAssetId,
    g.questions[0].options[1].imageAssetId,
  );
  assert.equal(
    currentImageOptions(i)[0].imageAssetId,
    g.questions[0].options[1].imageAssetId,
  );
  i.status = "completed";
  assert.deepEqual(currentImageOptions(i), []);
  assert.equal(g.questions[0].options[0].imageAssetId !== undefined, true);
});
