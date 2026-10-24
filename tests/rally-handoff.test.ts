import test from "node:test";
import assert from "node:assert/strict";
import {
  handoffAdmissionInput,
  rallySettingsInput,
  validRallyUrl,
  handoffUrl,
  type SurveyHandoff,
} from "../src/lib/survey-handoff";
test("Rally admission requires a participant/study pair while legacy Qualtrics admission remains compatible", () => {
  const secret = "a".repeat(64);
  assert.equal(
    handoffAdmissionInput.parse({ responseId: "R_123", secret }).provider,
    "qualtrics",
  );
  assert.ok(
    handoffAdmissionInput.safeParse({
      provider: "rally",
      responseId: "person_123",
      externalStudyId: "study_123",
      secret,
    }).success,
  );
  for (const input of [
    { provider: "rally", responseId: "person_123", secret },
    { responseId: "R_123", externalStudyId: "study_123", secret },
    {
      provider: "rally",
      responseId: "person@example.test",
      externalStudyId: "study_123",
      secret,
    },
  ])
    assert.equal(handoffAdmissionInput.safeParse(input).success, false);
  assert.equal(
    rallySettingsInput.safeParse({
      version: 0,
      enabled: true,
      externalStudyId: "",
      reviewed: true,
      routes: { complete: "", screened_out: "", withdrawn: "" },
    }).success,
    false,
  );
});
test("Rally return templates expand only approved path/query values and preserve the vendor URL contract", () => {
  const c: SurveyHandoff = {
    id: "id",
    workspaceId: "workspace",
    studyId: "echo",
    provider: "rally",
    externalStudyId: "study_123",
    responseId: "person_456",
    configVersion: 1,
    createdAt: new Date().toISOString(),
    routes: {
      complete:
        "https://app.rallyuxr.com/research/{studyID}/done?participant={pid}&keep=one",
      screened_out: "https://app.rallyuxr.com/thanks",
      withdrawn: "",
    },
  };
  const result = handoffUrl(c, "complete")!;
  const u = new URL(result.url);
  assert.equal(result.provider, "rally");
  assert.equal(u.pathname, "/research/study_123/done");
  assert.equal(u.searchParams.get("participant"), "person_456");
  assert.equal(u.searchParams.get("keep"), "one");
  for (const invented of ["ResponseID", "echo_status", "pid", "studyID"])
    assert.equal(u.searchParams.has(invented), false);
  assert.equal(handoffUrl(c, "active"), null);
  assert.equal(handoffUrl(c, "withdrawn"), null);
  assert.equal(
    handoffUrl({ ...c, externalStudyId: undefined }, "complete"),
    null,
  );
  assert.equal(
    handoffUrl({ ...c, responseDeletedAt: c.createdAt }, "complete"),
    null,
  );
  assert.ok(
    validRallyUrl("https://app.rallyuxr.com/?studyID=study_123&pid={pid}"),
  );
  assert.equal(
    rallySettingsInput.safeParse({
      version: 0,
      enabled: true,
      externalStudyId: "study_123",
      reviewed: true,
      routes: {
        complete: "https://app.rallyuxr.com/?studyID=other&pid={pid}",
        screened_out: "",
        withdrawn: "",
      },
    }).success,
    false,
  );
  assert.ok(
    validRallyUrl(
      "https://app.rallyuxr.com/complete?pid=%7Bpid%7D&studyID=%7BstudyID%7D",
    ),
  );
  for (const url of [
    "https://{pid}.example.test/",
    "https://app.rallyuxr.com/?{pid}=x",
    "https://app.rallyuxr.com/{unknown}",
    "https://app.rallyuxr.com/${pid}",
    "https://app.rallyuxr.com/?pid=other",
    "https://app.rallyuxr.com/?echo_status=complete",
    "https://user:password@app.rallyuxr.com/",
    "http://app.rallyuxr.com/",
  ])
    assert.equal(validRallyUrl(url), false, url);
});
