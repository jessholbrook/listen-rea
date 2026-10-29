import { after } from "next/server";
import { db, get, put, list, now, uid, transaction } from "./db";
import { backgroundDriver } from "./background-queue";
import { syncProlific } from "./prolific-server";
import { prolificTransport, type ProlificTransport } from "./prolific-provider";
import type { ProlificConfig } from "./prolific";
export type ProlificWake = {
  id: string;
  workspaceId: string;
  studyId: string;
  generation: string;
  attempts: number;
  state: "pending" | "running" | "failed";
  leaseUntil?: number;
  dirty?: boolean;
  createdAt: string;
};
export async function publishProlificWake(studyId: string, generation: string) {
  if (backgroundDriver() === "manual") return;
  if (backgroundDriver() === "vercel") {
    const { send } = await import("@vercel/queue");
    await send(
      "echo-lab-work",
      { action: "syncProlific", studyId, generation },
      {
        region: "iad1",
        idempotencyKey: "prolific:" + studyId + ":" + generation,
        retentionSeconds: 86400,
      },
    );
  } else
    after(async () => {
      try {
        await runProlificWake(studyId, generation);
      } catch {
        console.warn("PROLIFIC_RECONCILIATION_PENDING");
      }
    });
}
export async function requestProlificWake(
  c: ProlificConfig,
  publish = publishProlificWake,
) {
  let wake!: ProlificWake;
  await transaction(async () => {
    const existing = await get<ProlificWake>(
      "prolificWake",
      c.id,
      c.workspaceId,
    );
    if (existing && ["pending", "running"].includes(existing.state)) {
      wake = existing;
      return;
    }
    wake = {
      id: c.id,
      studyId: c.id,
      workspaceId: c.workspaceId,
      generation: uid(),
      attempts: 0,
      state: "pending",
      createdAt: now(),
    };
    await put("prolificWake", wake);
  });
  try {
    await publish(wake.id, wake.generation);
  } catch {
    /* Daily maintenance/manual refresh recovers the durable read-only wake. */
  }
}
export async function runProlificWake(
  studyId: string,
  generation: string,
  provider: ProlificTransport = prolificTransport,
  publish = publishProlificWake,
) {
  const workspaceId = process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID;
  if (!workspaceId || !provider.binding(workspaceId)) return;
  let claimed: ProlificWake | undefined;
  await transaction(async () => {
    const w = await get<ProlificWake>("prolificWake", studyId, workspaceId);
    if (
      !w ||
      w.generation !== generation ||
      w.state === "failed" ||
      (w.leaseUntil || 0) > Date.now()
    )
      return;
    claimed = {
      ...w,
      state: "running",
      attempts: w.attempts + 1,
      leaseUntil: Date.now() + 180000,
    };
    await put("prolificWake", claimed);
  });
  if (!claimed) return;
  try {
    await syncProlific(studyId, workspaceId, provider);
    let next: ProlificWake | undefined;
    await transaction(async () => {
      const w = await get<ProlificWake>("prolificWake", studyId, workspaceId);
      if (w?.generation === generation) {
        if (w.dirty) {
          next = {
            ...w,
            state: "pending",
            attempts: 0,
            generation: uid(),
            leaseUntil: undefined,
            dirty: false,
          };
          await put("prolificWake", next);
        } else
          await db
            .prepare(
              "DELETE FROM documents WHERE kind='prolificWake' AND id=? AND workspace_id=?",
            )
            .run(studyId, workspaceId);
      }
    });
    if (next) await publish(next.id, next.generation);
  } catch {
    await transaction(async () => {
      const w = await get<ProlificWake>("prolificWake", studyId, workspaceId);
      if (w?.generation === generation)
        await put("prolificWake", {
          ...w,
          state: w.attempts >= 3 ? "failed" : "pending",
          leaseUntil: undefined,
        });
    });
    throw Error("PROLIFIC_RECONCILIATION_PENDING");
  }
}
export async function prolificMaintenance() {
  const workspaceId = process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID;
  if (!workspaceId || !prolificTransport.binding(workspaceId))
    return { scheduled: 0 };
  const configs = (await list<ProlificConfig>("prolificConfig", workspaceId))
    .filter((c) => c.draftId && c.connectionHash)
    .slice(0, 20);
  for (const c of configs) await requestProlificWake(c);
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='prolificEvent' AND workspace_id=? AND json_extract(data,'$.createdAt')<?",
    )
    .run(workspaceId, new Date(Date.now() - 7 * 86400000).toISOString());
  return { scheduled: configs.length };
}
