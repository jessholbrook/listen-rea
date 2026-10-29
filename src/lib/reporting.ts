import { pptxEvidenceText, type PPTXEvidence } from "./pptx-evidence";
import {
  docxObservationsText,
  type DOCXObservation,
} from "./docx-observations";
import {
  pptxObservationsText,
  type PPTXObservation,
} from "./pptx-observations";
import { docxAnswersText, type DOCXAnswerEvidence } from "./docx-answers";
import { pptxAnswersText, type PPTXAnswerEvidence } from "./pptx-answers";
import { docxSynthesisText, type DOCXSynthesis } from "./docx-synthesis";
import { pptxSynthesisText, type PPTXSynthesis } from "./pptx-synthesis";
import { docxEvidenceText, type DOCXEvidence } from "./docx-evidence";
import { pdfAnswersText, type PDFAnswerEvidence } from "./pdf-answers";
import {
  docxObservationAnswersText,
  type DOCXObservationAnswerEvidence,
} from "./docx-observation-answers";
import {
  pptxObservationAnswersText,
  type PPTXObservationAnswerEvidence,
} from "./pptx-observation-answers";
import {
  pdfObservationAnswersText,
  type PDFObservationAnswerEvidence,
} from "./pdf-observation-answers";
import {
  docxObservationSynthesisText,
  type DOCXObservationSynthesis,
} from "./docx-observation-synthesis";
import {
  pptxObservationSynthesisText,
  type PPTXObservationSynthesis,
} from "./pptx-observation-synthesis";
import {
  pdfObservationSynthesisText,
  type PDFObservationSynthesis,
} from "./pdf-observation-synthesis";
import { pdfObservationsText, type PDFObservation } from "./pdf-observations";
import { pdfSynthesisText, type PDFSynthesis } from "./pdf-synthesis";
import { pdfEvidenceText, type PDFEvidence } from "./pdf-evidence";
import {
  attachmentSynthesisText,
  type AttachmentSynthesis,
} from "./attachment-synthesis";
import {
  attachmentEvidenceText,
  type AttachmentEvidence,
} from "./attachment-evidence";
import { reportingCopy, type Language } from "./localization";
import { z } from "zod";
import type { Analysis, AnalysisScope, Citation } from "./domain";
export const citationSchema = z.object({
  interviewId: z.string().min(1).max(100),
  turnId: z.string().min(1).max(100),
  quote: z.string().min(3).max(12000),
});
export const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  brand: z.string().trim().min(1).max(100),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  footer: z.string().max(160),
  font: z.enum(["Arial", "Georgia"]),
});
export type PresentationStyle = z.infer<typeof templateSchema>;
export const defaultStyle: PresentationStyle = {
  name: "Echo Lab",
  brand: "Echo Lab",
  accent: "#526D42",
  footer: "Internal research · Review source evidence",
  font: "Arial",
};
export type ReportTemplate = PresentationStyle & {
  id: string;
  workspaceId: string;
  version: number;
};
export const blockSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(6000),
  hidden: z.boolean(),
  citations: z.array(citationSchema).max(30),
});
export type ReportBlock = z.infer<typeof blockSchema>;
export const editionInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    blocks: z.array(blockSchema).min(1).max(20),
    style: templateSchema,
    reviewed: z.boolean(),
  })
  .superRefine((r, ctx) => {
    if (new Set(r.blocks.map((b) => b.id)).size !== r.blocks.length)
      ctx.addIssue({
        code: "custom",
        message: "Report block IDs must be unique.",
      });
    if (r.blocks.every((b) => b.hidden))
      ctx.addIssue({
        code: "custom",
        message: "Keep at least one report block visible.",
      });
  });
export type ReportEdition = z.infer<typeof editionInput> & {
  docxAnswers?: DOCXAnswerEvidence[];
  pptxAnswers?: PPTXAnswerEvidence[];
  pdfAnswers?: PDFAnswerEvidence[];
  docxObservationAnswers?: DOCXObservationAnswerEvidence[];
  pptxObservationAnswers?: PPTXObservationAnswerEvidence[];
  pdfObservationAnswers?: PDFObservationAnswerEvidence[];
  docxObservations?: DOCXObservation[];
  pptxObservations?: PPTXObservation[];
  pdfObservations?: PDFObservation[];
  docxObservationSynthesis?: DOCXObservationSynthesis;
  pptxObservationSynthesis?: PPTXObservationSynthesis;
  pdfObservationSynthesis?: PDFObservationSynthesis;
  pdfEvidence?: PDFEvidence[];
  pptxEvidence?: PPTXEvidence[];
  docxEvidence?: DOCXEvidence[];
  docxSynthesis?: DOCXSynthesis;
  pptxSynthesis?: PPTXSynthesis;
  pdfSynthesis?: PDFSynthesis;
  attachmentEvidence?: AttachmentEvidence[];
  attachmentSynthesis?: AttachmentSynthesis;
  language?: Language;
  id: string;
  workspaceId: string;
  studyId: string;
  sourceAnalysisId: string;
  sourceAnalysisVersion: number;
  dataVersion: number;
  scope?: AnalysisScope;
  version: number;
  sampleSize: number;
  createdAt: string;
  updatedAt: string;
};
export type ReportSnapshot = {
  id: string;
  workspaceId: string;
  studyId: string;
  editionId: string;
  edition: ReportEdition;
  action: "created" | "saved" | "restored" | "rebased";
  actorName: string;
  createdAt: string;
};
export type MediaSource = {
  external?: boolean;
  mediaId: string;
  interviewId: string;
  turnId: string;
  prompt: string;
  answerPreview: string;
  kind: "audio" | "screen";
  durationMs: number;
  revisionId: string;
  conceptId?: string;
};
export const clipInput = z.object({
  name: z.string().trim().min(1).max(100),
  mediaId: z.uuid(),
  quote: z.string().min(3).max(12000),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(100),
  caption: z.string().max(180),
  reviewed: z.boolean(),
});
export type MediaClip = z.infer<typeof clipInput> & {
  aiProvenance?: {
    runId: string;
    suggestionIndex: number;
    model: string;
    transcriptionModel: string;
    sourceDigest: string;
    edited: boolean;
  };
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnId: string;
  kind: "audio" | "screen";
  revisionId: string;
  conceptId?: string;
  version: number;
  createdAt: string;
};
export const reelInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    clipIds: z.array(z.uuid()).min(1).max(6),
    crossStudy: z.boolean().optional(),
    reviewed: z.boolean(),
  })
  .refine(
    (r) => new Set(r.clipIds).size === r.clipIds.length,
    "Use each clip only once in a reel.",
  );
export type MediaReel = z.infer<typeof reelInput> & {
  id: string;
  workspaceId: string;
  studyId: string;
  version: number;
  createdAt: string;
};
export type RenderJob = {
  id: string;
  workspaceId: string;
  studyId: string;
  reelId: string;
  reelVersion: number;
  sourceVersions?: { studyId: string; dataVersion: number; title: string }[];
  clipVersions: { id: string; version: number }[];
  dataVersion: number;
  name: string;
  state: "queued" | "running" | "failed" | "complete";
  attempts: number;
  backgroundJobId?: string;
  outputId?: string;
  durationMs?: number;
  segments?: { clipId: string; startMs: number; endMs: number }[];
  bytes?: number;
  lease?: string;
  leaseUntil?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
export function blocksFromAnalysis(
  a: Analysis,
  makeId: () => string,
): ReportBlock[] {
  return [
    {
      id: makeId(),
      title:
        a.reportLanguage && a.reportLanguage !== "en"
          ? reportingCopy[a.reportLanguage].summary
          : "Summary",
      body: a.summary,
      hidden: false,
      citations: [],
    },
    ...a.themes.map((t) => ({
      id: makeId(),
      title: t.title,
      body: t.description,
      citations: structuredClone(t.citations),
      hidden: false,
    })),
    {
      id: makeId(),
      title:
        a.reportLanguage && a.reportLanguage !== "en"
          ? reportingCopy[a.reportLanguage].limits
          : "Limitations",
      body: a.limitations,
      hidden: false,
      citations: [],
    },
  ];
}
export function editionText(e: ReportEdition) {
  return [
    e.title,
    `Report edition v${e.version} · ${e.sampleSize} included participants · Response set v${e.dataVersion}`,
    e.scope
      ? `Concept ${e.scope.conceptId} · Revision ${e.scope.revisionId}`
      : "Shared questions",
    ...e.blocks
      .filter((b) => !b.hidden)
      .flatMap((b) => [
        "\n" + b.title,
        b.body,
        ...b.citations.map(
          (c) =>
            `“${c.quote}” — Participant ${c.interviewId} · Turn ${c.turnId}`,
        ),
      ]),
    attachmentSynthesisText(e.attachmentSynthesis, e.language),
    attachmentEvidenceText(e.attachmentEvidence, e.language),
    pdfEvidenceText(e.pdfEvidence, e.language),
    pptxEvidenceText(e.pptxEvidence, e.language),
    docxEvidenceText(e.docxEvidence, e.language),
    docxSynthesisText(e.docxSynthesis, e.language) +
      pptxSynthesisText(e.pptxSynthesis, e.language),
    docxObservationsText(e.docxObservations, e.language) +
      pptxObservationsText(e.pptxObservations, e.language),
    pdfObservationsText(e.pdfObservations, e.language),
    docxAnswersText(e.docxAnswers, e.language) +
      pptxAnswersText(e.pptxAnswers, e.language),
    pdfAnswersText(e.pdfAnswers, e.language),
    docxObservationAnswersText(e.docxObservationAnswers, e.language) +
      pptxObservationAnswersText(e.pptxObservationAnswers, e.language),
    pdfObservationAnswersText(e.pdfObservationAnswers, e.language),
    docxObservationSynthesisText(e.docxObservationSynthesis, e.language) +
      pptxObservationSynthesisText(e.pptxObservationSynthesis, e.language),
    pdfObservationSynthesisText(e.pdfObservationSynthesis, e.language),
    pdfSynthesisText(e.pdfSynthesis, e.language),
    "\n" + e.style.footer,
  ].join("\n");
}
export function vttTime(ms: number) {
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export function captionsVtt(
  clips: Pick<MediaClip, "startMs" | "endMs" | "caption">[],
) {
  let at = 0;
  return (
    "WEBVTT\n\n" +
    clips
      .map((c, n) => {
        const start = at;
        at += c.endMs - c.startMs;
        const text = c.caption
          .replace(/[\r\n]+/g, " ")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return text
          ? `${n + 1}\n${vttTime(start)} --> ${vttTime(at)}\n${text}\n\n`
          : "";
      })
      .join("")
  );
}
export type ReportingData = {
  editions: ReportEdition[];
  templates: ReportTemplate[];
  clips: MediaClip[];
  workspaceClips?: (MediaClip & {
    studyTitle: string;
    displayCaption: string;
  })[];
  reels: MediaReel[];
  jobs: RenderJob[];
  sources: MediaSource[];
  analyses: { id: string; label: string; stale: boolean }[];
  evidence: { interviewId: string; turnId: string; label: string }[];
  dataVersion: number;
};
export function citationsOf(blocks: ReportBlock[]): Citation[] {
  return blocks.flatMap((b) => b.citations);
}

export function crossStudyCaption(
  title: string,
  studyId: string,
  caption: string,
) {
  const clean = title.replace(/\s+/g, " ").trim(),
    chars = Array.from(clean);
  return `${chars.slice(0, 60).join("")}${chars.length > 60 ? "…" : ""} [${studyId.slice(0, 8)}]\n${caption}`;
}
