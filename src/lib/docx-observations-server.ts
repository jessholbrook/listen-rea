import { createHash } from "node:crypto";
import { db, list } from "./db";
import { fail } from "./http";
import { readRecording } from "./storage";
import { docxSnapshot } from "./participant-docx";
import type { Interview, Study } from "./domain";
import type { DOCXProbe, DOCXReview } from "./participant-docx";
import type { DOCXObservation } from "./docx-observations";
export function docxProbeFingerprint(
  source: string,
  probe: DOCXProbe | undefined,
  snapshotHash: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([source, probe || null, snapshotHash]))
    .digest("hex");
}
export function docxReviewFingerprint(
  i: Interview,
  t: Interview["turns"][number],
  digest: unknown,
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
      ]),
    )
    .digest("hex");
}
export function docxReviewSnapshot(bytes: Buffer, probe?: DOCXProbe) {
  const { paragraphs } = docxSnapshot.parse(JSON.parse(bytes.toString())),
    snapshotHash = createHash("sha256").update(bytes).digest("hex");
  if (
    probe?.status === "asked" &&
    (probe.snapshotSha256 !== snapshotHash ||
      !probe.paragraph ||
      !probe.quote ||
      !paragraphs[probe.paragraph - 1]?.includes(probe.quote))
  )
    fail(
      409,
      "The DOCX question no longer matches its prepared source. Reload its transcript.",
    );
  return snapshotHash;
}
export async function collectDOCXObservations(
  s: Study,
  all: Interview[],
): Promise<DOCXObservation[]> {
  const reviews = await list<DOCXReview>(
    "participantDOCXReview",
    s.workspaceId,
    s.id,
  );
  const media = await db
    .prepare(
      "SELECT id,interview_id,digest FROM media WHERE workspace_id=? AND study_id=? AND kind='participant-docx'",
    )
    .all(s.workspaceId, s.id);
  const result: DOCXObservation[] = [];
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
      (t) => t.id === r.turnId && t.participantDOCX?.id === r.id,
    );
    const m = media.find((m) => m.id === r.id && m.interview_id === i?.id);
    if (!i || !t || !m || docxReviewFingerprint(i, t, m.digest) !== r.source)
      continue;
    const probe = t.docxProbe?.docxId === r.id ? t.docxProbe : undefined;
    const snapshotHash = docxReviewSnapshot(await readRecording(r.id), probe);
    if (
      latest.probeSource !== docxProbeFingerprint(r.source, probe, snapshotHash)
    )
      continue;
    const asked = probe?.status === "asked";
    if (
      asked
        ? latest.grounding === "not_applicable" ||
          JSON.stringify(latest.originalProbe) !== JSON.stringify(probe)
        : latest.grounding !== "not_applicable" || !!latest.correction
    )
      continue;
    result.push({
      docxId: r.id,
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
              paragraph: probe!.paragraph,
              quote: probe!.quote,
            },
          }
        : {}),
    });
  }
  return result.sort((a, b) => a.docxId.localeCompare(b.docxId));
}
export async function verifyDOCXObservations(
  s: Study,
  all: Interview[],
  entries?: DOCXObservation[],
) {
  if (!entries?.length) return;
  const live = await collectDOCXObservations(s, all);
  for (const e of entries)
    if (!live.some((v) => JSON.stringify(v) === JSON.stringify(e)))
      fail(
        409,
        "Researcher DOCX observations changed or were withdrawn. Create a new analysis and report.",
      );
}
