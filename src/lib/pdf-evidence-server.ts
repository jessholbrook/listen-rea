import { createHash } from "node:crypto";
import { db, list } from "./db";
import { fail } from "./http";
import type { Interview, Study, Turn } from "./domain";
import { validPassages, type PDFText } from "./pdf-text";
import type { PDFEvidence } from "./pdf-evidence";
export function pdfFingerprint(i: Interview, t: Turn, digest: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        i.id,
        t.id,
        t.prompt,
        t.answer,
        t.participantPDF,
        digest,
      ]),
    )
    .digest("hex");
}
export async function collectPDFEvidence(
  s: Study,
  all: Interview[],
): Promise<PDFEvidence[]> {
  const texts = await list<PDFText>("participantPDFText", s.workspaceId, s.id),
    media = await db
      .prepare(
        "SELECT id,interview_id,digest FROM media WHERE workspace_id=? AND study_id=? AND kind='participant-pdf'",
      )
      .all(s.workspaceId, s.id),
    result: PDFEvidence[] = [];
  for (const text of texts) {
    const latest = text.history.at(-1);
    if (
      !latest?.includeInReports ||
      !latest.passages.length ||
      !validPassages(text.pages, latest.passages)
    )
      continue;
    const i = all.find(
        (i) =>
          i.id === text.interviewId &&
          i.workspaceId === s.workspaceId &&
          i.studyId === s.id &&
          i.status === "complete" &&
          !i.excluded &&
          !i.preview,
      ),
      t = i?.turns.find(
        (t) => t.id === text.turnId && t.participantPDF?.id === text.id,
      ),
      m = media.find((m) => m.id === text.id && m.interview_id === i?.id);
    if (
      !i ||
      !t ||
      !m ||
      pdfFingerprint(i, t, m.digest) !== text.source ||
      createHash("sha256").update(JSON.stringify(text.pages)).digest("hex") !==
        text.digest
    )
      continue;
    result.push({
      pdfId: text.id,
      interviewId: i.id,
      turnId: t.id,
      source: text.source,
      digest: text.digest,
      revisionId: i.revisionId,
      conceptId: t.conceptId,
      verificationVersion: latest.version,
      reviewerName: latest.reviewer.name,
      reviewedAt: latest.at,
      passages: structuredClone(latest.passages),
      ...(text.ocr?.some(
        (d) => d.accepted && latest.passages.some((p) => p.page === d.page),
      )
        ? {
            ocrPages: text.ocr
              .filter(
                (d) =>
                  d.accepted && latest.passages.some((p) => p.page === d.page),
              )
              .map((d) => d.page)
              .sort((a, b) => a - b),
          }
        : {}),
    });
  }
  return result.sort((a, b) => a.pdfId.localeCompare(b.pdfId));
}
export async function verifyPDFEvidence(
  s: Study,
  all: Interview[],
  entries: PDFEvidence[] | undefined,
) {
  if (!entries?.length) return;
  const live = await collectPDFEvidence(s, all);
  for (const e of entries)
    if (!live.some((v) => JSON.stringify(v) === JSON.stringify(e)))
      fail(
        409,
        "Verified PDF passages changed or were withdrawn. Create a new analysis and report.",
      );
}
