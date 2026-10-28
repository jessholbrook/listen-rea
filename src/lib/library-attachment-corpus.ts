import { collectionScope } from "./library-collection-scope";
import { list, hash } from "./db";
import { fail } from "./http";
import type { Actor, Study, Interview } from "./domain";
import { collectAttachmentEvidence } from "./attachment-evidence-server";
import { collectPDFEvidence } from "./pdf-evidence-server";
import { collectDOCXEvidence } from "./docx-evidence-server";
import { collectPPTXEvidence } from "./pptx-evidence-server";
import { collectPDFObservations } from "./pdf-observations-server";
import { collectDOCXObservations } from "./docx-observations-server";
import { collectPPTXObservations } from "./pptx-observations-server";
import {
  type LibraryAttachmentHit,
  type LibraryAttachmentFilter,
  type AttachmentFormat,
  type AttachmentKind,
} from "./library-attachments";
type Origin = {
  interviewId: string;
  turnId: string;
  revisionId: string;
  conceptId?: string;
  reviewerName: string;
  reviewedAt: string;
  grounding?: string;
};
export async function libraryAttachmentCorpus(
  a: Actor,
  filter: LibraryAttachmentFilter,
) {
  const collection = await collectionScope(a, filter.collectionId);
  const available = await list<Study>("study", a.workspaceId);
  if (filter.studyIds.some((id) => !available.some((s) => s.id === id)))
    fail(404, "A selected study is unavailable.");
  let studies = filter.studyIds.length
    ? available.filter((s) => filter.studyIds.includes(s.id))
    : available;
  if (studies.length > 100)
    fail(413, "Select at most 100 studies for attachment evidence.");
  const selected = new Set(studies.map((s) => s.id));
  const responses = (await list<Interview>("interview", a.workspaceId)).filter(
    (i) =>
      (!collection || collection.interviewIds.includes(i.id)) &&
      selected.has(i.studyId) &&
      i.status === "complete" &&
      !i.preview &&
      !i.excluded &&
      (!filter.attribute ||
        i.attributes[filter.attribute.key] === filter.attribute.value),
  );
  if (collection)
    studies = studies.filter((s) => responses.some((i) => i.studyId === s.id));
  if (responses.length > 2000)
    fail(
      413,
      "Narrow the study or attribute filters to at most 2,000 eligible responses.",
    );
  const byId = new Map(responses.map((i) => [i.id, i])),
    hits: LibraryAttachmentHit[] = [];
  for (const s of studies) {
    const all = responses.filter((i) => i.studyId === s.id);
    const has = (format: AttachmentFormat) =>
      all.some((i) =>
        i.turns.some((t) =>
          format === "image"
            ? t.participantImage
            : format === "pdf"
              ? t.participantPDF
              : format === "docx"
                ? t.participantDOCX
                : t.participantPPTX,
        ),
      );
    const wants = (format: AttachmentFormat, kind: AttachmentKind) =>
      filter.formats.includes(format) &&
      filter.kinds.includes(kind) &&
      has(format);
    function add(
      format: AttachmentFormat,
      kind: AttachmentKind,
      e: Origin,
      attachmentId: string,
      version: number,
      text: string,
      field?: "notes" | "correction",
      locator?: LibraryAttachmentHit["locator"],
      ocr?: boolean,
    ) {
      if (text.trim().length < 3) return;
      const i = byId.get(e.interviewId)!;
      hits.push({
        id: hash(JSON.stringify([s.id, format, kind, e, field, locator, text])),
        studyId: s.id,
        studyTitle: s.title,
        interviewId: e.interviewId,
        turnId: e.turnId,
        revisionId: e.revisionId,
        conceptId: e.conceptId,
        attachmentId,
        format,
        kind,
        version,
        text,
        field,
        locator,
        ocr,
        grounding: kind === "observation" ? e.grounding : undefined,
        reviewerName: e.reviewerName,
        reviewedAt: e.reviewedAt,
        attributes: i.attributes,
      });
      if (hits.length > 5000)
        fail(
          413,
          "Narrow the filters to at most 5,000 included attachment evidence records.",
        );
    }
    const [images, pdfs, docxs, pptxs, pdfNotes, docxNotes, pptxNotes] =
      await Promise.all([
        wants("image", "observation") ? collectAttachmentEvidence(s, all) : [],
        wants("pdf", "passage") ? collectPDFEvidence(s, all) : [],
        wants("docx", "passage") ? collectDOCXEvidence(s, all) : [],
        wants("pptx", "passage") ? collectPPTXEvidence(s, all) : [],
        wants("pdf", "observation") ? collectPDFObservations(s, all) : [],
        wants("docx", "observation") ? collectDOCXObservations(s, all) : [],
        wants("pptx", "observation") ? collectPPTXObservations(s, all) : [],
      ]);
    for (const e of images)
      add(
        "image",
        "observation",
        e,
        e.imageId,
        e.reviewVersion,
        e.notes,
        "notes",
      );
    for (const e of pdfs)
      for (const p of e.passages)
        add(
          "pdf",
          "passage",
          e,
          e.pdfId,
          e.verificationVersion,
          p.quote,
          undefined,
          { unit: "page", number: p.page, start: p.start, end: p.end },
          e.ocrPages?.includes(p.page),
        );
    for (const e of docxs)
      for (const p of e.passages)
        add(
          "docx",
          "passage",
          e,
          e.docxId,
          e.verificationVersion,
          p.quote,
          undefined,
          {
            unit: "paragraph",
            number: p.paragraph,
            start: p.start,
            end: p.end,
          },
        );
    for (const e of pptxs)
      for (const p of e.passages)
        add(
          "pptx",
          "passage",
          e,
          e.pptxId,
          e.verificationVersion,
          p.quote,
          undefined,
          { unit: "slide", number: p.slide, start: p.start, end: p.end },
        );
    for (const [format, entries] of [
      ["pdf", pdfNotes],
      ["docx", docxNotes],
      ["pptx", pptxNotes],
    ] as const)
      for (const e of entries) {
        const id = "pdfId" in e ? e.pdfId : "docxId" in e ? e.docxId : e.pptxId;
        add(format, "observation", e, id, e.reviewVersion, e.notes, "notes");
        add(
          format,
          "observation",
          e,
          id,
          e.reviewVersion,
          e.correction,
          "correction",
        );
      }
  }
  hits.sort(
    (a, b) => a.studyId.localeCompare(b.studyId) || a.id.localeCompare(b.id),
  );
  if (JSON.stringify(hits).length > 5000000)
    fail(
      413,
      "Narrow the filters; attachment evidence exceeds the library request limit.",
    );
  return {
    hits,
    studies: studies.length,
    fingerprint: hash(
      JSON.stringify({
        ...(collection
          ? {
              collection: [
                collection.id,
                collection.version,
                collection.interviewIds,
              ],
            }
          : {}),
        studies: studies.map((s) => [s.id, s.title]).sort(),
        hits,
      }),
    ),
  };
}
