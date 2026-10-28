import type { Interview } from "./domain";
import { conceptFor } from "./concepts";
export type VideoView = {
  startedAt?: number;
  endsAt?: number;
  endedAt?: number;
  skippedAt?: number;
  alternativeAt?: number;
  revision: number;
  nonce?: string;
  requestId?: string;
};
export type VideoPresentation = {
  conceptId: string;
  state: "ready" | "playing" | "used" | "alternative";
  endsAt?: number;
  revision: number;
  serverNow: number;
};
export function videoPresentation(
  i: Interview,
  at = Date.now(),
): VideoPresentation | undefined {
  const c = conceptFor(i);
  if (!c?.videoOnce || !c.videoAssetId) return;
  const v =
    i.videoViews && Object.hasOwn(i.videoViews, c.id)
      ? i.videoViews[c.id]
      : undefined;
  return {
    conceptId: c.id,
    revision: v?.revision || 0,
    endsAt: v?.endsAt,
    serverNow: at,
    state:
      v?.alternativeAt !== undefined
        ? "alternative"
        : v?.endedAt !== undefined ||
            (v?.endsAt !== undefined && at >= v.endsAt)
          ? "used"
          : v?.startedAt !== undefined
            ? "playing"
            : "ready",
  };
}
export function videoAnswerBlocked(i: Interview) {
  const p = videoPresentation(i);
  return p?.state === "ready" || p?.state === "playing";
}
export function videoOnceCopy(language: "en" | "es" | "fr" = "en") {
  return {
    en: {
      closing:
        "The player is closed. Continue without video or use replayable viewing if needed.",
      volume: "Volume",
      fullscreen: "Fullscreen",
      title: "One-time video",
      intro:
        "Start when you are ready. You can pause and resume, but cannot rewind or restart. Loading and pauses count toward a window equal to the video length plus two minutes. Reloading does not grant another view.",
      start: "Start single video view",
      play: "Play",
      pause: "Pause",
      remaining: "Seconds left in this viewing window",
      interrupted:
        "This view has already started. A reload or another tab cannot restart it. Continue without video or choose replayable viewing if you need it.",
      used: "This video view is closed. You can answer the questions now.",
      alternative:
        "Replayable video enabled. This choice is saved for the research team.",
      access:
        "Need to replay or use different playback controls? Choose replayable viewing. This choice is saved for the research team.",
      switch: "Use replayable video",
      skip: "Continue without video",
      error:
        "The video view could not be updated. Try again; the viewing window will not restart.",
      retry: "Check video view again",
      loading: "Loading single-view video…",
      loadError:
        "The video could not be loaded. Retry within this window or choose replayable viewing.",
      retryLoad: "Retry video loading",
      sync: "Checking video view…",
    },
    es: {
      closing:
        "El reproductor está cerrado. Continúa sin vídeo o permite repetirlo si lo necesitas.",
      volume: "Volumen",
      fullscreen: "Pantalla completa",
      title: "Vídeo de una sola visualización",
      intro:
        "Empieza cuando estés listo. Puedes pausar y continuar, pero no retroceder ni reiniciar. La carga y las pausas cuentan en un plazo igual a la duración del vídeo más dos minutos. Recargar no permite otra visualización.",
      start: "Iniciar visualización única",
      play: "Reproducir",
      pause: "Pausar",
      remaining: "Segundos restantes para esta visualización",
      interrupted:
        "Esta visualización ya ha empezado. Recargar u otra pestaña no permite reiniciarla. Continúa sin vídeo o permite repetirlo si lo necesitas.",
      used: "Esta visualización ha terminado. Ya puedes responder las preguntas.",
      alternative:
        "Repetición del vídeo activada. El equipo de investigación verá esta elección.",
      access:
        "¿Necesitas repetir el vídeo u otros controles? Permite repetirlo. El equipo de investigación verá esta elección.",
      switch: "Permitir repetir el vídeo",
      skip: "Continuar sin vídeo",
      error:
        "No se pudo actualizar la visualización. Inténtalo de nuevo; el plazo no se reiniciará.",
      retry: "Comprobar la visualización",
      loading: "Cargando vídeo de visualización única…",
      loadError:
        "No se pudo cargar el vídeo. Reintenta dentro del plazo o permite repetirlo.",
      retryLoad: "Reintentar carga del vídeo",
      sync: "Comprobando la visualización…",
    },
    fr: {
      closing:
        "Le lecteur est fermé. Continuez sans vidéo ou autorisez la relecture si nécessaire.",
      volume: "Volume",
      fullscreen: "Plein écran",
      title: "Vidéo à visionnage unique",
      intro:
        "Démarrez quand vous êtes prêt. Vous pouvez mettre en pause et reprendre, sans rembobiner ni recommencer. Le chargement et les pauses comptent dans un délai égal à la durée de la vidéo plus deux minutes. Recharger ne donne pas un nouveau visionnage.",
      start: "Démarrer le visionnage unique",
      play: "Lire",
      pause: "Pause",
      remaining: "Secondes restantes pour ce visionnage",
      interrupted:
        "Ce visionnage a déjà commencé. Recharger ou ouvrir un autre onglet ne permet pas de recommencer. Continuez sans vidéo ou autorisez la relecture si nécessaire.",
      used: "Ce visionnage est terminé. Vous pouvez répondre aux questions.",
      alternative:
        "Relecture de la vidéo activée. L’équipe de recherche verra ce choix.",
      access:
        "Besoin de relire la vidéo ou d’autres commandes ? Autorisez la relecture. L’équipe de recherche verra ce choix.",
      switch: "Autoriser la relecture vidéo",
      skip: "Continuer sans vidéo",
      error:
        "Le visionnage n’a pas pu être mis à jour. Réessayez ; le délai ne redémarrera pas.",
      retry: "Vérifier le visionnage",
      loading: "Chargement de la vidéo à visionnage unique…",
      loadError:
        "La vidéo n’a pas pu être chargée. Réessayez dans le délai ou autorisez la relecture.",
      retryLoad: "Réessayer le chargement",
      sync: "Vérification du visionnage…",
    },
  }[language];
}
