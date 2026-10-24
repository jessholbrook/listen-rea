import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  readPage,
  nextCursor,
  responseDto,
  studyDto,
  safeAnalysis,
  keyInput,
} from "../src/lib/external-api";
import { emotionInterview } from "./emotion-fixture";
import type { Analysis, Study, Revision } from "../src/lib/domain";
test("External API projects an explicit schema and never serializes admission secrets, tags or internal guide state", () => {
  const i = emotionInterview();
  i.status = "complete";
  i.invitationId = "private-binding";
  i.attributes = { email: "private@example.test" };
  const output = JSON.stringify(responseDto(i));
  for (const hidden of [
    "tokenHash",
    "private-binding",
    "attributes",
    "private@example.test",
    "requests",
    "workspaceId",
    "guide",
    "consentVersion",
  ])
    assert.ok(!output.includes(hidden));
  const s = {
    id: "s",
    revisionId: "r",
    title: "Unpublished title",
    draft: { private: "draft" },
  } as unknown as Study;
  const r = {
    guide: { title: "Published title", questions: [] },
  } as unknown as Revision;
  assert.equal(studyDto(s, r).title, "Published title");
  assert.ok(!JSON.stringify(studyDto(s, r)).includes("Unpublished"));
});
test("Pagination is bounded, resource-bound and rejects ambiguous or injected query parameters", () => {
  const c = nextCursor("responses:s", "response-id");
  assert.deepEqual(
    readPage(new URL("https://echo.test?limit=10&cursor=" + c), "responses:s"),
    { limit: 10, after: "response-id" },
  );
  for (const q of [
    "limit=101",
    "limit=0",
    "limit=1.5",
    "limit=x",
    "cursor=bad",
    "limit=1&limit=2",
    "token=secret",
  ])
    assert.throws(() =>
      readPage(new URL("https://echo.test?" + q), "responses:s"),
    );
  assert.throws(() =>
    readPage(new URL("https://echo.test?cursor=" + c), "responses:other"),
  );
  const base = {
    requestId: randomUUID(),
    secret: "ab".repeat(32),
    name: "Report script",
    studyIds: [randomUUID()],
    scopes: ["studies:read"],
    expiresAt: new Date().toISOString(),
  };
  assert.equal(keyInput.safeParse(base).success, true);
  assert.equal(
    keyInput.safeParse({ ...base, scopes: ["studies:write"] }).success,
    false,
  );
  assert.equal(keyInput.safeParse({ ...base, studyIds: [] }).success, false);
});
test("Analyses require review, current source version and live exact citations", () => {
  const i = emotionInterview();
  i.status = "complete";
  i.turns = [
    {
      id: "t",
      questionId: "q",
      prompt: "Question",
      answer: "An exact participant answer",
      followUp: false,
      createdAt: new Date().toISOString(),
      source: "typed",
      strategy: "guide",
    },
  ];
  const s = { id: i.studyId, dataVersion: 4 } as Study;
  const a = {
    reviewed: true,
    dataVersion: 4,
    themes: [
      {
        id: "theme",
        title: "Finding",
        description: "Observation",
        citations: [
          { interviewId: i.id, turnId: "t", quote: "exact participant" },
        ],
      },
    ],
  } as Analysis;
  assert.equal(safeAnalysis(a, s, [i]), true);
  assert.equal(safeAnalysis({ ...a, reviewed: false }, s, [i]), false);
  assert.equal(safeAnalysis({ ...a, dataVersion: 3 }, s, [i]), false);
  assert.equal(safeAnalysis(a, s, [{ ...i, excluded: true }]), false);
  assert.equal(safeAnalysis(a, s, []), false);
  assert.equal(safeAnalysis(a, s, [{ ...i, studyId: "other" }]), false);
});
