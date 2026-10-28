import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema, templateGuide } from "../src/lib/domain";
import { clipAt } from "../src/lib/screen";
test("tasks require safe links and suppress follow-ups; timeline lookup preserves gaps", () => {
  const g = templateGuide("Usability task");
  g.questions[1].task = { url: "https://example.com/task", maxSeconds: 60 };
  g.questions[1].followUps = 0;
  assert.equal(guideSchema.safeParse(g).success, true);
  g.questions[1].followUps = 1;
  assert.equal(guideSchema.safeParse(g).success, false);
  g.questions[1].followUps = 0;
  for (const url of [
    "http://example.com",
    "javascript:alert(1)",
    "https://user:pass@example.com",
  ]) {
    g.questions[1].task.url = url;
    assert.equal(guideSchema.safeParse(g).success, false);
  }
  const clips = [
    { id: "first", sequence: 0, offsetMs: 0, durationMs: 1000, bytes: 100 },
    { id: "next", sequence: 1, offsetMs: 2500, durationMs: 1500, bytes: 100 },
  ];
  assert.equal(clipAt(clips, 500)?.id, "first");
  assert.equal(clipAt(clips, 1500), undefined);
  assert.equal(clipAt(clips, 2600)?.id, "next");
});
