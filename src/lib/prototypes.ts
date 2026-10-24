import type { Language } from "./localization";
export function prototypeCopy(language: Language = "en") {
  return {
    en: {
      task: "Your task",
      open: "Open prototype",
      notice: "Opens in a new tab. Return here to answer.",
      destination: "Destination",
      external:
        "The prototype is a separate site. Its access and privacy settings apply.",
    },
    es: {
      task: "Tu tarea",
      open: "Abrir prototipo",
      notice: "Se abre en una pestaña nueva. Vuelve aquí para responder.",
      destination: "Destino",
      external:
        "El prototipo es un sitio independiente. Se aplican sus ajustes de acceso y privacidad.",
    },
    fr: {
      task: "Votre tâche",
      open: "Ouvrir le prototype",
      notice: "S’ouvre dans un nouvel onglet. Revenez ici pour répondre.",
      destination: "Destination",
      external:
        "Le prototype est un site distinct. Ses paramètres d’accès et de confidentialité s’appliquent.",
    },
  }[language];
}
