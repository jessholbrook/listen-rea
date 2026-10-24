import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import { start, stop, client, base, dataDirectory } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3134 : 3133 }),
  { timeout: 90000 },
);
after(stop);
const routes = {
  complete: "https://brand.qualtrics.com/jfe/form/SV_next?Q_JFE=qdg",
  screened_out: "https://survey.example.test/screened",
  withdrawn: "https://survey.example.test/stopped",
};
async function setup(screener = false) {
  const owner = await client(),
    other = await client(),
    anon = await client(),
    collaborator = await client();
  for (const c of [owner, other])
    await c("auth/signup", "POST", {
      name: "Handoff admin",
      email: randomUUID() + "@example.test",
      password: "handoff-test-password",
    });
  const invite = (await owner("invites", "POST", { role: "collaborator" }))
    .invite;
  await collaborator("auth/signup", "POST", {
    name: "Collaborator",
    email: randomUUID() + "@example.test",
    password: "handoff-test-password",
    invite,
  });
  let s = (await owner("studies", "POST", { title: "Qualtrics handoff study" }))
    .study;
  const guide = {
    ...emotionInterview().guide,
    title: "Qualtrics handoff study",
    limit: 20,
  };
  if (screener)
    guide.questions = [
      {
        id: "eligible",
        type: "choice",
        text: "Which group applies?",
        options: [
          { id: "yes", text: "Eligible", rejects: false },
          { id: "no", text: "Other", rejects: true },
        ],
        followUps: 0,
        instructions: "",
        section: "",
        condition: null,
      },
    ];
  s = (await owner(`studies/${s.id}`, "PUT", { guide, version: s.version }))
    .study;
  s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const root = `studies/${s.id}`,
    pub = `public/${s.id}`;
  const input = { version: 0, enabled: true, routes, reviewed: true };
  return { owner, other, anon, collaborator, s, root, pub, input };
}
const admission = (responseId = "R_" + randomUUID()) => ({
  consent: true,
  surveyHandoff: { responseId, secret: randomBytes(32).toString("hex") },
  attributes: { segment: "A", ResponseID: "must-not-enter-generic-tags" },
});
const bearer = (joined: any) => ({ "x-interview-token": joined.token });
test(
  "Survey handoffs enforce admin/workspace controls, atomic duplicate admission, private projections and unchanged invitation boundaries",
  { timeout: 90000 },
  async () => {
    const { owner, other, anon, collaborator, s, root, pub, input } =
      await setup();
    assert.equal((await anon(root + "/survey-handoff")).status, 401);
    assert.equal((await other(root + "/survey-handoff")).status, 404);
    assert.equal(
      (await collaborator(root + "/survey-handoff")).canManage,
      false,
    );
    assert.equal(
      (await collaborator(root + "/survey-handoff", "PUT", input)).status,
      403,
    );
    assert.equal((await anon(pub, "POST", admission())).status, 409);
    assert.equal(
      (
        await owner(root + "/survey-handoff", "PUT", {
          ...input,
          reviewed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (await owner(root + "/survey-handoff", "PUT", input)).status,
      200,
    );
    assert.equal(
      (await owner(root + "/survey-handoff", "PUT", input)).status,
      409,
    );
    const publicInfo = await anon(pub);
    assert.equal(publicInfo.surveyHandoff, true);
    assert.ok(!JSON.stringify(publicInfo).includes("SV_next"));
    const request = admission(),
      outcomes = await Promise.all(
        [0, 1].map(() => anon(pub, "POST", request)),
      );
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 201]);
    assert.equal(outcomes[0].interview.id, outcomes[1].interview.id);
    assert.equal(outcomes[0].token, outcomes[1].token);
    const joined = outcomes[0];
    assert.equal(joined.interview.handoffId, undefined);
    assert.deepEqual(joined.interview.attributes, {});
    assert.equal(
      (await anon(pub, "POST", { ...request, language: "en" })).status,
      409,
    );
    assert.equal(
      (
        await anon(pub, "POST", {
          ...request,
          surveyHandoff: {
            ...request.surveyHandoff,
            secret: randomBytes(32).toString("hex"),
          },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await anon(pub, "POST", {
          ...request,
          surveyHandoff: {
            ...request.surveyHandoff,
            responseId: "someone@example.test",
          },
        })
      ).status,
      400,
    );
    const rows = (await owner(root + "/survey-handoff")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].responseId, request.surveyHandoff.responseId);
    const detail = await owner(root);
    assert.equal(detail.interviews.length, 1);
    assert.equal(detail.interviews[0].attributes.ResponseID, undefined);
    assert.ok(
      !JSON.stringify(detail).includes(request.surveyHandoff.responseId),
    );
    assert.equal(
      (await anon(`interviews/${joined.interview.id}/survey-handoff`)).status,
      404,
    );
    assert.equal(
      (
        await anon(
          `interviews/${joined.interview.id}/survey-handoff`,
          "GET",
          undefined,
          bearer(joined),
        )
      ).destination,
      null,
    );
    await owner(root + "/recruitment", "PUT", {
      version: 0,
      mode: "invitation_only",
    });
    assert.equal((await anon(pub, "POST", admission())).status, 403);
    const batch = await owner(root + "/invitations", "POST", {
      requestId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      recipients: [{ reference: "Qualtrics invitation" }],
    });
    const invitedRequest = {
      ...admission(),
      invitationToken: batch.links[0].path.split("#invite=")[1],
    };
    const invited = await anon(pub, "POST", invitedRequest);
    assert.equal(invited.status, 201);
    await owner(root + "/fielding", "POST", { state: "paused" });
    const recovered = await anon(pub, "POST", invitedRequest);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.interview.id, invited.interview.id);
    const preview = await owner(root + "/preview", "POST", {});
    assert.equal(
      (
        await anon(
          `interviews/${preview.interview.id}/survey-handoff`,
          "GET",
          undefined,
          bearer(preview),
        )
      ).destination,
      null,
    );
    assert.equal((await other(root + "/survey-handoff/export")).status, 404);
    assert.equal((await anon(root + "/survey-handoff/export")).status, 401);
  },
);

test(
  "Completion, screen-out and withdrawal destinations use saved versions; disable, exclusion and source deletion are reflected in matching exports",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input, s } = await setup();
    await owner(root + "/survey-handoff", "PUT", input);
    const request = admission("R_complete_test"),
      joined = await anon(pub, "POST", request);
    const changed = {
      ...input,
      version: 1,
      routes: {
        ...routes,
        complete: "https://brand.qualtrics.com/jfe/form/SV_changed",
      },
    };
    await owner(root + "/survey-handoff", "PUT", changed);
    const complete = await anon(
      `interviews/${joined.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "",
        value: ["happy", "", "A synthetic source note."],
      },
      bearer(joined),
    );
    assert.equal(complete.interview.status, "complete");
    const destination = (
      await anon(
        `interviews/${joined.interview.id}/survey-handoff`,
        "GET",
        undefined,
        bearer(joined),
      )
    ).destination;
    const url = new URL(destination.url);
    assert.equal(url.pathname, "/jfe/form/SV_next");
    assert.equal(
      url.searchParams.get("ResponseID"),
      request.surveyHandoff.responseId,
    );
    assert.equal(url.searchParams.get("echo_status"), "complete");
    assert.equal(url.searchParams.get("Q_JFE"), "qdg");
    const stopped = await anon(pub, "POST", admission("R_stopped_test"));
    await anon(
      `interviews/${stopped.interview.id}/stop`,
      "POST",
      {},
      bearer(stopped),
    );
    const stoppedUrl = (
      await anon(
        `interviews/${stopped.interview.id}/survey-handoff`,
        "GET",
        undefined,
        bearer(stopped),
      )
    ).destination.url;
    assert.equal(
      new URL(stoppedUrl).searchParams.get("echo_status"),
      "withdrawn",
    );
    const exported = await owner(root + "/survey-handoff/export");
    assert.equal(exported.status, 200);
    assert.ok(exported.text.includes('"R_complete_test"'));
    assert.ok(exported.text.includes('"withdrawn"'));
    await owner(root + "/responses/" + joined.interview.id, "PATCH", {
      excluded: true,
      reason: "Synthetic check",
    });
    assert.equal(
      (await owner(root + "/survey-handoff")).rows.find(
        (r: any) => r.responseId === request.surveyHandoff.responseId,
      ).excluded,
      true,
    );
    await owner(root + "/survey-handoff", "PUT", {
      ...changed,
      version: 2,
      enabled: false,
      reviewed: false,
    });
    assert.equal(
      (
        await anon(
          `interviews/${joined.interview.id}/survey-handoff`,
          "GET",
          undefined,
          bearer(joined),
        )
      ).destination,
      null,
    );
    assert.equal((await anon(pub, "POST", admission())).status, 409);
    assert.equal((await anon(pub, "POST", request)).status, 200);
    await owner(root + "/responses/" + joined.interview.id, "DELETE");
    const deletedRows = (await owner(root + "/survey-handoff")).rows;
    const deleted = deletedRows.find(
      (r: any) => r.status === "response_deleted",
    );
    assert.equal(deleted.responseId, "");
    assert.equal(deleted.interviewId, null);
    assert.equal(
      (
        await anon(
          `interviews/${joined.interview.id}/survey-handoff`,
          "GET",
          undefined,
          bearer(joined),
        )
      ).status,
      404,
    );
    assert.equal((await anon(pub, "POST", request)).status, 409);
    assert.ok(
      !(await owner(root + "/survey-handoff/export")).text.includes(
        request.surveyHandoff.responseId,
      ),
    );
    const local = createClient({
      url: "file:" + dataDirectory() + "/research.sqlite",
    });
    try {
      const rows = (
        await local.execute({
          sql: "SELECT data FROM documents WHERE kind='surveyHandoff' AND workspace_id=?",
          args: [s.workspaceId],
        })
      ).rows;
      const tombstone = rows
        .map((r) => JSON.parse(r.data as string))
        .find((r) => r.responseDeletedAt);
      assert.equal(tombstone.responseId, "");
      assert.equal(tombstone.secretHash, undefined);
      assert.equal(tombstone.fingerprint, undefined);
      assert.deepEqual(tombstone.routes, {
        complete: "",
        screened_out: "",
        withdrawn: "",
      });
    } finally {
      local.close();
    }
    const screener = await setup(true);
    await screener.owner(
      screener.root + "/survey-handoff",
      "PUT",
      screener.input,
    );
    const screened = await screener.anon(
      screener.pub,
      "POST",
      admission("R_screened_test"),
    );
    const ending = await screener.anon(
      `interviews/${screened.interview.id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 0, answer: "Other", optionId: "no" },
      bearer(screened),
    );
    assert.equal(ending.interview.status, "screened_out");
    const screenUrl = (
      await screener.anon(
        `interviews/${screened.interview.id}/survey-handoff`,
        "GET",
        undefined,
        bearer(screened),
      )
    ).destination.url;
    assert.equal(
      new URL(screenUrl).searchParams.get("echo_status"),
      "screened_out",
    );
  },
);
