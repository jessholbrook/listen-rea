import type { Language } from "./localization";
const en = {
  running: "Timer running",
  paused: "Timer paused",
  ended: "Timer ended",
  timer: "Optional task timer",
  start: "Start task timer",
  pause: "Pause timer",
  resume: "Resume timer",
  end: "End task timer",
  timerNotice:
    "Timing measures your use of these controls. Report the outcome yourself; Echo Lab cannot observe clicks or verify completion on another website.",
  outcome: "Your task outcome",
  completed: "I completed the task",
  not_completed: "I did not complete the task",
  skipped: "I skipped the task",
  timerReview: "I reviewed my task outcome and want to end this attempt.",
  voiceMode: "Voice mode",
  recorded: "Recorded voice",
  streaming: "Streaming voice · preview",
  voiceConsent:
    "I allow OpenAI to receive live microphone audio and return speech and transcription. Echo Lab saves the transcript only when I continue; it does not save this live audio.",
  voiceStart: "Start streaming voice",
  voiceStop: "Stop streaming voice",
  connecting: "Connecting…",
  listening:
    "Live voice connected. Speak to interrupt; review the transcript before continuing.",
  voiceNotice:
    "Use headphones. Streaming voice reads the current question and transcribes your speech; it cannot advance the guide. Stop before editing your draft. Sessions stop after ten minutes in this browser.",
  voiceUnavailable:
    "Streaming voice disconnected. Review the text already received, then reconnect or use recorded voice or typing.",
  voiceDraft: "Live transcript (draft)",
  screenConsent:
    "I allow a current screen image to be sent to OpenAI when I request screen-aware help.",
  help: "Ask about my current screen",
  refocus: "Return to the task",
  helpNotice:
    "Optional screen-aware help sends one image when requested. Images are not retained; AI guidance is separate from your answers and does not judge success or off-task behavior.",
  helping: "Looking at the current screen…",
  guidance: "Optional AI guidance",
  recovery:
    "Return to the task instructions above. You may also pause, stop sharing, or tell us what is difficult.",
};
const es: typeof en = {
  running: "Temporizador en marcha",
  paused: "Temporizador en pausa",
  ended: "Temporizador finalizado",
  timer: "Temporizador de tarea opcional",
  start: "Iniciar temporizador",
  pause: "Pausar temporizador",
  resume: "Reanudar temporizador",
  end: "Finalizar temporizador",
  timerNotice:
    "El tiempo mide el uso de estos controles. Indica tú el resultado; Echo Lab no observa clics ni verifica la finalización en otro sitio.",
  outcome: "Resultado de tu tarea",
  completed: "Completé la tarea",
  not_completed: "No completé la tarea",
  skipped: "Omití la tarea",
  timerReview: "Revisé el resultado y quiero finalizar este intento.",
  voiceMode: "Modo de voz",
  recorded: "Voz grabada",
  streaming: "Voz en directo · vista previa",
  voiceConsent:
    "Autorizo a OpenAI a recibir audio del micrófono en directo y devolver voz y transcripción. Echo Lab guarda la transcripción solo cuando continúo; no guarda este audio en directo.",
  voiceStart: "Iniciar voz en directo",
  voiceStop: "Detener voz en directo",
  connecting: "Conectando…",
  listening:
    "Voz conectada. Habla para interrumpir; revisa la transcripción antes de continuar.",
  voiceNotice:
    "Usa auriculares. La voz en directo lee la pregunta actual y transcribe tu voz; no avanza la guía. Detén la voz antes de editar. Las sesiones se detienen a los diez minutos en este navegador.",
  voiceUnavailable:
    "Voz desconectada. Revisa el texto recibido y vuelve a conectar o usa grabación o texto.",
  voiceDraft: "Transcripción en directo (borrador)",
  screenConsent:
    "Autorizo enviar una imagen actual de mi pantalla a OpenAI cuando solicite ayuda sobre la pantalla.",
  help: "Preguntar sobre mi pantalla",
  refocus: "Volver a la tarea",
  helpNotice:
    "La ayuda opcional envía una imagen cuando la solicitas. Las imágenes no se conservan; la ayuda de IA está separada de tus respuestas y no juzga el éxito ni las distracciones.",
  helping: "Revisando la pantalla…",
  guidance: "Ayuda de IA opcional",
  recovery:
    "Vuelve a las instrucciones anteriores. También puedes pausar, dejar de compartir o explicar qué resulta difícil.",
};
const fr: typeof en = {
  running: "Chronomètre en cours",
  paused: "Chronomètre en pause",
  ended: "Chronomètre terminé",
  timer: "Chronomètre de tâche facultatif",
  start: "Démarrer le chronomètre",
  pause: "Mettre en pause",
  resume: "Reprendre le chronomètre",
  end: "Terminer le chronomètre",
  timerNotice:
    "Le temps mesure votre utilisation de ces commandes. Indiquez le résultat vous-même ; Echo Lab n’observe pas les clics et ne vérifie pas la réussite sur un autre site.",
  outcome: "Résultat de votre tâche",
  completed: "J’ai terminé la tâche",
  not_completed: "Je n’ai pas terminé la tâche",
  skipped: "J’ai passé la tâche",
  timerReview: "J’ai vérifié le résultat et souhaite terminer cet essai.",
  voiceMode: "Mode vocal",
  recorded: "Voix enregistrée",
  streaming: "Voix en direct · aperçu",
  voiceConsent:
    "J’autorise OpenAI à recevoir le son du microphone en direct et à renvoyer une voix et une transcription. Echo Lab enregistre la transcription seulement lorsque je continue ; il ne conserve pas ce son en direct.",
  voiceStart: "Démarrer la voix en direct",
  voiceStop: "Arrêter la voix en direct",
  connecting: "Connexion…",
  listening:
    "Voix connectée. Parlez pour interrompre ; vérifiez la transcription avant de continuer.",
  voiceNotice:
    "Utilisez un casque. La voix en direct lit la question et transcrit votre voix ; elle ne fait pas avancer le guide. Arrêtez-la avant de modifier le texte. Les sessions s’arrêtent après dix minutes dans ce navigateur.",
  voiceUnavailable:
    "Voix déconnectée. Vérifiez le texte reçu puis reconnectez-vous, enregistrez une réponse ou écrivez.",
  voiceDraft: "Transcription en direct (brouillon)",
  screenConsent:
    "J’autorise l’envoi à OpenAI d’une image de mon écran lorsque je demande une aide liée à l’écran.",
  help: "Poser une question sur mon écran",
  refocus: "Revenir à la tâche",
  helpNotice:
    "L’aide facultative envoie une image à votre demande. Les images ne sont pas conservées ; les conseils de l’IA sont distincts de vos réponses et ne jugent ni la réussite ni les distractions.",
  helping: "Examen de l’écran…",
  guidance: "Conseil facultatif de l’IA",
  recovery:
    "Revenez aux consignes ci-dessus. Vous pouvez aussi faire une pause, arrêter le partage ou expliquer vos difficultés.",
};
export const richerCopy = (language: Language = "en") =>
  ({ en, es, fr })[language];
