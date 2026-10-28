import type { LibraryAttachmentHit } from "./library-attachments";
import type { Language } from "./localization";
export type SavedTranscriptSource = Omit<
  LibraryAttachmentHit,
  "format" | "kind" | "locator"
> & {
  format: "transcript";
  kind: "transcript";
  locator: { unit: "turn"; number: number; start: number; end: number };
  transcript: {
    recordingSection?: import("./recording-sections").ReviewedRecordingSection;
    source: "external" | "interview";
    language: Language;
    prompt: string;
  };
};
export const transcriptAnswerLabels = {
  en: {
    title: "Saved transcript answers",
    turn: "Turn",
    source: "Transcript excerpt",
    notice:
      "Save a cited transcript answer as a private draft. Review the interpretation, exact quotes, speaker labels and full responses before approving exports or adding it to a brief. Source changes remove the complete saved answer and dependent briefs, including their histories and commentary. Originals and earlier reviews stay private. Copied downloads cannot be recalled.",
    warning:
      "Researcher-reviewed interpretation of transcript excerpts. Speaker labels and section timings may carry a researcher review; they do not authenticate identities or establish word-level alignment. Exact quotation does not establish interpretation quality, prevalence or comparable samples.",
  },
  es: {
    title: "Respuestas guardadas de transcripciones",
    turn: "Turno",
    source: "Extracto de transcripción",
    notice:
      "Guarde una respuesta citada como borrador privado. Revise la interpretación, citas exactas, etiquetas de hablante y respuestas completas antes de aprobar exportaciones o incluirla en un informe. Los cambios de fuentes eliminan la respuesta y los informes dependientes, incluidos historiales y comentarios. Los originales y revisiones anteriores siguen privados. No se pueden recuperar descargas copiadas.",
    warning:
      "Interpretación revisada de extractos de transcripciones. Las etiquetas y tiempos pueden tener revisión de investigación; no autentican identidades ni alinean palabras. Una cita exacta no establece calidad de interpretación, prevalencia ni comparabilidad de muestras.",
  },
  fr: {
    title: "Réponses enregistrées des transcriptions",
    turn: "Tour",
    source: "Extrait de transcription",
    notice:
      "Enregistrez une réponse citée comme brouillon privé. Vérifiez l’interprétation, les citations exactes, les locuteurs et les réponses complètes avant d’approuver l’exportation ou de l’inclure dans une note. Les changements de sources suppriment la réponse et les notes dépendantes, historiques et commentaires compris. Les originaux et anciennes révisions restent privés. Les téléchargements copiés ne peuvent être rappelés.",
    warning:
      "Interprétation révisée d’extraits de transcriptions. Les locuteurs et intervalles peuvent porter une révision humaine ; ils n’authentifient pas les identités et ne synchronisent pas les mots. Une citation exacte n’établit ni la qualité de l’interprétation, ni la prévalence, ni la comparabilité des échantillons.",
  },
};
