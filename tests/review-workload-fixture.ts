import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inboxSetup } from "./team-review-inbox-fixture";
import { client } from "./image-review-fixture";
export async function workloadSetup() {
  const c = await inboxSetup(),
    replacement = {
      id: randomUUID(),
      name: "Synthetic available reviewer",
      email: randomUUID() + "@example.test",
      password: "workload-test-password",
      call: await client(),
    };
  await c.local.db
    .prepare(
      "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
    )
    .run(
      replacement.id,
      replacement.email,
      replacement.name,
      c.local.passwordHash(replacement.password),
      c.actor.workspaceId,
      "collaborator",
    );
  assert.equal(
    (
      await replacement.call("auth/login", "POST", {
        email: replacement.email,
        password: replacement.password,
      })
    ).status,
    200,
  );
  return { ...c, replacement };
}
export const reassign = (
  p: any,
  fromReviewerId: string,
  toReviewerId: string,
) => ({
  op: "reassign",
  id: p.id,
  packetVersion: p.packetVersion,
  version: p.version,
  signature: p.signature,
  fromReviewerId,
  toReviewerId,
});
export const planningPath = (g: any, id = g.d.packet.id) =>
  g.path + "/planning?" + new URLSearchParams({ id });
