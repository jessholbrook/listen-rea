import { videoPresentation } from "./video-once";
import { currentImageOptions } from "./option-images";
import { withoutOptionImage } from "./option-image-fields";
import { cardsortPrompt } from "./cardsort";
import { conceptPresentation, conceptVisible } from "./concept-timing";
import { maxdiffPrompt } from "./maxdiff";
import { pricingPrompt } from "./pricing";
import { cookies } from "next/headers";
import { db, get, hash, token, actorFor } from "./db";
import type { Actor, Interview } from "./domain";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
export async function actor() {
  const a = await actorFor(
    (await cookies()).get("research_session")?.value || "",
  );
  return a || fail(401, "Sign in to your workspace.");
}
export function canEdit(a: Actor) {
  if (!["admin", "researcher", "collaborator"].includes(a.role))
    fail(403, "You do not have edit access.");
}
export function canLaunch(a: Actor) {
  if (a.role === "collaborator")
    fail(403, "A researcher or admin must open fielding.");
}
export async function body(req: Request) {
  const s = await req.text();
  if (s.length > 250000) fail(413, "Request is too large.");
  try {
    return JSON.parse(s);
  } catch {
    fail(400, "Invalid JSON request.");
  }
}
export const respond = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function participant(req: Request, id: string) {
  const i = await get<Interview>("interview", id);
  const t = req.headers.get("x-interview-token") || "";
  if (!i || !t || i.tokenHash !== hash(t))
    fail(404, "Interview not found. Open your original study link.");
  return i;
}
export function publicInterview(i: Interview, participantView = false) {
  const {
    tokenHash,
    invitationId,
    handoffId,
    quotaRuleIds,
    quotaVersion,
    screenerQuota,
    pending,
    requests,
    workspaceId,
    pricingStates,
    maxdiffStates,
    cardsortStates,
    videoViews,
    videoPresentation: _videoPresentation,
    conceptExposures,
    conceptPresentation: _presentation,
    ...safe
  } = i;
  const at = Date.now();
  const videoMetadata = participantView
    ? { videoPresentation: videoPresentation(i, at) }
    : {
        videoViews: videoViews
          ? Object.fromEntries(
              Object.entries(videoViews).map(
                ([id, { nonce, requestId, ...v }]) => [id, v],
              ),
            )
          : undefined,
      };
  const timingMetadata = participantView
    ? { conceptPresentation: conceptPresentation(i, at) }
    : { conceptExposures };
  if (participantView) delete safe.screenOutReason;
  if (participantView && (i.invitationId || i.handoffId)) safe.attributes = {};
  if (participantView)
    safe.pricingPrompt =
      i.guide.questions[i.current]?.type === "pricing"
        ? pricingPrompt(i, i.guide.questions[i.current])
        : undefined;
  if (participantView)
    safe.maxdiffPrompt =
      i.guide.questions[i.current]?.type === "maxdiff"
        ? maxdiffPrompt(i, i.guide.questions[i.current])
        : undefined;
  if (participantView)
    safe.cardsortPrompt =
      i.guide.questions[i.current]?.type === "cardsort"
        ? cardsortPrompt(i, i.guide.questions[i.current])
        : undefined;
  const visibleOptions = participantView ? currentImageOptions(i, at) : [];
  const projectOptions = (
    options: Interview["guide"]["questions"][number]["options"],
    current: boolean,
  ) =>
    options.map((o) =>
      current &&
      visibleOptions.some(
        (v) => v.id === o.id && v.imageAssetId === o.imageAssetId,
      )
        ? o
        : withoutOptionImage(o),
    );
  if (participantView && safe.maxdiffPrompt)
    safe.maxdiffPrompt = {
      ...safe.maxdiffPrompt,
      items: safe.maxdiffPrompt.items.map((item) =>
        visibleOptions.some(
          (v) => v.id === item.id && v.imageAssetId === item.imageAssetId,
        )
          ? item
          : withoutOptionImage(item),
      ),
    };
  if (participantView && safe.optionAssignments)
    safe.optionAssignments = Object.fromEntries(
      Object.entries(safe.optionAssignments).map(([id, options]) => [
        id,
        projectOptions(options, id === i.guide.questions[i.current]?.id),
      ]),
    );
  const guide = {
    ...i.guide,
    questions: participantView
      ? i.guide.questions.map((q) => ({
          ...q,
          options: projectOptions(
            q.options,
            q.id === i.guide.questions[i.current]?.id,
          ),
          pricing: undefined,
          maxdiff: undefined,
          cardsort: undefined,
        }))
      : i.guide.questions,
    ...(i.guide.localization
      ? {
          localization: {
            ...i.guide.localization,
            guidance: "",
            translations: [],
          },
        }
      : {}),
  };
  if (participantView && i.guide.conceptTest) {
    const current = i.guide.questions[i.current]?.conceptId;
    return {
      ...safe,
      ...timingMetadata,
      ...videoMetadata,
      conceptAssignments: undefined,
      guide: {
        ...guide,
        conceptTest: {
          ...i.guide.conceptTest,
          concepts: i.guide.conceptTest.concepts
            .filter((c) => c.id === current)
            .map((c) =>
              conceptVisible(i, at)
                ? c
                : {
                    id: c.id,
                    name: "",
                    headline: "",
                    description: "",
                    exposureSeconds: c.exposureSeconds,
                  },
            ),
        },
      },
    };
  }
  return { ...safe, ...timingMetadata, ...videoMetadata, guide };
}
const rates = new Map<
  string,
  {
    count: number;
    until: number;
  }
>();
export function limit(key: string, max = 40) {
  const t = Date.now(),
    v = rates.get(key);
  if (v && v.until > t) {
    if (v.count >= max)
      fail(429, "Too many requests. Please wait a minute and try again.");
    v.count++;
  } else {
    if (rates.size > 10000) rates.clear();
    rates.set(key, { count: 1, until: t + 60000 });
  }
}
export async function sessionResponse(a: Actor) {
  const raw = token();
  await db.prepare("DELETE FROM auth_sessions WHERE expires<?").run(Date.now());
  await db
    .prepare("INSERT INTO auth_sessions(hash,user_id,expires) VALUES(?,?,?)")
    .run(hash(raw), a.id, Date.now() + 7 * 86400000);
  (await cookies()).set("research_session", raw, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.RESEARCH_SECURE_COOKIES === "true" ||
      process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 86400,
  });
  return respond({ user: a });
}
