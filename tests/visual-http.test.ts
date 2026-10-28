import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client, base } from "./harness";
import { visualFixture } from "./visual-fixture";
before(() => start({ port: 3112 }), { timeout: 90000 });
after(stop);
test(
  "visual evidence review, failed-run retries, isolation and source lifecycle",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      anon = await client();
    const credentials = {
      email: "visual@example.test",
      password: "visual-password-test",
    };
    await owner("auth/signup", "POST", {
      ...credentials,
      name: "Visual Owner",
    });
    await stranger("auth/signup", "POST", {
      email: "stranger-visual@example.test",
      password: "visual-password-test",
      name: "Other Owner",
    });
    const study = (
      await owner("studies", "POST", { title: "Visual decisions" })
    ).study;
    const imported = await owner("library/imports", "POST", {
      studyId: study.id,
      requestId: randomUUID(),
      externalId: "visual-1",
      title: "Synthetic screen",
      transcript: "Participant: I opened the help page.",
      permissionConfirmed: true,
      transcriptReviewed: true,
    });
    const auth = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const upload = await fetch(
      base + `/api/library/imports/${imported.interviewId}/media`,
      {
        method: "POST",
        headers: {
          cookie: auth.headers.get("set-cookie")!.split(";")[0],
          "content-type": "video/mp4",
        },
        body: new Uint8Array(await visualFixture()),
      },
    );
    assert.equal(upload.status, 201);
    const { mediaId } = await upload.json();
    const root = `studies/${study.id}/visual`;
    assert.equal((await anon(root)).status, 401);
    assert.equal((await stranger(root)).status, 404);
    let data = await owner(root);
    assert.equal(data.sources.length, 1);
    assert.ok(data.sources[0].sourceFingerprint);
    const input = {
      mediaId,
      atMs: 2000,
      description: "SUPPORT heading is visible.",
      interpretation: "May provide access to contact options.",
      uncertainty: "Input method is not visible.",
      tag: "visible_content",
      status: "pending",
      reviewed: false,
      claim: null,
    };
    assert.equal(
      (
        await owner(root + "/observations", "POST", {
          ...input,
          status: "confirmed",
        })
      ).status,
      400,
    );
    assert.equal(
      (await owner(root + "/observations", "POST", { ...input, atMs: 99999 }))
        .status,
      400,
    );
    assert.equal(
      (
        await owner(root + "/observations", "POST", {
          ...input,
          claim: {
            quote: "invented quote",
            relation: "context",
            note: "Context only.",
          },
        })
      ).status,
      400,
    );
    const note = (await owner(root + "/observations", "POST", input))
      .observation;
    assert.ok(note.id);
    assert.equal(note.version, 1);
    assert.ok(
      !(await owner(root + "/export")).text.includes(input.description),
    );
    assert.equal(
      (await owner(root + "/qa", "POST", { question: "What is visible?" }))
        .citations.length,
      0,
    );
    assert.equal(
      (await stranger(root + `/observations/${note.id}/history`)).status,
      404,
    );
    const edit = {
      ...input,
      status: "confirmed",
      reviewed: true,
      version: 1,
      claim: {
        quote: "I opened the help page.",
        relation: "context",
        note: "Account context; no click count inferred.",
      },
    };
    assert.equal(
      (await owner(root + `/observations/${note.id}`, "PUT", edit)).status,
      200,
    );
    assert.equal(
      (await owner(root + `/observations/${note.id}`, "PUT", edit)).status,
      409,
    );
    assert.equal(
      (await owner(root + `/observations/${note.id}/history`)).history.length,
      2,
    );
    assert.ok((await owner(root + "/export")).text.includes(input.description));
    assert.equal(
      (
        await owner(root + "/qa", "POST", {
          question: "How many clicks did they make?",
        })
      ).citations.length,
      0,
    );
    const generation = {
      mediaId,
      requestId: randomUUID(),
      startMs: 0,
      endMs: 3000,
      frameCount: 3,
      sendToProvider: true,
    };
    assert.equal(
      (
        await owner(root + "/runs", "POST", {
          ...generation,
          sendToProvider: false,
        })
      ).status,
      400,
    );
    const generated = await owner(root + "/runs", "POST", generation);
    assert.equal(generated.status, 200, JSON.stringify(generated));
    let run = generated.run;
    assert.equal(run.state, "failed");
    assert.equal(run.attempts, 1);
    assert.equal((await owner(root + `/runs/${run.id}`)).run.state, "failed");
    run = (await owner(root + "/runs", "POST", generation)).run;
    assert.equal(run.attempts, 2);
    assert.equal(
      (await owner(root + "/runs", "POST", { ...generation, endMs: 2000 }))
        .status,
      409,
    );
    await owner(
      `studies/${study.id}/responses/${imported.interviewId}`,
      "PATCH",
      { excluded: true, reason: "Review source" },
    );
    data = await owner(root);
    assert.equal(data.sources.length, 0);
    assert.equal(data.observations.length, 0);
    assert.equal(data.runs.length, 0);
    assert.equal(
      (await owner(root + `/observations/${note.id}/history`)).status,
      404,
    );
    await owner(
      `studies/${study.id}/responses/${imported.interviewId}`,
      "PATCH",
      { excluded: false, reason: "Reviewed" },
    );
    assert.equal((await owner(root)).observations.length, 1);
    await owner(
      `studies/${study.id}/responses/${imported.interviewId}`,
      "DELETE",
    );
    data = await owner(root);
    assert.equal(data.sources.length, 0);
    assert.equal(data.observations.length, 0);
    assert.equal(data.runs.length, 0);
    assert.equal((await owner("recordings/" + mediaId)).status, 404);
  },
);
