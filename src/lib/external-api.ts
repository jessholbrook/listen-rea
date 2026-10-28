import { z } from "zod";
import type { Study, Revision, Interview, Analysis } from "./domain";
export const apiScopes = [
  "studies:read",
  "responses:read",
  "analyses:read",
] as const;
export const keyInput = z
  .object({
    requestId: z.uuid(),
    secret: z.string().regex(/^[0-9a-f]{64}$/),
    name: z.string().trim().min(2).max(80),
    studyIds: z.array(z.uuid()).min(1).max(50),
    scopes: z.array(z.enum(apiScopes)).min(1).max(3),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (v) =>
      new Set(v.studyIds).size === v.studyIds.length &&
      new Set(v.scopes).size === v.scopes.length,
    "Use unique studies and permissions.",
  );
export type ReadApiKey = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  studyIds: string[];
  scopes: (typeof apiScopes)[number][];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  version: number;
  rateMinute?: number;
  rateCount?: number;
};
export function apiKeyView(k: ReadApiKey) {
  return {
    id: k.id,
    name: k.name,
    studyIds: k.studyIds,
    scopes: k.scopes,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt || null,
    lastUsedAt: k.lastUsedAt || null,
    version: k.version,
  };
}
export const eligibleResponse = (i: Interview) =>
  !i.preview && !i.excluded && i.status === "complete";
export function studyDto(s: Study, r: Revision) {
  return {
    id: s.id,
    title: r.guide.title,
    fielding: s.fielding,
    revisionId: s.revisionId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    dataVersion: s.dataVersion,
    questionCount: r.guide.questions.length,
  };
}
export function responseSummary(i: Interview) {
  return {
    id: i.id,
    studyId: i.studyId,
    revisionId: i.revisionId,
    createdAt: i.createdAt,
    completedAt: i.completedAt || null,
    language: i.language || "en",
    source: i.origin ? "imported" : "native",
    turnCount: i.turns.length,
  };
}
export function responseDto(i: Interview) {
  return {
    ...responseSummary(i),
    turns: i.turns.map((t) => ({
      id: t.id,
      questionId: t.questionId,
      prompt: t.prompt,
      answer: t.answer,
      createdAt: t.createdAt,
      source: t.source,
      followUp: t.followUp,
      ...(t.value !== undefined ? { value: t.value } : {}),
      ...(t.conceptId ? { conceptId: t.conceptId } : {}),
    })),
  };
}
export function safeAnalysis(a: Analysis, s: Study, sources: Interview[]) {
  return (
    a.reviewed &&
    a.dataVersion === s.dataVersion &&
    a.themes.every((t) =>
      t.citations.every((c) => {
        const i = sources.find(
          (v) =>
            v.id === c.interviewId && v.studyId === s.id && eligibleResponse(v),
        );
        return !!i?.turns.some(
          (turn) => turn.id === c.turnId && turn.answer.includes(c.quote),
        );
      }),
    )
  );
}
export function analysisDto(a: Analysis, detail = false) {
  return {
    id: a.id,
    studyId: a.studyId,
    version: a.version,
    dataVersion: a.dataVersion,
    createdAt: a.createdAt,
    reportLanguage: a.reportLanguage || "en",
    scope: a.scope || null,
    summary: a.summary,
    ...(detail
      ? {
          limitations: a.limitations,
          memo: a.memo,
          themes: a.themes.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            citations: t.citations.map((c) => ({
              interviewId: c.interviewId,
              turnId: c.turnId,
              quote: c.quote,
            })),
          })),
        }
      : {}),
  };
}
const cursorSchema = z
  .object({ resource: z.string().max(200), after: z.string().min(1).max(200) })
  .strict();
export function readPage(url: URL, resource: string) {
  for (const key of url.searchParams.keys())
    if (!["limit", "cursor"].includes(key))
      throw new Error("INVALID_PAGINATION");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("cursor").length > 1
  )
    throw new Error("INVALID_PAGINATION");
  const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(url.searchParams.get("limit") || 25),
    raw = url.searchParams.get("cursor");
  let after = "";
  if (raw) {
    if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw))
      throw new Error("INVALID_PAGINATION");
    try {
      const c = cursorSchema.parse(
        JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
      );
      if (c.resource !== resource) throw new Error();
      after = c.after;
    } catch {
      throw new Error("INVALID_PAGINATION");
    }
  }
  return { limit, after };
}
export function nextCursor(resource: string, after: string) {
  return Buffer.from(JSON.stringify({ resource, after })).toString("base64url");
}
