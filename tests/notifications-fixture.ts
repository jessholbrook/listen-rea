import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { advancedSetup } from "./advanced-methods-fixture";
import { automationGuide } from "./automation-fixture";
import { base, client } from "./harness";
import type { NotificationSender } from "../src/lib/notification-transport";
export async function notificationsSetup(
  existing?: Awaited<ReturnType<typeof advancedSetup>>,
) {
  const c = existing || (await advancedSetup());
  process.env.RESEARCH_BACKGROUND_DRIVER = "manual";
  process.env.RESEARCH_NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(
    32,
    11,
  ).toString("base64");
  process.env.RESEARCH_NOTIFICATION_ALLOWED_ORIGINS =
    "https://receiver.example.com";
  const study = await c.create(
    automationGuide("Synthetic notification study"),
    "Synthetic notification study",
  );
  const { dispatchNotifications } =
      await import("../src/lib/notification-server"),
    { deliverNotification, runNotificationWake } =
      await import("../src/lib/notification-queue");
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];
  let status = 204,
    lose = false,
    hook: (() => Promise<void>) | undefined;
  const sender: NotificationSender = async (url, headers, body) => {
    calls.push({ url, headers, body });
    if (hook) {
      const fn = hook;
      hook = undefined;
      await fn();
    }
    if (lose) throw Error("Marked ambiguous network result");
    return headers["Echo-Lab-Verification"] === "1"
      ? { status: 200, challenge: JSON.parse(body).data.challenge }
      : { status };
  };
  const ask = async (path = "", method = "GET", data?: unknown) =>
    dispatchNotifications(
      new Request(base + "/api/notifications" + (path ? "/" + path : ""), {
        method,
        headers: { "content-type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      ["notifications", ...(path ? path.split("/") : [])],
      sender,
      c.actor,
    );
  const input = {
    requestId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    name: "Synthetic owned receiver",
    url: "https://receiver.example.com/notify",
    studyIds: [study.id],
    eventTypes: ["study.changed", "response.changed", "job.changed"],
    reviewed: true,
  };
  const registered = await (await ask("", "POST", input))!.json();
  assert.equal(registered.endpoint.enabled, false);
  let endpoint = registered.endpoint;
  const current = async () => {
    const view = await (await ask())!.json();
    endpoint = view.endpoints.find((e: any) => e.id === endpoint.id);
    return view;
  };
  const verify = async () => {
    const r = await ask(endpoint.id + "/verify", "POST", {
      version: endpoint.version,
      reviewed: true,
    });
    endpoint = (await r!.json()).endpoint;
    return endpoint;
  };
  const setEnabled = async (enabled = true) => {
    await current();
    const r = await ask(endpoint.id, "PUT", {
      name: endpoint.name,
      url: endpoint.url,
      studyIds: endpoint.studyIds,
      eventTypes: endpoint.eventTypes,
      version: endpoint.version,
      enabled,
      reviewed: true,
    });
    endpoint = (await r!.json()).endpoint;
    return endpoint;
  };
  const changed = async () => {
    const s = await c.local.get<any>("study", study.id, c.actor.workspaceId);
    await c.local.put("study", {
      ...s,
      version: s.version + 1,
      updatedAt: new Date().toISOString(),
    });
  };
  const deliver = async (id: string) =>
    deliverNotification(id, c.actor.workspaceId, sender);
  const due = async () => {
    await c.local.db
      .prepare(
        "UPDATE documents SET data=json_set(data,'$.nextAt',0,'$.leaseUntil',0) WHERE kind IN ('notificationDelivery','notificationWake') AND workspace_id=?",
      )
      .run(c.actor.workspaceId);
  };
  const drain = async () => {
    const wake = await c.local.get<any>(
      "notificationWake",
      c.actor.workspaceId,
      c.actor.workspaceId,
    );
    if (wake)
      await runNotificationWake(
        c.actor.workspaceId,
        wake.generation,
        sender,
        async () => {},
      );
  };
  function signature(call: (typeof calls)[number]) {
    const expected =
      "v1=" +
      createHmac("sha256", registered.signingKey)
        .update(call.headers["Echo-Lab-Timestamp"] + "." + call.body)
        .digest("hex");
    assert.equal(call.headers["Echo-Lab-Signature"], expected);
  }
  async function completed() {
    await c.owner(`studies/${study.id}/fielding`, "POST", { state: "active" });
    const person = await client(),
      j = await person("public/" + study.id, "POST", { consent: true });
    assert.equal(j.status, 201);
    await person(
      "interviews/" + j.interview.id + "/answer",
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "Synthetic private answer must never be notified",
      },
      { "x-interview-token": j.token },
    );
    return j;
  }
  return {
    ...c,
    study,
    ask,
    input,
    current,
    verify,
    setEnabled,
    changed,
    calls,
    sender,
    deliver,
    due,
    drain,
    signature,
    completed,
    secret: registered.signingKey,
    getEndpoint: () => endpoint,
    setStatus: (v: number) => {
      status = v;
    },
    setLose: (v: boolean) => {
      lose = v;
    },
    setHook: (v: () => Promise<void>) => {
      hook = v;
    },
  };
}
