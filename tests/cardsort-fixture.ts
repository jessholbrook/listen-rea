import { randomUUID } from "node:crypto";
import { templateGuide, type Interview, type Turn } from "../src/lib/domain";
import { advanceInterview } from "../src/lib/mixed";
import { applyCardsort, type CardAssignment } from "../src/lib/cardsort";
export function cardsortInterview() {
  const guide = templateGuide();
  guide.questions = [
    {
      ...guide.questions[1],
      id: "sort",
      type: "cardsort",
      text: "Group these research activities.",
      followUps: 0,
      options: [],
      cardsort: {
        cards: ["Invite a teammate", "Review evidence", "Export a report"].map(
          (text, n) => ({ id: String(n), text }),
        ),
        groups: [
          { id: "team", text: "Team management" },
          { id: "research", text: "Research work" },
        ],
        randomizeCards: true,
        randomizeGroups: true,
        allowUncertain: true,
        askReason: true,
      },
    },
  ];
  const i: Interview = {
    id: randomUUID(),
    studyId: "study",
    workspaceId: "workspace",
    revisionId: "revision-1",
    tokenHash: "fixture",
    preview: false,
    status: "active",
    createdAt: new Date().toISOString(),
    consentAt: new Date().toISOString(),
    consentVersion: "v1",
    guide,
    current: 0,
    prompt: "",
    strategy: "guide",
    turns: [],
    attributes: { segment: "Team" },
    excluded: false,
    exclusionReason: "",
    requests: {},
    version: 0,
  };
  advanceInterview(i, -1, (n) => n - 1);
  return i;
}
export function completeCardsort(assignments: CardAssignment[]) {
  const i = cardsortInterview(),
    q = i.guide.questions[0];
  for (const input of [
    { value: assignments, answer: "" },
    { answer: "I grouped activities by the type of work." },
  ]) {
    const prompt = i.prompt,
      result = applyCardsort(i, q, input);
    i.turns.push({
      id: randomUUID(),
      questionId: q.id,
      prompt,
      ...result,
      followUp: false,
      createdAt: new Date().toISOString(),
      source: "typed",
      strategy: "guide",
    } as Turn);
  }
  i.status = "complete";
  return i;
}
export const assignments = (groups: (string | null)[]) =>
  groups.map((groupId, n) => ({ cardId: String(n), groupId }));
