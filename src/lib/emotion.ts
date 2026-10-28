import { z } from "zod";
import type { Language } from "./localization";
export const feelings = [
  "happy",
  "calm",
  "confident",
  "curious",
  "uncertain",
  "frustrated",
  "disappointed",
  "overwhelmed",
  "neutral",
  "mixed",
  "other",
  "prefer_not_to_answer",
] as const;
export type Feeling = (typeof feelings)[number];
export const emotionSchema = z
  .object({
    method: z.literal("self-report-v1"),
    feeling: z.enum(feelings),
    intensity: z.number().int().min(1).max(3).nullable(),
    note: z.string().trim().max(2000),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      (v.feeling === "neutral" || v.feeling === "prefer_not_to_answer") &&
      v.intensity !== null
    )
      c.addIssue({
        code: "custom",
        message: "Neutral and declined answers have no intensity.",
      });
    if (v.feeling === "prefer_not_to_answer" && v.note)
      c.addIssue({
        code: "custom",
        message: "A declined check-in must not retain a note.",
      });
  });
export type EmotionAnswer = z.infer<typeof emotionSchema>;
// A compact form tuple fits the existing structured-input draft/retry protocol.
export function emotionInput(value: unknown): EmotionAnswer {
  const [feeling, intensity, note] = z
    .tuple([
      z.enum(feelings),
      z.enum(["", "1", "2", "3"]),
      z.string().max(2000),
    ])
    .parse(value);
  return emotionSchema.parse({
    method: "self-report-v1",
    feeling,
    intensity: intensity ? Number(intensity) : null,
    note,
  });
}
const words = {
  en: {
    title: "Your feeling",
    optional:
      "This check-in is optional. Choose the closest feeling, or prefer not to answer. Your own selection is saved.",
    intensity: "Intensity (optional)",
    unspecified: "Not specified",
    note: "In your own words (optional)",
    reported: "Self-reported feeling",
    intensityLabel: "Intensity",
    noteLabel: "Note",
    levels: ["Slightly", "Moderately", "Strongly"],
    labels: [
      "Happy",
      "Calm",
      "Confident",
      "Curious",
      "Uncertain",
      "Frustrated",
      "Disappointed",
      "Overwhelmed",
      "Neutral",
      "Mixed feelings",
      "Other",
      "Prefer not to answer",
    ],
  },
  es: {
    title: "Cómo te sientes",
    optional:
      "Esta pregunta es opcional. Elige la emoción más cercana o indica que prefieres no responder. Se guardará tu propia selección.",
    intensity: "Intensidad (opcional)",
    unspecified: "Sin especificar",
    note: "En tus propias palabras (opcional)",
    reported: "Emoción declarada por la persona",
    intensityLabel: "Intensidad",
    noteLabel: "Nota",
    levels: ["Levemente", "Moderadamente", "Intensamente"],
    labels: [
      "Alegría",
      "Calma",
      "Confianza",
      "Curiosidad",
      "Incertidumbre",
      "Frustración",
      "Decepción",
      "Agobio",
      "Neutral",
      "Emociones mixtas",
      "Otra",
      "Prefiero no responder",
    ],
  },
  fr: {
    title: "Votre ressenti",
    optional:
      "Cette question est facultative. Choisissez le ressenti le plus proche ou préférez ne pas répondre. Votre propre choix sera enregistré.",
    intensity: "Intensité (facultatif)",
    unspecified: "Non précisée",
    note: "Avec vos propres mots (facultatif)",
    reported: "Ressenti déclaré par la personne",
    intensityLabel: "Intensité",
    noteLabel: "Note",
    levels: ["Légèrement", "Modérément", "Fortement"],
    labels: [
      "Joie",
      "Calme",
      "Confiance",
      "Curiosité",
      "Incertitude",
      "Frustration",
      "Déception",
      "Sentiment d’être dépassé",
      "Neutre",
      "Émotions mixtes",
      "Autre",
      "Je préfère ne pas répondre",
    ],
  },
};
export function emotionCopy(language: Language = "en") {
  const w = words[language];
  return {
    ...w,
    labels: Object.fromEntries(
      feelings.map((f, n) => [f, w.labels[n]]),
    ) as Record<Feeling, string>,
  };
}
export function emotionText(answer: EmotionAnswer, language: Language = "en") {
  const w = emotionCopy(language);
  if (answer.feeling === "prefer_not_to_answer")
    return w.labels.prefer_not_to_answer;
  return `${w.reported}: ${w.labels[answer.feeling]}${answer.intensity === null ? "" : `\n${w.intensityLabel}: ${w.levels[answer.intensity - 1]}`}${answer.note ? `\n${w.noteLabel}: ${answer.note}` : ""}`;
}
