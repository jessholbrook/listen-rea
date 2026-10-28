import { z } from "zod";
import { actor, body, fail, respond } from "./http";
import { get, list } from "./db";
import {
  backgroundKind,
  createBackgroundJob,
  changeBackgroundJob,
  pruneBackgroundJobs,
} from "./background-jobs-store";
import { backgroundView, type BackgroundJob } from "./background-jobs";
import { publishBackgroundJob } from "./background-queue";
export async function dispatchBackgroundJobs(req: Request, p: string[]) {
  if (p[0] !== "background-jobs") return null;
  const a = await actor();
  await pruneBackgroundJobs(a.workspaceId);
  if (p.length === 1 && req.method === "GET") {
    const q = new URL(req.url).searchParams;
    for (const k of q.keys())
      if (!["studyId", "targetId"].includes(k)) fail(400, "Unknown job scope.");
    const studyId = q.has("studyId")
        ? z.uuid().parse(q.get("studyId"))
        : undefined,
      targetId = q.has("targetId")
        ? z.uuid().parse(q.get("targetId"))
        : undefined;
    const jobs = (await list<BackgroundJob>(backgroundKind, a.workspaceId))
      .filter(
        (j) =>
          (!studyId || j.studyId === studyId) &&
          (!targetId || j.targetId === targetId),
      )
      .sort(
        (a, b) =>
          Number(["queued", "running"].includes(b.state)) -
            Number(["queued", "running"].includes(a.state)) ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, 100);
    return respond({
      jobs: jobs.map(backgroundView),
      canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
    });
  }
  let j: BackgroundJob | undefined,
    status = 200;
  if (p.length === 1 && req.method === "POST") {
    const result = await createBackgroundJob(a, await body(req));
    j = result.job;
    status = result.reused ? 200 : 201;
  } else if (p.length === 2) {
    const id = z.uuid().parse(p[1]);
    if (req.method === "GET") {
      j = await get<BackgroundJob>(backgroundKind, id, a.workspaceId);
      if (!j) fail(404, "Job unavailable.");
      return respond({ job: backgroundView(j) });
    }
    if (req.method !== "PATCH") fail(405, "Method not allowed.");
    const input = z
      .object({
        version: z.number().int().positive(),
        op: z.enum(["cancel", "retry", "dispatch"]),
      })
      .strict()
      .parse(await body(req));
    j = await changeBackgroundJob(a, id, input);
  } else fail(405, "Method not allowed.");
  if (
    j.state === "queued" ||
    (j.state === "running" && (j.leaseUntil || 0) < Date.now())
  ) {
    try {
      await publishBackgroundJob(j.id, j.wake);
    } catch {
      /* Durable outbox remains pending for explicit retry or scheduled recovery. */
    }
  }
  const current = await get<BackgroundJob>(backgroundKind, j.id, a.workspaceId);
  return respond({ job: backgroundView(current || j) }, status);
}
