import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import { start, stop, client, base, dataDirectory } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3128 : 3127 }),
  { timeout: 90000 },
);
after(stop);
test(
  "Versioned read API enforces key scope, study boundary, lifecycle, revocation, issuer role and durable concurrent rate limits",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      other = await client(),
      anon = await client(),
      collab = await client();
    for (const [c, email] of [
      [owner, "api-owner@example.test"],
      [other, "api-other@example.test"],
    ] as const)
      await c("auth/signup", "POST", {
        name: "API researcher",
        email,
        password: "external-api-test-password",
      });
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
      .invite;
    await collab("auth/signup", "POST", {
      name: "API observer",
      email: "api-observer@example.test",
      password: "external-api-test-password",
      invite,
    });
    async function study(c = owner, publish = true) {
      let s = (await c("studies", "POST", { title: "External API study" }))
        .study;
      s = (
        await c(`studies/${s.id}`, "PUT", {
          version: s.version,
          guide: emotionInterview().guide,
        })
      ).study;
      if (publish) {
        s = (await c(`studies/${s.id}/publish`, "POST", { version: s.version }))
          .study;
        await c(`studies/${s.id}/fielding`, "POST", { state: "active" });
      }
      return s;
    }
    const s = await study(),
      hidden = await study(),
      draft = await study(owner, false),
      foreign = await study(other);
    const request = {
      requestId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      name: "Read integration",
      studyIds: [s.id, draft.id],
      scopes: ["studies:read", "responses:read", "analyses:read"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    assert.equal((await collab("api-keys")).status, 403);
    assert.equal((await collab("api-keys", "POST", request)).status, 403);
    assert.equal(
      (await owner("api-keys", "POST", { ...request, studyIds: [foreign.id] }))
        .status,
      404,
    );
    assert.equal(
      (
        await owner("api-keys", "POST", {
          ...request,
          scopes: ["studies:write"],
        })
      ).status,
      400,
    );
    const issued = await owner("api-keys", "POST", request);
    assert.equal(issued.status, 201);
    assert.equal(
      (await owner("api-keys", "POST", request)).token,
      issued.token,
    );
    assert.equal(
      (await owner("api-keys", "POST", { ...request, name: "Changed" })).status,
      409,
    );
    const bearer = { Authorization: "Bearer " + issued.token };
    const read = (path: string) => anon("v1/" + path, "GET", undefined, bearer);
    assert.equal((await owner("v1/studies")).status, 401);
    assert.equal((await anon("v1/studies?token=" + issued.token)).status, 401);
    const first = await read("studies?limit=1");
    assert.equal(first.status, 200);
    assert.deepEqual(
      first.data.map((v: any) => v.id),
      [s.id],
    );
    assert.equal((await read("studies/" + hidden.id)).status, 404);
    assert.equal((await read("studies/" + foreign.id)).status, 404);
    assert.equal((await read("studies/" + draft.id)).status, 404);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const r = await anon(
        "v1/studies/" + s.id,
        method,
        method === "OPTIONS" ? undefined : { fielding: "active" },
        bearer,
      );
      assert.equal(r.status, 405);
      assert.equal(r.error.code, "method_not_allowed");
    }
    assert.equal((await anon("api-keys", "POST", request, bearer)).status, 401);
    assert.equal(
      (
        await anon(
          `studies/${s.id}/fielding`,
          "POST",
          { state: "closed" },
          bearer,
        )
      ).status,
      401,
    );
    assert.equal((await read("studies?limit=101")).status, 400);
    assert.equal((await read("studies?unknown=x")).status, 400);
    assert.equal((await read(`studies/${s.id}/emails`)).status, 404);
    const minimal = await owner("api-keys", "POST", {
      ...request,
      requestId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      studyIds: [s.id],
      scopes: ["studies:read"],
    });
    assert.equal(
      (
        await anon(`v1/studies/${s.id}/responses`, "GET", undefined, {
          Authorization: "Bearer " + minimal.token,
        })
      ).status,
      403,
    );
    async function response(complete = true) {
      const j = await anon("public/" + s.id, "POST", {
        consent: true,
        attributes: { email: "private-tag@example.test" },
      });
      if (complete)
        await anon(
          `interviews/${j.interview.id}/answer`,
          "POST",
          {
            requestId: randomUUID(),
            version: 0,
            value: ["happy", "", "An original participant note."],
            answer: "",
          },
          { "x-interview-token": j.token },
        );
      return j.interview.id;
    }
    const ids = [await response(), await response(), await response()],
      active = await response(false);
    const page1 = await read(`studies/${s.id}/responses?limit=2`);
    assert.equal(page1.data.length, 2);
    assert.ok(page1.nextCursor);
    const page2 = await read(
      `studies/${s.id}/responses?limit=2&cursor=${page1.nextCursor}`,
    );
    assert.equal(page2.data.length, 1);
    assert.equal(page2.nextCursor, null);
    assert.equal(
      new Set([...page1.data, ...page2.data].map((v) => v.id)).size,
      3,
    );
    const detail = (await read(`studies/${s.id}/responses/${ids[0]}`)).data;
    assert.ok(detail.turns[0].answer.includes("original participant note"));
    for (const field of [
      "tokenHash",
      "attributes",
      "guide",
      "requests",
      "invitationId",
      "audioId",
      "workspaceId",
    ])
      assert.equal(detail[field], undefined);
    assert.ok(!JSON.stringify(detail).includes("private-tag@example.test"));
    assert.equal(
      (await read(`studies/${s.id}/responses/${active}`)).status,
      404,
    );
    const sql = createClient({
      url: "file:" + dataDirectory() + "/research.sqlite",
    });
    try {
      const current = (await owner("studies/" + s.id)).study,
        analysisId = randomUUID(),
        analysis = {
          id: analysisId,
          workspaceId: current.workspaceId,
          studyId: s.id,
          version: 1,
          dataVersion: current.dataVersion,
          createdAt: new Date().toISOString(),
          model: "synthetic",
          studyGoal: "Research",
          summary: "Reviewed summary",
          limitations: "Synthetic fixture",
          memo: "Reviewed memo",
          reviewed: false,
          themes: [
            {
              id: "finding",
              title: "A source-backed finding",
              description: "Synthetic observation",
              citations: [
                {
                  interviewId: ids[0],
                  turnId: detail.turns[0].id,
                  quote: "original participant note",
                },
              ],
            },
          ],
        };
      await sql.execute({
        sql: "INSERT INTO documents(kind,id,workspace_id,study_id,data) VALUES(?,?,?,?,?)",
        args: [
          "analysis",
          analysisId,
          current.workspaceId,
          s.id,
          JSON.stringify(analysis),
        ],
      });
      assert.equal((await read(`studies/${s.id}/analyses`)).data.length, 0);
      assert.equal(
        (await read(`studies/${s.id}/analyses/${analysisId}`)).status,
        404,
      );
      await owner(`studies/${s.id}/analysis`, "PUT", {
        id: analysisId,
        version: 1,
        summary: analysis.summary,
        limitations: analysis.limitations,
        themes: analysis.themes,
        memo: analysis.memo,
        reviewed: true,
      });
      assert.equal((await read(`studies/${s.id}/analyses`)).data.length, 1);
      assert.equal(
        (await read(`studies/${s.id}/analyses/${analysisId}`)).data.memo,
        "Reviewed memo",
      );
      await owner(`studies/${s.id}/responses/${ids[0]}`, "PATCH", {
        excluded: true,
        reason: "Synthetic exclusion",
      });
      assert.equal(
        (await read(`studies/${s.id}/responses/${ids[0]}`)).status,
        404,
      );
      assert.equal(
        (await read(`studies/${s.id}/analyses/${analysisId}`)).status,
        404,
      );
      await owner(`studies/${s.id}/responses/${ids[1]}`, "DELETE");
      assert.equal(
        (await read(`studies/${s.id}/responses/${ids[1]}`)).status,
        404,
      );
      assert.equal((await read(`studies/${s.id}/responses`)).data.length, 1);
      const rows = await sql.execute(
        "SELECT data FROM documents WHERE kind IN ('readApiKey','apiKeyRequest')",
      );
      assert.ok(!JSON.stringify(rows.rows).includes(request.secret));
      assert.ok(
        !JSON.stringify(await owner("api-keys")).includes(issued.token),
      );
      const keyRow = (
          await sql.execute({
            sql: "SELECT data FROM documents WHERE kind='readApiKey' AND id=?",
            args: [minimal.key.id],
          })
        ).rows[0],
        key = JSON.parse(keyRow.data as string);
      for (let attempt = 0; attempt < 2; attempt++) {
        const minute = Math.floor(Date.now() / 60000);
        await sql.execute({
          sql: "UPDATE documents SET data=? WHERE kind='readApiKey' AND id=?",
          args: [
            JSON.stringify({ ...key, rateMinute: minute, rateCount: 59 }),
            key.id,
          ],
        });
        const statuses = await Promise.all(
          [0, 1].map(() =>
            anon("v1/studies", "GET", undefined, {
              Authorization: "Bearer " + minimal.token,
            }),
          ),
        );
        if (Math.floor(Date.now() / 60000) === minute) {
          assert.deepEqual(statuses.map((v) => v.status).sort(), [200, 429]);
          break;
        }
        assert.ok(attempt === 0, "Rate boundary retry exhausted");
      }
      await sql.execute({
        sql: "UPDATE users SET role=? WHERE id=?",
        args: ["researcher", key.ownerId],
      });
      assert.equal((await read("studies")).status, 401);
      await sql.execute({
        sql: "UPDATE users SET role=? WHERE id=?",
        args: ["admin", key.ownerId],
      });
      await sql.execute({
        sql: "UPDATE documents SET data=? WHERE kind='readApiKey' AND id=?",
        args: [
          JSON.stringify({
            ...key,
            expiresAt: new Date(Date.now() - 1).toISOString(),
          }),
          key.id,
        ],
      });
      assert.equal(
        (
          await anon("v1/studies", "GET", undefined, {
            Authorization: "Bearer " + minimal.token,
          })
        ).status,
        401,
      );
      const raw = await fetch(base + "/api/v1/studies", { headers: bearer });
      assert.equal(raw.headers.get("cache-control"), "private, no-store");
      assert.ok(raw.headers.get("x-request-id"));
      assert.equal(raw.headers.get("access-control-allow-origin"), null);
      assert.equal(
        (
          await owner(`api-keys/${issued.key.id}/revoke`, "POST", {
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal((await read("studies")).status, 401);
      assert.equal(
        (await owner("api-keys", "POST", request)).key.revokedAt !== null,
        true,
      );
      assert.equal((await read("studies")).status, 401);
    } finally {
      sql.close();
    }
  },
);
