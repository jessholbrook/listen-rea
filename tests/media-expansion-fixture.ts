import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { advancedSetup } from "./advanced-methods-fixture";
import { client } from "./image-review-fixture";
import { templateGuide } from "../src/lib/domain";
import { base } from "./harness";
import { toneWav } from "./reporting-fixture";
export const syntheticClipAnswer =
  "We check the original evidence before making a decision.";
export async function mediaStudy(
  setup?: Awaited<ReturnType<typeof advancedSetup>>,
  title = "Synthetic source Alpha",
) {
  const c = setup || (await advancedSetup()),
    guide = templateGuide();
  guide.title = title;
  guide.questions = [
    { ...guide.questions[1], id: "evidence-question", followUps: 0 },
  ];
  const s = await c.create(guide, title);
  await c.owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const person = await client(),
    r = await person(`public/${s.id}`, "POST", { consent: true }),
    mediaId = randomUUID(),
    h = { "x-interview-token": r.token };
  const upload = await fetch(
    `${base}/api/interviews/${r.interview.id}/recording`,
    {
      method: "POST",
      headers: {
        ...h,
        "content-type": "audio/wav",
        "x-recording-consent": "yes",
        "x-recording-id": mediaId,
        "x-recording-duration": "3000",
      },
      body: new Uint8Array(toneWav()),
    },
  );
  assert.equal(upload.status, 200);
  const answer = await person(
    `interviews/${r.interview.id}/answer`,
    "POST",
    {
      requestId: randomUUID(),
      version: 0,
      answer: syntheticClipAnswer,
      audioId: mediaId,
      durationMs: 3000,
    },
    h,
  );
  assert.equal(answer.interview.status, "complete");
  const root = `studies/${s.id}/reporting`,
    clip = (
      await c.owner(root + "/clips", "POST", {
        name: title + " clip",
        mediaId,
        quote: syntheticClipAnswer,
        startMs: 0,
        endMs: 1200,
        caption: "Reviewed synthetic source",
        reviewed: true,
      })
    ).clip;
  assert.ok(clip?.id);
  return {
    ...c,
    s: (await c.owner(`studies/${s.id}`)).study,
    root,
    clip,
    mediaId,
    interview: answer.interview,
    person,
  };
}
export async function reviewedEdition(
  c: Awaited<ReturnType<typeof mediaStudy>>,
) {
  const path = `studies/${c.s.id}/analysis`;
  let analysis = (await c.owner(path, "POST", { mode: "manual" })).analysis;
  analysis = (
    await c.owner(path, "PUT", {
      ...analysis,
      summary: "Synthetic source review.",
      themes: [
        {
          id: "source",
          title: "Check original evidence",
          description: "One synthetic participant checks evidence.",
          citations: [
            {
              interviewId: c.interview.id,
              turnId: c.interview.turns[0].id,
              quote: syntheticClipAnswer,
            },
          ],
        },
      ],
      reviewed: true,
    })
  ).analysis;
  let edition = (
    await c.owner(c.root + "/editions", "POST", {
      analysisId: analysis.id,
      title: "Reviewed synthetic report",
    })
  ).edition;
  edition = (
    await c.owner(c.root + "/editions/" + edition.id, "PUT", {
      ...edition,
      reviewed: true,
    })
  ).edition;
  assert.ok(edition?.reviewed);
  return edition;
}
