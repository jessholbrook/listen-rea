import { createHash } from "node:crypto";
import { z } from "zod";
import { generate, aiReady, model } from "./ai";
import { readRecording } from "./storage";
import { pptxSnapshot } from "./participant-pptx";
import { limit } from "./http";
import { now } from "./db";
import { languageNames, responseLanguage } from "./localization";
import {
  pptxAIPermissionVersion,
  pptxProbePromptVersion,
  pptxProbeSystem,
  pptxProbeOutput,
  pptxProbeSlides,
  pptxProbeAnchors,
  usablePPTXProbe,
  pptxProbeRejectionReason,
} from "./participant-pptx-ai";
import type { Interview } from "./domain";
import type { PPTXProbe } from "./participant-pptx";
export async function participantPPTXProbe(
  i: Interview,
  answer: string,
  deps = { generate, readRecording, aiReady, model },
): Promise<PPTXProbe | null> {
  const pptx = i.participantPPTXDraft?.pptx,
    q = i.guide.questions[i.current];
  if (
    !pptx ||
    i.participantPPTXDraft?.version !== i.version ||
    pptx.aiPermission?.provider !== "OpenAI" ||
    pptx.aiPermission.version !== pptxAIPermissionVersion ||
    !q?.participantPPTXAI ||
    !q.participantPPTX ||
    q.type !== "open" ||
    q.followUps < 1 ||
    i.status !== "active"
  )
    return null;
  const provenance: Omit<PPTXProbe, "status"> = {
    pptxId: pptx.id,
    permissionVersion: pptx.aiPermission.version,
    promptVersion: pptxProbePromptVersion,
    model: deps.model(),
    generatedAt: now(),
  };
  if (!deps.aiReady()) return { ...provenance, status: "unavailable" };
  try {
    limit("pptx-probe:" + i.id, 20);
    const deadline = AbortSignal.timeout(50000),
      bytes = await deps.readRecording(pptx.id);
    provenance.snapshotSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    const extracted = pptxSnapshot.parse(JSON.parse(bytes.toString())).slides,
      slides = pptxProbeSlides(extracted);
    provenance.contextTruncated =
      extracted.length > 20 ||
      extracted.slice(0, 20).some((t) => t.length > 1000);
    provenance.slidesConsidered = slides.map((p) => p.slide);
    const quoteAnchors = pptxProbeAnchors(slides);
    if (!quoteAnchors.length) return { ...provenance, status: "none" };
    const allowedQuotes = [...new Set(quoteAnchors.map((a) => a.quote))];
    const outputSchema = pptxProbeOutput.extend({
      quote: z.enum(allowedQuotes as [string, ...string[]]).nullable(),
    });
    const result = await deps.generate(
      pptxProbeSystem,
      {
        interviewLanguage: languageNames[responseLanguage(i)],
        goal: i.guide.goal,
        question: q.text,
        instructions: q.instructions,
        answer,
        pptxDescription: pptx.description,
        slides,
        quoteAnchors,
      },
      i.workspaceId,
      i.studyId,
      "pptx-probe",
      z.toJSONSchema(outputSchema),
      { maxTokens: 600, signal: deadline },
    );
    const parsed = usablePPTXProbe(result, slides, quoteAnchors);
    if (!parsed)
      return {
        ...provenance,
        status: "rejected",
        rejectionReason:
          pptxProbeRejectionReason(result, slides, quoteAnchors) ||
          "invalid_format",
      };
    if (!parsed.probe) return { ...provenance, status: "none" };
    return { ...provenance, ...parsed, status: "asked" };
  } catch {
    return { ...provenance, status: "unavailable" };
  }
}
