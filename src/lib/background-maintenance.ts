import { prolificMaintenance } from "./prolific-queue";
import { reapRealtime } from "./realtime-server";
import { runPulseSchedules } from "./pulse-schedule-server";
import { timingSafeEqual, createHash } from "node:crypto";
import { db, get, list } from "./db";
import { retention } from "./features";
import { backgroundKind, pruneBackgroundJobs } from "./background-jobs-store";
import { activeJob, type BackgroundJob } from "./background-jobs";
import { publishBackgroundJob } from "./background-queue";
export function maintenanceAuthorized(value: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !value) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(value), digest("Bearer " + secret));
}
export async function backgroundMaintenance(
  publish = publishBackgroundJob,
  cleanup = () => retention(true),
) {
  await cleanup();
  await pruneBackgroundJobs();
  const rows = await db
    .prepare(
      "SELECT data FROM documents WHERE kind='backgroundJob' AND json_extract(data,'$.state') IN ('queued','running') ORDER BY json_extract(data,'$.createdAt') LIMIT 100",
    )
    .all();
  let dispatched = 0,
    pending = 0;
  for (const row of rows) {
    const j = JSON.parse(String(row.data)) as BackgroundJob;
    if (
      activeJob(j) &&
      (j.state !== "running" || (j.leaseUntil || 0) < Date.now())
    ) {
      try {
        await publish(j.id, j.wake);
        dispatched++;
      } catch {
        pending++;
      }
    }
  }
  // Terminal metadata ages out; source content is never stored in the outbox.
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='backgroundJob' AND json_extract(data,'$.state') IN ('complete','cancelled') AND json_extract(data,'$.updatedAt')<?",
    )
    .run(new Date(Date.now() - 7 * 86400000).toISOString());
  await reapRealtime();
  const pulse = await runPulseSchedules();
  const prolific = await prolificMaintenance();
  return { ok: true, dispatched, pending, pulse, prolific };
}
