import { z } from "zod";
import { importInput } from "./library";
import {
  list,
  put,
  uid,
  hash,
  token,
  now,
  requireStudy,
  dirty,
  transaction,
} from "./db";
import { fail } from "./http";
import { templateGuide, type Actor, type Interview } from "./domain";
export function transcriptSections(text: string) {
  if (text.length <= 12000) return [text];
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 10000, text.length);
    // Keep Unicode surrogate pairs together at a storage boundary.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}
export async function createLibraryImport(
  a: Actor,
  input: z.infer<typeof importInput>,
) {
  const fingerprint = hash(JSON.stringify(input));
  return transaction(async () => {
    const s = await requireStudy(input.studyId, a),
      all = await list<Interview>("interview", a.workspaceId, s.id),
      existing = all.find((i) => i.origin?.requestId === input.requestId);
    if (existing) {
      if (existing.origin!.fingerprint !== fingerprint)
        fail(409, "This import request has different content.");
      return { interviewId: existing.id, reused: true };
    }
    if (all.some((i) => i.origin?.externalId === input.externalId))
      fail(409, "This external ID already exists in the study.");
    const date = now(),
      id = uid(),
      questionId = uid(),
      guide = templateGuide(s.title);
    guide.questions = [
      {
        ...guide.questions[1],
        id: questionId,
        text: input.prompt,
        followUps: 0,
      },
    ];
    guide.conceptTest = null;
    guide.sections = [];
    // Keep the frozen import context inside the response so deletion removes it too.
    const revisionId = uid();
    const i: Interview = {
      id,
      language: input.language || "en",
      studyId: s.id,
      workspaceId: a.workspaceId,
      revisionId,
      preview: false,
      tokenHash: hash(token()),
      status: "complete",
      createdAt: date,
      completedAt: date,
      consentAt: date,
      consentVersion: "external-permission-attestation-v1",
      guide,
      current: 1,
      prompt: "",
      strategy: "guide",
      turns: transcriptSections(input.transcript).map((answer) => ({
        id: uid(),
        questionId,
        prompt: input.prompt,
        answer,
        followUp: false,
        createdAt: date,
        source: "typed",
        strategy: "guide",
      })),
      attributes: {},
      excluded: false,
      exclusionReason: "",
      requests: {},
      version: 1,
      origin: {
        kind: "external",
        externalId: input.externalId,
        title: input.title,
        importedAt: date,
        importedBy: a.name,
        requestId: input.requestId,
        fingerprint,
        permissionConfirmed: true,
        transcriptReviewed: true,
      },
    };
    await put("interview", i);
    await dirty(s);
    return { interviewId: id, reused: false };
  });
}
