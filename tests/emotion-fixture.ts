import { randomUUID } from "node:crypto";
import { templateGuide, guideSchema, type Interview } from "../src/lib/domain";
import { structuredAnswer, advanceInterview } from "../src/lib/mixed";
export function emotionInterview() {
  const guide = guideSchema.parse({
    ...templateGuide("Experience feelings"),
    questions: [
      {
        id: "feeling",
        type: "emotion",
        text: "How did this experience make you feel?",
      },
    ],
  });
  const i: Interview = {
    id: randomUUID(),
    workspaceId: "workspace",
    studyId: "study",
    revisionId: "revision",
    guide,
    preview: false,
    excluded: false,
    exclusionReason: "",
    status: "active",
    createdAt: "2026-10-19T12:00:00Z",
    consentAt: "2026-10-19T12:00:00Z",
    consentVersion: "test",
    tokenHash: "private",
    current: 0,
    prompt: guide.questions[0].text,
    strategy: "guide",
    turns: [],
    attributes: { segment: "Team" },
    version: 0,
    requests: {},
  };
  advanceInterview(i, -1);
  return i;
}
export function emotionResponse(value: unknown) {
  const i = emotionInterview(),
    q = i.guide.questions[0];
  i.turns = [
    {
      id: randomUUID(),
      questionId: q.id,
      prompt: q.text,
      ...structuredAnswer(i, q, { value }),
      followUp: false,
      source: "typed",
      strategy: "guide",
      createdAt: "2026-10-19T12:01:00Z",
    },
  ];
  i.status = "complete";
  i.version = 1;
  return i;
}
