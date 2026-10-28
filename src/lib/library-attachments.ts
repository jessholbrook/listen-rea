import type { SemanticRetrieval } from "./library-semantic";
import { z } from "zod";
import { libraryFilter, queryTerms } from "./library";
import { languageSchema, type Language } from "./localization";
export const attachmentFormats = ["image", "pdf", "docx", "pptx"] as const;
export const attachmentKinds = ["passage", "observation"] as const;
export type AttachmentFormat = (typeof attachmentFormats)[number];
export type AttachmentKind = (typeof attachmentKinds)[number];
export const libraryAttachmentFilter = libraryFilter
  .extend({
    formats: z
      .array(z.enum(attachmentFormats))
      .min(1)
      .max(4)
      .default([...attachmentFormats]),
    kinds: z
      .array(z.enum(attachmentKinds))
      .min(1)
      .max(2)
      .default([...attachmentKinds]),
  })
  .strict();
export type LibraryAttachmentFilter = z.infer<typeof libraryAttachmentFilter>;
export type LibraryAttachmentHit = {
  id: string;
  studyId: string;
  studyTitle: string;
  interviewId: string;
  turnId: string;
  revisionId: string;
  conceptId?: string;
  attachmentId: string;
  format: AttachmentFormat;
  kind: AttachmentKind;
  version: number;
  text: string;
  field?: "notes" | "correction";
  locator?: {
    unit: "page" | "paragraph" | "slide";
    number: number;
    start: number;
    end: number;
  };
  ocr?: boolean;
  grounding?: string;
  reviewerName: string;
  reviewedAt: string;
  attributes: Record<string, string>;
};
export const libraryAttachmentQuestion = libraryAttachmentFilter
  .extend({
    question: z.string().trim().min(5).max(2000),
    language: languageSchema.default("en"),
  })
  .strict();
export const libraryAttachmentOutput = z
  .object({
    answer: z.string().trim().min(3).max(6000),
    citations: z
      .array(
        z
          .object({
            evidenceId: z.string().regex(/^[a-f0-9]{64}$/),
            quote: z
              .string()
              .min(3)
              .max(2000)
              .refine((q) => /\S/.test(q)),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type LibraryAttachmentAnswer = {
  answer: string;
  question: string;
  language: Language;
  citations: {
    evidenceId: string;
    quote: string;
    source: LibraryAttachmentHit;
  }[];
  searchedStudies: number;
  evidenceCount: number;
  generated: boolean;
  savedAnswerId?: string;
  retrieval?: SemanticRetrieval;
  model?: string;
  promptVersion?: string;
  generatedAt?: string;
};
export function rankLibraryAttachments(
  hits: LibraryAttachmentHit[],
  query: string,
  limit = 50,
) {
  const terms = queryTerms(query);
  return hits
    .map((hit, index) => ({
      hit,
      index,
      score: terms.reduce(
        (score, t) =>
          score +
          (hit.text.toLocaleLowerCase().includes(t) ? 3 : 0) +
          (hit.studyTitle.toLocaleLowerCase().includes(t) ? 1 : 0),
        0,
      ),
    }))
    .filter((r) => !terms.length || r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.hit);
}
export function attachmentQuestionEvidence(
  hits: LibraryAttachmentHit[],
  query: string,
  question: string,
) {
  let budget = 40000;
  const selected: LibraryAttachmentHit[] = [];
  for (const h of rankLibraryAttachments(
    rankLibraryAttachments(hits, query, 5000),
    question,
    5000,
  )) {
    if (h.text.length < 3 || h.text.length > 2000 || h.text.length > budget)
      continue;
    budget -= h.text.length;
    selected.push(h);
    if (selected.length === 30) break;
  }
  return selected;
}
export function validateLibraryAttachmentAnswer(
  output: unknown,
  evidence: LibraryAttachmentHit[],
  language: Language = "en",
) {
  const parsed = libraryAttachmentOutput.parse(output);
  for (const c of parsed.citations)
    if (!evidence.some((h) => h.id === c.evidenceId && h.text === c.quote))
      throw new Error("INVALID_CITATION");
  if (!parsed.citations.length)
    parsed.answer = libraryAttachmentLabels[language].insufficient;
  return parsed;
}
export const libraryAttachmentLabels = {
  en: {
    title: "Attachment evidence",
    notice:
      "Search explicitly included verified excerpts and researcher observations across studies. These are separate from participant quotations and independently verified facts. Keyword retrieval can miss relevant evidence.",
    payload:
      "Ask sends only matching included text, evidence/study/revision references, source type, location and grounding context to OpenAI. Separate file, unselected-text, participant-answer, original-question, name, attribute and private-history fields are excluded. Included text can contain personal details; review it before asking. Answers are temporary unless you choose Ask & save draft; check every source.",
    studies: "Studies",
    all: "All permitted studies",
    formats: "File types",
    kinds: "Evidence types",
    passage: "Verified excerpt",
    observation: "Researcher observation",
    query: "Evidence keywords",
    question: "Your attachment evidence question",
    search: "Search attachment evidence",
    ask: "Ask about attachment evidence",
    clear: "Clear attachment results",
    language: "Answer language",
    attributeKey: "Attribute name",
    attributeValue: "Exact attribute value",
    source: "Open current evidence",
    response: "Open response",
    original: "Original source context",
    review: "Review / verification",
    notes: "Researcher notes",
    correction: "Researcher correction",
    page: "Page",
    paragraph: "Prepared paragraph",
    slide: "Slide",
    characters: "Selected characters",
    ocr: "Researcher-verified OCR",
    empty: "No matching included attachment evidence.",
    insufficient:
      "The included attachment evidence does not provide enough support to answer this question.",
    results: "Matching evidence records",
    searched: "Studies searched",
    considered: "Evidence records supplied",
    working: "Working…",
    close: "Close evidence",
    refresh:
      "Refresh library to load current studies. Opening evidence rechecks its current inclusion; changing filters clears displayed results.",
  },
  es: {
    title: "Evidencia de archivos adjuntos",
    notice:
      "Busque extractos verificados y observaciones del investigador incluidos explícitamente entre estudios. Son distintos de las citas de participantes y los hechos verificados independientemente. La búsqueda por palabras puede omitir evidencia relevante.",
    payload:
      "La pregunta envía a OpenAI solo el texto incluido coincidente, referencias de evidencia/estudio/revisión, tipo, ubicación y contexto de fundamentación. Se excluyen los campos separados de archivos completos, texto no seleccionado, respuestas, preguntas originales, nombres, atributos e historial privado. El texto incluido puede contener datos personales; revíselo antes de preguntar. Las respuestas son temporales salvo si guarda un borrador; revise cada fuente.",
    studies: "Estudios",
    all: "Todos los estudios permitidos",
    formats: "Tipos de archivo",
    kinds: "Tipos de evidencia",
    passage: "Extracto verificado",
    observation: "Observación del investigador",
    query: "Palabras de evidencia",
    question: "Su pregunta sobre evidencia adjunta",
    search: "Buscar evidencia adjunta",
    ask: "Preguntar sobre evidencia adjunta",
    clear: "Borrar resultados adjuntos",
    language: "Idioma de respuesta",
    attributeKey: "Nombre del atributo",
    attributeValue: "Valor exacto del atributo",
    source: "Abrir evidencia actual",
    response: "Abrir respuesta",
    original: "Contexto de origen",
    review: "Revisión / verificación",
    notes: "Notas del investigador",
    correction: "Corrección del investigador",
    page: "Página",
    paragraph: "Párrafo preparado",
    slide: "Diapositiva",
    characters: "Caracteres seleccionados",
    ocr: "OCR verificado por el investigador",
    empty: "No hay evidencia adjunta incluida que coincida.",
    insufficient:
      "La evidencia adjunta incluida no ofrece suficiente respaldo para responder esta pregunta.",
    results: "Registros coincidentes",
    searched: "Estudios consultados",
    considered: "Registros enviados",
    working: "Procesando…",
    close: "Cerrar evidencia",
    refresh:
      "Actualice la biblioteca para cargar los estudios actuales. Abrir evidencia comprueba su inclusión actual; cambiar filtros borra los resultados mostrados.",
  },
  fr: {
    title: "Éléments des pièces jointes",
    notice:
      "Recherchez les extraits vérifiés et observations de recherche explicitement inclus entre études. Ils restent distincts des citations de participants et des faits vérifiés indépendamment. La recherche par mots peut omettre des éléments pertinents.",
    payload:
      "La question transmet à OpenAI uniquement le texte inclus correspondant, les références d’élément/étude/révision, le type, l’emplacement et le contexte d’ancrage. Les champs séparés de fichiers complets, texte non sélectionné, réponses, questions initiales, noms, attributs et historique privé sont exclus. Le texte inclus peut contenir des données personnelles ; relisez-le avant d’interroger. Les réponses sont temporaires sauf si vous enregistrez un brouillon ; vérifiez chaque source.",
    studies: "Études",
    all: "Toutes les études autorisées",
    formats: "Types de fichiers",
    kinds: "Types d’éléments",
    passage: "Extrait vérifié",
    observation: "Observation de recherche",
    query: "Mots-clés des éléments",
    question: "Votre question sur les éléments joints",
    search: "Rechercher les éléments joints",
    ask: "Interroger les éléments joints",
    clear: "Effacer les résultats joints",
    language: "Langue de réponse",
    attributeKey: "Nom de l’attribut",
    attributeValue: "Valeur exacte de l’attribut",
    source: "Ouvrir l’élément actuel",
    response: "Ouvrir la réponse",
    original: "Contexte de la source",
    review: "Révision / vérification",
    notes: "Notes de recherche",
    correction: "Correction du chercheur",
    page: "Page",
    paragraph: "Paragraphe préparé",
    slide: "Diapositive",
    characters: "Caractères sélectionnés",
    ocr: "OCR vérifié par un chercheur",
    empty: "Aucun élément joint inclus ne correspond.",
    insufficient:
      "Les éléments joints inclus ne fournissent pas assez de preuves pour répondre à cette question.",
    results: "Éléments correspondants",
    searched: "Études consultées",
    considered: "Éléments transmis",
    working: "En cours…",
    close: "Fermer l’élément",
    refresh:
      "Actualisez la bibliothèque pour charger les études actuelles. L’ouverture vérifie l’inclusion actuelle ; changer les filtres efface les résultats affichés.",
  },
};
