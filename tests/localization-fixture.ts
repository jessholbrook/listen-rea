import type { Guide } from "../src/lib/domain";
import { guideFields, type Language } from "../src/lib/localization";
export function translatedFields(guide: Guide, language: Language) {
  const known: Record<string, { es: string; fr: string }> = {
    "From feedback to decisions": {
      es: "De comentarios a decisiones",
      fr: "Des retours aux décisions",
    },
    "External interview transcript": {
      es: "Transcripción de entrevista externa",
      fr: "Transcription d’entretien externe",
    },
    Discussion: { es: "Conversación", fr: "Discussion" },
    Context: { es: "Contexto", fr: "Contexte" },
    "Tell me about your recent research.": {
      es: "Cuéntame sobre tu investigación reciente.",
      fr: "Parlez-moi de votre dernière recherche.",
    },
    "What helped you decide?": {
      es: "¿Qué te ayudó a decidir?",
      fr: "Qu’est-ce qui vous a aidé à décider ?",
    },
  };
  return guideFields(guide).map((f) => ({
    key: f.key,
    text: !f.text
      ? ""
      : known[f.text]?.[language as "es" | "fr"] ||
        ((language === "es" ? "ES " : "FR ") + f.text).slice(0, f.max),
  }));
}
