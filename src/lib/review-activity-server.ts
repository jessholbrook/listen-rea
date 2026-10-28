import { planDate } from "./review-plans";
import { z } from "zod";
import { db, list, transaction, pruneLibraryCollections } from "./db";
import { fail, respond } from "./http";
import type { Actor } from "./domain";
import type { CollectionHandoff } from "./collection-handoff";
import { currentHandoffInboxPacket } from "./collection-handoff-server";
import { activityKind } from "./review-activity-records";
import {
  activityActions,
  type ReviewActivity,
  type ActivityView,
  type ActivityEventView,
} from "./review-activity";
// Snapshot current coordination, never copied research or saved member names.
export async function dispatchReviewActivity(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "review-activity") return null;
  if (p.length !== 2) fail(404, "Review activity route unavailable.");
  if (req.method !== "GET") fail(405, "Review history is read-only.");
  const params = new URL(req.url).searchParams;
  if ([...params.keys()].length !== new Set(params.keys()).size)
    fail(400, "Choose each filter once.");
  const q = z
    .object({
      packetId: z.union([z.uuid(), z.literal("")]).default(""),
      personId: z
        .union([z.uuid(), z.literal(""), z.literal("system")])
        .default(""),
      action: z.union([z.enum(activityActions), z.literal("")]).default(""),
      from: z.union([planDate, z.literal("")]).default(""),
      to: z.union([planDate, z.literal("")]).default(""),
      timeZone: z
        .string()
        .max(100)
        .refine((s) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: s });
            return true;
          } catch {
            return false;
          }
        }, "Choose a valid time zone.")
        .default("UTC"),
      page: z.coerce.number().int().min(0).max(100000).default(0),
    })
    .strict()
    .parse(Object.fromEntries(params));
  if (q.from && q.to && q.to < q.from)
    fail(400, "Choose an end date on or after the start date.");
  return transaction(async () => {
    await pruneLibraryCollections(a.workspaceId);
    const packets = [];
    for (const collectionId of new Set(
      (
        await list<CollectionHandoff>("libraryCollectionHandoff", a.workspaceId)
      ).map((p) => p.collectionId),
    )) {
      const packet = await currentHandoffInboxPacket(a, collectionId);
      if (packet) packets.push(packet);
    }
    const remaining = new Set(
      (
        await list<CollectionHandoff>("libraryCollectionHandoff", a.workspaceId)
      ).map((p) => p.id),
    );
    const current = packets.filter((p) => remaining.has(p.id)),
      logs = (await list<ReviewActivity>(activityKind, a.workspaceId)).filter(
        (r) => current.some((p) => p.id === r.id),
      );
    const members = await db
      .prepare("SELECT id,name FROM users WHERE workspace_id=?")
      .all(a.workspaceId);
    const person = (id: string) => ({
      id,
      name:
        (members.find((m) => m.id === id)?.name as string | undefined) || null,
    });
    const events: ActivityEventView[] = logs
      .flatMap((r) => {
        const packet = current.find((p) => p.id === r.id)!;
        return r.events.map((e) => ({
          id: e.id,
          at: e.at,
          sequence: e.sequence,
          action: e.action,
          packetVersion: e.packetVersion,
          reviewVersion: e.reviewVersion,
          actor: e.actorId ? person(e.actorId) : null,
          ...(e.before
            ? {
                before: e.before.map((v) => ({
                  ...person(v.id),
                  dueDate: v.dueDate,
                })),
              }
            : {}),
          ...(e.after
            ? {
                after: e.after.map((v) => ({
                  ...person(v.id),
                  dueDate: v.dueDate,
                })),
              }
            : {}),
          ...(e.reviewerId ? { reviewer: person(e.reviewerId) } : {}),
          clearedReviewers: e.clearedReviewerIds.map(person),
          finalApprovalReset: e.finalApprovalReset,
          packet: {
            id: packet.id,
            collectionId: packet.collectionId,
            title: packet.title,
            collectionTitle: packet.collectionTitle,
          },
        }));
      })
      .sort(
        (a, b) =>
          b.at.localeCompare(a.at) ||
          a.packet.id.localeCompare(b.packet.id) ||
          b.sequence - a.sequence ||
          b.id.localeCompare(a.id),
      );
    const ids = new Set(
      events.flatMap((e) => [
        ...(e.actor ? [e.actor.id] : []),
        ...(e.before || []).map((v) => v.id),
        ...(e.after || []).map((v) => v.id),
        ...(e.reviewer ? [e.reviewer.id] : []),
        ...e.clearedReviewers.map((v) => v.id),
      ]),
    );
    const dateFormatter = new Intl.DateTimeFormat("en", {
      timeZone: q.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const day = (at: string) => {
      const parts = dateFormatter.formatToParts(new Date(at));
      return ["year", "month", "day"]
        .map((type) => parts.find((p) => p.type === type)!.value)
        .join("-");
    };
    const filtered = events.filter(
      (e) =>
        (!q.packetId || e.packet.id === q.packetId) &&
        (!q.action || e.action === q.action) &&
        (!q.personId ||
          (q.personId === "system"
            ? !e.actor
            : [
                ...(e.actor ? [e.actor.id] : []),
                ...(e.before || []).map((v) => v.id),
                ...(e.after || []).map((v) => v.id),
                ...(e.reviewer ? [e.reviewer.id] : []),
                ...e.clearedReviewers.map((v) => v.id),
              ].includes(q.personId))) &&
        (!q.from || day(e.at) >= q.from) &&
        (!q.to || day(e.at) <= q.to),
    );
    const pages = Math.max(1, Math.ceil(filtered.length / 20)),
      page = Math.min(q.page, pages - 1);
    const result: ActivityView = {
      total: filtered.length,
      page,
      pages,
      events: filtered.slice(page * 20, page * 20 + 20),
      packets: current
        .map((p) => ({ id: p.id, title: p.title }))
        .sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        ),
      people: [...ids]
        .map(person)
        .sort(
          (a, b) =>
            (a.name || "").localeCompare(b.name || "") ||
            a.id.localeCompare(b.id),
        ),
      omitted: logs
        .filter((r) => !q.packetId || r.id === q.packetId)
        .reduce((n, r) => n + r.omitted, 0),
    };
    return respond(result);
  });
}
