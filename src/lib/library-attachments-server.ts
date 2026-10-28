import {
  retrieveLibrarySemantic,
  embedLibraryTexts,
} from "./library-semantic-server";
import type { LibraryAttachmentHit } from "./library-attachments";
import { z } from "zod";
import { hash, transaction } from "./db";
import { body, canEdit, respond, fail, limit } from "./http";
import type { Actor } from "./domain";
import { answerLibraryAttachments } from "./library-attachments-ai-server";
import { libraryAttachmentCorpus } from "./library-attachment-corpus";
import {
  dispatchLibraryAnswers,
  existingLibraryDraft,
  saveLibraryDraft,
} from "./library-answers-server";
import {
  libraryAttachmentFilter,
  libraryAttachmentQuestion,
  libraryAttachmentLabels,
  rankLibraryAttachments,
  attachmentQuestionEvidence,
} from "./library-attachments";
export async function dispatchLibraryAttachments(
  req: Request,
  p: string[],
  a: Actor,
  answer: typeof answerLibraryAttachments = answerLibraryAttachments,
  embed: typeof embedLibraryTexts = embedLibraryTexts,
) {
  if (p[1] !== "attachments") return null;
  if (p[2] === "answers") return dispatchLibraryAnswers(req, p, a);
  if (p.length !== 3 || !["search", "source", "qa"].includes(p[2]))
    fail(404, "Attachment library action unavailable.");
  if (req.method !== "POST") fail(405, "Method unavailable.");
  if (p[2] === "qa") {
    canEdit(a);
    limit("library-attachment-qa:" + a.workspaceId, 10);
    const input = libraryAttachmentQuestion
      .extend({
        saveDraft: z.boolean().default(false),
        requestId: z.uuid().optional(),
        retrieval: z.enum(["keyword", "semantic"]).default("keyword"),
      })
      .strict()
      .parse(await body(req));
    if (input.saveDraft && !input.requestId)
      fail(400, "A request ID is required to save a draft.");
    const { retrieval, ...rest } = input;
    const inputHash = hash(
      JSON.stringify({
        ...rest,
        ...(retrieval === "semantic" ? { retrieval } : {}),
      }),
    );
    if (input.saveDraft) {
      const existing = await existingLibraryDraft(
        a,
        input.requestId!,
        inputHash,
      );
      if (existing) return respond(existing);
    }
    const c = await libraryAttachmentCorpus(a, input);
    const found =
      input.retrieval === "semantic"
        ? await retrieveLibrarySemantic(
            a,
            "attachments",
            input,
            [input.query, input.question].filter(Boolean).join("\n"),
            100,
            embed,
          )
        : undefined;
    let budget = 40000;
    const evidence = found
      ? found.items
          .flatMap((h) => {
            if (h.text.length > 2000 || h.text.length > budget) return [];
            budget -= h.text.length;
            return [h.hit as LibraryAttachmentHit];
          })
          .slice(0, 30)
      : attachmentQuestionEvidence(c.hits, input.query, input.question);
    if (!evidence.length) {
      if (input.saveDraft)
        fail(
          400,
          "A saved answer requires matching included evidence and exact citations.",
        );
      return respond({
        answer: libraryAttachmentLabels[input.language].insufficient,
        question: input.question,
        language: input.language,
        citations: [],
        searchedStudies: c.studies,
        evidenceCount: 0,
        generated: false,
        ...(found ? { retrieval: found.retrieval } : {}),
      });
    }
    const result = await answer(
      evidence,
      input.question,
      input.language,
      a.workspaceId,
    );
    return transaction(async () => {
      if (
        (await libraryAttachmentCorpus(a, input)).fingerprint !== c.fingerprint
      )
        fail(
          409,
          "Attachment library sources changed while answering. Search again.",
        );
      const response = {
        ...result,
        question: input.question,
        language: input.language,
        citations: result.citations.map((c) => ({
          ...c,
          source: evidence.find((h) => h.id === c.evidenceId)!,
        })),
        searchedStudies: c.studies,
        evidenceCount: evidence.length,
        generated: true,
        ...(found ? { retrieval: found.retrieval } : {}),
      };
      if (input.saveDraft)
        return respond(
          await saveLibraryDraft(a, input, inputHash, response, evidence),
        );
      return respond(response);
    });
  }
  if (p[2] === "source") {
    const input = libraryAttachmentFilter
      .extend({ id: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(await body(req));
    const c = await libraryAttachmentCorpus(a, input),
      source = c.hits.find((h) => h.id === input.id);
    if (!source)
      fail(
        404,
        "This attachment evidence changed, was withdrawn or is outside the selected filters. Search again.",
      );
    return respond({ source });
  }
  const input = libraryAttachmentFilter
    .extend({ retrieval: z.enum(["keyword", "semantic"]).default("keyword") })
    .strict()
    .parse(await body(req));
  if (input.retrieval === "semantic") {
    const found = await retrieveLibrarySemantic(
      a,
      "attachments",
      input,
      input.query,
      50,
      embed,
    );
    return respond({
      hits: found.items.map((h) => h.hit),
      total: found.retrieval.indexed,
      limited: found.retrieval.indexed > 50,
      searchedStudies: (await libraryAttachmentCorpus(a, input)).studies,
      retrieval: found.retrieval,
    });
  }
  const c = await libraryAttachmentCorpus(a, input),
    ranked = rankLibraryAttachments(c.hits, input.query, 5001);
  return respond({
    hits: ranked.slice(0, 50),
    total: ranked.length,
    limited: ranked.length > 50,
    searchedStudies: c.studies,
  });
}
