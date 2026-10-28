import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guideSchema } from "../src/lib/domain";
import { rankingMaxdiffImageGuide } from "./ranking-maxdiff-images-fixture";
import { maxdiffInterview } from "./maxdiff-fixture";
import { beginMaxdiff, maxdiffPrompt, applyMaxdiff } from "../src/lib/maxdiff";
import { currentImageOptions } from "../src/lib/option-images";
import { publicInterview } from "../src/lib/http";
import { applyFields, guideSource } from "../src/lib/localization";
import { translatedFields } from "./localization-fixture";
test("Ranking and MaxDiff image descriptions validate and translate with stable asset/item IDs and invalidate prior translation sources", () => {
  const g = rankingMaxdiffImageGuide([
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ]);
  for (const mutate of [
    (x: any) => (x.questions[0].options[0].imageAlt = " "),
    (x: any) => (x.questions[1].maxdiff.items[0].imageAlt = " "),
    (x: any) => (x.questions[1].maxdiff.items[0].imageAssetId = "bad"),
    (x: any) => (x.questions[1].maxdiff.items[0].text = ""),
  ]) {
    const bad = structuredClone(g);
    mutate(bad);
    assert.equal(guideSchema.safeParse(bad).success, false);
  }
  for (const language of ["es", "fr"] as const) {
    const local = applyFields(g, translatedFields(g, language));
    assert.equal(
      local.questions[1].maxdiff!.items[0].imageAssetId,
      g.questions[1].maxdiff!.items[0].imageAssetId,
    );
    assert.match(
      local.questions[1].maxdiff!.items[0].imageAlt!,
      language === "es" ? /^ES / : /^FR /,
    );
  }
  const changed = structuredClone(g);
  changed.questions[1].maxdiff!.items[0].imageAssetId = randomUUID();
  assert.notEqual(guideSource(g), guideSource(changed));
});
test("MaxDiff image access follows actual saved task membership and timing while assignments and recorded choices match a text-only design", () => {
  const plain = maxdiffInterview(),
    image = structuredClone(plain);
  delete plain.maxdiffStates;
  delete image.maxdiffStates;
  const q = image.guide.questions[0];
  q.maxdiff!.items.forEach((item) => {
    item.imageAssetId = randomUUID();
    item.imageAlt = "Description: " + item.text;
  });
  beginMaxdiff(plain, plain.guide.questions[0], () => 0);
  beginMaxdiff(image, q, () => 0);
  assert.deepEqual(image.maxdiffStates, plain.maxdiffStates);
  q.conceptId = "timed";
  image.guide.conceptTest = {
    concepts: [
      {
        id: "timed",
        name: "Timed",
        headline: "Timed",
        description: "A timed concept",
        exposureSeconds: 2,
      },
      {
        id: "other",
        name: "Other",
        headline: "Other",
        description: "Another concept",
      },
    ],
    count: 2,
    randomizeOrder: false,
  };
  assert.deepEqual(currentImageOptions(image), []);
  assert.ok(
    publicInterview(image, true).maxdiffPrompt!.items.every(
      (item) => !item.imageAssetId,
    ),
  );
  image.conceptExposures = {
    timed: { startedAt: Date.now(), endsAt: Date.now() + 2000 },
  };
  assert.deepEqual(currentImageOptions(image), []);
  image.conceptExposures.timed.endsAt = Date.now() - 1;
  assert.equal(currentImageOptions(image).length, 3);
  image.guide.conceptTest = null;
  delete q.conceptId;
  for (let task = 0; task < 4; task++) {
    const p = maxdiffPrompt(image, q)!;
    assert.deepEqual(
      currentImageOptions(image).map((x) => x.id),
      p.items.map((x) => x.id),
    );
    const dto = publicInterview(image, true);
    assert.equal(dto.guide.questions[0].maxdiff, undefined);
    assert.equal(dto.maxdiffPrompt!.items.length, 3);
    assert.ok(dto.maxdiffPrompt!.items.every((x) => x.imageAssetId));
    assert.equal(
      JSON.stringify(dto).includes(
        q.maxdiff!.items.find((x) => !p.items.some((y) => y.id === x.id))!
          .imageAssetId!,
      ),
      false,
    );
    assert.deepEqual(
      applyMaxdiff(image, q, { best: p.items[0].id, worst: p.items[1].id }),
      applyMaxdiff(plain, plain.guide.questions[0], {
        best: p.items[0].id,
        worst: p.items[1].id,
      }),
    );
  }
  assert.deepEqual(currentImageOptions(image), []);
  image.status = "complete";
  assert.deepEqual(currentImageOptions(image), []);
});
