import { createHash } from "node:crypto";
import { limit } from "./http";
import { z } from "zod";
import { generate, aiReady, model } from "./ai";
import { readRecording } from "./storage";
import { now } from "./db";
import { languageNames, responseLanguage } from "./localization";
import {
  imageAIPermissionVersion,
  imageProbePromptVersion,
  imageObservationPromptVersion,
  imageObservationSystem,
  imageObservationOutput,
  observedAnchors,
  imageProbeSystem,
  imageProbeOutput,
  usableImageProbe,
} from "./participant-image-ai";
import type { Interview, ImageProbe } from "./domain";
export async function participantImageProbe(
  i: Interview,
  answer: string,
  deps = { generate, readRecording, aiReady, model },
): Promise<ImageProbe | null> {
  const image = i.participantImageDraft?.image,
    q = i.guide.questions[i.current];
  if (
    !image ||
    i.participantImageDraft?.version !== i.version ||
    image.aiPermission?.provider !== "OpenAI" ||
    !q.participantImageAI ||
    image.aiPermission?.version !== imageAIPermissionVersion
  )
    return null;
  const provenance: Omit<ImageProbe, "status"> = {
    imageId: image.id,
    permissionVersion: image.aiPermission.version,
    promptVersion: imageProbePromptVersion,
    observationPromptVersion: imageObservationPromptVersion,
    model: deps.model(),
    generatedAt: now(),
  };
  if (!deps.aiReady()) return { ...provenance, status: "unavailable" };
  try {
    limit("image-probe:" + i.id, 20);
    const deadline = AbortSignal.timeout(50000);
    const bytes = await deps.readRecording(image.id);
    provenance.imageSha256 = createHash("sha256").update(bytes).digest("hex");
    const observed = await deps.generate(
      imageObservationSystem,
      { interviewLanguage: languageNames[responseLanguage(i)] },
      i.workspaceId,
      i.studyId,
      "image-observe",
      z.toJSONSchema(imageObservationOutput),
      { image: bytes, maxTokens: 400, signal: deadline },
    );
    const anchors = observedAnchors(observed);
    if (!anchors) return { ...provenance, status: "rejected" };
    if (!anchors.length) return { ...provenance, status: "none" };
    const result = await deps.generate(
      imageProbeSystem,
      {
        interviewLanguage: languageNames[responseLanguage(i)],
        goal: i.guide.goal,
        question: q.text,
        instructions: q.instructions,
        answer,
        imageDescription: image.description,
        visibleAnchors: anchors,
      },
      i.workspaceId,
      i.studyId,
      "image-probe",
      z.toJSONSchema(imageProbeOutput),
      { maxTokens: 500, signal: deadline },
    );
    const parsed = usableImageProbe(result, anchors);
    if (!parsed) return { ...provenance, status: "rejected" };
    if (!parsed.probe) return { ...provenance, status: "none" };
    return {
      ...provenance,
      status: "asked",
      probe: parsed.probe,
      visualAnchor: parsed.visualAnchor!,
    };
  } catch {
    return { ...provenance, status: "unavailable" };
  }
}
