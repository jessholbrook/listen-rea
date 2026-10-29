import { db, get, put, list, uid, now, transaction } from "./db";
import {
  notificationProjection,
  type NotificationEndpoint,
  type NotificationDelivery,
  type NotificationWake,
} from "./integration-notifications";
export async function captureNotifications(
  kind: string,
  before: unknown,
  value: any,
  endpoints: NotificationEndpoint[],
) {
  if (
    kind === "interview" &&
    (value.preview || value.excluded || value.status !== "complete")
  )
    await db
      .prepare(
        "DELETE FROM documents WHERE kind='notificationDelivery' AND workspace_id=? AND json_extract(data,'$.eventType')='response.changed' AND json_extract(data,'$.payload.data.id')=?",
      )
      .run(value.workspaceId, value.id);
  const projection = notificationProjection(kind, before, value);
  if (!projection) return false;
  let recorded = false;
  const eventId = uid(),
    occurredAt = now();
  for (const endpoint of endpoints.filter(
    (e) =>
      e.enabled &&
      e.studyIds.includes(projection.data.studyId) &&
      e.eventTypes.includes(projection.type),
  )) {
    endpoint.sequence++;
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM documents WHERE kind='notificationDelivery' AND workspace_id=? AND json_extract(data,'$.endpointId')=?",
      )
      .get(value.workspaceId, endpoint.id);
    if (Number(count?.n) >= 1000) {
      endpoint.dropped++;
      endpoint.lastDroppedAt = now();
      await put("notificationEndpoint", endpoint);
      continue;
    }
    const delivery: NotificationDelivery = {
      id: uid(),
      workspaceId: value.workspaceId,
      studyId: projection.data.studyId,
      endpointId: endpoint.id,
      endpointVersion: endpoint.version,
      payload: {
        ...projection,
        id: eventId,
        occurredAt,
        sequence: endpoint.sequence,
      },
      eventId,
      eventType: projection.type,
      state: "pending",
      version: 1,
      attempts: 0,
      cycleAttempts: 0,
      manualRetries: 0,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      nextAt: Date.now(),
    };
    await put("notificationDelivery", delivery);
    await put("notificationEndpoint", endpoint);
    recorded = true;
  }
  if (recorded) await ensureNotificationWake(value.workspaceId);
  return recorded;
}
export async function ensureNotificationWake(workspaceId: string) {
  const existing = await get<NotificationWake>(
    "notificationWake",
    workspaceId,
    workspaceId,
  );
  if (existing) {
    if (
      !(existing.leaseUntil && existing.leaseUntil > Date.now()) &&
      existing.nextAt > Date.now()
    ) {
      const ready = { ...existing, nextAt: Date.now(), generation: uid() };
      await put("notificationWake", ready);
      return ready;
    }
    return existing;
  }
  const wake: NotificationWake = {
    id: workspaceId,
    workspaceId,
    generation: uid(),
    nextAt: Date.now(),
  };
  await put("notificationWake", wake);
  return wake;
}
export async function clearStudyNotifications(
  workspaceId: string,
  studyId: string,
) {
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='notificationDelivery' AND workspace_id=? AND study_id=?",
    )
    .run(workspaceId, studyId);
}
export async function notificationSource(
  d: NotificationDelivery,
  e: NotificationEndpoint,
) {
  const admin = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(e.authorizedById);
  if (
    !e.enabled ||
    !e.verifiedAt ||
    e.version !== d.endpointVersion ||
    !e.studyIds.includes(d.studyId) ||
    !e.eventTypes.includes(d.eventType) ||
    admin?.role !== "admin" ||
    admin.workspace_id !== e.workspaceId
  )
    return false;
  if (!d.payload || !(await get("study", d.studyId, d.workspaceId)))
    return false;
  if (d.eventType === "response.changed") {
    const i = await get<any>("interview", d.payload.data.id, d.workspaceId);
    return (
      !!i &&
      i.studyId === d.studyId &&
      !i.preview &&
      !i.excluded &&
      i.status === "complete"
    );
  }
  if (d.eventType === "job.changed") {
    const job = await get<any>(
      "backgroundJob",
      d.payload.data.id,
      d.workspaceId,
    );
    if (!job || job.studyId !== d.studyId) return false;
    const target = await get<any>(
      job.kind === "transcription" ? "libraryRecording" : "renderJob",
      job.targetId,
      d.workspaceId,
    );
    if (!target) return false;
    if (
      target.interviewId &&
      !(await get("interview", target.interviewId, d.workspaceId))
    )
      return false;
  }
  return true;
}
export async function cancelEndpointDeliveries(e: NotificationEndpoint) {
  for (const d of (
    await list<NotificationDelivery>("notificationDelivery", e.workspaceId)
  ).filter(
    (d) =>
      d.endpointId === e.id &&
      ["pending", "sending", "failed"].includes(d.state),
  ))
    await put("notificationDelivery", {
      ...d,
      payload: undefined,
      attemptToken: undefined,
      leaseUntil: undefined,
      state: "cancelled",
      version: d.version + 1,
      error: "revoked",
      updatedAt: now(),
    });
}
export async function notificationMaintenance(
  publish: (workspaceId: string) => Promise<void>,
) {
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='notificationDelivery' AND json_extract(data,'$.createdAt')<?",
    )
    .run(new Date(Date.now() - 7 * 86400000).toISOString());
  const wakes = await db
    .prepare(
      "SELECT id FROM documents WHERE kind='notificationWake' ORDER BY rowid LIMIT 100",
    )
    .all();
  let dispatched = 0;
  for (const w of wakes)
    try {
      await publish(String(w.id));
      dispatched++;
    } catch {}
  return { dispatched };
}
