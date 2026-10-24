import { createHash } from "node:crypto";
import { db, list } from "./db";
import { fail } from "./http";
import { readRecording } from "./storage";
import { docxSnapshot } from "./participant-docx";
import { validDOCXPassages, type DOCXVerification } from "./docx-text";
import type { DOCXEvidence } from "./docx-evidence";
import type { Interview, Study, Turn } from "./domain";
export const docxTextDigest = (paragraphs: string[]) =>
  createHash("sha256").update(JSON.stringify(paragraphs)).digest("hex");
export function docxFingerprint(
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
        t.participantDOCX,
        digest,
        textDigest,
      ]),
    )
    .digest("hex");
}
export async function collectDOCXEvidence(
  s: Study,
  all: Interview[],
): Promise<DOCXEvidence[]> {
  const records = await list<DOCXVerification>(
      "participantDOCXText",
      s.workspaceId,
      s.id,
    ),
    media = await db
      .prepare(
        "SELECT id,interview_id,digest FROM media WHERE workspace_id=? AND study_id=? AND kind='participant-docx'",
      )
      .all(s.workspaceId, s.id),
    result: DOCXEvidence[] = [];
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
        (t) => t.id === r.turnId && t.participantDOCX?.id === r.id,
      ),
      m = media.find((m) => m.id === r.id && m.interview_id === i?.id);
    if (
      !i ||
      !t ||
      !m ||
      docxFingerprint(i, t, m.digest, r.digest) !== r.source
    )
      continue;
    const { paragraphs } = docxSnapshot.parse(
      JSON.parse((await readRecording(r.id)).toString()),
    );
    if (
      docxTextDigest(paragraphs) !== r.digest ||
      !validDOCXPassages(paragraphs, latest.passages)
    )
      continue;
    result.push({
      docxId: r.id,
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
  return result.sort((a, b) => a.docxId.localeCompare(b.docxId));
}
export async function verifyDOCXEvidence(
  s: Study,
  all: Interview[],
  entries: DOCXEvidence[] | undefined,
) {
  if (!entries?.length) return;
  const live = await collectDOCXEvidence(s, all);
  for (const e of entries)
    if (!live.some((v) => JSON.stringify(v) === JSON.stringify(e)))
      fail(
        409,
        "Verified DOCX passages changed or were withdrawn. Create a new analysis and report.",
      );
}
