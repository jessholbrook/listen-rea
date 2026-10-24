import test from "node:test";
import assert from "node:assert/strict";
import { timedGuide } from "./timed-concepts-fixture";
import { guideSchema } from "../src/lib/domain";
import { compileConceptGuide } from "../src/lib/concepts";
import { emotionInterview } from "./emotion-fixture";
import { conceptPresentation, conceptVisible } from "../src/lib/concept-timing";
import { publicInterview } from "../src/lib/http";
test("Timed schema bounds, prototype incompatibility, immutable assignments and server-clock states cover waiting/viewing/expiry and accessible override", () => {
  const g = timedGuide();
  for (const seconds of [0, -1, 301, 1.5]) {
    const bad = structuredClone(g);
    bad.conceptTest!.concepts[0].exposureSeconds = seconds;
    assert.equal(guideSchema.safeParse(bad).success, false);
  }
  const bad = structuredClone(g);
  Object.assign(bad.conceptTest!.concepts[0], {
    prototypeUrl: "https://prototype.example.test",
    taskInstructions: "Try it.",
  });
  assert.equal(guideSchema.safeParse(bad).success, false);
  const compiled = compileConceptGuide(g, () => 0).guide;
  g.conceptTest!.concepts[0].exposureSeconds = 10;
  const i = { ...emotionInterview(), guide: compiled, current: 1 };
  assert.equal(compiled.conceptTest!.concepts[0].exposureSeconds, 1);
  assert.equal(conceptPresentation(i, 1000)!.state, "waiting");
  assert.equal(conceptVisible(i, 1000), false);
  i.conceptExposures = {
    alpha: { startedAt: 1000, endsAt: 2000, revision: 1 },
  };
  assert.equal(conceptPresentation(i, 1999)!.state, "viewing");
  assert.equal(conceptPresentation(i, 2000)!.state, "expired");
  assert.equal(conceptVisible(i, 2000), false);
  i.conceptExposures.alpha.untimedAt = 2001;
  i.conceptExposures.alpha.revision = 2;
  assert.equal(conceptPresentation(i, 9000)!.state, "untimed");
  assert.equal(conceptVisible(i, 9000), true);
});
test("Participant projections hide timed content before/after the window and omit internal/future timing records while researcher records retain override provenance", () => {
  const i = {
    ...emotionInterview(),
    guide: compileConceptGuide(timedGuide(), () => 0).guide,
    current: 1,
  };
  let safe = publicInterview(i, true);
  assert.equal(safe.guide.conceptTest!.concepts[0].description, "");
  assert.equal("conceptExposures" in safe, false);
  i.conceptExposures = {
    alpha: { startedAt: Date.now(), endsAt: Date.now() + 10000, revision: 1 },
    beta: { untimedAt: Date.now(), revision: 1 },
  };
  safe = publicInterview(i, true);
  assert.match(
    safe.guide.conceptTest!.concepts[0].description,
    /fast summaries/,
  );
  assert.equal(safe.conceptPresentation!.conceptId, "alpha");
  assert.equal(JSON.stringify(safe).includes("untimedAt"), false);
  i.conceptExposures.alpha.endsAt = Date.now() - 1;
  safe = publicInterview(i, true);
  assert.equal(safe.conceptPresentation!.state, "expired");
  assert.equal(safe.guide.conceptTest!.concepts[0].headline, "");
  assert.equal(safe.guide.conceptTest!.concepts[0].imageAssetId, undefined);
  assert.equal(
    publicInterview(i).conceptExposures!.beta.untimedAt,
    i.conceptExposures.beta.untimedAt,
  );
});
