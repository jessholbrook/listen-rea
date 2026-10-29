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
