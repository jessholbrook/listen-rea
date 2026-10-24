import { createHash } from "node:crypto";
import { z } from "zod";
import { generate, aiReady, model } from "./ai";
import { readRecording } from "./storage";
import { docxSnapshot } from "./participant-docx";
import { limit } from "./http";
import { now } from "./db";
import { languageNames, responseLanguage } from "./localization";
import {
  docxAIPermissionVersion,
  docxProbePromptVersion,
  docxProbeSystem,
  docxProbeOutput,
  docxProbeParagraphs,
  docxProbeAnchors,
  usableDOCXProbe,
  docxProbeRejectionReason,
} from "./participant-docx-ai";
import type { Interview } from "./domain";
import type { DOCXProbe } from "./participant-docx";
export async function participantDOCXProbe(
  i: Interview,
  answer: string,
  deps = { generate, readRecording, aiReady, model },
): Promise<DOCXProbe | null> {
  const docx = i.participantDOCXDraft?.docx,
    q = i.guide.questions[i.current];
  if (
    !docx ||
    i.participantDOCXDraft?.version !== i.version ||
    docx.aiPermission?.provider !== "OpenAI" ||
    docx.aiPermission.version !== docxAIPermissionVersion ||
    !q?.participantDOCXAI ||
    !q.participantDOCX ||
    q.type !== "open" ||
    q.followUps < 1 ||
    i.status !== "active"
  )
    return null;
  const provenance: Omit<DOCXProbe, "status"> = {
    docxId: docx.id,
    permissionVersion: docx.aiPermission.version,
    promptVersion: docxProbePromptVersion,
    model: deps.model(),
    generatedAt: now(),
  };
  if (!deps.aiReady()) return { ...provenance, status: "unavailable" };
  try {
    limit("docx-probe:" + i.id, 20);
    const deadline = AbortSignal.timeout(50000),
      bytes = await deps.readRecording(docx.id);
    provenance.snapshotSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    const extracted = docxSnapshot.parse(
        JSON.parse(bytes.toString()),
      ).paragraphs,
      paragraphs = docxProbeParagraphs(extracted);
    provenance.contextTruncated =
      extracted.length > 20 ||
      extracted.slice(0, 20).some((t) => t.length > 1000);
    provenance.paragraphsConsidered = paragraphs.map((p) => p.paragraph);
    const quoteAnchors = docxProbeAnchors(paragraphs);
    if (!quoteAnchors.length) return { ...provenance, status: "none" };
    const allowedQuotes = [...new Set(quoteAnchors.map((a) => a.quote))];
    const outputSchema = docxProbeOutput.extend({
      quote: z.enum(allowedQuotes as [string, ...string[]]).nullable(),
    });
    const result = await deps.generate(
      docxProbeSystem,
      {
        interviewLanguage: languageNames[responseLanguage(i)],
        goal: i.guide.goal,
        question: q.text,
        instructions: q.instructions,
        answer,
        docxDescription: docx.description,
        paragraphs,
        quoteAnchors,
      },
      i.workspaceId,
      i.studyId,
      "docx-probe",
      z.toJSONSchema(outputSchema),
      { maxTokens: 600, signal: deadline },
    );
    const parsed = usableDOCXProbe(result, paragraphs, quoteAnchors);
    if (!parsed)
      return {
        ...provenance,
        status: "rejected",
        rejectionReason:
          docxProbeRejectionReason(result, paragraphs, quoteAnchors) ||
          "invalid_format",
      };
    if (!parsed.probe) return { ...provenance, status: "none" };
    return { ...provenance, ...parsed, status: "asked" };
  } catch {
    return { ...provenance, status: "unavailable" };
  }
}
