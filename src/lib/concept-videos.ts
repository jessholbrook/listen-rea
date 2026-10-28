export const conceptVideoMaxInput = 3 * 1024 * 1024;
export const conceptVideoMaxOutput = 8 * 1024 * 1024;
export const conceptVideoMaxMs = 60000;
export type ConceptVideo = {
  id: string;
  studyId: string;
  workspaceId: string;
  createdAt: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
  digest: string;
  sourceAssetId?: string;
  watermarkAssetId?: string;
  watermarkVersion?: string;
};
export function conceptVideoCopy(language: "en" | "es" | "fr" = "en") {
  return {
    en: { video: "Concept video", text: "Video text alternative" },
    es: { video: "Vídeo del concepto", text: "Alternativa textual del vídeo" },
    fr: {
      video: "Vidéo du concept",
      text: "Alternative textuelle de la vidéo",
    },
  }[language];
}
