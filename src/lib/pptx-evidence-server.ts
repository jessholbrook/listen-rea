import { createHash } from "node:crypto";
import { db, list } from "./db";
import { fail } from "./http";
import { readRecording } from "./storage";
import { pptxSnapshot } from "./participant-pptx";
import { validPPTXPassages, type PPTXVerification } from "./pptx-text";
import type { PPTXEvidence } from "./pptx-evidence";
import type { Interview, Study, Turn } from "./domain";
export const pptxTextDigest = (slides: string[]) =>
  createHash("sha256").update(JSON.stringify(slides)).digest("hex");
export function pptxFingerprint(
  i: Interview,
  t: Turn,
  digest: unknown,
  textDigest: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        i.id,
        t.id,
        t.prompt,
        t.answer,
        t.participantPPTX,
        digest,
        textDigest,
      ]),
    )
    .digest("hex");
}
export async function collectPPTXEvidence(
  s: Study,
  all: Interview[],
): Promise<PPTXEvidence[]> {
  const records = await list<PPTXVerification>(
      "participantPPTXText",
      s.workspaceId,
      s.id,
    ),
    media = await db
      .prepare(
        "SELECT id,interview_id,digest FROM media WHERE workspace_id=? AND study_id=? AND kind='participant-pptx'",
      )
      .all(s.workspaceId, s.id),
    result: PPTXEvidence[] = [];
  for (const r of records) {
    const latest = r.history.at(-1);
    if (!latest?.includeInReports || !latest.passages.length) continue;
    const i = all.find(
        (i) =>
          i.id === r.interviewId &&
          i.workspaceId === s.workspaceId &&
          i.studyId === s.id &&
          i.status === "complete" &&
          !i.excluded &&
          !i.preview,
      ),
      t = i?.turns.find(
        (t) => t.id === r.turnId && t.participantPPTX?.id === r.id,
      ),
      m = media.find((m) => m.id === r.id && m.interview_id === i?.id);
    if (
      !i ||
      !t ||
      !m ||
      pptxFingerprint(i, t, m.digest, r.digest) !== r.source
    )
      continue;
    const { slides } = pptxSnapshot.parse(
      JSON.parse((await readRecording(r.id)).toString()),
    );
    if (
      pptxTextDigest(slides) !== r.digest ||
      !validPPTXPassages(slides, latest.passages)
    )
      continue;
    result.push({
      pptxId: r.id,
      interviewId: i.id,
      turnId: t.id,
      source: r.source,
      digest: r.digest,
      revisionId: i.revisionId,
      conceptId: t.conceptId,
      verificationVersion: latest.version,
      reviewerName: latest.reviewer.name,
      reviewedAt: latest.at,
      passages: structuredClone(latest.passages),
    });
  }
  return result.sort((a, b) => a.pptxId.localeCompare(b.pptxId));
}
export async function verifyPPTXEvidence(
  s: Study,
  all: Interview[],
  entries: PPTXEvidence[] | undefined,
) {
  if (!entries?.length) return;
  const live = await collectPPTXEvidence(s, all);
  for (const e of entries)
    if (!live.some((v) => JSON.stringify(v) === JSON.stringify(e)))
      fail(
        409,
        "Verified PPTX passages changed or were withdrawn. Create a new analysis and report.",
      );
}
