import test from "node:test";
import assert from "node:assert/strict";
import { taskTiming, type TaskAttempt } from "../src/lib/usability-activity";
import {
  liveTranscriptEvent,
  liveTranscriptText,
  type LiveTranscript,
} from "../src/lib/live-transcript";
import { realtimeConfig } from "../src/lib/realtime-provider";
import {
  taskProbeOutput,
  taskProbeInstructions,
} from "../src/lib/task-probe-server";
import { richerCopy } from "../src/lib/richer-copy";
test("task control intervals subtract pauses using a hand-calculated reference; unfinished attempts do not invent durations", () => {
  const a = {
    state: "ended",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:00:25Z",
    intervals: [
      { start: "2026-01-01T00:00:00Z", end: "2026-01-01T00:00:10Z" },
      { start: "2026-01-01T00:00:15Z", end: "2026-01-01T00:00:25Z" },
    ],
  } as TaskAttempt;
  assert.deepEqual(taskTiming(a), {
    activeMs: 20000,
    wallMs: 25000,
    pausedMs: 5000,
  });
  assert.deepEqual(taskTiming({ ...a, state: "running", endedAt: undefined }), {
    activeMs: null,
    wallMs: null,
    pausedMs: null,
  });
});
test("live transcript follows committed speech order, replaces partials with final text and rejects duplicate/out-of-order provider events", () => {
  let s: LiveTranscript = { parts: [] };
  const send = (e: any) => {
    s = liveTranscriptEvent(s, e);
  };
  send({
    type: "input_audio_buffer.committed",
    item_id: "one",
    previous_item_id: null,
  });
  send({
    type: "input_audio_buffer.committed",
    item_id: "two",
    previous_item_id: "one",
  });
  send({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "two",
    transcript: "Second response.",
  });
  const delta = {
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "one",
    delta: "Fir",
    event_id: "unique-event",
  };
  send(delta);
  send(delta);
  assert.equal(liveTranscriptText(s), "Fir Second response.");
  send({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "one",
    transcript: "First response.",
  });
  send(delta);
  send({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "one",
    transcript: "Duplicated.",
  });
  assert.equal(liveTranscriptText(s), "First response. Second response.");
  send({
    type: "response.output_audio_transcript.delta",
    item_id: "assistant",
    delta: "Never a participant answer",
  });
  assert.equal(s.parts.length, 2);
  send({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "large",
    transcript: "a".repeat(13000),
  });
  assert.equal(liveTranscriptText(s).length, 12000);
});
test("live voice disables automatic model replies; optional screen guidance requires visible grounding and uncertainty rather than behavioral claims", () => {
  const c = realtimeConfig("What worked?", "fr");
  assert.equal(c.audio.input.turn_detection.create_response, false);
  assert.equal(c.audio.input.turn_detection.interrupt_response, true);
  assert.equal(c.audio.input.transcription.language, "fr");
  assert.deepEqual(c.tools, []);
  assert.ok(taskProbeInstructions.includes("Never claim"));
  assert.equal(
    taskProbeOutput.safeParse({
      question: "What do you see?",
      visibleContext: "A home screen",
      uncertainty: "The text is unclear.",
    }).success,
    true,
  );
  assert.equal(
    taskProbeOutput.safeParse({
      question: "Click here",
      visibleContext: "",
      success: true,
    }).success,
    false,
  );
  for (const language of ["en", "es", "fr"] as const)
    for (const value of Object.values(richerCopy(language)))
      assert.ok(value.trim());
});
