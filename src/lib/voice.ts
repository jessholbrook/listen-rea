export type VoiceActivity = {
  startedAt: number;
  speechMs: number;
  lastSpeechAt: number;
  lastAt: number;
  hasSpeech: boolean;
};
export function newVoiceActivity(at: number): VoiceActivity {
  return {
    startedAt: at,
    speechMs: 0,
    lastSpeechAt: at,
    lastAt: at,
    hasSpeech: false,
  };
}
// Require sustained speech before accepting silence as the end of a turn.
export function voiceActivity(state: VoiceActivity, rms: number, at: number) {
  const voiced = rms >= 0.025;
  const delta = Math.min(150, Math.max(0, at - state.lastAt));
  const speechMs = state.speechMs + (voiced ? delta : 0);
  const next = {
    ...state,
    lastAt: at,
    speechMs,
    lastSpeechAt: voiced ? at : state.lastSpeechAt,
    hasSpeech: speechMs >= 400,
  };
  return {
    state: next,
    finish:
      next.hasSpeech &&
      at - next.lastSpeechAt >= 1500 &&
      at - next.startedAt >= 2000,
    idle: !next.hasSpeech && at - next.startedAt >= 20000,
  };
}
