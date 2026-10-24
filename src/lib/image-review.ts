import { z } from "zod";
export const imageReviewFields = z
  .object({
    quality: z.enum([
      "usable",
      "unclear",
      "irrelevant",
      "privacy_concern",
      "uncertain",
    ]),
    grounding: z.enum([
      "supported",
      "unsupported",
      "uncertain",
      "not_applicable",
    ]),
    notes: z.string().trim().max(2000),
    correction: z.string().trim().max(1000),
    includeInReports: z.boolean().optional(),
  })
  .strict();
export type ImageReviewFields = z.infer<typeof imageReviewFields>;
export type ImageReviewEntry = ImageReviewFields & {
  version: number;
  at: string;
  reviewer: { id: string; name: string };
};
export type ImageReview = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnId: string;
  source: string;
  history: ImageReviewEntry[];
};
export type ImageReviewResult = {
  source: string;
  version: number;
  history: ImageReviewEntry[];
  asked: boolean;
};
