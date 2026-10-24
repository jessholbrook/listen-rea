import { z } from "zod";
import { participant, body, respond, publicInterview, fail } from "./http";
import { get, put, transaction } from "./db";
import type { Interview } from "./domain";
import { conceptFor } from "./concepts";
export async function dispatchConceptTiming(req: Request, p: string[]) {
  if (
    p.length !== 3 ||
    p[0] !== "interviews" ||
    p[2] !== "concept-presentation"
  )
    return null;
  const initial = await participant(req, p[1]);
  if (req.method === "GET")
    return respond({ interview: publicInterview(initial, true) });
  if (req.method !== "POST") fail(405, "Method not allowed.");
  const input = z
    .object({
      conceptId: z.string().min(1).max(100),
      version: z.number().int().min(0),
      action: z.enum(["start", "untimed"]),
    })
    .strict()
    .parse(await body(req));
  return transaction(async () => {
    const i = await get<Interview>("interview", initial.id);
    if (!i) fail(404, "Interview not found.");
    const c = conceptFor(i);
    if (
      i.status !== "active" ||
      !c?.exposureSeconds ||
      c.id !== input.conceptId
    )
      fail(409, "The current concept changed. Reload to continue.");
    const saved =
      i.conceptExposures && Object.hasOwn(i.conceptExposures, c.id)
        ? i.conceptExposures[c.id]
        : undefined;
    if (
      (input.action === "start" && saved?.endsAt !== undefined) ||
      (input.action === "untimed" && saved?.untimedAt !== undefined)
    )
      return respond({ interview: publicInterview(i, true) });
    if (i.version !== input.version || i.pending)
      fail(409, "This interview changed in another tab. Reload to continue.");
    if (input.action === "start" && saved?.untimedAt !== undefined)
      return respond({ interview: publicInterview(i, true) });
    const at = Date.now(),
      exposure =
        input.action === "start"
          ? { startedAt: at, endsAt: at + c.exposureSeconds * 1000 }
          : { ...saved, untimedAt: at };
    i.conceptExposures = {
      ...i.conceptExposures,
      [c.id]: { ...exposure, revision: (saved?.revision || 0) + 1 },
    };
    await put("interview", i);
    return respond({ interview: publicInterview(i, true) });
  });
}
