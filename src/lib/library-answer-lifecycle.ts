// Pure source-change classification; the database applies these removals in the same transaction as the write.
export const libraryReviewKinds: Record<string, string> = {
  imageReview: "image",
  participantPDFReview: "pdf",
  participantDOCXReview: "docx",
  participantPPTXReview: "pptx",
};
export const libraryTextKinds: Record<string, string> = {
  participantPDFText: "pdf",
  participantDOCXText: "docx",
  participantPPTXText: "pptx",
};
export type LibraryRemoval = {
  field: "attachmentId" | "interviewId" | "turnId" | "studyId";
  id: string;
  format?: string;
  kind?: string;
};
export function librarySourceChanges(
  kind: string,
  before: any,
  after: any,
): LibraryRemoval[] {
  if (!before) return [];
  if (Object.hasOwn(libraryReviewKinds, kind))
    return [
      {
        field: "attachmentId",
        id: after.id,
        format: libraryReviewKinds[kind],
        kind: "observation",
      },
    ];
  if (Object.hasOwn(libraryTextKinds, kind)) {
    const contentChanged =
      before.digest !== after.digest ||
      before.source !== after.source ||
      JSON.stringify(before.pages) !== JSON.stringify(after.pages);
    const verificationChanged =
      JSON.stringify(before.history?.at(-1)) !==
      JSON.stringify(after.history?.at(-1));
    return contentChanged || verificationChanged
      ? [
          {
            field: "attachmentId",
            id: after.id,
            format: libraryTextKinds[kind],
            ...(contentChanged ? {} : { kind: "passage" }),
          },
        ]
      : [];
  }
  if (kind === "study")
    return before.title !== after.title
      ? [{ field: "studyId", id: after.id }]
      : [];
  if (kind !== "interview") return [];
  if (
    after.status !== "complete" ||
    after.excluded ||
    after.preview ||
    before.revisionId !== after.revisionId ||
    before.language !== after.language ||
    before.origin?.title !== after.origin?.title ||
    before.origin?.externalId !== after.origin?.externalId ||
    JSON.stringify(before.attributes) !== JSON.stringify(after.attributes)
  )
    return [{ field: "interviewId", id: after.id }];
  const fields = [
    "prompt",
    "answer",
    "recordingSection",
    "audioId",
    "conceptId",
    "participantImage",
    "participantPDF",
    "participantDOCX",
    "participantPPTX",
    "imageProbe",
    "pdfProbe",
    "docxProbe",
    "pptxProbe",
  ];
  return (before.turns || []).flatMap((t: any) => {
    const current = after.turns?.find((v: any) => v.id === t.id);
    return !current ||
      fields.some((k) => JSON.stringify(t[k]) !== JSON.stringify(current[k]))
      ? [{ field: "turnId" as const, id: t.id }]
      : [];
  });
}
