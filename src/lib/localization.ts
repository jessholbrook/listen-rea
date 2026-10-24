import { z } from "zod";
import type { Guide, Interview } from "./domain";
export const languages = ["en", "es", "fr"] as const;
export type Language = (typeof languages)[number];
export const languageSchema = z.enum(languages);
export const languageNames: Record<Language, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
};
export const translatedField = z.object({
  key: z.string().min(1).max(1000),
  text: z.string().max(6000),
});
export const guideTranslationSchema = z.object({
  language: languageSchema,
  sourceFingerprint: z.string().max(100),
  fields: z.array(translatedField).max(300),
  reviewed: z.boolean(),
  reviewedBy: z.string().max(80).optional(),
  reviewedAt: z.string().optional(),
});
export const localizationSchema = z
  .object({
    sourceLanguage: languageSchema.default("en"),
    reportingLanguage: languageSchema.default("en"),
    guidance: z.string().max(3000).default(""),
    translations: z.array(guideTranslationSchema).max(2).default([]),
  })
  .superRefine((v, c) => {
    if (
      new Set(v.translations.map((t) => t.language)).size !==
        v.translations.length ||
      v.translations.some((t) => t.language === v.sourceLanguage)
    )
      c.addIssue({
        code: "custom",
        message:
          "Guide translations need unique languages different from the source language.",
      });
  });
export const settings = (g: Guide) =>
  g.localization || {
    sourceLanguage: "en" as Language,
    reportingLanguage: "en" as Language,
    guidance: "",
    translations: [],
  };
export type TextField = {
  key: string;
  label: string;
  text: string;
  min: number;
  max: number;
};
const key = (...p: string[]) => JSON.stringify(p);
export const scaleLabels = (language: Language) =>
  ({
    en: { lowLabel: "Low", highLabel: "High" },
    es: { lowLabel: "Bajo", highLabel: "Alto" },
    fr: { lowLabel: "Faible", highLabel: "Élevé" },
  })[language];
export function guideFields(g: Guide): TextField[] {
  const fields: TextField[] = [];
  const add = (
    p: string[],
    label: string,
    text: string,
    min: number,
    max: number,
  ) => fields.push({ key: key(...p), label, text, min, max });
  for (const [name, min, max] of [
    ["title", 3, 160],
    ["goal", 10, 4000],
    ["audience", 3, 1000],
    ["intro", 5, 3000],
  ] as const)
    add([name], name, g[name], min, max);
  if (g.confidentiality) {
    add(
      ["confidentiality", "title"],
      "Confidentiality title",
      g.confidentiality.title,
      3,
      160,
    );
    add(
      ["confidentiality", "text"],
      "Confidentiality text",
      g.confidentiality.text,
      20,
      6000,
    );
  }
  const sections = new Set(g.questions.map((q) => q.section));
  for (const s of sections) add(["section", s], "Section: " + s, s, 0, 100);
  for (const [n, q] of g.questions.entries()) {
    add(["question", q.id, "text"], `Question ${n + 1}`, q.text, 1, 3000);
    add(
      ["question", q.id, "instructions"],
      `Question ${n + 1} instructions`,
      q.instructions,
      0,
      2000,
    );
    for (const o of q.options) {
      if (o.imageAssetId)
        add(
          ["optionImageAlt", q.id, o.id],
          `Question ${n + 1} image description: ${o.text}`,
          o.imageAlt || "",
          1,
          500,
        );
      add(
        ["option", q.id, o.id],
        `Question ${n + 1} option: ${o.text}`,
        o.text,
        1,
        500,
      );
    }
    if (q.cardsort)
      for (const type of ["cards", "groups"] as const)
        for (const item of q.cardsort[type])
          add(
            ["cardsort", q.id, type, item.id],
            `Question ${n + 1} card sort ${type}: ${item.text}`,
            item.text,
            1,
            500,
          );
    if (q.maxdiff)
      for (const item of q.maxdiff.items) {
        if (item.imageAssetId)
          add(
            ["maxdiffImageAlt", q.id, item.id],
            `Question ${n + 1} MaxDiff image: ${item.text}`,
            item.imageAlt || "",
            1,
            500,
          );
        add(
          ["maxdiff", q.id, item.id],
          `Question ${n + 1} MaxDiff item: ${item.text}`,
          item.text,
          1,
          500,
        );
      }
    if (q.pricing)
      add(
        ["pricing", q.id, "unit"],
        `Question ${n + 1} price unit`,
        q.pricing.unit,
        1,
        100,
      );
    if (q.type === "rating" || q.type === "matrix") {
      add(
        ["scale", q.id, "lowLabel"],
        `Question ${n + 1} low label`,
        q.scale?.lowLabel ?? scaleLabels(settings(g).sourceLanguage).lowLabel,
        0,
        100,
      );
      add(
        ["scale", q.id, "highLabel"],
        `Question ${n + 1} high label`,
        q.scale?.highLabel ?? scaleLabels(settings(g).sourceLanguage).highLabel,
        0,
        100,
      );
    }
  }
  for (const c of g.conceptTest?.concepts || [])
    for (const field of [
      "name",
      "headline",
      "description",
      "imageAlt",
      "taskInstructions",
      "videoTranscript",
    ] as const)
      if (c[field] !== undefined)
        add(
          ["concept", c.id, field],
          `Concept ${c.name}: ${field}`,
          c[field]!,
          field === "imageAlt" ||
            (field === "videoTranscript" && !c.videoAssetId) ||
            (field === "taskInstructions" && !c.prototypeUrl)
            ? 0
            : 1,
          field === "videoTranscript"
            ? 6000
            : field === "taskInstructions"
              ? 4000
              : field === "description"
                ? 6000
                : field === "imageAlt"
                  ? 500
                  : field === "name"
                    ? 100
                    : 160,
        );
  return fields;
}
export function guideSource(g: Guide) {
  const { localization, ...rest } = g;
  return JSON.stringify({
    guide: rest,
    sourceLanguage: settings(g).sourceLanguage,
    guidance: settings(g).guidance,
  });
}
export function validateFields(
  g: Guide,
  fields: z.infer<typeof translatedField>[],
) {
  const expected = guideFields(g);
  if (
    expected.length > 300 ||
    fields.length !== expected.length ||
    new Set(fields.map((f) => f.key)).size !== fields.length
  )
    throw new Error("TRANSLATION_FIELDS");
  let total = 0;
  for (const e of expected) {
    const f = fields.find((f) => f.key === e.key);
    if (!f || f.text.length < e.min || f.text.length > e.max)
      throw new Error("TRANSLATION_FIELDS");
    total += f.text.length;
  }
  if (total > 60000) throw new Error("TRANSLATION_FIELDS");
  return fields;
}
export function applyFields(
  g: Guide,
  fields: z.infer<typeof translatedField>[],
): Guide {
  validateFields(g, fields);
  const out = structuredClone(g),
    map = new Map(fields.map((f) => [f.key, f.text])),
    read = (...p: string[]) => map.get(key(...p))!;
  for (const name of ["title", "goal", "audience", "intro"] as const)
    out[name] = read(name);
  if (out.confidentiality)
    out.confidentiality = {
      title: read("confidentiality", "title"),
      text: read("confidentiality", "text"),
    };
  const sectionNames = new Map(
    g.questions.map((q) => [q.section, read("section", q.section)]),
  );
  if (new Set(sectionNames.values()).size !== sectionNames.size)
    throw new Error("TRANSLATION_FIELDS");
  for (const q of out.questions) {
    q.section = sectionNames.get(q.section)!;
    q.text = read("question", q.id, "text");
    q.instructions = read("question", q.id, "instructions");
    if (q.cardsort)
      for (const type of ["cards", "groups"] as const)
        for (const item of q.cardsort[type])
          item.text = read("cardsort", q.id, type, item.id);
    if (q.maxdiff)
      for (const item of q.maxdiff.items) {
        item.text = read("maxdiff", q.id, item.id);
        if (item.imageAssetId)
          item.imageAlt = read("maxdiffImageAlt", q.id, item.id);
      }
    if (q.pricing) q.pricing.unit = read("pricing", q.id, "unit");
    for (const o of q.options) {
      o.text = read("option", q.id, o.id);
      if (o.imageAssetId) o.imageAlt = read("optionImageAlt", q.id, o.id);
    }
    if (q.type === "rating" || q.type === "matrix")
      q.scale = {
        ...(q.scale || { min: 1, max: 5 }),
        lowLabel: read("scale", q.id, "lowLabel"),
        highLabel: read("scale", q.id, "highLabel"),
      };
  }
  for (const s of out.sections || []) s.name = sectionNames.get(s.name)!;
  for (const c of out.conceptTest?.concepts || [])
    for (const field of [
      "name",
      "headline",
      "description",
      "imageAlt",
      "taskInstructions",
      "videoTranscript",
    ] as const)
      if (c[field] !== undefined) c[field] = read("concept", c.id, field);
  return out;
}
export type ResponseTranslation = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnId: string;
  language: Language;
  sourceLanguage: Language;
  original: string;
  translated: string;
  sourceFingerprint: string;
  version: number;
  reviewed: boolean;
  reviewedBy: string;
  updatedAt: string;
};
export const responseLanguage = (i: Interview): Language =>
  i.language || settings(i.guide).sourceLanguage;
export const reportLanguage = (g: Guide): Language =>
  settings(g).reportingLanguage;
export const reportingCopy = {
  en: {
    objective: "RESEARCH OBJECTIVE",
    method: "METHOD & SAMPLE",
    summary: "SUMMARY",
    findings: "FINDINGS",
    limits: "LIMITATIONS & CONTRARY EVIDENCE",
    scripted: "Could you share a specific example of that?",
    continued: "Continued",
    defaultLimits:
      "Exploratory sample. Review source languages, contrary evidence and missing responses before sharing.",
    sample:
      "Counts describe this sample, not a population estimate. Original-language quotes are retained; translations require review.",
    emptySummary: "Add a researcher summary after reviewing the responses.",
    emptyFindings:
      "No themes coded yet. Add exact supporting quotes before sharing a finding.",
    emptyLimits:
      "Review minority views, missing answers and recruitment limitations.",
    participants: "completed, included participants",
    external:
      "Exploratory evidence including researcher-imported external transcripts; check source provenance, speakers and recruitment context",
    native: "Self-recruited exploratory interviews",
    source: "Original source",
    provenance: "Provenance",
    cont: "continued",
  },
  es: {
    objective: "OBJETIVO DE INVESTIGACIÓN",
    method: "MÉTODO Y MUESTRA",
    summary: "RESUMEN",
    findings: "HALLAZGOS",
    limits: "LIMITACIONES Y EVIDENCIA CONTRARIA",
    scripted: "¿Podrías compartir un ejemplo concreto?",
    continued: "Continuado",
    defaultLimits:
      "Muestra exploratoria. Revisa los idiomas originales, la evidencia contraria y las respuestas que faltan antes de compartir.",
    sample:
      "Los recuentos describen esta muestra, no una estimación poblacional. Se conservan las citas originales; las traducciones requieren revisión.",
    emptySummary: "Añade un resumen tras revisar las respuestas.",
    emptyFindings:
      "Todavía no hay temas codificados. Añade citas originales que respalden los hallazgos.",
    emptyLimits:
      "Revisa las opiniones minoritarias, las respuestas ausentes y las limitaciones del reclutamiento.",
    participants:
      "participantes que completaron la entrevista y fueron incluidos",
    external:
      "Evidencia exploratoria que incluye transcripciones externas importadas; revisa la procedencia, los hablantes y el contexto de reclutamiento",
    native:
      "Entrevistas exploratorias con participantes reclutados por el equipo",
    source: "Fuente original",
    provenance: "Procedencia",
    cont: "continuación",
  },
  fr: {
    objective: "OBJECTIF DE RECHERCHE",
    method: "MÉTHODE ET ÉCHANTILLON",
    summary: "SYNTHÈSE",
    findings: "RÉSULTATS",
    limits: "LIMITES ET ÉLÉMENTS CONTRADICTOIRES",
    scripted: "Pourriez-vous donner un exemple précis ?",
    continued: "Suite",
    defaultLimits:
      "Échantillon exploratoire. Vérifiez les langues originales, les éléments contradictoires et les réponses manquantes avant de partager.",
    sample:
      "Les décomptes décrivent cet échantillon, sans estimer une population. Les citations originales sont conservées ; les traductions doivent être vérifiées.",
    emptySummary: "Ajoutez une synthèse après avoir examiné les réponses.",
    emptyFindings:
      "Aucun thème codé. Ajoutez des citations originales pour étayer les résultats.",
    emptyLimits:
      "Examinez les points de vue minoritaires, les réponses manquantes et les limites du recrutement.",
    participants: "participants ayant terminé et inclus dans l’analyse",
    external:
      "Données exploratoires comprenant des transcriptions externes importées ; vérifiez la provenance, les locuteurs et le contexte de recrutement",
    native:
      "Entretiens exploratoires auprès de participants recrutés par l’équipe",
    source: "Source originale",
    provenance: "Provenance",
    cont: "suite",
  },
} satisfies Record<Language, Record<string, string>>;
export function declines(answer: string, language: Language) {
  const text = answer
    .trim()
    .replace(/[.!?¡¿ ]+$/g, "")
    .toLocaleLowerCase();
  return {
    en: /^(skip|stop|pass|no comment|(?:i )?prefer not to answer|i don.t know)$/,
    es: /^(omitir|pasar|parar|sin comentarios|prefiero no responder|no s[eé])$/,
    fr: /^(passer|arr[eê]ter|sans commentaire|je pr[eé]f[eè]re ne pas r[eé]pondre|je ne sais pas)$/,
  }[language].test(text);
}
export const insufficientEvidence = (language: Language) =>
  ({
    en: "There is not enough matching evidence in the selected studies to answer this question.",
    es: "No hay suficiente evidencia pertinente en los estudios seleccionados para responder a esta pregunta.",
    fr: "Les études sélectionnées ne contiennent pas assez de données pertinentes pour répondre à cette question.",
  })[language];
