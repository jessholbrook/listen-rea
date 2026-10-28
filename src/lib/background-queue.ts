import { after } from "next/server";
import { get, put, transaction } from "./db";
import { backgroundKind } from "./background-jobs-store";
import type { BackgroundJob } from "./background-jobs";
export function backgroundDriver() {
  return (
    process.env.RESEARCH_BACKGROUND_DRIVER ||
    (process.env.VERCEL ? "vercel" : "local")
  );
}
export async function publishBackgroundJob(
  jobId: string,
  wake: number,
  delaySeconds = 0,
) {
  const driver = backgroundDriver();
  if (driver === "manual") return;
  if (driver === "vercel") {
    const { send } = await import("@vercel/queue");
    await send(
      "echo-lab-work",
      { jobId, wake },
      {
        idempotencyKey: `${jobId}:${wake}`,
        delaySeconds,
        retentionSeconds: 86400,
        region: "iad1",
      },
    );
  } else if (driver === "local") {
    after(async () => {
      try {
        if (delaySeconds)
          await new Promise((r) => setTimeout(r, delaySeconds * 1000));
        const { runBackgroundMessage } = await import("./background-worker");
        await runBackgroundMessage({ jobId, wake });
      } catch {
        console.warn("BACKGROUND_LOCAL_DELIVERY_PENDING");
      }
    });
  } else throw Error("BACKGROUND_DRIVER_NOT_CONFIGURED");
  await transaction(async () => {
    const j = await get<BackgroundJob>(backgroundKind, jobId);
    if (j && j.wake === wake) {
      j.publishedWake = wake;
      j.dispatchPending = false;
      await put(backgroundKind, j);
    }
  });
}
