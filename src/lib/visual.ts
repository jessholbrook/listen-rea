import { z } from "zod";
import type { Language } from "./localization";
export const visualPromptVersion = "screen-observation-v1";
export const observationText = z.object({
  description: z.string().trim().min(3).max(1500),
  interpretation: z.string().max(1500),
  uncertainty: z.string().max(1000),
  tag: z.enum([
    "visible_content",
    "visible_change",
    "navigation_cue",
    "unclear",
  ]),
});
export const claimInput = z
  .object({
    quote: z.string().min(3).max(12000),
    relation: z.enum(["context", "consistent", "possible_tension"]),
    note: z.string().trim().min(3).max(1500),
  })
  .nullable()
  .default(null);
export const observationInput = observationText.extend({
  atMs: z.number().int().min(0),
  status: z.enum(["pending", "confirmed", "rejected"]),
  reviewed: z.boolean(),
  claim: claimInput,
});
export type VisualSource = {
  mediaId: string;
  interviewId: string;
  turnId: string;
  revisionId: string;
  conceptId?: string;
  captureId: string | null;
  offsetMs: number;
  durationMs: number;
  prompt: string;
  account: string;
  origin: "screen" | "external_video";
  language: Language;
  sourceFingerprint: string;
};
export type SampleFrame = {
  id: string;
  requestMs: number;
  atMs: number;
  digest: string;
  bytes: number;
};
export type VisualObservation = z.infer<typeof observationInput> & {
  id: string;
  workspaceId: string;
  studyId: string;
  mediaId: string;
  interviewId: string;
  turnId: string;
  sourceFingerprint: string;
  version: number;
  origin: "researcher" | "ai";
  runId: string | null;
  frameIds: string[];
  model: string | null;
  promptVersion: string | null;
  originalDescription: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedBy: string;
  reviewedAt: string | null;
};
export type VisualRun = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  mediaId: string;
  requestId: string;
  requestFingerprint: string;
  sourceFingerprint: string;
  startMs: number;
  endMs: number;
  frameCount: number;
  frames: SampleFrame[];
  model: string;
  promptVersion: string;
  language: Language;
  state: "running" | "failed" | "complete";
  attempts: number;
  leaseUntil: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};
export type VisualHistory = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  observationId: string;
  observation: VisualObservation;
  actorName: string;
  createdAt: string;
};
export const visualGenerationInput = z.object({
  mediaId: z.uuid(),
  requestId: z.uuid(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  frameCount: z.number().int().min(3).max(6).default(3),
  sendToProvider: z.literal(true),
});
export const visualOutput = z.object({
  observations: z
    .array(
      observationText.extend({ frameIds: z.array(z.string()).min(1).max(3) }),
    )
    .max(12),
});
export function sampleTimes(startMs: number, endMs: number, count: number) {
  if (
    !Number.isInteger(startMs) ||
    !Number.isInteger(endMs) ||
    startMs < 0 ||
    endMs - startMs < 500 ||
    endMs - startMs > 30000 ||
    !Number.isInteger(count) ||
    count < 3 ||
    count > 6
  )
    throw new Error("VISUAL_RANGE");
  return Array.from({ length: count }, (_, n) =>
    Math.floor(startMs + ((endMs - startMs) * (n + 0.5)) / count),
  );
}
export function verifiedVisualOutput(output: unknown, frames: SampleFrame[]) {
  const parsed = visualOutput.parse(output);
  return parsed.observations.map((o) => {
    if (
      new Set(o.frameIds).size !== o.frameIds.length ||
      o.frameIds.some((id) => !frames.some((f) => f.id === id))
    )
      throw new Error("INVALID_VISUAL_EVIDENCE");
    if (o.tag === "visible_change" && o.frameIds.length < 2)
      throw new Error("INVALID_VISUAL_EVIDENCE");
    return {
      ...o,
      atMs: Math.max(
        ...o.frameIds.map((id) => frames.find((f) => f.id === id)!.atMs),
      ),
    };
  });
}
export function validateObservation(
  input: z.infer<typeof observationInput>,
  source: VisualSource,
) {
  if (input.atMs >= source.durationMs) throw new Error("VISUAL_RANGE");
  if (input.status === "confirmed" && !input.reviewed)
    throw new Error("VISUAL_REVIEW");
  if (input.claim && !source.account.includes(input.claim.quote))
    throw new Error("INVALID_CITATION");
  return input;
}
export const visualQaOutput = z.object({
  answer: z.string().max(6000),
  citations: z
    .array(
      z.object({
        observationId: z.string(),
        quote: z.string().min(3).max(1500),
      }),
    )
    .max(20),
});
export function verifiedVisualAnswer(
  output: unknown,
  evidence: VisualObservation[],
) {
  const parsed = visualQaOutput.parse(output);
  if (
    parsed.citations.some(
      (c) =>
        !evidence.some(
          (o) =>
            o.id === c.observationId &&
            o.status === "confirmed" &&
            o.reviewed &&
            o.description.includes(c.quote),
        ),
    )
  )
    throw new Error("INVALID_VISUAL_EVIDENCE");
  return parsed;
}
export type VisualData = {
  sources: VisualSource[];
  runs: VisualRun[];
  observations: VisualObservation[];
  ai: boolean;
};
export const stamp = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.round(ms) % 1000).padStart(3, "0")}`;

// This review-stage dataset contains screen states, not behavioral measurements.
// Decline explicit metric/mental-state requests before sending them to the model.
export function unsupportedVisualQuestion(question: string) {
  const q = question
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return /\b(clicks?|taps?|keystrokes?|clics?|pulsaciones|emotions?|emociones|intentions?|intent|intencion|prevalence|prevalencia)\b|task\s+(success|completion|duration)|(?:succeed|successful|successfully)|(?:complete|finish|accomplish|fail)(?:d|ed)?\s+(?:the\s+)?task|(?:how long|combien de temps|cuanto tiempo)|(?:reussi|reussite|succes)|(?:exito|completo|completado|termino)\s+(?:de\s+la\s+|la\s+)?tarea/.test(
    q,
  );
}
