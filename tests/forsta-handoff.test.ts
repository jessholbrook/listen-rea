import test from "node:test";
import assert from "node:assert/strict";
import {
  forstaTestUrl,
  forstaSettingsInput,
  handoffAdmissionInput,
  validForstaUrl,
  handoffUrl,
  type SurveyHandoff,
} from "../src/lib/survey-handoff";
test("Decipher accepts only reviewed HTTPS return addresses without fixed rid, credentials or merge fields", () => {
  assert.equal(
    forstaTestUrl("https://echo.example.test", "study"),
    "https://echo.example.test/s/study?handoff=forsta",
  );
  for (const value of [
    "",
    "https://survey.decipherinc.com/survey/selfserve/123?list=1",
  ])
    assert.ok(validForstaUrl(value));
  for (const value of [
    "http://survey.example.test",
    "https://localhost/",
    "https://user:password@survey.example.test/",
    "https://survey.example.test/?RID=person",
    "https://survey.example.test/?rid={rid}",
    "https://survey.example.test/$uuid",
    "https://survey.example.test/%7Brid%7D",
    "https://survey.example.test/?token=secret",
  ])
    assert.equal(validForstaUrl(value), false, value);
  const input = {
    version: 0,
    enabled: true,
    reviewed: true,
    routes: {
      complete: "https://survey.decipherinc.com/survey",
      screened_out: "",
      withdrawn: "",
    },
  };
  assert.ok(forstaSettingsInput.safeParse(input).success);
  assert.equal(
    forstaSettingsInput.safeParse({ ...input, reviewed: false }).success,
    false,
  );
  assert.equal(
    forstaSettingsInput.safeParse({ ...input, externalStudyId: "wrong" })
      .success,
    false,
  );
  assert.ok(
    handoffAdmissionInput.safeParse({
      provider: "forsta",
      responseId: "uuid_abc-123",
      secret: "a".repeat(64),
    }).success,
  );
  assert.equal(
    handoffAdmissionInput.safeParse({
      provider: "forsta",
      responseId: "uuid_abc-123",
      secret: "a".repeat(64),
      externalStudyId: "rally",
    }).success,
    false,
  );
});
test("Decipher return appends admitted rid only, preserves saved survey parameters, and respects outcomes/deletion", () => {
  const c: SurveyHandoff = {
    id: "hash",
    workspaceId: "w",
    studyId: "s",
    provider: "forsta",
    responseId: "uuid_Abc-123",
    configVersion: 1,
    createdAt: new Date().toISOString(),
    routes: {
      complete: "https://survey.decipherinc.com/survey?list=1",
      screened_out: "https://survey.example.test/screened",
      withdrawn: "",
    },
  };
  const destination = handoffUrl(c, "complete")!,
    url = new URL(destination.url);
  assert.equal(destination.provider, "forsta");
  assert.equal(url.searchParams.get("rid"), c.responseId);
  assert.equal(url.searchParams.get("list"), "1");
  assert.equal(url.searchParams.size, 2);
  assert.equal(
    new URL(handoffUrl(c, "screened_out")!.url).pathname,
    "/screened",
  );
  assert.equal(handoffUrl(c, "withdrawn"), null);
  assert.equal(handoffUrl(c, "active"), null);
  assert.equal(
    handoffUrl({ ...c, responseDeletedAt: c.createdAt }, "complete"),
    null,
  );
});
