import { z } from "zod";
export const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const docxSnapshot = z
  .object({
    version: z.literal(1),
    paragraphs: z.array(z.string().min(1).max(200000)).min(1).max(2000),
  })
  .strict()
  .refine((s) => s.paragraphs.join("").length <= 200000);
export type DOCXSnapshot = z.infer<typeof docxSnapshot>;
export type ParticipantDOCX = {
  aiPermission?: {
    version: string;
    provider: "OpenAI";
    text: string;
    language: import("./localization").Language;
    grantedAt: string;
  };
  id: string;
  description: string;
  paragraphs: number;
  characters: number;
  bytes: number;
  uploadedAt: string;
};
export type DOCXReview = {
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
    originalProbe?: DOCXProbe;
    notes: string;
    at: string;
    reviewer: { id: string; name: string };
  }[];
};
export const docxLabels = {
  en: {
    title: "Optional DOCX attachment",
    notice:
      "Share a prepared text snapshot of your DOCX. Images, links, formatting, comments and hidden or deleted text are omitted. The original file is not retained. Remove personal details first. No document text is sent to AI in this step.",
    choose: "Choose a DOCX (up to 3 MB)",
    description: "Describe your DOCX",
    consent:
      "I agree to share the prepared DOCX text with the research team for this study.",
    upload: "Upload DOCX",
    uploading: "Preparing DOCX…",
    remove: "Remove attached DOCX",
    pending: "This DOCX text will be attached when you submit your answer.",
    view: "View DOCX text",
    hide: "Hide DOCX text",
    download: "Download prepared text",
    paragraph: "Paragraph",
    snapshot: "Prepared DOCX text",
    optional:
      "You can continue without a DOCX. A selected file is shared only after you choose Upload DOCX.",
  },
  es: {
    title: "Archivo DOCX opcional",
    notice:
      "Comparte una copia de texto preparada de tu DOCX. Se omiten imágenes, enlaces, formato, comentarios y texto oculto o eliminado. El archivo original no se conserva. Elimina primero los datos personales. Este paso no envía el texto a la IA.",
    choose: "Elige un DOCX (hasta 3 MB)",
    description: "Describe tu DOCX",
    consent:
      "Acepto compartir el texto preparado del DOCX con el equipo investigador para este estudio.",
    upload: "Subir DOCX",
    uploading: "Preparando DOCX…",
    remove: "Quitar DOCX adjunto",
    pending: "Este texto DOCX se adjuntará al enviar tu respuesta.",
    view: "Ver texto del DOCX",
    hide: "Ocultar texto del DOCX",
    download: "Descargar texto preparado",
    paragraph: "Párrafo",
    snapshot: "Texto DOCX preparado",
    optional:
      "Puedes continuar sin DOCX. El archivo elegido se comparte solo al pulsar Subir DOCX.",
  },
  fr: {
    title: "Pièce jointe DOCX facultative",
    notice:
      "Partagez une copie texte préparée de votre DOCX. Images, liens, mise en forme, commentaires et texte masqué ou supprimé sont omis. Le fichier original n’est pas conservé. Supprimez d’abord les données personnelles. Cette étape n’envoie pas le texte à l’IA.",
    choose: "Choisir un DOCX (3 Mo maximum)",
    description: "Décrivez votre DOCX",
    consent:
      "J’accepte de partager le texte préparé du DOCX avec l’équipe de recherche pour cette étude.",
    upload: "Envoyer le DOCX",
    uploading: "Préparation du DOCX…",
    remove: "Retirer le DOCX joint",
    pending: "Ce texte DOCX sera joint lorsque vous enverrez votre réponse.",
    view: "Voir le texte DOCX",
    hide: "Masquer le texte DOCX",
    download: "Télécharger le texte préparé",
    paragraph: "Paragraphe",
    snapshot: "Texte DOCX préparé",
    optional:
      "Vous pouvez continuer sans DOCX. Le fichier sélectionné est partagé uniquement après avoir choisi Envoyer le DOCX.",
  },
};

export type DOCXProbe = {
  docxId: string;
  permissionVersion: string;
  promptVersion: string;
  model: string;
  generatedAt: string;
  status: "asked" | "none" | "rejected" | "unavailable";
  probe?: string;
  paragraph?: number;
  quote?: string;
  rejectionReason?: NonNullable<
    ReturnType<typeof import("./participant-docx-ai").docxProbeRejectionReason>
  >;
  snapshotSha256?: string;
  contextTruncated?: boolean;
  paragraphsConsidered?: number[];
};

export type DOCXReviewResult = {
  source: string;
  probeSource: string;
  probe?: DOCXProbe;
  asked: boolean;
  version: number;
  history: DOCXReview["history"];
};
