import type { Interview } from "./domain";
import { conceptFor } from "./concepts";
export type ConceptExposure = {
  startedAt?: number;
  endsAt?: number;
  untimedAt?: number;
  revision?: number;
};
export type ConceptPresentation = {
  conceptId: string;
  seconds: number;
  state: "waiting" | "viewing" | "expired" | "untimed";
  serverNow: number;
  endsAt?: number;
  revision: number;
};
export function conceptPresentation(
  i: Interview,
  at = Date.now(),
): ConceptPresentation | undefined {
  const c = conceptFor(i);
  if (!c?.exposureSeconds) return;
  const saved =
    i.conceptExposures && Object.hasOwn(i.conceptExposures, c.id)
      ? i.conceptExposures[c.id]
      : undefined;
  return {
    conceptId: c.id,
    seconds: c.exposureSeconds,
    revision: saved?.revision || (saved ? 1 : 0),
    serverNow: at,
    endsAt: saved?.endsAt,
    state:
      saved?.untimedAt !== undefined
        ? "untimed"
        : saved?.endsAt !== undefined
          ? at >= saved.endsAt
            ? "expired"
            : "viewing"
          : "waiting",
  };
}
export function conceptVisible(i: Interview, at = Date.now()) {
  const p = conceptPresentation(i, at);
  return !p || p.state === "viewing" || p.state === "untimed";
}
export function timingCopy(language: "en" | "es" | "fr" = "en") {
  return {
    en: {
      title: "Timed concept",
      intro:
        "Start when you are ready. The clock continues in background tabs and across reloads.",
      start: "Start timed view",
      seconds: "seconds",
      remaining: "Time remaining",
      expired: "The timed view has ended. Answer the questions from memory.",
      untimed: "Untimed view enabled. Take the time you need.",
      switch: "Use untimed view",
      access:
        "Need more time? Switch to an untimed view. This choice is saved for the research team.",
      sync: "Checking presentation timing…",
      error: "Presentation timing could not be updated. Try again.",
      retry: "Check timing again",
    },
    es: {
      title: "Concepto cronometrado",
      intro:
        "Empieza cuando estés listo. El reloj continúa en pestañas en segundo plano y al recargar.",
      start: "Iniciar vista cronometrada",
      seconds: "segundos",
      remaining: "Tiempo restante",
      expired:
        "La vista cronometrada ha terminado. Responde las preguntas de memoria.",
      untimed: "Vista sin límite activada. Tómate el tiempo que necesites.",
      switch: "Usar vista sin límite",
      access:
        "¿Necesitas más tiempo? Cambia a una vista sin límite. El equipo de investigación verá esta elección.",
      sync: "Comprobando el tiempo de presentación…",
      error:
        "No se pudo actualizar el tiempo de presentación. Inténtalo de nuevo.",
      retry: "Comprobar el tiempo de nuevo",
    },
    fr: {
      title: "Concept chronométré",
      intro:
        "Commencez quand vous êtes prêt. Le chronomètre continue en arrière-plan et après rechargement.",
      start: "Démarrer la présentation",
      seconds: "secondes",
      remaining: "Temps restant",
      expired:
        "La présentation chronométrée est terminée. Répondez aux questions de mémoire.",
      untimed: "Présentation sans limite activée. Prenez le temps nécessaire.",
      switch: "Utiliser la vue sans limite",
      access:
        "Besoin de plus de temps ? Passez à une vue sans limite. Ce choix sera visible par l’équipe de recherche.",
      sync: "Vérification du temps de présentation…",
      error: "Le temps de présentation n’a pas pu être mis à jour. Réessayez.",
      retry: "Vérifier le temps à nouveau",
    },
  }[language];
}
