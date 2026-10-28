import { z } from "zod";
export const recordingSection = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    speaker: z.string().trim().max(80),
    startMs: z.number().int().min(0).nullable(),
    endMs: z.number().int().positive().nullable(),
  })
  .strict();
export type RecordingSection = z.infer<typeof recordingSection>;
export type ReviewedRecordingSection = {
  mediaId: string;
  mime: string;
  speaker: string;
  startMs: number;
  endMs: number;
  reviewedAt: string;
  reviewedBy: { id: string; name: string };
};
export function validateRecordingSections(
  text: string,
  sections: RecordingSection[] | undefined,
  durationMs: number,
  reviewed: boolean,
) {
  if (!sections) return;
  if (!sections.length || sections.length > 200)
    throw Error("RECORDING_SECTIONS_INVALID");
  let offset = 0,
    previousEnd = 0;
  for (const s of sections) {
    if (
      s.start !== offset ||
      s.end <= s.start ||
      s.end > text.length ||
      s.end - s.start > 12000 ||
      !text.slice(s.start, s.end).trim() ||
      (s.end < text.length && /[\uD800-\uDBFF]/.test(text[s.end - 1]))
    )
      throw Error("RECORDING_SECTIONS_INVALID");
    if (
      (s.startMs !== null && s.startMs >= durationMs) ||
      (s.endMs !== null && s.endMs > durationMs) ||
      (s.startMs !== null && s.endMs !== null && s.endMs <= s.startMs)
    )
      throw Error("RECORDING_SECTIONS_INVALID");
    if (
      reviewed &&
      (!s.speaker ||
        s.startMs === null ||
        s.endMs === null ||
        s.startMs < previousEnd)
    )
      throw Error("RECORDING_SECTIONS_INVALID");
    offset = s.end;
    previousEnd = s.endMs ?? 0;
  }
  if (offset !== text.length) throw Error("RECORDING_SECTIONS_INVALID");
}
export function initialRecordingSections(text: string): RecordingSection[] {
  const sections: RecordingSection[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 10000, text.length);
    const paragraph = text.indexOf("\n\n", start);
    if (
      sections.length + Math.ceil((text.length - start) / 10000) < 200 &&
      paragraph >= start &&
      paragraph + 2 < end &&
      text.slice(start, paragraph).trim()
    )
      end = paragraph + 2;
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    sections.push({ start, end, speaker: "", startMs: null, endMs: null });
    start = end;
  }
  return sections;
}
export function recordingRangeLabel(
  r: Pick<ReviewedRecordingSection, "speaker" | "startMs" | "endMs">,
) {
  const time = (ms: number) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
  return `${r.speaker} · ${time(r.startMs)}–${time(r.endMs)}`;
}
export const sectionLabels = {
  en: {
    title: "Speaker sections",
    notice:
      "Split the reviewed text into speaker sections. Listen to the recording, label each speaker and check each time range before attesting review. These labels reflect your review, not authenticated identities. Text edits clear the sections. Times describe whole sections, not word-level alignment.",
    create: "Create speaker sections",
    speaker: "Speaker label",
    start: "Start (seconds)",
    end: "End (seconds)",
    split: "Split at selected cursor",
    merge: "Merge with next section",
    play: "Play reviewed section",
    reviewer: "Section reviewed by",
    remove: "Remove speaker sections",
    text: "Section text",
    warning:
      "Review every speaker label and recording range before saving as reviewed.",
  },
  es: {
    title: "Secciones por hablante",
    notice:
      "Divida el texto en secciones. Escuche la grabación, etiquete a cada hablante y compruebe los tiempos antes de confirmar la revisión. Son etiquetas revisadas, no identidades autenticadas. Editar el texto elimina las secciones. Los tiempos corresponden a secciones completas, no a palabras.",
    create: "Crear secciones por hablante",
    speaker: "Etiqueta de hablante",
    start: "Inicio (segundos)",
    end: "Fin (segundos)",
    split: "Dividir en el cursor seleccionado",
    merge: "Unir con la siguiente sección",
    play: "Reproducir sección revisada",
    reviewer: "Sección revisada por",
    remove: "Quitar secciones por hablante",
    text: "Texto de la sección",
    warning: "Revise cada hablante e intervalo antes de guardar como revisado.",
  },
  fr: {
    title: "Sections par locuteur",
    notice:
      "Divisez le texte en sections. Écoutez l’enregistrement, nommez les locuteurs et vérifiez chaque intervalle avant d’attester la révision. Ces étiquettes ne sont pas des identités authentifiées. Modifier le texte efface les sections. Les temps concernent des sections entières, pas des mots.",
    create: "Créer les sections par locuteur",
    speaker: "Étiquette du locuteur",
    start: "Début (secondes)",
    end: "Fin (secondes)",
    split: "Diviser au curseur sélectionné",
    merge: "Fusionner avec la section suivante",
    play: "Lire la section révisée",
    reviewer: "Section vérifiée par",
    remove: "Supprimer les sections par locuteur",
    text: "Texte de la section",
    warning:
      "Vérifiez les locuteurs et les intervalles avant d’enregistrer comme révisé.",
  },
};

export const recordingExportHeaders = [
  "recording_speaker",
  "recording_start_ms",
  "recording_end_ms",
  "recording_url",
  "recording_reviewer",
  "recording_reviewed_at",
];
export function recordingExportFields(
  r: ReviewedRecordingSection | undefined,
  origin: string,
) {
  return r
    ? [
        r.speaker,
        String(r.startMs),
        String(r.endMs),
        `${origin}/api/recordings/${r.mediaId}#t=${r.startMs / 1000},${r.endMs / 1000}`,
        r.reviewedBy.name,
        r.reviewedAt,
      ]
    : ["", "", "", "", "", ""];
}
