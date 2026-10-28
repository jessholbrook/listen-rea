import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { participant, body, respond, publicInterview, fail } from "./http";
import { get, put, transaction } from "./db";
import type { Interview } from "./domain";
import type { ConceptVideo } from "./concept-videos";
import { conceptFor } from "./concepts";
import { videoPresentation, type VideoView } from "./video-once";
function grant(i: Interview, conceptId: string, token: string) {
  const v =
    i.videoViews && Object.hasOwn(i.videoViews, conceptId)
      ? i.videoViews[conceptId]
      : undefined;
  return v?.nonce
    ? createHmac("sha256", token)
        .update(i.id + ":" + conceptId + ":" + v.nonce)
        .digest("hex")
    : "";
}
export function videoGrantAllowed(req: Request, i: Interview) {
  const p = videoPresentation(i);
  if (!p) return true;
  if (i.status !== "active") return false;
  if (p.state === "alternative") return true;
  if (p.state !== "playing" || i.status !== "active") return false;
  const actual = req.headers.get("x-video-view-token") || "",
    expected = grant(
      i,
      p.conceptId,
      req.headers.get("x-interview-token") || "",
    );
  return (
    /^[a-f0-9]{64}$/.test(actual) &&
    expected.length === actual.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
export async function dispatchVideoOnce(req: Request, p: string[]) {
  if (p.length !== 3 || p[0] !== "interviews" || p[2] !== "video-presentation")
    return null;
  const initial = await participant(req, p[1]);
  if (req.method === "GET")
    return respond({ interview: publicInterview(initial, true) });
  if (req.method !== "POST") fail(405, "Method not allowed.");
  const input = z
    .object({
      conceptId: z.string().min(1).max(100),
      version: z.number().int().min(0),
      action: z.enum(["start", "finish", "skip", "alternative"]),
      requestId: z.uuid().optional(),
    })
    .strict()
    .parse(await body(req));
  return transaction(async () => {
    const i = await get<Interview>("interview", initial.id);
    if (!i) fail(404, "Interview not found.");
    const c = conceptFor(i);
    if (
      i.status !== "active" ||
      !c?.videoOnce ||
      !c.videoAssetId ||
      c.id !== input.conceptId
    )
      fail(409, "The current concept changed. Reload to continue.");
    const saved =
      i.videoViews && Object.hasOwn(i.videoViews, c.id)
        ? i.videoViews[c.id]
        : undefined;
    if (input.action === "start" && saved?.startedAt !== undefined) {
      if (
        input.requestId === saved.requestId &&
        videoPresentation(i)?.state === "playing"
      )
        return respond({
          interview: publicInterview(i, true),
          viewToken: grant(i, c.id, req.headers.get("x-interview-token") || ""),
        });
      fail(
        409,
        "This video view has already started. Choose replayable viewing if needed.",
      );
    }
    if (
      (input.action === "alternative" && saved?.alternativeAt !== undefined) ||
      ((input.action === "finish" || input.action === "skip") &&
        saved?.endedAt !== undefined)
    )
      return respond({ interview: publicInterview(i, true) });
    if (i.version !== input.version || i.pending)
      fail(409, "This interview changed in another tab. Reload to continue.");
    const at = Date.now();
    let next: VideoView = { ...saved, revision: (saved?.revision || 0) + 1 };
    if (input.action === "start") {
      if (!input.requestId) fail(400, "A video start request ID is required.");
      if (saved?.alternativeAt !== undefined || saved?.endedAt !== undefined)
        fail(409, "This video view is already closed or replayable.");
      const asset = await get<ConceptVideo>(
        "conceptVideo",
        c.videoAssetId,
        i.workspaceId,
      );
      if (!asset) fail(404, "Concept video is unavailable.");
      next = {
        ...next,
        startedAt: at,
        endsAt: at + asset.durationMs + 120000,
        nonce: randomBytes(32).toString("base64url"),
        requestId: input.requestId,
      };
    } else if (input.action === "finish") {
      if (!saved?.nonce || !videoGrantAllowed(req, i))
        fail(
          409,
          "This viewing window is closed or belongs to another player.",
        );
      next.endedAt = at;
    } else if (input.action === "skip") {
      next.endedAt = at;
      next.skippedAt = at;
    } else next.alternativeAt = at;
    i.videoViews = { ...i.videoViews, [c.id]: next };
    await put("interview", i);
    return respond({
      interview: publicInterview(i, true),
      ...(input.action === "start"
        ? {
            viewToken: grant(
              i,
              c.id,
              req.headers.get("x-interview-token") || "",
            ),
          }
        : {}),
    });
  });
}
