export type LiveTranscript = {
  parts: {
    id: string;
    text: string;
    complete: boolean;
    previousId?: string | null;
  }[];
  seen?: string[];
};
export function liveTranscriptEvent(
  state: LiveTranscript,
  event: any,
): LiveTranscript {
  if (
    !event ||
    ![
      "input_audio_buffer.committed",
      "conversation.item.input_audio_transcription.delta",
      "conversation.item.input_audio_transcription.completed",
    ].includes(event.type) ||
    typeof event.item_id !== "string"
  )
    return state;
  if (event.event_id && state.seen?.includes(event.event_id)) return state;
  if (
    state.parts.length >= 100 &&
    !state.parts.some((p) => p.id === event.item_id)
  )
    return state;
  const parts = state.parts.map((p) => ({ ...p }));
  let part = parts.find((p) => p.id === event.item_id);
  if (!part) {
    part = { id: event.item_id, text: "", complete: false };
    parts.push(part);
  }
  if (event.type === "input_audio_buffer.committed")
    part.previousId =
      typeof event.previous_item_id === "string"
        ? event.previous_item_id
        : null;
  else if (
    !part.complete &&
    event.type.endsWith(".completed") &&
    typeof event.transcript === "string"
  ) {
    part.text = event.transcript.slice(0, 12000);
    part.complete = true;
  } else if (!part.complete && typeof event.delta === "string")
    part.text = (part.text + event.delta).slice(0, 12000);
  const ordered: LiveTranscript["parts"] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(p: LiveTranscript["parts"][number]) {
    if (visited.has(p.id) || visiting.has(p.id)) return;
    visiting.add(p.id);
    const previous = parts.find((v) => v.id === p.previousId);
    if (previous) visit(previous);
    visiting.delete(p.id);
    visited.add(p.id);
    ordered.push(p);
  }
  for (const p of parts) visit(p);
  return {
    parts: ordered,
    seen: event.event_id
      ? [...(state.seen || []), event.event_id].slice(-2000)
      : state.seen,
  };
}
export const liveTranscriptText = (state: LiveTranscript) =>
  state.parts
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 12000);
