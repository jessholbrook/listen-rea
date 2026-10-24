import type { LibraryHit } from "./library";
import type { LibraryAttachmentHit } from "./library-attachments";
export const semanticModel = "text-embedding-3-small";
export const semanticDimensions = 256;
export const semanticVersion = "2026-10-21-library-semantic-v1";
export type SemanticScope = "transcripts" | "attachments";
export type SemanticItem = {
  id: string;
  text: string;
  fingerprint: string;
  ref: {
    id: string;
    studyId: string;
    interviewId: string;
    turnId: string;
    attachmentId?: string;
    format: string;
    kind: string;
  };
  hit: LibraryHit | LibraryAttachmentHit;
};
export type LibraryEmbedding = {
  id: string;
  workspaceId: string;
  scope: SemanticScope;
  sourceId: string;
  fingerprint: string;
  model: string;
  dimensions: number;
  version: string;
  vector: number[];
  createdAt: string;
  dependencies: SemanticItem["ref"][];
};
export type SemanticCoverage = {
  scope: SemanticScope;
  indexed: number;
  eligible: number;
  missing: number;
  model: string;
  dimensions: number;
  version: string;
  partial: boolean;
  canEdit: boolean;
};
export type SemanticRetrieval = {
  mode: "semantic";
  strategy: "hybrid-rrf-v1";
  model: string;
  version: string;
  indexed: number;
  eligible: number;
  partial: boolean;
};
export function transcriptChunks(text: string) {
  const chunks: { text: string; start: number; end: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + 1500);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + 1000) end = boundary;
    }
    const value = text.slice(start, end);
    if (value.trim().length >= 3) chunks.push({ text: value, start, end });
    if (end === text.length) break;
    start = Math.max(start + 1, end - 150);
  }
  return chunks;
}
export function validVector(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === semanticDimensions &&
    v.every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1,
    ) &&
    v.reduce((n, x) => n + x * x, 0) > 1e-12
  );
}
export function cosine(a: number[], b: number[]) {
  if (!validVector(a) || !validVector(b)) throw Error("INVALID_EMBEDDING");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}
export function embeddingBatch(items: SemanticItem[]) {
  const result: SemanticItem[] = [];
  let remaining = 40000;
  for (const h of items) {
    if (
      h.text.length > 2000 ||
      h.text.trim().length < 3 ||
      h.text.length > remaining
    )
      continue;
    result.push(h);
    remaining -= h.text.length;
    if (result.length === 100) break;
  }
  return result;
}
export function hybridNeighbors(
  items: SemanticItem[],
  rows: LibraryEmbedding[],
  query: number[],
  keywordIds: string[],
  limit = 50,
) {
  const available = new Map(
    rows
      .filter(
        (r) =>
          r.model === semanticModel &&
          r.version === semanticVersion &&
          r.dimensions === semanticDimensions &&
          validVector(r.vector),
      )
      .map((r) => [r.sourceId, r]),
  );
  const neighbors = items
    .filter((h) => available.get(h.id)?.fingerprint === h.fingerprint)
    .map((h, i) => ({
      h,
      i,
      score: cosine(available.get(h.id)!.vector, query),
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const lexical = new Map(keywordIds.map((id, i) => [id, i]));
  return neighbors
    .map((n, i) => ({
      ...n,
      score:
        1 / (60 + i + 1) +
        (lexical.has(n.h.id) ? 1 / (60 + lexical.get(n.h.id)! + 1) : 0),
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.h);
}
export const semanticLabels = {
  en: {
    title: "Meaning-based retrieval",
    method: "Search method",
    keyword: "Keywords",
    semantic: "Meaning + keywords",
    notice:
      "Build a private index before searching by meaning. Indexing sends the selected eligible transcript excerpts or explicitly included attachment text to OpenAI. Query searches send your search/question text. Selected text may contain personal details. Full files and separate names, attributes, questions and private history are excluded from embedding requests. Stored vectors are private derived data; source changes remove them. Results combine meaning and keywords and may be irrelevant or incomplete; they are not confidence scores.",
    status: "Check index coverage",
    build: "Index next batch (up to 100 records)",
    clear: "Clear this workspace index",
    coverage: "Current indexed records",
    eligible: "Eligible records",
    partial:
      "Partial coverage: some eligible records are not indexed. Index another batch or narrow the filters.",
    empty: "No current indexed evidence. Build the selected index first.",
    ready: "Coverage is complete for these filters.",
    working: "Updating index…",
    cleared: "Workspace index cleared for this source type.",
    results: "Meaning + keyword retrieval",
    confirm:
      "Clear every indexed record of this source type in this workspace?",
    query: "Search terms",
    meta: "Similarity ranks relevance; it does not establish support, sample counts or research quality.",
  },
  es: {
    title: "Búsqueda por significado",
    method: "Método de búsqueda",
    keyword: "Palabras clave",
    semantic: "Significado y palabras",
    notice:
      "Cree un índice privado antes de buscar por significado. La indexación envía a OpenAI los extractos elegibles de transcripciones o el texto adjunto incluido explícitamente. Las búsquedas envían su consulta o pregunta. El texto puede contener datos personales. No se envían archivos completos ni campos separados de nombres, atributos, preguntas originales o historial privado. Los vectores son datos derivados privados y se eliminan al cambiar la fuente. Los resultados pueden ser irrelevantes o incompletos; no son puntuaciones de confianza.",
    status: "Comprobar cobertura del índice",
    build: "Indexar siguiente lote (hasta 100 registros)",
    clear: "Borrar este índice del equipo",
    coverage: "Registros actuales indexados",
    eligible: "Registros elegibles",
    partial:
      "Cobertura parcial: faltan registros elegibles. Indexe otro lote o limite los filtros.",
    empty:
      "No hay evidencia actual indexada. Cree primero el índice seleccionado.",
    ready: "La cobertura de estos filtros está completa.",
    working: "Actualizando índice…",
    cleared: "Índice del equipo borrado para este tipo de fuente.",
    results: "Búsqueda por significado y palabras",
    confirm:
      "¿Borrar todos los registros indexados de este tipo en este equipo?",
    query: "Términos de búsqueda",
    meta: "La similitud ordena la relevancia; no establece respaldo, recuentos ni calidad de investigación.",
  },
  fr: {
    title: "Recherche par sens",
    method: "Méthode de recherche",
    keyword: "Mots-clés",
    semantic: "Sens et mots-clés",
    notice:
      "Créez un index privé avant de rechercher par sens. L’indexation transmet à OpenAI les extraits de transcription admissibles ou le texte joint explicitement inclus. Les recherches transmettent votre requête ou question. Le texte peut contenir des données personnelles. Fichiers complets et champs séparés de noms, attributs, questions initiales et historique privé sont exclus des demandes de vecteurs. Les vecteurs sont des données dérivées privées, supprimées si la source change. Les résultats peuvent être non pertinents ou incomplets ; ils ne mesurent pas la confiance.",
    status: "Vérifier la couverture de l’index",
    build: "Indexer le lot suivant (100 éléments maximum)",
    clear: "Effacer cet index de l’équipe",
    coverage: "Éléments actuels indexés",
    eligible: "Éléments admissibles",
    partial:
      "Couverture partielle : des éléments admissibles ne sont pas indexés. Indexez un autre lot ou limitez les filtres.",
    empty: "Aucun élément actuel indexé. Créez d’abord l’index sélectionné.",
    ready: "La couverture est complète pour ces filtres.",
    working: "Mise à jour de l’index…",
    cleared: "Index de l’équipe effacé pour ce type de source.",
    results: "Recherche par sens et mots-clés",
    confirm: "Effacer tous les éléments indexés de ce type dans cette équipe ?",
    query: "Termes de recherche",
    meta: "La similarité classe la pertinence ; elle n’établit ni justification, ni décomptes, ni qualité de recherche.",
  },
};
