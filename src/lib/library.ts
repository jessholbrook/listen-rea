import {
  languageSchema,
  insufficientEvidence,
  type Language,
} from "./localization";
import { z } from "zod";
export const importInput = z.object({
  language: languageSchema.optional(),
  studyId: z.uuid(),
  requestId: z.uuid(),
  externalId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(3).max(160),
  prompt: z
    .string()
    .trim()
    .min(3)
    .max(2000)
    .default("External interview transcript"),
  transcript: z.string().trim().min(10).max(12000),
  permissionConfirmed: z.literal(true),
  transcriptReviewed: z.literal(true),
});
export type LibraryHit = {
  recordingSection?: import("./recording-sections").ReviewedRecordingSection;
  semanticChunkId?: string;
  semanticStart?: number;
  semanticEnd?: number;
  language?: Language;
  studyId: string;
  studyTitle: string;
  interviewId: string;
  turnId: string;
  prompt: string;
  quote: string;
  source: "external" | "interview";
  sourceTitle: string;
  externalId: string;
  revisionId: string;
  conceptId?: string;
  attributes: Record<string, string>;
};
export type LibraryFilter = {
  collectionId?: string;
  studyIds: string[];
  query: string;
  attribute?: { key: string; value: string };
};
export type LibraryCitation = {
  recordingSection?: import("./recording-sections").ReviewedRecordingSection;
  studyId: string;
  interviewId: string;
  turnId: string;
  quote: string;
};
export const libraryFilter = z.object({
  collectionId: z.uuid().optional(),
  studyIds: z.array(z.uuid()).max(100).default([]),
  query: z.string().trim().max(1000).default(""),
  attribute: z
    .object({ key: z.string().min(1).max(60), value: z.string().max(500) })
    .optional(),
});
export const libraryAnswer = z.object({
  answer: z.string().max(6000),
  citations: z
    .array(
      z.object({
        studyId: z.string(),
        interviewId: z.string(),
        turnId: z.string(),
        quote: z.string().min(3).max(6000),
      }),
    )
    .max(20),
});
const stop = new Set(
  "a an and are as at be been by can did do does for from had has have how i in into is it its me of on or our so that the their them there these they this to us was we were what when where which who why will with would you your learned across studies research about all tell".split(
    " ",
  ),
);
export function queryTerms(query: string) {
  return [
    ...new Set(
      (query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
        (t) => t.length > 1 && !stop.has(t),
      ),
    ),
  ].slice(0, 25);
}
export function rankEvidence(hits: LibraryHit[], query: string, limit = 50) {
  const terms = queryTerms(query);
  return hits
    .map((h, index) => {
      const answer = h.quote.toLocaleLowerCase(),
        context = (
          h.prompt +
          " " +
          h.studyTitle +
          " " +
          h.sourceTitle +
          " " +
          (h.recordingSection?.speaker || "")
        ).toLocaleLowerCase();
      return {
        h,
        index,
        score: terms.reduce(
          (s, t) =>
            s + (answer.includes(t) ? 3 : 0) + (context.includes(t) ? 1 : 0),
          0,
        ),
      };
    })
    .filter((x) => !terms.length || x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.h);
}
export function excerpt(text: string, query: string, size = 600) {
  if (text.length <= size) return text;
  const lower = text.toLocaleLowerCase(),
    matches = queryTerms(query)
      .map((t) => lower.indexOf(t))
      .filter((n) => n >= 0);
  const at = matches.length ? Math.max(0, Math.min(...matches) - 100) : 0;
  return text.slice(at, at + size);
}
// RFC 4180 fields, including escaped quotes, CRLF and quoted newlines.
export function parseAttributeCsv(input: string) {
  if (input.length > 120000)
    throw new Error("CSV is too large (120,000 characters maximum).");
  const text = input.replace(/^\uFEFF/, ""),
    rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  function cell() {
    row.push(field);
    field = "";
    closed = false;
  }
  function end() {
    cell();
    if (row.some((v) => v.length)) rows.push(row);
    row = [];
    if (rows.length > 201) throw new Error("Use at most 200 data rows.");
  }
  for (let n = 0; n < text.length; n++) {
    const c = text[n];
    if (quoted) {
      if (c === '"') {
        if (text[n + 1] === '"') {
          field += '"';
          n++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === ",") {
      cell();
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[n + 1] === "\n") n++;
      end();
      continue;
    }
    if (closed) throw new Error("Unexpected text after a quoted field.");
    if (c === '"') {
      if (field) throw new Error("A quote must begin a field.");
      quoted = true;
    } else field += c;
  }
  if (quoted) throw new Error("A quoted field is not closed.");
  if (field || row.length || closed) end();
  const headers = rows.shift()?.map((s) => s.trim()) || [];
  if (
    headers.length < 2 ||
    headers.length > 21 ||
    new Set(headers).size !== headers.length
  )
    throw new Error("Use one identifier and 1–20 unique attribute columns.");
  if (!["response_id", "external_id"].includes(headers[0]))
    throw new Error("The first column must be response_id or external_id.");
  const keys = headers.slice(1);
  if (
    keys.some(
      (k) =>
        !/^[A-Za-z][A-Za-z0-9_ -]{0,59}$/.test(k) ||
        [
          "__proto__",
          "prototype",
          "constructor",
          "response_id",
          "external_id",
        ].includes(k),
    )
  )
    throw new Error(
      "Attribute names must start with a letter and use at most 60 letters, digits, spaces, hyphens or underscores.",
    );
  if (!rows.length) throw new Error("Add at least one data row.");
  return {
    identifier: headers[0],
    keys,
    rows: rows.map((values, n) => ({
      line: n + 2,
      identifier: values[0]?.trim() || "",
      attributes: Object.fromEntries(
        keys.map((k, i) => [k, values[i + 1] || ""]),
      ),
      error:
        values.length !== headers.length
          ? "Column count does not match header."
          : values.some((v) => v.length > 500)
            ? "Values must be at most 500 characters."
            : "",
    })),
  };
}

export function verifiedLibraryAnswer(
  output: unknown,
  evidence: LibraryHit[],
  language: Language = "en",
) {
  const result = libraryAnswer.parse(output);
  if (
    result.citations.some(
      (c) =>
        !evidence.some(
          (h) =>
            h.studyId === c.studyId &&
            h.interviewId === c.interviewId &&
            h.turnId === c.turnId &&
            h.quote.includes(c.quote),
        ),
    )
  )
    throw new Error("INVALID_CITATION");
  if (!result.citations.length) result.answer = insufficientEvidence(language);
  return result;
}
