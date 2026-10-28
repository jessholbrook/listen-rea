export const participantPDFMaxBytes = 3 * 1024 * 1024;
export type ParticipantPDF = {
  aiPermission?: {
    version: string;
    provider: "OpenAI";
    text: string;
    language: import("./localization").Language;
    grantedAt: string;
  };
  id: string;
  description: string;
  pages: number;
  bytes: number;
  uploadedAt: string;
};
export type PDFReview = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnId: string;
  source: string;
  history: {
    quality:
      "usable" | "unclear" | "irrelevant" | "privacy_concern" | "uncertain";
    includeInReports?: boolean;
    grounding?: "supported" | "unsupported" | "uncertain" | "not_applicable";
    correction?: string;
    probeSource?: string;
    originalProbe?: PDFProbe;
    notes: string;
    version: number;
    at: string;
    reviewer: { id: string; name: string };
  }[];
};

export type PDFProbe = {
  pdfId: string;
  permissionVersion: string;
  promptVersion: string;
  model: string;
  generatedAt: string;
  status: "asked" | "none" | "rejected" | "unavailable";
  probe?: string;
  page?: number;
  quote?: string;
  pdfSha256?: string;
  contextTruncated?: boolean;
  pagesConsidered?: number[];
};

export type PDFReviewResult = {
  source: string;
  probeSource: string;
  probe?: PDFProbe;
  asked: boolean;
  version: number;
  history: PDFReview["history"];
};
