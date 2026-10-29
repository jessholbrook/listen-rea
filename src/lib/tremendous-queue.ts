import { after } from "next/server";
import { db, get, put, list, now, uid, transaction } from "./db";
import { backgroundDriver } from "./background-queue";
import { syncTremendousStudy } from "./tremendous-server";
import {
  tremendousTransport,
  type TremendousTransport,
} from "./tremendous-provider";
import type { TremendousPlan } from "./tremendous";
export type TremendousWake = {
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
export async function publishTremendousWake(
  studyId: string,
  generation: string,
) {
  if (backgroundDriver() === "manual") return;
  if (backgroundDriver() === "vercel") {
    const { send } = await import("@vercel/queue");
    await send(
      "echo-lab-work",
      { action: "syncTremendous", studyId, generation },
      {
        region: "iad1",
        idempotencyKey: "tremendous:" + studyId + ":" + generation,
        retentionSeconds: 86400,
      },
    );
  } else
    after(async () => {
      try {
        await runTremendousWake(studyId, generation);
      } catch {
        console.warn("TREMENDOUS_RECONCILIATION_PENDING");
      }
    });
}
export async function requestTremendousWake(
  c: TremendousPlan,
  publish = publishTremendousWake,
) {
  let wake!: TremendousWake;
  await transaction(async () => {
    const existing = await get<TremendousWake>(
      "tremendousWake",
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
    await put("tremendousWake", wake);
  });
  try {
    await publish(wake.id, wake.generation);
  } catch {
    /* Daily maintenance/manual refresh recovers the durable read-only wake. */
  }
}
export async function runTremendousWake(
  studyId: string,
  generation: string,
  provider: TremendousTransport = tremendousTransport,
  publish = publishTremendousWake,
) {
  const workspaceId = process.env.RESEARCH_TREMENDOUS_ECHO_WORKSPACE_ID;
  if (!workspaceId || !provider.binding(workspaceId)) return;
  let claimed: TremendousWake | undefined;
  await transaction(async () => {
    const w = await get<TremendousWake>("tremendousWake", studyId, workspaceId);
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
    await put("tremendousWake", claimed);
  });
  if (!claimed) return;
  try {
    await syncTremendousStudy(studyId, workspaceId, provider);
    let next: TremendousWake | undefined;
    await transaction(async () => {
      const w = await get<TremendousWake>(
        "tremendousWake",
        studyId,
        workspaceId,
      );
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
          await put("tremendousWake", next);
        } else
          await db
            .prepare(
              "DELETE FROM documents WHERE kind='tremendousWake' AND id=? AND workspace_id=?",
            )
            .run(studyId, workspaceId);
      }
    });
    if (next) await publish(next.id, next.generation);
  } catch {
    await transaction(async () => {
      const w = await get<TremendousWake>(
        "tremendousWake",
        studyId,
        workspaceId,
      );
      if (w?.generation === generation)
        await put("tremendousWake", {
          ...w,
          state: w.attempts >= 3 ? "failed" : "pending",
          leaseUntil: undefined,
        });
    });
    throw Error("TREMENDOUS_RECONCILIATION_PENDING");
  }
}
export async function tremendousMaintenance() {
  const workspaceId = process.env.RESEARCH_TREMENDOUS_ECHO_WORKSPACE_ID;
  if (!workspaceId || !tremendousTransport.binding(workspaceId))
    return { scheduled: 0 };
  const configs = (
    await list<TremendousPlan>("tremendousPlan", workspaceId)
  ).slice(0, 20);
  for (const c of configs) await requestTremendousWake(c);
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='tremendousEvent' AND workspace_id=? AND json_extract(data,'$.createdAt')<?",
    )
    .run(workspaceId, new Date(Date.now() - 7 * 86400000).toISOString());
  return { scheduled: configs.length };
}
