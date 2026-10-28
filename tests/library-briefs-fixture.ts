import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { savedLibrarySetup } from "./library-answers-fixture";
export const answerRoot = "library/attachments/answers";
export const briefRoot = "library/briefs";
export const answerEdit = (s: any, changes: any = {}) => ({
  version: s.history.at(-1).version,
  answer: s.history.at(-1).answer,
  citations: s.history.at(-1).citations,
  reviewed: true,
  includeInExports: true,
  ...changes,
});
export const briefInput = (answers: any[], changes: any = {}) => ({
  title: "Cross-study workflow brief",
  summary: "=Researcher summary, with separate interpretation",
  language: "en",
  sections: answers.map((a, i) => ({
    answerId: a.id,
    answerVersion: a.history.at(-1).version,
    heading: "Section " + (i + 1),
    commentary: "Researcher commentary " + (i + 1),
  })),
  ...changes,
});
export const briefUpdate = (b: any, changes: any = {}) => ({
  title: b.title,
  summary: b.summary,
  language: b.language,
  sections: b.sections.map(
    ({ answerId, answerVersion, heading, commentary }: any) => ({
      answerId,
      answerVersion,
      heading,
      commentary,
    }),
  ),
  version: b.version,
  reviewed: false,
  includeInExports: false,
  ...changes,
});
export async function briefSetup() {
  const c = await savedLibrarySetup(),
    answers: any[] = [];
  for (const [i, f] of c.fixtures.entries()) {
    const asked = await c.ask({
      studyIds: [f.s.id],
      question: "What does draft review show? " + i,
    });
    let saved = (await c.owner(answerRoot + "/" + asked.result.savedAnswerId))
      .answer;
    saved = (
      await c.owner(
        answerRoot + "/" + saved.id,
        "PUT",
        answerEdit(saved, { answer: "APPROVED_FINDING_" + i }),
      )
    ).answer;
    assert.ok(saved);
    answers.push(saved);
  }
  return {
    ...c,
    answers,
    create: async (changes: any = {}) => {
      const r = await c.owner(briefRoot, "POST", {
        ...briefInput(answers),
        requestId: randomUUID(),
        ...changes,
      });
      assert.equal(r.status, 201, JSON.stringify(r));
      return r.brief;
    },
  };
}
