import { z } from "zod";
export const pptxMime =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const pptxSnapshot = z
  .object({
    version: z.literal(1),
    slides: z.array(z.string().max(200000)).min(1).max(100),
  })
  .strict()
  .refine(
    (s) => s.slides.some((v) => v.trim()) && s.slides.join("").length <= 200000,
  );
export type PPTXSnapshot = z.infer<typeof pptxSnapshot>;
export type ParticipantPPTX = {
  aiPermission?: {
    version: string;
    provider: "OpenAI";
    text: string;
    language: import("./localization").Language;
    grantedAt: string;
  };

  id: string;
  description: string;
  slides: number;
  characters: number;
  bytes: number;
  uploadedAt: string;
};
export const pptxLabels = {
  en: {
    title: "Optional PPTX attachment",
    notice:
      "Share prepared slide text from your PPTX. Speaker notes, images, comments, master text, hidden slides/shapes and link destinations are omitted. Empty slides keep their numbers. The original file is not retained. Remove personal details first. Uploading does not send slide text to AI. Researchers can select and verify excerpts for AI synthesis and questions.",
    choose: "Choose a PPTX (up to 3 MB)",
    description: "Describe your PPTX",
    consent:
      "I agree to share the prepared PPTX text with the research team for this study.",
    upload: "Upload PPTX",
    uploading: "Preparing PPTX…",
    remove: "Remove attached PPTX",
    pending: "This PPTX text will be attached when you submit your answer.",
    view: "View PPTX text",
    hide: "Hide PPTX text",
    download: "Download prepared text",
    slide: "Slide",
    snapshot: "Prepared PPTX text",
    optional:
      "You can continue without a PPTX. A selected file is shared only after you choose Upload PPTX.",
  },
  es: {
    title: "Archivo PPTX opcional",
    notice:
      "Comparte texto preparado de las diapositivas de tu PPTX. Se omiten notas del orador, imágenes, comentarios, texto maestro, diapositivas o formas ocultas y destinos de enlaces. Las diapositivas vacías conservan su número. El original no se conserva. Elimina los datos personales. La carga no envía texto a la IA. Los investigadores pueden seleccionar y verificar extractos para síntesis y preguntas con IA.",
    choose: "Elige un PPTX (hasta 3 MB)",
    description: "Describe tu PPTX",
    consent:
      "Acepto compartir el texto preparado del PPTX con el equipo investigador para este estudio.",
    upload: "Subir PPTX",
    uploading: "Preparando PPTX…",
    remove: "Quitar PPTX adjunto",
    pending: "Este texto PPTX se adjuntará al enviar tu respuesta.",
    view: "Ver texto del PPTX",
    hide: "Ocultar texto del PPTX",
    download: "Descargar texto preparado",
    slide: "Diapositiva",
    snapshot: "Texto PPTX preparado",
    optional:
      "Puedes continuar sin PPTX. El archivo elegido se comparte solo al pulsar Subir PPTX.",
  },
  fr: {
    title: "Pièce jointe PPTX facultative",
    notice:
      "Partagez le texte préparé des diapositives de votre PPTX. Notes, images, commentaires, texte des masques, diapositives ou formes masquées et destinations des liens sont omis. Les diapositives vides gardent leur numéro. L’original n’est pas conservé. Supprimez les données personnelles. L’envoi ne transmet aucun texte à l’IA. Les chercheurs peuvent sélectionner et vérifier des extraits pour des synthèses et questions par IA.",
    choose: "Choisir un PPTX (3 Mo maximum)",
    description: "Décrivez votre PPTX",
    consent:
      "J’accepte de partager le texte préparé du PPTX avec l’équipe de recherche pour cette étude.",
    upload: "Envoyer le PPTX",
    uploading: "Préparation du PPTX…",
    remove: "Retirer le PPTX joint",
    pending: "Ce texte PPTX sera joint lorsque vous enverrez votre réponse.",
    view: "Voir le texte PPTX",
    hide: "Masquer le texte PPTX",
    download: "Télécharger le texte préparé",
    slide: "Diapositive",
    snapshot: "Texte PPTX préparé",
    optional:
      "Vous pouvez continuer sans PPTX. Le fichier sélectionné est partagé uniquement après avoir choisi Envoyer le PPTX.",
  },
};

export type PPTXReview = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnId: string;
  source: string;
  history: {
    version: number;
    quality:
      "usable" | "unclear" | "irrelevant" | "privacy_concern" | "uncertain";
    includeInReports?: boolean;
    grounding?: "supported" | "unsupported" | "uncertain" | "not_applicable";
    correction?: string;
    probeSource?: string;
    originalProbe?: PPTXProbe;
    notes: string;
    at: string;
    reviewer: { id: string; name: string };
  }[];
};

export type PPTXProbe = {
  pptxId: string;
  permissionVersion: string;
  promptVersion: string;
  model: string;
  generatedAt: string;
  status: "asked" | "none" | "rejected" | "unavailable";
  probe?: string;
  slide?: number;
  quote?: string;
  rejectionReason?: NonNullable<
    ReturnType<typeof import("./participant-pptx-ai").pptxProbeRejectionReason>
  >;
  snapshotSha256?: string;
  contextTruncated?: boolean;
  slidesConsidered?: number[];
};

export type PPTXReviewResult = {
  source: string;
  probeSource: string;
  probe?: PPTXProbe;
  asked: boolean;
  version: number;
  history: PPTXReview["history"];
};
