import { after } from "next/server";
import { db, get, put, list, uid, now, transaction } from "./db";
import { backgroundDriver } from "./background-queue";
import type {
  NotificationDelivery,
  NotificationEndpoint,
  NotificationWake,
} from "./integration-notifications";
import { notificationSource } from "./notification-store";
import { openNotificationKey } from "./notification-crypto";
import {
  notificationHeaders,
  sendNotification,
  type NotificationSender,
} from "./notification-transport";
export async function publishNotificationWake(workspaceId: string) {
  const wake = await get<NotificationWake>(
    "notificationWake",
    workspaceId,
    workspaceId,
  );
  if (!wake || backgroundDriver() === "manual") return;
  const delay = Math.max(0, Math.ceil((wake.nextAt - Date.now()) / 1000));
  if (backgroundDriver() === "vercel") {
    const { send } = await import("@vercel/queue");
    await send(
      "echo-lab-work",
      { action: "notifyIntegration", workspaceId, generation: wake.generation },
      {
        region: "iad1",
        idempotencyKey: "notification:" + workspaceId + ":" + wake.generation,
        delaySeconds: Math.min(86400, delay),
        retentionSeconds: 86400,
      },
    );
  } else
    after(async () => {
      if (delay) return;
      try {
        await runNotificationWake(workspaceId, wake.generation);
      } catch {
        console.warn("NOTIFICATION_DELIVERY_PENDING");
      }
    });
}
export async function runNotificationWake(
  workspaceId: string,
  generation: string,
  sender: NotificationSender = sendNotification,
  publish = publishNotificationWake,
) {
  let claimed = false;
  const wakeToken = uid();
  await transaction(async () => {
    const w = await get<NotificationWake>(
      "notificationWake",
      workspaceId,
      workspaceId,
    );
    if (
      !w ||
      w.generation !== generation ||
      (w.leaseUntil || 0) > Date.now() ||
      w.nextAt > Date.now()
    )
      return;
    await put("notificationWake", {
      ...w,
      leaseUntil: Date.now() + 180000,
      leaseToken: wakeToken,
    });
    claimed = true;
  });
  if (!claimed) return;
  try {
    const due = (
      await list<NotificationDelivery>("notificationDelivery", workspaceId)
    )
      .filter(
        (d) =>
          (d.state === "pending" && d.nextAt <= Date.now()) ||
          (d.state === "sending" && (d.leaseUntil || 0) <= Date.now()),
      )
      .sort((a, b) => a.nextAt - b.nextAt)
      .slice(0, 5);
    for (const item of due)
      await deliverNotification(item.id, workspaceId, sender);
  } finally {
    let again = false;
    await transaction(async () => {
      const w = await get<NotificationWake>(
        "notificationWake",
        workspaceId,
        workspaceId,
      );
      if (!w || w.generation !== generation || w.leaseToken !== wakeToken)
        return;
      const pending = (
        await list<NotificationDelivery>("notificationDelivery", workspaceId)
      ).filter((d) => ["pending", "sending"].includes(d.state));
      if (pending.length) {
        await put("notificationWake", {
          ...w,
          generation: uid(),
          leaseUntil: undefined,
          leaseToken: undefined,
          nextAt: Math.min(
            ...pending.map((d) =>
              d.state === "sending" ? d.leaseUntil || Date.now() : d.nextAt,
            ),
          ),
        });
        again = true;
      } else
        await db
          .prepare(
            "DELETE FROM documents WHERE kind='notificationWake' AND id=? AND workspace_id=?",
          )
          .run(workspaceId, workspaceId);
    });
    if (again)
      try {
        await publish(workspaceId);
      } catch {}
  }
}
export async function deliverNotification(
  id: string,
  workspaceId: string,
  sender: NotificationSender = sendNotification,
) {
  let delivery: NotificationDelivery | undefined,
    endpoint: NotificationEndpoint | undefined;
  const attemptToken = uid();
  await transaction(async () => {
    const d = await get<NotificationDelivery>(
      "notificationDelivery",
      id,
      workspaceId,
    );
    if (
      !d ||
      !(
        (d.state === "pending" && d.nextAt <= Date.now()) ||
        (d.state === "sending" && (d.leaseUntil || 0) <= Date.now())
      )
    )
      return;
    const e = await get<NotificationEndpoint>(
      "notificationEndpoint",
      d.endpointId,
      workspaceId,
    );
    if (
      !e ||
      !(await notificationSource(d, e)) ||
      Date.now() - Date.parse(d.createdAt) > 7 * 86400000
    ) {
      await put("notificationDelivery", {
        ...d,
        payload: undefined,
        state: "cancelled",
        error: "source",
        version: d.version + 1,
        updatedAt: now(),
      });
      return;
    }
    if (d.cycleAttempts >= 5) {
      await put("notificationDelivery", {
        ...d,
        state: "failed",
        error: "network",
        leaseUntil: undefined,
        attemptToken: undefined,
        version: d.version + 1,
        updatedAt: now(),
      });
      return;
    }
    delivery = {
      ...d,
      state: "sending",
      attempts: d.attempts + 1,
      cycleAttempts: d.cycleAttempts + 1,
      attemptToken,
      leaseUntil: Date.now() + 60000,
      version: d.version + 1,
      updatedAt: now(),
    };
    endpoint = e;
    await put("notificationDelivery", delivery);
  });
  if (!delivery || !endpoint) return;
  // A second, current read immediately before the external side effect fences intervening revocation/erasure.
  const fresh = await get<NotificationDelivery>(
      "notificationDelivery",
      id,
      workspaceId,
    ),
    current = await get<NotificationEndpoint>(
      "notificationEndpoint",
      endpoint.id,
      workspaceId,
    );
  if (
    !fresh ||
    fresh.attemptToken !== attemptToken ||
    !current ||
    !(await notificationSource(fresh, current))
  )
    return;
  let httpStatus: number | undefined, error: "http" | "network" | undefined;
  try {
    const body = JSON.stringify(delivery.payload),
      secret = openNotificationKey<string>(endpoint.sealedKey, endpoint.id);
    httpStatus = (
      await sender(
        endpoint.url,
        notificationHeaders(secret, delivery.eventId, body, delivery.attempts),
        body,
      )
    ).status;
    if (httpStatus < 200 || httpStatus >= 300) error = "http";
  } catch {
    error = "network";
  }
  await transaction(async () => {
    const d = await get<NotificationDelivery>(
        "notificationDelivery",
        id,
        workspaceId,
      ),
      e = await get<NotificationEndpoint>(
        "notificationEndpoint",
        endpoint!.id,
        workspaceId,
      );
    if (!d || d.attemptToken !== attemptToken) return;
    if (!e || !(await notificationSource(d, e))) {
      await put("notificationDelivery", {
        ...d,
        payload: undefined,
        state: "cancelled",
        error: "revoked",
        leaseUntil: undefined,
        attemptToken: undefined,
        version: d.version + 1,
        updatedAt: now(),
      });
      return;
    }
    const retryable =
      !httpStatus ||
      httpStatus === 408 ||
      httpStatus === 429 ||
      httpStatus >= 500;
    const retry = !!error && retryable && d.cycleAttempts < 5;
    const delays = [10000, 60000, 300000, 900000];
    await put("notificationDelivery", {
      ...d,
      state: !error ? "delivered" : retry ? "pending" : "failed",
      error,
      httpStatus,
      leaseUntil: undefined,
      attemptToken: undefined,
      nextAt: retry
        ? Date.now() + delays[Math.min(3, d.cycleAttempts - 1)]
        : d.nextAt,
      version: d.version + 1,
      updatedAt: now(),
    });
  });
}
