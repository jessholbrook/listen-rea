import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import { start, stop, client, dataDirectory } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3136 : 3135 }),
  { timeout: 90000 },
);
after(stop);
const routes = {
  complete:
    "https://app.rallyuxr.com/research/{studyID}/complete?participant={pid}&keep=yes",
  screened_out:
    "https://app.rallyuxr.com/research/{studyID}/screened?pid={pid}",
  withdrawn: "https://app.rallyuxr.com/research/{studyID}/stopped?pid={pid}",
};
async function setup() {
  const owner = await client(),
    other = await client(),
    anon = await client(),
    collab = await client();
  for (const c of [owner, other])
    await c("auth/signup", "POST", {
      name: "Rally admin",
      email: randomUUID() + "@example.test",
      password: "rally-test-password",
    });
  const invite = (await owner("invites", "POST", { role: "collaborator" }))
    .invite;
  await collab("auth/signup", "POST", {
    name: "Rally collaborator",
    email: randomUUID() + "@example.test",
    password: "rally-test-password",
    invite,
  });
  let s = (await owner("studies", "POST", { title: "Rally study" })).study;
  s = (
    await owner(`studies/${s.id}`, "PUT", {
      guide: { ...emotionInterview().guide, title: "Rally study" },
      version: s.version,
    })
  ).study;
  s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const root = `studies/${s.id}`,
    pub = `public/${s.id}`,
    input = {
      version: 0,
      enabled: true,
      externalStudyId: "rally_study_A",
      routes,
      reviewed: true,
    };
  return { owner, other, anon, collab, s, root, pub, input };
}
const request = (pid = "participant_123", studyID = "rally_study_A") => ({
  consent: true,
  surveyHandoff: {
    provider: "rally",
    externalStudyId: studyID,
    responseId: pid,
    secret: randomBytes(32).toString("hex"),
  },
  attributes: {
    pid,
    studyID,
    segment: "Synthetic",
    redirect: "https://attacker.example/",
  },
});
const header = (r: any) => ({ "x-interview-token": r.token });
test(
  "Rally uses admin-reviewed provider-specific settings, exact study binding and atomic pair-scoped admission without changing Qualtrics",
  { timeout: 90000 },
  async () => {
    const { owner, other, anon, collab, root, pub, input } = await setup(),
      route = root + "/rally-handoff";
    assert.equal((await anon(route)).status, 401);
    assert.equal((await other(route)).status, 404);
    assert.equal((await collab(route)).canManage, false);
    assert.equal((await collab(route, "PUT", input)).status, 403);
    assert.equal(
      (await owner(route, "PUT", { ...input, externalStudyId: "" })).status,
      400,
    );
    assert.equal(
      (await owner(route, "PUT", { ...input, reviewed: false })).status,
      400,
    );
    assert.equal((await owner(route, "PUT", input)).status, 200);
    assert.equal((await owner(route, "PUT", input)).status, 409);
    assert.equal(
      (await owner(root + "/survey-handoff")).settings.enabled,
      false,
    );
    const info = await anon(pub);
    assert.equal(info.rallyHandoff, true);
    assert.equal(info.surveyHandoff, false);
    assert.ok(!JSON.stringify(info).includes("rally_study_A"));
    assert.ok(!JSON.stringify(info).includes("rallyuxr"));
    assert.equal(
      (await anon(pub, "POST", request("person", "wrong_study"))).status,
      400,
    );
    const body = request(),
      attempts = await Promise.all([0, 1].map(() => anon(pub, "POST", body)));
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 201]);
    const joined = attempts[0];
    assert.equal(joined.interview.id, attempts[1].interview.id);
    assert.equal(joined.token, attempts[1].token);
    assert.equal(joined.interview.handoffId, undefined);
    assert.deepEqual(joined.interview.attributes, {});
    assert.equal(
      (
        await anon(pub, "POST", {
          ...body,
          surveyHandoff: {
            ...body.surveyHandoff,
            secret: randomBytes(32).toString("hex"),
          },
        })
      ).status,
      409,
    );
    const records = await owner(root);
    assert.equal(records.interviews[0].attributes.pid, undefined);
    assert.equal(records.interviews[0].attributes.studyID, undefined);
    assert.ok(!JSON.stringify(records).includes("rally_study_A"));
    const qsettings = {
      version: 0,
      enabled: true,
      routes: {
        complete: "https://survey.example.test/thanks",
        screened_out: "",
        withdrawn: "",
      },
      reviewed: true,
    };
    await owner(root + "/survey-handoff", "PUT", qsettings);
    const q = await anon(pub, "POST", {
      consent: true,
      surveyHandoff: {
        responseId: body.surveyHandoff.responseId,
        secret: randomBytes(32).toString("hex"),
      },
    });
    assert.equal(q.status, 201);
    assert.notEqual(q.interview.id, joined.interview.id);
    assert.equal((await owner(route)).rows.length, 1);
    assert.equal((await owner(root + "/survey-handoff")).rows.length, 1);
    const rallyCsv = await owner(route + "/export"),
      qCsv = await owner(root + "/survey-handoff/export");
    assert.ok(rallyCsv.text.includes('"pid","studyID"'));
    assert.ok(rallyCsv.text.includes("rally_study_A"));
    assert.ok(qCsv.text.includes('"ResponseID","interview_id"'));
    assert.ok(!qCsv.text.includes("rally_study_A"));
    await owner(route, "PUT", {
      ...input,
      version: 1,
      externalStudyId: "rally_study_B",
    });
    const b = await anon(
      pub,
      "POST",
      request(body.surveyHandoff.responseId, "rally_study_B"),
    );
    assert.equal(b.status, 201);
    assert.notEqual(b.interview.id, joined.interview.id);
    assert.equal(
      (await anon(pub, "POST", body)).interview.id,
      joined.interview.id,
    );
    await owner(route, "PUT", {
      ...input,
      version: 2,
      enabled: false,
      externalStudyId: "rally_study_B",
      reviewed: false,
    });
    assert.equal(
      (await anon(pub, "POST", request("new_person", "rally_study_B"))).status,
      409,
    );
    assert.equal((await anon(pub, "POST", body)).status, 200);
    assert.equal(
      (
        await anon(pub, "POST", {
          consent: true,
          surveyHandoff: {
            responseId: "another_q",
            secret: randomBytes(32).toString("hex"),
          },
        })
      ).status,
      201,
    );
  },
);

test(
  "Rally freezes return templates per admission, selects terminal outcomes and redacts both identifiers on source deletion",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input, s } = await setup(),
      route = root + "/rally-handoff";
    await owner(route, "PUT", input);
    const body = request(),
      joined = await anon(pub, "POST", body),
      path = `interviews/${joined.interview.id}/survey-handoff`;
    assert.equal((await anon(path)).status, 404);
    assert.equal(
      (await anon(path, "GET", undefined, header(joined))).destination,
      null,
    );
    await owner(route, "PUT", {
      ...input,
      version: 1,
      routes: {
        ...routes,
        complete:
          "https://app.rallyuxr.com/changed?pid={pid}&studyID={studyID}",
      },
    });
    const completed = await anon(
      `interviews/${joined.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "",
        value: ["happy", "", "A synthetic Rally note."],
      },
      header(joined),
    );
    assert.equal(completed.interview.status, "complete");
    const result = (await anon(path, "GET", undefined, header(joined)))
      .destination;
    assert.equal(result.provider, "rally");
    const url = new URL(result.url);
    assert.equal(url.pathname, "/research/rally_study_A/complete");
    assert.equal(
      url.searchParams.get("participant"),
      body.surveyHandoff.responseId,
    );
    assert.equal(url.searchParams.get("keep"), "yes");
    assert.equal(url.searchParams.get("echo_status"), null);
    assert.equal(url.searchParams.get("redirect"), null);
    assert.equal(url.searchParams.get("ResponseID"), null);
    const stopped = await anon(pub, "POST", request("stopped_person"));
    await anon(
      `interviews/${stopped.interview.id}/stop`,
      "POST",
      {},
      header(stopped),
    );
    assert.equal(
      new URL(
        (
          await anon(
            `interviews/${stopped.interview.id}/survey-handoff`,
            "GET",
            undefined,
            header(stopped),
          )
        ).destination.url,
      ).pathname,
      "/research/rally_study_A/stopped",
    );
    const preview = await owner(root + "/preview", "POST", {});
    assert.equal(
      (
        await anon(
          `interviews/${preview.interview.id}/survey-handoff`,
          "GET",
          undefined,
          header(preview),
        )
      ).destination,
      null,
    );
    await owner(route, "PUT", {
      ...input,
      version: 2,
      enabled: false,
      reviewed: false,
    });
    assert.equal(
      (await anon(path, "GET", undefined, header(joined))).destination,
      null,
    );
    await owner(root + "/responses/" + joined.interview.id, "PATCH", {
      excluded: true,
      reason: "Synthetic Rally exclusion",
    });
    assert.equal(
      (await owner(route)).rows.find(
        (r: any) => r.interviewId === joined.interview.id,
      ).excluded,
      true,
    );
    await owner(root + "/responses/" + joined.interview.id, "DELETE");
    const deleted = (await owner(route)).rows.find(
      (r: any) => r.status === "response_deleted",
    );
    assert.equal(deleted.responseId, "");
    assert.equal(deleted.externalStudyId, "");
    assert.equal((await anon(pub, "POST", body)).status, 409);
    assert.equal(
      (await anon(path, "GET", undefined, header(joined))).status,
      404,
    );
    const local = createClient({
      url: "file:" + dataDirectory() + "/research.sqlite",
    });
    try {
      const docs = (
        await local.execute({
          sql: "SELECT data FROM documents WHERE kind='surveyHandoff' AND workspace_id=?",
          args: [s.workspaceId],
        })
      ).rows;
      const tomb = docs
        .map((r) => JSON.parse(r.data as string))
        .find((r) => r.responseDeletedAt);
      assert.equal(tomb.provider, "rally");
      assert.equal(tomb.externalStudyId, undefined);
      assert.equal(tomb.responseId, "");
      assert.equal(tomb.secretHash, undefined);
      assert.deepEqual(tomb.routes, {
        complete: "",
        screened_out: "",
        withdrawn: "",
      });
    } finally {
      local.close();
    }
    let current = (await owner(root)).study;
    current = (
      await owner(root, "PUT", {
        version: current.version,
        guide: {
          ...current.draft,
          questions: [
            {
              id: "screen",
              type: "choice",
              text: "Which applies?",
              options: [
                { id: "no", text: "Other", rejects: true },
                { id: "yes", text: "Eligible", rejects: false },
              ],
              followUps: 0,
            },
          ],
        },
      })
    ).study;
    await owner(root + "/publish", "POST", { version: current.version });
    await owner(route, "PUT", { ...input, version: 3 });
    const screened = await anon(pub, "POST", request("screened_person"));
    const ending = await anon(
      `interviews/${screened.interview.id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 0, answer: "Other", optionId: "no" },
      header(screened),
    );
    assert.equal(ending.interview.status, "screened_out");
    assert.equal(
      new URL(
        (
          await anon(
            `interviews/${screened.interview.id}/survey-handoff`,
            "GET",
            undefined,
            header(screened),
          )
        ).destination.url,
      ).pathname,
      "/research/rally_study_A/screened",
    );
  },
);
