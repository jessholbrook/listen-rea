import { createHash } from "node:crypto";
import { db, list } from "./db";
import { fail } from "./http";
import { readRecording } from "./storage";
import { pptxSnapshot } from "./participant-pptx";
import type { Interview, Study } from "./domain";
import type { PPTXProbe, PPTXReview } from "./participant-pptx";
import type { PPTXObservation } from "./pptx-observations";
export function pptxProbeFingerprint(
  source: string,
  probe: PPTXProbe | undefined,
  snapshotHash: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([source, probe || null, snapshotHash]))
    .digest("hex");
}
export function pptxReviewFingerprint(
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
        t.participantPPTX,
        digest,
      ]),
    )
    .digest("hex");
}
export function pptxReviewSnapshot(bytes: Buffer, probe?: PPTXProbe) {
  const { slides } = pptxSnapshot.parse(JSON.parse(bytes.toString())),
    snapshotHash = createHash("sha256").update(bytes).digest("hex");
  if (
    probe?.status === "asked" &&
    (probe.snapshotSha256 !== snapshotHash ||
      !probe.slide ||
      !probe.quote ||
      !slides[probe.slide - 1]?.includes(probe.quote))
  )
    fail(
      409,
      "The PPTX question no longer matches its prepared source. Reload its transcript.",
    );
  return snapshotHash;
}
export async function collectPPTXObservations(
  s: Study,
  all: Interview[],
): Promise<PPTXObservation[]> {
  const reviews = await list<PPTXReview>(
    "participantPPTXReview",
    s.workspaceId,
    s.id,
  );
  const media = await db
    .prepare(
      "SELECT id,interview_id,digest FROM media WHERE workspace_id=? AND study_id=? AND kind='participant-pptx'",
    )
    .all(s.workspaceId, s.id);
  const result: PPTXObservation[] = [];
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
      (t) => t.id === r.turnId && t.participantPPTX?.id === r.id,
    );
    const m = media.find((m) => m.id === r.id && m.interview_id === i?.id);
    if (!i || !t || !m || pptxReviewFingerprint(i, t, m.digest) !== r.source)
      continue;
    const probe = t.pptxProbe?.pptxId === r.id ? t.pptxProbe : undefined;
    const snapshotHash = pptxReviewSnapshot(await readRecording(r.id), probe);
    if (
      latest.probeSource !== pptxProbeFingerprint(r.source, probe, snapshotHash)
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
      pptxId: r.id,
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
              slide: probe!.slide,
              quote: probe!.quote,
            },
          }
        : {}),
    });
  }
  return result.sort((a, b) => a.pptxId.localeCompare(b.pptxId));
}
export async function verifyPPTXObservations(
  s: Study,
  all: Interview[],
  entries?: PPTXObservation[],
) {
  if (!entries?.length) return;
  const live = await collectPPTXObservations(s, all);
  for (const e of entries)
    if (!live.some((v) => JSON.stringify(v) === JSON.stringify(e)))
      fail(
        409,
        "Researcher PPTX observations changed or were withdrawn. Create a new analysis and report.",
      );
}
