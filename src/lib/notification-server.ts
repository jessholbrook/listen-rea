import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  db,
  get,
  put,
  list,
  hash,
  uid,
  now,
  transaction,
  requireStudy,
} from "./db";
import { actor, body, respond, fail, limit } from "./http";
import type { Actor } from "./domain";
import {
  notificationConfig,
  type NotificationEndpoint,
  type NotificationDelivery,
} from "./integration-notifications";
import {
  notificationEncryptionReady,
  sealNotificationKey,
  openNotificationKey,
} from "./notification-crypto";
import {
  notificationAllowed,
  notificationHeaders,
  sendNotification,
  type NotificationSender,
} from "./notification-transport";
import {
  cancelEndpointDeliveries,
  ensureNotificationWake,
  notificationSource,
} from "./notification-store";
import { publishNotificationWake } from "./notification-queue";
async function admin(a: Actor) {
  const row = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(a.id);
  if (row?.role !== "admin" || row.workspace_id !== a.workspaceId)
    fail(403, "Current workspace admin access is required.");
}
function endpointView(e: NotificationEndpoint) {
  const { sealedKey, rotationRequest, ...view } = e;
  return { ...view, destinationApproved: notificationAllowed(e.url) };
}
function deliveryView(d: NotificationDelivery) {
  const {
    payload,
    attemptToken,
    leaseUntil,
    manualRequest,
    workspaceId,
    ...view
  } = d;
  return view;
}
async function selectedStudies(a: Actor, studyIds: string[]) {
  for (const id of studyIds)
    if (!(await get("study", id, a.workspaceId)))
      fail(404, "Selected study is unavailable.");
}
export async function dispatchNotifications(
  req: Request,
  p: string[],
  sender: NotificationSender = sendNotification,
  internalActor?: Actor,
) {
  if (p[0] !== "notifications") return null;
  const a = internalActor || (await actor());
  await admin(a);
  if (req.method !== "GET") limit("notifications:" + a.id, 40);
  if (req.method === "GET" && p.length === 1)
    return respond({
      encryptionReady: notificationEncryptionReady(),
      endpoints: (
        await list<NotificationEndpoint>("notificationEndpoint", a.workspaceId)
      ).map(endpointView),
      deliveries: (
        await list<NotificationDelivery>("notificationDelivery", a.workspaceId)
      )
        .slice(0, 200)
        .map(deliveryView),
      studies: (await list<any>("study", a.workspaceId)).map((s) => ({
        id: s.id,
        title: s.title,
      })),
    });
  if (req.method === "POST" && p.length === 1) {
    const input = notificationConfig
      .safeExtend({
        requestId: z.uuid(),
        secret: z.string().regex(/^[a-f0-9]{64}$/),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    if (!notificationEncryptionReady())
      fail(
        503,
        "Private signing-key storage is not configured. Ask the deployment admin to finish notification setup.",
      );
    const id = hash(a.workspaceId + ":" + input.requestId),
      digest = hash(JSON.stringify(input));
    let endpoint!: NotificationEndpoint,
      reused = false;
    await transaction(async () => {
      await admin(a);
      await selectedStudies(a, input.studyIds);
      const receipt = await get<{ digest: string }>(
        "notificationEndpointReceipt",
        id,
        a.workspaceId,
      );
      if (receipt) {
        if (receipt.digest !== digest)
          fail(409, "This registration request has different content.");
        const old = await get<NotificationEndpoint>(
          "notificationEndpoint",
          id,
          a.workspaceId,
        );
        if (!old)
          fail(
            410,
            "This destination was removed. Use a new registration request.",
          );
        if (old.version !== 1)
          fail(409, "This destination changed; use the current settings.");
        endpoint = old;
        reused = true;
        return;
      }
      if ((await list("notificationEndpoint", a.workspaceId)).length >= 5)
        fail(409, "A workspace can register up to five destinations.");
      const receipts = await list("notificationEndpointReceipt", a.workspaceId);
      if (receipts.length >= 200)
        fail(409, "This workspace reached its destination registration limit.");
      endpoint = {
        id,
        workspaceId: a.workspaceId,
        name: input.name,
        url: input.url,
        studyIds: input.studyIds,
        eventTypes: input.eventTypes,
        version: 1,
        enabled: false,
        sealedKey: sealNotificationKey("eln_" + input.secret, id),
        authorizedById: a.id,
        createdAt: now(),
        updatedAt: now(),
        sequence: 0,
        dropped: 0,
      };
      await put("notificationEndpoint", endpoint);
      await put("notificationEndpointReceipt", {
        id,
        workspaceId: a.workspaceId,
        digest,
      });
    });
    return respond(
      {
        endpoint: endpointView(endpoint),
        signingKey: openNotificationKey<string>(endpoint.sealedKey, id),
      },
      reused ? 200 : 201,
    );
  }
  if (!p[1]) fail(405, "Unsupported notification action.");
  if (
    p[1] === "deliveries" &&
    p.length === 4 &&
    p[3] === "retry" &&
    req.method === "POST"
  ) {
    const input = z
      .object({
        version: z.number().int().positive(),
        requestId: z.uuid(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await admin(a);
      const d = await get<NotificationDelivery>(
        "notificationDelivery",
        p[2],
        a.workspaceId,
      );
      if (!d) fail(404, "Delivery not found.");
      if (d.manualRequest === input.requestId) return;
      const e = await get<NotificationEndpoint>(
        "notificationEndpoint",
        d.endpointId,
        a.workspaceId,
      );
      if (
        d.state !== "failed" ||
        d.version !== input.version ||
        d.manualRetries >= 3 ||
        Date.now() - Date.parse(d.createdAt) > 7 * 86400000 ||
        !e ||
        !(await notificationSource(d, e))
      )
        fail(
          409,
          "Only a current failed delivery can be retried, up to three reviewed retry cycles within seven days.",
        );
      await put("notificationDelivery", {
        ...d,
        state: "pending",
        cycleAttempts: 0,
        manualRetries: d.manualRetries + 1,
        manualRequest: input.requestId,
        nextAt: Date.now(),
        version: d.version + 1,
        updatedAt: now(),
      });
      await ensureNotificationWake(a.workspaceId);
    });
    try {
      await publishNotificationWake(a.workspaceId);
    } catch {}
    return respond({ ok: true });
  }
  if (p[1] === "dispatch" && p.length === 2 && req.method === "POST") {
    await transaction(async () => {
      await admin(a);
      await ensureNotificationWake(a.workspaceId);
    });
    try {
      await publishNotificationWake(a.workspaceId);
    } catch {}
    return respond({ ok: true });
  }
  let endpoint = await get<NotificationEndpoint>(
    "notificationEndpoint",
    p[1],
    a.workspaceId,
  );
  if (!endpoint) fail(404, "Notification destination not found.");
  if (p.length === 2 && req.method === "PUT") {
    const input = notificationConfig
      .safeExtend({
        version: z.number().int().positive(),
        enabled: z.boolean(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await admin(a);
      await selectedStudies(a, input.studyIds);
      const old = await get<NotificationEndpoint>(
        "notificationEndpoint",
        p[1],
        a.workspaceId,
      );
      if (!old || old.version !== input.version)
        fail(409, "Destination settings changed. Refresh first.");
      if (
        input.enabled &&
        (!old.verifiedAt ||
          old.url !== input.url ||
          !notificationAllowed(input.url) ||
          !notificationEncryptionReady())
      )
        fail(
          409,
          "Verify the current approved destination before enabling it.",
        );
      await cancelEndpointDeliveries(old);
      endpoint = {
        ...old,
        name: input.name,
        url: input.url,
        studyIds: input.studyIds,
        eventTypes: input.eventTypes,
        enabled: input.enabled,
        version: old.version + 1,
        authorizedById: a.id,
        updatedAt: now(),
        verifiedAt: old.url === input.url ? old.verifiedAt : undefined,
        rotationRequest: undefined,
      };
      await put("notificationEndpoint", endpoint);
    });
    return respond({ endpoint: endpointView(endpoint!) });
  }
  if (p.length === 3 && p[2] === "verify" && req.method === "POST") {
    const input = z
      .object({
        version: z.number().int().positive(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    if (input.version !== endpoint.version)
      fail(409, "Destination changed. Refresh first.");
    if (!notificationAllowed(endpoint.url))
      fail(
        503,
        "This destination origin has not been approved by the deployment admin.",
      );
    const challenge = uid(),
      id = uid(),
      raw = JSON.stringify({
        id,
        type: "endpoint.verification",
        occurredAt: now(),
        data: { challenge },
      }),
      headers = {
        ...notificationHeaders(
          openNotificationKey<string>(endpoint.sealedKey, endpoint.id),
          id,
          raw,
          1,
        ),
        "Echo-Lab-Verification": "1",
      };
    let result;
    try {
      result = await sender(endpoint.url, headers, raw);
    } catch {
      fail(
        502,
        "Destination verification failed. Check the receiver and approved origin.",
      );
    }
    if (
      result.status < 200 ||
      result.status >= 300 ||
      result.challenge !== challenge
    )
      fail(
        409,
        "The receiver must return a successful JSON response containing echo_lab_challenge equal to this signed challenge.",
      );
    await transaction(async () => {
      await admin(a);
      const old = await get<NotificationEndpoint>(
        "notificationEndpoint",
        p[1],
        a.workspaceId,
      );
      if (!old || old.version !== input.version)
        fail(409, "Destination changed while verifying.");
      endpoint = {
        ...old,
        verifiedAt: now(),
        updatedAt: now(),
        version: old.version + 1,
      };
      await cancelEndpointDeliveries(old);
      await put("notificationEndpoint", endpoint);
    });
    return respond({ endpoint: endpointView(endpoint) });
  }
  if (p.length === 3 && p[2] === "rotate" && req.method === "POST") {
    const input = z
      .object({
        version: z.number().int().positive(),
        requestId: z.uuid(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    let secret = "";
    await transaction(async () => {
      await admin(a);
      const old = await get<NotificationEndpoint>(
        "notificationEndpoint",
        p[1],
        a.workspaceId,
      );
      if (!old) fail(404, "Destination not found.");
      if (old.rotationRequest === input.requestId) {
        secret = openNotificationKey<string>(old.sealedKey, old.id);
        endpoint = old;
        return;
      }
      if (old.version !== input.version)
        fail(409, "Destination changed. Refresh first.");
      secret = "eln_" + randomBytes(32).toString("hex");
      await cancelEndpointDeliveries(old);
      endpoint = {
        ...old,
        sealedKey: sealNotificationKey(secret, old.id),
        enabled: false,
        verifiedAt: undefined,
        rotationRequest: input.requestId,
        version: old.version + 1,
        authorizedById: a.id,
        updatedAt: now(),
      };
      await put("notificationEndpoint", endpoint);
    });
    return respond({ endpoint: endpointView(endpoint), signingKey: secret });
  }
  if (p.length === 2 && req.method === "DELETE") {
    const input = z
      .object({
        version: z.number().int().positive(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await admin(a);
      const old = await get<NotificationEndpoint>(
        "notificationEndpoint",
        p[1],
        a.workspaceId,
      );
      if (!old || old.version !== input.version)
        fail(409, "Destination changed. Refresh first.");
      await db
        .prepare(
          "DELETE FROM documents WHERE workspace_id=? AND (kind='notificationEndpoint' AND id=? OR kind='notificationDelivery' AND json_extract(data,'$.endpointId')=?)",
        )
        .run(a.workspaceId, old.id, old.id);
    });
    return respond({ ok: true });
  }
  fail(405, "Unsupported notification action.");
}
