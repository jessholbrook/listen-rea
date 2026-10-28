import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { client } from "./image-review-fixture";
export const feedbackAction = (d: any, extra: any) => ({
  id: d.packet.id,
  packetVersion: d.packet.version,
  version: d.feedback.version,
  signature: d.signature,
  ...extra,
});
export const finalReview = (d: any) => ({
  id: d.packet.id,
  version: d.packet.version,
  signature: d.signature,
  reviewed: true,
});
export const packetEdit = (d: any, extra: any) => ({
  id: d.packet.id,
  version: d.packet.version,
  title: d.packet.title,
  summary: d.packet.summary,
  language: d.packet.language,
  answerIds: d.packet.answerIds,
  taskIds: d.packet.taskIds,
  ...extra,
});
export async function inboxSetup(withPerson = true) {
  const c = await transcriptSetup();
  const person = {
    id: randomUUID(),
    name: "Synthetic inbox reviewer",
    email: randomUUID() + "@example.test",
    password: "inbox-test-password",
    call: await client(),
  };
  if (withPerson) {
    await c.local.db
      .prepare(
        "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
      )
      .run(
        person.id,
        person.email,
        person.name,
        c.local.passwordHash(person.password),
        c.actor.workspaceId,
        "researcher",
      );
    assert.equal(
      (
        await person.call("auth/login", "POST", {
          email: person.email,
          password: person.password,
        })
      ).status,
      200,
    );
  }
  const groups: any[] = [];
  const create = async (
    title: string,
    reviewerIds: string[] = [],
    language = "en",
  ) => {
    const collection = (
      await c.owner("library/collections", "POST", {
        requestId: randomUUID(),
        title,
        interviewIds: c.imports.map((i) => i.interviewId),
        briefIds: [],
      })
    ).collection;
    const path = `library/collections/${collection.id}/handoff`;
    let d = await c.owner(path, "POST", {
      requestId: randomUUID(),
      title: "Packet " + title,
      summary: "PRIVATE_INBOX_SUMMARY",
      language,
      answerIds: [],
      taskIds: [],
    });
    assert.equal(d.status, 201);
    if (reviewerIds.length)
      d = await c.owner(
        path + "/feedback",
        "POST",
        feedbackAction(d, { op: "assign", reviewerIds }),
      );
    assert.ok([200, 201].includes(d.status), JSON.stringify(d));
    const g = { collection, path, d, language };
    groups.push(g);
    return g;
  };
  return { ...c, person, groups, create };
}
