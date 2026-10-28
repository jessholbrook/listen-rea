import { collectionScope } from "./library-collection-scope";
import { list, hash } from "./db";
import { fail } from "./http";
import { responseLanguage } from "./localization";
import type { Actor, Study, Interview } from "./domain";
import type { LibraryFilter, LibraryHit } from "./library";
export async function transcriptLibraryCorpus(a: Actor, filter: LibraryFilter) {
  const collection = await collectionScope(a, filter.collectionId);
  const all = await list<Study>("study", a.workspaceId),
    selectedStudies = filter.studyIds.length
      ? all.filter((s) => filter.studyIds.includes(s.id))
      : all;
  if (filter.studyIds.some((id) => !all.some((s) => s.id === id)))
    fail(404, "A selected study is unavailable.");
  const responses = (await list<Interview>("interview", a.workspaceId)).filter(
    (i) =>
      (!collection || collection.interviewIds.includes(i.id)) &&
      selectedStudies.some((s) => s.id === i.studyId) &&
      !i.preview &&
      !i.excluded &&
      i.status === "complete" &&
      (!filter.attribute ||
        i.attributes[filter.attribute.key] === filter.attribute.value),
  );
  const studies = collection
    ? selectedStudies.filter((s) => responses.some((i) => i.studyId === s.id))
    : selectedStudies;
  const hits: LibraryHit[] = responses.flatMap((i) =>
    i.turns
      .filter((t) => t.answer.trim())
      .map((t) => ({
        studyId: i.studyId,
        studyTitle: studies.find((s) => s.id === i.studyId)!.title,
        interviewId: i.id,
        turnId: t.id,
        prompt: t.prompt,
        quote: t.answer,
        language: responseLanguage(i),
        source: i.origin ? "external" : "interview",
        sourceTitle: i.origin?.title || "Echo Lab interview",
        externalId: i.origin?.externalId || "",
        revisionId: i.revisionId,
        conceptId: t.conceptId,
        attributes: i.attributes,
        ...(t.recordingSection ? { recordingSection: t.recordingSection } : {}),
      })),
  );
  const fingerprint = hash(
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
      studies: studies.map((s) => [s.id, s.dataVersion, s.title]),
      responses: responses.map((i) => [i.id, i.version, i.attributes, i.turns]),
    }),
  );
  return { studies, responses, hits, fingerprint };
}
