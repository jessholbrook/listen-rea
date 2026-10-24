import type { EmotionAnswer } from "./emotion";
import {
  cardsortSchema,
  type CardsortState,
  type CardsortPrompt,
  type CardAssignment,
} from "./cardsort";
import {
  maxdiffSchema,
  type MaxdiffState,
  type MaxdiffPrompt,
} from "./maxdiff";
import {
  pricingSchema,
  type PricingState,
  type PricingPrompt,
} from "./pricing";
import { z } from "zod";
import { localizationSchema, type Language } from "./localization";
export const optionSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(500),
  rejects: z.boolean().default(false),
  imageAssetId: z.uuid().nullable().optional(),
  imageAlt: z.string().trim().max(500).optional(),
});
export const questionSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum([
    "open",
    "choice",
    "statement",
    "multiple",
    "rating",
    "ranking",
    "matrix",
    "pricing",
    "maxdiff",
    "cardsort",
    "emotion",
  ]),
  participantImages: z.boolean().optional(),
  participantPDFs: z.boolean().optional(),
  participantPPTX: z.boolean().optional(),
  participantDOCX: z.boolean().optional(),
  participantImageAI: z.boolean().optional(),
  participantDOCXAI: z.boolean().optional(),
  participantPPTXAI: z.boolean().optional(),
  participantPDFAI: z.boolean().optional(),
  pricing: pricingSchema.nullable().optional(),
  maxdiff: maxdiffSchema.nullable().optional(),
  cardsort: cardsortSchema.nullable().optional(),
  text: z.string().trim().min(1).max(3000),
  section: z.string().max(100).default("Discussion"),
  options: z.array(optionSchema).max(20).default([]),
  conceptQuestion: z.boolean().optional(),
  task: z
    .object({
      url: z
        .string()
        .url()
        .max(2000)
        .refine((value) => {
          const u = new URL(value);
          return u.protocol === "https:" && !u.username && !u.password;
        }, "Use an HTTPS task link without embedded credentials.")
        .optional(),
      maxSeconds: z.number().int().min(30).max(600).default(300),
    })
    .nullable()
    .optional(),
  randomizeOptions: z.boolean().optional(),
  scale: z
    .object({
      min: z.number().int().min(-100).max(100),
      max: z.number().int().min(-100).max(100),
      lowLabel: z.string().max(100),
      highLabel: z.string().max(100),
    })
    .nullable()
    .optional(),
  selection: z
    .object({
      min: z.number().int().min(1).max(20),
      max: z.number().int().min(1).max(20),
    })
    .nullable()
    .optional(),
  carryForward: z
    .object({
      questionId: z.string(),
      mode: z.enum(["selected", "unselected"]),
    })
    .nullable()
    .optional(),
  followUps: z.number().int().min(0).max(2).default(0),
  instructions: z.string().max(2000).default(""),
  condition: z
    .object({ questionId: z.string(), optionId: z.string() })
    .nullable()
    .default(null),
});
export const conceptSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  headline: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(6000),
  exposureSeconds: z.number().int().min(1).max(300).nullable().optional(),
  imageAssetId: z.uuid().nullable().optional(),
  videoAssetId: z.uuid().nullable().optional(),
  videoOnce: z.boolean().optional(),
  videoTranscript: z.string().trim().max(6000).optional(),
  imageUrl: z
    .string()
    .url()
    .max(2000)
    .refine((value) => {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    }, "Use an HTTPS image URL without embedded credentials.")
    .nullable()
    .optional(),
  imageAlt: z.string().max(500).optional(),
  prototypeUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => {
      try {
        const u = new URL(value);
        return (
          /^https:\/\//i.test(value) &&
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !/[\\\u0000-\u0020\u007f]/.test(value)
        );
      } catch {
        return false;
      }
    }, "Use an HTTPS prototype URL without credentials or spaces.")
    .nullable()
    .optional(),
  taskInstructions: z.string().trim().max(4000).optional(),
});
export const guideSchema = z
  .object({
    confidentiality: z
      .object({
        title: z.string().trim().min(3).max(160),
        text: z.string().trim().min(20).max(6000),
      })
      .nullable()
      .optional(),
    localization: localizationSchema.optional(),
    title: z.string().trim().min(3).max(160),
    goal: z.string().trim().min(10).max(4000),
    audience: z.string().trim().min(3).max(1000),
    intro: z.string().min(5).max(3000),
    questions: z.array(questionSchema).min(1).max(50),
    conceptTest: z
      .object({
        concepts: z.array(conceptSchema).min(2).max(10),
        count: z.number().int().min(1).max(5),
        randomizeOrder: z.boolean(),
      })
      .nullable()
      .optional(),
    sections: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          condition: z.object({ questionId: z.string(), optionId: z.string() }),
        }),
      )
      .max(50)
      .nullable()
      .optional(),
    limit: z.number().int().min(1).max(500).default(20),
  })
  .superRefine((g, ctx) => {
    const ids = new Set<string>();
    g.questions.forEach((q, i) => {
      if (
        q.participantImageAI &&
        (!q.participantImages || q.type !== "open" || q.followUps < 1)
      )
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantImageAI"],
          message:
            "Image-aware AI requires image attachments on an open question with at least one follow-up.",
        });
      if (
        q.participantDOCXAI &&
        (!q.participantDOCX || q.type !== "open" || q.followUps < 1)
      )
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantDOCXAI"],
          message:
            "DOCX-aware AI requires DOCX attachments on an open question with at least one follow-up.",
        });
      if (
        q.participantPPTXAI &&
        (!q.participantPPTX || q.type !== "open" || q.followUps < 1)
      )
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantPPTXAI"],
          message:
            "PPTX-aware AI requires PPTX attachments on an open question with at least one follow-up.",
        });
      if (
        q.participantPDFAI &&
        (!q.participantPDFs || q.type !== "open" || q.followUps < 1)
      )
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantPDFAI"],
          message:
            "PDF-aware AI requires PDF attachments on an open question with at least one follow-up.",
        });
      if (q.participantPPTX && q.type !== "open")
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantPPTX"],
          message: "PPTX attachments require an open-ended question.",
        });
      if (q.participantDOCX && q.type !== "open")
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantDOCX"],
          message: "DOCX attachments require an open-ended question.",
        });
      if (q.participantPDFs && q.type !== "open")
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantPDFs"],
          message: "PDF attachments require an open-ended question.",
        });
      if (q.participantImages && q.type !== "open")
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "participantImages"],
          message:
            "Participant image attachments require an open-ended question.",
        });
      if (
        q.type === "emotion" &&
        (q.followUps !== 0 ||
          q.options.length ||
          q.scale ||
          q.selection ||
          q.carryForward ||
          q.randomizeOptions ||
          q.task ||
          q.pricing ||
          q.maxdiff ||
          q.cardsort)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Feeling check-ins use fixed optional self-report controls, zero AI follow-ups and no other method settings.",
          path: ["questions", i],
        });
      if (
        q.type === "cardsort" &&
        (!q.cardsort ||
          q.followUps !== 0 ||
          q.task ||
          q.carryForward ||
          q.options.length ||
          q.pricing ||
          q.maxdiff)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Card sorts need cards/groups, no fixed options/tasks/carry-forward/other specialist settings and zero AI follow-ups.",
          path: ["questions", i, "cardsort"],
        });
      if (q.type !== "cardsort" && q.cardsort)
        ctx.addIssue({
          code: "custom",
          message: "Card-sort settings require the card-sort question type.",
          path: ["questions", i, "cardsort"],
        });
      if (
        q.type === "maxdiff" &&
        (!q.maxdiff ||
          q.followUps !== 0 ||
          q.task ||
          q.carryForward ||
          q.options.length ||
          q.pricing)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "MaxDiff needs an item design, no options/tasks/carry-forward/pricing and zero AI follow-ups.",
          path: ["questions", i, "maxdiff"],
        });
      if (q.type !== "maxdiff" && q.maxdiff)
        ctx.addIssue({
          code: "custom",
          message: "MaxDiff designs require the MaxDiff question type.",
          path: ["questions", i, "maxdiff"],
        });
      if (
        q.type === "pricing" &&
        (!q.pricing ||
          q.followUps !== 0 ||
          q.task ||
          q.carryForward ||
          q.options.length)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Pricing questions need a price ladder, no options, no task/carry-forward and zero AI follow-ups.",
          path: ["questions", i, "pricing"],
        });
      if (q.type !== "pricing" && q.pricing)
        ctx.addIssue({
          code: "custom",
          message: "Price ladders require the pricing question type.",
          path: ["questions", i, "pricing"],
        });
      if (q.task && (q.type !== "open" || q.followUps !== 0))
        ctx.addIssue({
          code: "custom",
          message:
            "Usability tasks must be open questions with follow-ups set to zero.",
          path: ["questions", i, "task"],
        });
      if (ids.has(q.id))
        ctx.addIssue({
          code: "custom",
          message: "Question IDs must be unique.",
          path: ["questions", i, "id"],
        });
      if (
        ["choice", "multiple", "ranking", "matrix"].includes(q.type) &&
        !q.carryForward &&
        q.options.length < (q.type === "matrix" ? 1 : 2)
      )
        ctx.addIssue({
          code: "custom",
          message: "Choice questions need at least two options.",
          path: ["questions", i, "options"],
        });
      if (new Set(q.options.map((o) => o.id)).size !== q.options.length)
        ctx.addIssue({
          code: "custom",
          message: "Option IDs must be unique.",
          path: ["questions", i, "options"],
        });
      if (
        q.condition &&
        !g.questions
          .slice(0, i)
          .some(
            (p) =>
              p.id === q.condition!.questionId &&
              ["choice", "multiple"].includes(p.type) &&
              !p.carryForward &&
              p.options.some((o) => o.id === q.condition!.optionId),
          )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "A branch must reference an option in an earlier choice question.",
          path: ["questions", i, "condition"],
        });
      const issue = (message: string) =>
        ctx.addIssue({ code: "custom", message, path: ["questions", i] });
      for (const o of q.options) {
        if (
          o.imageAssetId &&
          !["choice", "multiple", "ranking"].includes(q.type)
        )
          issue(
            "Answer images require a single-select, multiple-select or ranking question.",
          );
        if (o.imageAssetId && !o.imageAlt?.trim())
          issue("Every answer image needs a text description.");
      }
      const scale = q.scale;
      if (scale && (scale.min >= scale.max || scale.max - scale.min > 10))
        issue("Scale must increase by whole numbers across at most 11 points.");
      if (
        q.selection &&
        (q.selection.min > q.selection.max ||
          (!q.carryForward && q.selection.max > q.options.length))
      )
        issue("Selection bounds must fit the available options.");
      if (q.type !== "choice" && q.options.some((o) => o.rejects))
        issue(
          "Screen-out options are only supported for single-select questions.",
        );
      if (q.carryForward) {
        const source = g.questions
          .slice(0, i)
          .find((p) => p.id === q.carryForward!.questionId);
        if (
          !["choice", "multiple", "ranking", "matrix"].includes(q.type) ||
          !source ||
          !["choice", "multiple"].includes(source.type) ||
          source.carryForward
        )
          issue(
            "Carry-forward requires an earlier single/multiple-select source with fixed options.",
          );
      }
      ids.add(q.id);
    });
    const names = new Set<string>();
    for (const section of g.sections || []) {
      const first = g.questions.findIndex((q) => q.section === section.name);
      const source = g.questions
        .slice(0, first)
        .find((q) => q.id === section.condition.questionId);
      if (
        names.has(section.name) ||
        first < 0 ||
        !source ||
        source.carryForward ||
        !["choice", "multiple"].includes(source.type) ||
        !source.options.some((o) => o.id === section.condition.optionId)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Section conditions need a unique section and a fixed option in a question before that section.",
          path: ["sections"],
        });
      names.add(section.name);
    }
    const block = g.questions.filter((q) => q.conceptQuestion),
      config = g.conceptTest;
    const conceptIssue = (message: string) =>
      ctx.addIssue({ code: "custom", message, path: ["conceptTest"] });
    if (config) {
      if (
        new Set(config.concepts.map((c) => c.id)).size !==
        config.concepts.length
      )
        conceptIssue("Concept IDs must be unique.");
      if (config.count > config.concepts.length)
        conceptIssue("Assigned count cannot exceed available concepts.");
      for (const c of config.concepts) {
        if (c.videoOnce && (!c.videoAssetId || c.exposureSeconds))
          conceptIssue(
            "One-time viewing requires an uploaded video and self-paced concept presentation.",
          );
        if (c.exposureSeconds && c.prototypeUrl)
          conceptIssue(
            "Timed presentation supports in-page concepts. Remove the external prototype link or use self-paced presentation.",
          );
        if (c.videoAssetId && !c.videoTranscript?.trim())
          conceptIssue(
            "Add a video text alternative covering speech and important visuals.",
          );
        if (c.prototypeUrl && !c.taskInstructions?.trim())
          conceptIssue("Add task instructions for each prototype link.");
        if (c.imageAssetId && c.imageUrl)
          conceptIssue("Choose an uploaded image or an image URL, not both.");
        if ((c.imageUrl || c.imageAssetId) && !c.imageAlt?.trim())
          conceptIssue("Images need an accessible description.");
      }
      if (!block.length)
        conceptIssue("Mark at least one question to repeat for each concept.");
      const start = g.questions.findIndex((q) => q.conceptQuestion),
        end = g.questions.findLastIndex((q) => q.conceptQuestion);
      if (g.questions.slice(start, end + 1).some((q) => !q.conceptQuestion))
        conceptIssue("Concept questions must form one consecutive block.");
      const repeated = new Set(block.map((q) => q.id));
      for (const q of g.questions) {
        if (q.conceptQuestion && q.options.some((o) => o.rejects))
          conceptIssue("Keep screeners before the concept block.");
        if (
          !q.conceptQuestion &&
          (repeated.has(q.condition?.questionId || "") ||
            repeated.has(q.carryForward?.questionId || ""))
        )
          conceptIssue(
            "Shared questions cannot depend on answers inside a repeated concept block.",
          );
      }
      for (const r of g.sections || [])
        if (
          repeated.has(r.condition.questionId) &&
          g.questions.some((q) => q.section === r.name && !q.conceptQuestion)
        )
          conceptIssue("Shared sections cannot depend on a concept answer.");
    } else if (block.length)
      conceptIssue("Configure concepts before repeating questions.");
  });
export type Question = z.infer<typeof questionSchema> & {
  conceptId?: string;
  templateQuestionId?: string;
};
export type Guide = Omit<z.infer<typeof guideSchema>, "questions"> & {
  questions: Question[];
};
export type AnalysisScope = { conceptId: string; revisionId: string };
export type ImageProbe = {
  observationPromptVersion?: string;
  imageSha256?: string;
  imageId: string;
  permissionVersion: string;
  promptVersion: string;
  model: string;
  generatedAt: string;
  status: "asked" | "none" | "rejected" | "unavailable";
  probe?: string;
  visualAnchor?: string;
};
export type ParticipantImage = {
  aiPermission?: {
    version: string;
    provider: "OpenAI";
    text: string;
    language: Language;
    grantedAt: string;
  };
  id: string;
  description: string;
  width: number;
  height: number;
  bytes: number;
  uploadedAt: string;
};
export type Turn = {
  recordingSection?: import("./recording-sections").ReviewedRecordingSection;
  participantPPTX?: import("./participant-pptx").ParticipantPPTX;
  participantPPTXRemovedAt?: string;
  participantDOCX?: import("./participant-docx").ParticipantDOCX;
  participantDOCXRemovedAt?: string;
  participantPDF?: import("./participant-pdfs").ParticipantPDF;
  participantPDFRemovedAt?: string;
  imageProbe?: ImageProbe;
  docxProbe?: import("./participant-docx").DOCXProbe;
  pptxProbe?: import("./participant-pptx").PPTXProbe;
  promptSourceDOCXId?: string;
  promptSourcePPTXId?: string;
  pdfProbe?: import("./participant-pdfs").PDFProbe;
  promptSourcePDFId?: string;
  promptSourceImageId?: string;
  participantImage?: ParticipantImage;
  participantImageRemovedAt?: string;
  emotion?: EmotionAnswer;
  id: string;
  questionId: string;
  conceptId?: string;
  templateQuestionId?: string;
  prompt: string;
  answer: string;
  cardsort?: { phase: "sort" | "reason"; assignments?: CardAssignment[] };
  maxdiff?: { task: number; shown: string[]; best: string; worst: string };
  pricing?: {
    phase: "price" | "check" | "reason";
    priceMinor?: number;
    buy?: boolean;
  };
  optionId?: string;
  value?: number | string[] | Record<string, number>;
  followUp: boolean;
  createdAt: string;
  audioId?: string;
  durationMs?: number;
  source: "typed" | "transcribed";
  strategy: "guide" | "scripted" | "ai";
};
export type Interview = {
  screenerQuota?: import("./quotas").ScreenerQuotaPlan;
  screenOutReason?: "quota_full" | "quota_no_match" | "quota_minimum";
  quotaRuleIds?: string[];
  quotaVersion?: number;
  handoffId?: string;
  invitationId?: string;
  language?: Language;
  cardsortStates?: Record<string, CardsortState>;
  cardsortPrompt?: CardsortPrompt;
  maxdiffStates?: Record<string, MaxdiffState>;
  maxdiffPrompt?: MaxdiffPrompt;
  pricingStates?: Record<string, PricingState>;
  pricingPrompt?: PricingPrompt;
  origin?: {
    kind: "external";
    externalId: string;
    title: string;
    importedAt: string;
    importedBy: string;
    requestId: string;
    fingerprint: string;
    permissionConfirmed: true;
    transcriptReviewed: true;
    recordingRevision?: {
      reviewVersion: number;
      sourceVersion: number;
      reason: string;
      at: string;
      editor: { id: string; name: string };
    };
    transcription?: {
      revision?: {
        reviewVersion: number;
        sourceVersion: number;
        reason: string;
        at: string;
        editor: { id: string; name: string };
      };
      model: string;
      generatedAt: string;
      recordingDigest: string;
      originalTranscriptDigest: string;
      reviewedTranscriptDigest: string;
      edited: boolean;
      reviewedAt: string;
      reviewedBy: { id: string; name: string };
    };
  };
  id: string;
  studyId: string;
  workspaceId: string;
  revisionId: string;
  preview: boolean;
  tokenHash: string;
  status: "active" | "complete" | "screened_out" | "withdrawn";
  createdAt: string;
  completedAt?: string;
  consentAt: string;
  consentVersion: string;
  promptImageId?: string;
  promptDOCXId?: string;
  promptPPTXId?: string;
  promptPDFId?: string;
  participantImageDraft?: { version: number; image: ParticipantImage };
  participantPPTXDraft?: {
    version: number;
    pptx: import("./participant-pptx").ParticipantPPTX;
  };
  participantDOCXDraft?: {
    version: number;
    docx: import("./participant-docx").ParticipantDOCX;
  };
  participantPDFDraft?: {
    version: number;
    pdf: import("./participant-pdfs").ParticipantPDF;
  };
  confidentialityAcknowledgement?: {
    title: string;
    text: string;
    version: string;
    language: import("./localization").Language;
    revisionId: string;
    acceptedAt: string;
  };
  videoViews?: Record<string, import("./video-once").VideoView>;
  videoPresentation?: import("./video-once").VideoPresentation;
  conceptExposures?: Record<string, import("./concept-timing").ConceptExposure>;
  conceptPresentation?: import("./concept-timing").ConceptPresentation;
  participantBranding?: import("./branding").ParticipantBranding;
  guide: Guide;
  current: number;
  prompt: string;
  strategy: Turn["strategy"];
  turns: Turn[];
  attributes: Record<string, string>;
  excluded: boolean;
  exclusionReason: string;
  pending?: { id: string; at: number };
  requests: Record<string, { version: number }>;
  version: number;
  conceptAssignments?: string[];
  optionAssignments?: Record<string, z.infer<typeof optionSchema>[]>;
  shownQuestions?: string[];
};
export type Study = {
  id: string;
  workspaceId: string;
  title: string;
  draft: Guide;
  revisionId: string | null;
  fielding: "draft" | "paused" | "active" | "closed";
  createdAt: string;
  updatedAt: string;
  version: number;
  dataVersion: number;
  sample?: boolean;
  folderId?: string | null;
  researchGuidelines?: string;
};
export type Revision = {
  id: string;
  studyId: string;
  guide: Guide;
  createdAt: string;
};
export type Actor = {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  role: "admin" | "researcher" | "collaborator";
};
export type Citation = { turnId: string; interviewId: string; quote: string };
export type Theme = {
  id: string;
  title: string;
  description: string;
  citations: Citation[];
};
export type Analysis = {
  docxSynthesis?: import("./docx-synthesis").DOCXSynthesis;
  pptxSynthesis?: import("./pptx-synthesis").PPTXSynthesis;
  pptxEvidence?: import("./pptx-evidence").PPTXEvidence[];
  docxEvidence?: import("./docx-evidence").DOCXEvidence[];
  docxAnswers?: import("./docx-answers").SavedDOCXAnswer[];
  pptxAnswers?: import("./pptx-answers").SavedPPTXAnswer[];
  pdfAnswers?: import("./pdf-answers").SavedPDFAnswer[];
  docxObservationAnswers?: import("./docx-observation-answers").SavedDOCXObservationAnswer[];
  pptxObservationAnswers?: import("./pptx-observation-answers").SavedPPTXObservationAnswer[];
  pdfObservationAnswers?: import("./pdf-observation-answers").SavedPDFObservationAnswer[];
  docxObservationSynthesis?: import("./docx-observation-synthesis").DOCXObservationSynthesis;
  pptxObservationSynthesis?: import("./pptx-observation-synthesis").PPTXObservationSynthesis;
  pdfObservationSynthesis?: import("./pdf-observation-synthesis").PDFObservationSynthesis;
  docxObservations?: import("./docx-observations").DOCXObservation[];
  pptxObservations?: import("./pptx-observations").PPTXObservation[];
  pdfObservations?: import("./pdf-observations").PDFObservation[];
  pdfSynthesis?: import("./pdf-synthesis").PDFSynthesis;
  pdfEvidence?: import("./pdf-evidence").PDFEvidence[];
  attachmentSynthesis?: import("./attachment-synthesis").AttachmentSynthesis;
  attachmentEvidence?: import("./attachment-evidence").AttachmentEvidence[];
  reportLanguage?: Language;
  scope?: AnalysisScope;
  version: number;
  studyGoal: string;
  id: string;
  studyId: string;
  workspaceId: string;
  dataVersion: number;
  createdAt: string;
  model: string;
  themes: Theme[];
  summary: string;
  limitations: string;
  memo: string;
  reviewed: boolean;
};
export function nextQuestion(
  guide: Guide,
  after: number,
  turns: Turn[],
): number {
  for (let i = after + 1; i < guide.questions.length; i++) {
    const q = guide.questions[i];
    const matches = (
      c: { questionId: string; optionId: string } | null | undefined,
    ) =>
      !c ||
      turns.some(
        (t) =>
          t.questionId === c.questionId &&
          (t.optionId === c.optionId ||
            (Array.isArray(t.value) && t.value.includes(c.optionId))),
      );
    if (
      matches(q.condition) &&
      matches(guide.sections?.find((s) => s.name === q.section)?.condition)
    )
      return i;
  }
  return guide.questions.length;
}
export function templateGuide(
  title = "From feedback to decisions",
  goal = "Understand how teams turn customer feedback into product decisions and where the process breaks down.",
): Guide {
  const q = (id: string, text: string, section = "Discussion"): Question => ({
    id,
    text,
    section,
    type: "open",
    options: [],
    followUps: 1,
    instructions:
      "Ask about a specific recent example. Avoid suggesting an answer.",
    condition: null,
  });
  return {
    title,
    goal,
    audience:
      "People who used customer feedback to make a product decision in the past three months.",
    intro:
      "We’re learning how teams work with customer feedback. There are no right or wrong answers. You can stop at any time. Please avoid sharing confidential or personally identifying information.",
    limit: 20,
    questions: [
      {
        ...q(
          "screener",
          "Have you used customer feedback to make a product decision in the last three months?",
          "Screener",
        ),
        type: "choice",
        followUps: 0,
        options: [
          { id: "yes", text: "Yes", rejects: false },
          { id: "no", text: "No", rejects: true },
        ],
      },
      q(
        "decision",
        "Tell me about the last product decision you made using customer feedback.",
      ),
      q("gather", "How did you gather the feedback for that decision?"),
      q(
        "conflict",
        "What happened when different pieces of feedback pointed in different directions?",
      ),
      q("bottleneck", "Which part of the process took the most effort?"),
      q(
        "share",
        "How did you share what you learned with the people making the decision?",
      ),
      q("improve", "What would have made that process work better for you?"),
      {
        ...q(
          "closing",
          "Is there anything else about working with customer feedback that we should understand?",
          "Closing",
        ),
        followUps: 0,
      },
    ],
  };
}
export function summarizeThemes(
  themes: Theme[],
  interviews: Interview[],
  segment?: { questionId: string; optionId: string },
) {
  const eligible = interviews.filter(
    (i) =>
      !i.preview &&
      !i.excluded &&
      i.status === "complete" &&
      (!segment ||
        i.turns.some(
          (t) =>
            t.questionId === segment.questionId &&
            (t.optionId === segment.optionId ||
              (Array.isArray(t.value) && t.value.includes(segment.optionId))),
        )),
  );
  const ids = new Set(eligible.map((i) => i.id));
  return {
    denominator: eligible.length,
    themes: themes.map((t) => {
      const citations = t.citations.filter((c) => ids.has(c.interviewId));
      const count = new Set(citations.map((c) => c.interviewId)).size;
      return {
        ...t,
        citations,
        count,
        percent: eligible.length
          ? Math.round((count / eligible.length) * 100)
          : 0,
      };
    }),
  };
}

export function remainingProbes(
  question: Question,
  turns: Turn[],
  currentPrompt: string,
) {
  return Math.max(
    0,
    question.followUps -
      turns.filter((t) => t.questionId === question.id && t.followUp).length -
      (currentPrompt !== question.text ? 1 : 0),
  );
}
