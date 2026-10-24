import { currentImageOptions } from "../src/lib/option-images";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { onceGuide } from "./video-once-fixture";
import { guideSchema } from "../src/lib/domain";
import { videoPresentation, videoAnswerBlocked } from "../src/lib/video-once";
import { publicInterview } from "../src/lib/http";
import { applyFields } from "../src/lib/localization";
import { translatedFields } from "./localization-fixture";
test("Single-view validation, translation identity and server-clock states preserve explicit start, expiry, skip and replayable exceptions", () => {
  const g = onceGuide([randomUUID(), randomUUID()]);
  assert.ok(guideSchema.safeParse(g).success);
  for (const patch of [{ videoAssetId: null }, { exposureSeconds: 10 }]) {
    const bad = structuredClone(g);
    Object.assign(bad.conceptTest!.concepts[0], patch);
    assert.equal(guideSchema.safeParse(bad).success, false);
  }
  for (const language of ["es", "fr"] as const) {
    const local = applyFields(g, translatedFields(g, language));
    assert.equal(local.conceptTest!.concepts[0].videoOnce, true);
    assert.equal(
      local.conceptTest!.concepts[0].videoAssetId,
      g.conceptTest!.concepts[0].videoAssetId,
    );
  }
  const i: any = { guide: g, current: 0, status: "active", turns: [] };
  i.guide.questions[0].conceptId = "alpha";
  assert.equal(videoPresentation(i, 99)?.state, "ready");
  assert.equal(videoAnswerBlocked(i), true);
  i.guide.questions[0].options[0].imageAssetId = randomUUID();
  assert.deepEqual(currentImageOptions(i), []);
  i.videoViews = { alpha: { startedAt: 10, endsAt: 100, revision: 1 } };
  assert.equal(videoPresentation(i, 99)?.state, "playing");
  assert.equal(videoPresentation(i, 100)?.state, "used");
  i.videoViews.alpha.endedAt = 30;
  assert.equal(videoPresentation(i, 40)?.state, "used");
  i.videoViews.alpha.alternativeAt = 35;
  assert.equal(videoPresentation(i, 40)?.state, "alternative");
  assert.equal(
    currentImageOptions(i)[0].imageAssetId,
    i.guide.questions[0].options[0].imageAssetId,
  );
  i.videoViews = {};
  assert.equal(videoPresentation(i)?.state, "ready");
  i.videoViews = { constructor: { startedAt: 1, endsAt: 3, revision: 1 } };
  assert.equal(videoPresentation(i)?.state, "ready");
});
test("Participant projection reveals only the current video state and no grant secrets or future records; researcher audit keeps decisions without nonces", () => {
  const g = onceGuide([randomUUID(), randomUUID()]);
  (g.questions[0] as any).conceptId = "alpha";
  const i: any = {
    guide: g,
    current: 0,
    status: "active",
    turns: [],
    videoViews: {
      alpha: {
        startedAt: 1,
        endsAt: Date.now() + 10000,
        nonce: "private-alpha",
        requestId: randomUUID(),
        revision: 1,
      },
      beta: { alternativeAt: 3, nonce: "private-beta", revision: 1 },
    },
  };
  const participant = publicInterview(i, true);
  assert.equal(participant.videoPresentation!.conceptId, "alpha");
  assert.equal("videoViews" in participant, false);
  assert.equal(JSON.stringify(participant).includes("private-"), false);
  const researcher = publicInterview(i);
  assert.equal(researcher.videoViews!.beta.alternativeAt, 3);
  assert.equal("nonce" in researcher.videoViews!.alpha, false);
  assert.equal(i.videoViews.alpha.nonce, "private-alpha");
});
