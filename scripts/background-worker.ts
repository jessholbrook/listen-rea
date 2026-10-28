import { db } from "../src/lib/db";
import { runBackgroundMessage } from "../src/lib/background-worker";
import { backgroundMaintenance } from "../src/lib/background-maintenance";
import type { BackgroundJob } from "../src/lib/background-jobs";
// Local/self-hosted durable runner. The deployed Vercel consumer does not need this process.
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
const once = process.argv.includes("--once");
const publish = async () => {};
if (process.argv.includes("--maintenance"))
  await backgroundMaintenance(publish);
do {
  const row = await db
    .prepare(
      "SELECT data FROM documents WHERE kind='backgroundJob' AND (json_extract(data,'$.state')='queued' OR (json_extract(data,'$.state')='running' AND COALESCE(json_extract(data,'$.leaseUntil'),0)<?)) ORDER BY json_extract(data,'$.createdAt') LIMIT 1",
    )
    .get(Date.now());
  if (row) {
    const j = JSON.parse(String(row.data)) as BackgroundJob;
    try {
      await runBackgroundMessage({ jobId: j.id, wake: j.wake }, { publish });
    } catch {
      console.warn("BACKGROUND_DELIVERY_DEFERRED");
    }
  }
  if (!once && !stopped) await new Promise((r) => setTimeout(r, 1000));
} while (!once && !stopped);
