import { z } from "zod";
import { db, get, put, transaction, now, dirty, requireStudy } from "./db";
import { clearAttachmentReports } from "./attachment-evidence-server";
import { pptxFingerprint, pptxTextDigest } from "./pptx-evidence-server";
import { body, canEdit, fail, respond } from "./http";
import { readRecording } from "./storage";
import { pptxSnapshot } from "./participant-pptx";
import { validPPTXPassages, type PPTXVerification } from "./pptx-text";
import type { Actor, Study, Interview } from "./domain";

export async function pptxTextRequest(
  req: Request,
  id: string,
  a: Actor,
  s: Study,
) {
  if (!["GET", "PUT"].includes(req.method)) fail(405, "Method unavailable.");
  if (req.method === "PUT") canEdit(a);
  const input =
    req.method === "PUT"
      ? z
          .object({
            source: z.string().regex(/^[a-f0-9]{64}$/),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            version: z.number().int().nonnegative(),
            attested: z.literal(true),
            includeInReports: z.boolean().optional().default(false),
            passages: z
              .array(
                z
                  .object({
                    slide: z.number().int().min(1).max(100),
                    start: z.number().int().nonnegative(),
                    end: z.number().int().positive(),
                    quote: z.string().min(1).max(1000),
                  })
                  .strict(),
              )
              .max(10),
          })
          .strict()
          .parse(await body(req))
      : undefined;
  return transaction(async () => {
    const m = await db
      .prepare(
        "SELECT * FROM media WHERE id=? AND study_id=? AND workspace_id=? AND kind='participant-pptx'",
      )
      .get(id, s.id, a.workspaceId);
    if (!m) fail(404, "Attached PPTX is unavailable.");
    const i = await get<Interview>(
        "interview",
        String(m.interview_id),
        a.workspaceId,
      ),
      t =
        i?.studyId === s.id
          ? i.turns.find((t) => t.participantPPTX?.id === id)
          : undefined;
    if (!i || !t)
      fail(409, "Submit the PPTX with an answer before verifying passages.");
    const { slides } = pptxSnapshot.parse(
        JSON.parse((await readRecording(id)).toString()),
      ),
      digest = pptxTextDigest(slides),
      source = pptxFingerprint(i, t, m.digest, digest),
      saved = await get<PPTXVerification>(
        "participantPPTXText",
        id,
        a.workspaceId,
      );
    if (
      saved &&
      (saved.source !== source ||
        saved.digest !== digest ||
        saved.interviewId !== i.id ||
        saved.turnId !== t.id)
    )
      fail(409, "The PPTX verification source changed. Reload its transcript.");
    if (!input)
      return respond({
        source,
        digest,
        slides,
        verification: saved || null,
      });
    const version = saved?.history.at(-1)?.version || 0;
    if (
      input.source !== source ||
      input.digest !== digest ||
      input.version !== version
    )
      fail(
        409,
        "PPTX verification changed. Reload saved verification before editing.",
      );
    if (!validPPTXPassages(slides, input.passages))
      fail(
        400,
        "Each passage must match its exact prepared slide and character range.",
      );
    if ((saved?.history.length || 0) >= 50)
      fail(409, "PPTX verification has reached its revision limit.");
    if (input.includeInReports && !input.passages.length)
      fail(
        400,
        "Select at least one verified PPTX passage before including it in reports.",
      );
    if (input.includeInReports || saved?.history.at(-1)?.includeInReports) {
      await clearAttachmentReports(s);
      await dirty(await requireStudy(s.id, a));
    }
    const verification: PPTXVerification = saved || {
      id,
      workspaceId: a.workspaceId,
      studyId: s.id,
      interviewId: i.id,
      turnId: t.id,
      source,
      digest,
      history: [],
    };
    verification.history.push({
      version: version + 1,
      at: now(),
      reviewer: { id: a.id, name: a.name },
      passages: input.passages,
      includeInReports: input.includeInReports,
    });
    await put("participantPPTXText", verification);
    return respond({ source, digest, slides, verification });
  });
}
