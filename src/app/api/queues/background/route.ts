import { runTremendousWake } from "@/lib/tremendous-queue";
import { runProlificWake } from "@/lib/prolific-queue";
import { closeRealtime } from "@/lib/realtime-server";
import { handleCallback } from "@vercel/queue";
import { z } from "zod";
import { runBackgroundMessage } from "@/lib/background-worker";
export const runtime = "nodejs";
export const maxDuration = 180;
const message = z
  .object({ jobId: z.uuid(), wake: z.number().int().positive() })
  .strict();
export const POST = handleCallback(
  async (payload) => {
    const expiry = z
      .object({
        realtimeId: z.string().regex(/^[a-f0-9]{64}$/),
        action: z.literal("expireVoice"),
      })
      .strict()
      .safeParse(payload);
    if (expiry.success) {
      await closeRealtime(expiry.data.realtimeId);
      return;
    }
    const tremendous = z
      .object({
        action: z.literal("syncTremendous"),
        studyId: z.uuid(),
        generation: z.string().min(1).max(64),
      })
      .strict()
      .safeParse(payload);
    if (tremendous.success) {
      await runTremendousWake(
        tremendous.data.studyId,
        tremendous.data.generation,
      );
      return;
    }
    const prolific = z
      .object({
        action: z.literal("syncProlific"),
        studyId: z.uuid(),
        generation: z.string().min(1).max(64),
      })
      .strict()
      .safeParse(payload);
    if (prolific.success) {
      await runProlificWake(prolific.data.studyId, prolific.data.generation);
      return;
    }
    const parsed = message.safeParse(payload);
    if (!parsed.success) return;
    await runBackgroundMessage(parsed.data);
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(300, metadata.deliveryCount * 30),
    }),
  },
);
