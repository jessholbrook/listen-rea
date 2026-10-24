import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { briefSetup } from "./library-briefs-fixture";
import { fixtureEmbedding } from "./library-semantic-fixture";
export async function transcriptSetup() {
  const c = await briefSetup(),
    imports: any[] = [];
  for (const [n, transcript] of [
    "Interviewer: What protects unfinished work?\nParticipant: Saving a draft keeps unfinished progress available before review.",
    "Interviewer: What happens at month end?\nParticipant: Finance reviews monthly invoices after payments arrive.",
  ].entries()) {
    const s = (
      await c.owner("studies", "POST", {
        title: "Reviewed external context " + n,
      })
    ).study;
    const r = await c.owner("library/imports", "POST", {
      studyId: s.id,
      requestId: randomUUID(),
      externalId: "private-external-" + n,
      title: "Reviewed external transcript " + n,
      transcript,
      permissionConfirmed: true,
      transcriptReviewed: true,
    });
    assert.equal(r.status, 201);
    imports.push({ s, interviewId: r.interviewId, transcript });
  }
  const service = await import("../src/lib/library-transcript-qa-server");
  let count = 0;
  let payload: any;
  const ask = async (changes: any = {}, run?: any) => {
    const input = {
      studyIds: imports.map((s) => s.s.id),
      question: "What do draft review and invoices describe?",
      language: "en",
      saveDraft: true,
      requestId: randomUUID(),
      ...changes,
    };
    const r = await service.answerTranscriptQuestion(
      new Request("http://localhost/api/library/qa", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      c.actor,
      run ||
        (async (...args: any[]) => {
          count++;
          payload = args;
          const h = args[1].evidence[0];
          return {
            answer: "MARKED_TRANSCRIPT_ORIGINAL",
            citations: [
              {
                studyId: h.studyId,
                interviewId: h.interviewId,
                turnId: h.turnId,
                quote: h.quote.slice(h.quote.indexOf("Participant:")),
              },
            ],
          };
        }),
      fixtureEmbedding,
    );
    return { input, result: await r.json() };
  };
  return {
    ...c,
    imports,
    ask,
    service,
    count: () => count,
    payload: () => payload,
  };
}
