import { createHash } from "node:crypto";
import { db, list } from "./db";
import { fail } from "./http";
import { pdfFingerprint } from "./pdf-evidence-server";
import type { Interview, Study } from "./domain";
import type { PDFProbe, PDFReview } from "./participant-pdfs";
import type { PDFObservation } from "./pdf-observations";
export function pdfProbeFingerprint(source: string, probe?: PDFProbe) {
  return createHash("sha256")
    .update(JSON.stringify([source, probe || null]))
    .digest("hex");
}
export async function collectPDFObservations(
  s: Study,
  all: Interview[],
): Promise<PDFObservation[]> {
  const reviews = await list<PDFReview>(
    "participantPDFReview",
    s.workspaceId,
    s.id,
  );
  const media = await db
    .prepare(
      "SELECT id,interview_id,digest FROM media WHERE workspace_id=? AND study_id=? AND kind='participant-pdf'",
    )
    .all(s.workspaceId, s.id);
  const result: PDFObservation[] = [];
  for (const r of reviews) {
    const latest = r.history.at(-1);
    if (
      !latest?.includeInReports ||
      latest.quality !== "usable" ||
      !latest.grounding ||
      Math.max(
        latest.notes.trim().length,
        latest.correction?.trim().length || 0,
      ) < 3
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
      (t) => t.id === r.turnId && t.participantPDF?.id === r.id,
    );
    const m = media.find((m) => m.id === r.id && m.interview_id === i?.id);
    if (!i || !t || !m || pdfFingerprint(i, t, m.digest) !== r.source) continue;
    const probe = t.pdfProbe?.pdfId === r.id ? t.pdfProbe : undefined;
    if (latest.probeSource !== pdfProbeFingerprint(r.source, probe)) continue;
    const asked = probe?.status === "asked";
    if (
      asked
        ? latest.grounding === "not_applicable" ||
          JSON.stringify(latest.originalProbe) !== JSON.stringify(probe)
        : latest.grounding !== "not_applicable" || !!latest.correction
    )
      continue;
    result.push({
      pdfId: r.id,
      interviewId: i.id,
      turnId: t.id,
      source: r.source,
      probeSource: latest.probeSource,
      revisionId: i.revisionId,
      conceptId: t.conceptId,
      reviewVersion: latest.version,
      reviewerName: latest.reviewer.name,
      reviewedAt: latest.at,
      notes: latest.notes,
      correction: latest.correction || "",
      grounding: latest.grounding,
      ...(asked
        ? {
            question: {
              text: probe!.probe!,
              page: probe!.page,
              quote: probe!.quote,
            },
          }
        : {}),
    });
  }
  return result.sort((a, b) => a.pdfId.localeCompare(b.pdfId));
}
export async function verifyPDFObservations(
  s: Study,
  all: Interview[],
  entries?: PDFObservation[],
) {
  if (!entries?.length) return;
  const live = await collectPDFObservations(s, all);
  for (const e of entries)
    if (!live.some((v) => JSON.stringify(v) === JSON.stringify(e)))
      fail(
        409,
        "Researcher PDF observations changed or were withdrawn. Create a new analysis and report.",
      );
}
