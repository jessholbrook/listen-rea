import test from "node:test";
import assert from "node:assert/strict";
import {
  responseIdInput,
  validHandoffUrl,
  qualtricsTemplate,
  handoffUrl,
  type SurveyHandoff,
} from "../src/lib/survey-handoff";
test("Qualtrics template preserves the piped ResponseID expression and rejects contact or unexpanded identifier values", () => {
  assert.equal(
    qualtricsTemplate("https://research.example", "study"),
    "https://research.example/s/study?ResponseID=${e://Field/ResponseID}",
  );
  assert.ok(responseIdInput.safeParse("R_123Abc-456_test").success);
  for (const value of [
    "",
    "person@example.test",
    "${e://Field/ResponseID}",
    "a b",
    "a\n",
    "x".repeat(129),
  ])
    assert.equal(responseIdInput.safeParse(value).success, false);
});
test("Survey destination validation accepts approved HTTPS surveys and rejects redirect credentials, local addresses and query collisions", () => {
  for (const value of [
    "",
    "https://brand.qualtrics.com/jfe/form/SV_abc?Q_JFE=qdg",
    "https://research.example.test/thanks",
  ])
    assert.ok(validHandoffUrl(value));
  for (const value of [
    "javascript:alert(1)",
    "http://brand.qualtrics.com/",
    "https://user:secret@example.test/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://example.test/#fragment",
    "https://example.test/?ResponseID=other",
    "https://example.test/?ECHO_STATUS=complete",
    "https://example.test/?token=secret",
  ])
    assert.equal(validHandoffUrl(value), false);
});
test("Saved outcome destinations preserve existing query fields, use server outcome and stop for active or deleted sources", () => {
  const c: SurveyHandoff = {
    id: "hash",
    workspaceId: "workspace",
    studyId: "study",
    responseId: "R_abc-123",
    interviewId: "interview",
    configVersion: 1,
    createdAt: new Date().toISOString(),
    routes: {
      complete: "https://brand.qualtrics.com/jfe/form/SV_next?Q_JFE=qdg",
      screened_out: "https://research.example.test/screened",
      withdrawn: "",
    },
  };
  const result = handoffUrl(c, "complete")!;
  const u = new URL(result.url);
  assert.equal(u.searchParams.get("ResponseID"), c.responseId);
  assert.equal(u.searchParams.get("echo_status"), "complete");
  assert.equal(u.searchParams.get("Q_JFE"), "qdg");
  assert.equal(result.origin, "https://brand.qualtrics.com");
  assert.equal(
    new URL(handoffUrl(c, "screened_out")!.url).searchParams.get("echo_status"),
    "screened_out",
  );
  assert.equal(handoffUrl(c, "active"), null);
  assert.equal(handoffUrl(c, "withdrawn"), null);
  assert.equal(
    handoffUrl({ ...c, responseDeletedAt: c.createdAt }, "complete"),
    null,
  );
});
