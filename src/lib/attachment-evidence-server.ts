import { createHash } from "node:crypto";
import { db, list } from "./db";
import { fail } from "./http";
import type { Interview, Study } from "./domain";
import type { ImageReview } from "./image-review";
import {
  attachmentSource,
  type AttachmentEvidence,
} from "./attachment-evidence";
export function attachmentFingerprint(
  i: Interview,
  t: Interview["turns"][number],
  digest: unknown,
) {
  return createHash("sha256")
    .update(attachmentSource(i, t, digest))
    .digest("hex");
}
export async function collectAttachmentEvidence(
  s: Study,
  all: Interview[],
): Promise<AttachmentEvidence[]> {
  const reviews = await list<ImageReview>("imageReview", s.workspaceId, s.id);
  const media = await db
    .prepare(
      "SELECT id,interview_id,digest FROM media WHERE workspace_id=? AND study_id=? AND kind='participant-image'",
    )
    .all(s.workspaceId, s.id);
  const result: AttachmentEvidence[] = [];
  for (const r of reviews) {
    const latest = r.history.at(-1);
    if (
      !latest?.includeInReports ||
      latest.quality !== "usable" ||
      !latest.notes.trim()
    )
      continue;
    const i = all.find(
      (i) =>
        i.id === r.interviewId &&
        i.workspaceId === s.workspaceId &&
        i.studyId === s.id &&
        i.status === "complete" &&
        !i.excluded &&
        !i.preview,
    );
    const t = i?.turns.find(
      (t) => t.id === r.turnId && t.participantImage?.id === r.id,
    );
    const m = media.find((m) => m.id === r.id && m.interview_id === i?.id);
    if (!i || !t || !m || attachmentFingerprint(i, t, m.digest) !== r.source)
      continue;
    result.push({
      imageId: r.id,
      interviewId: i.id,
      turnId: t.id,
      source: r.source,
      revisionId: i.revisionId,
      conceptId: t.conceptId,
      reviewVersion: latest.version,
      notes: latest.notes,
      reviewerName: latest.reviewer.name,
      reviewedAt: latest.at,
      grounding: latest.grounding,
    });
  }
  return result.sort((a, b) => a.imageId.localeCompare(b.imageId));
}
export async function verifyAttachmentEvidence(
  s: Study,
  all: Interview[],
  entries: AttachmentEvidence[] | undefined,
) {
  if (!entries?.length) return;
  const live = await collectAttachmentEvidence(s, all);
  for (const e of entries)
    if (!live.some((v) => JSON.stringify(v) === JSON.stringify(e)))
      fail(
        409,
        "Attachment evidence changed or was withdrawn. Create a new analysis and report.",
      );
}
export async function clearAttachmentReports(s: Study) {
  await db
    .prepare(
      "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind IN ('analysis','reportEdition','reportSnapshot')",
    )
    .run(s.workspaceId, s.id);
  await db
    .prepare("DELETE FROM shares WHERE workspace_id=? AND study_id=?")
    .run(s.workspaceId, s.id);
}

export async function clearAttachmentEditions(s: Study) {
  await db
    .prepare(
      "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind IN ('reportEdition','reportSnapshot')",
    )
    .run(s.workspaceId, s.id);
  await db
    .prepare("DELETE FROM shares WHERE workspace_id=? AND study_id=?")
    .run(s.workspaceId, s.id);
}
