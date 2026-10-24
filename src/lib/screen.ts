import type { Interview } from "./domain";
export const screenSegmentMs = 12000;
export const maxScreenSegmentMs = 20000;
export type ScreenClip = {
  id: string;
  sequence: number;
  offsetMs: number;
  durationMs: number;
  bytes: number;
};
export type ScreenSession = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  questionId: string;
  turnVersion: number;
  prompt: string;
  consentAt: string;
  createdAt: string;
  status: "recording" | "stopped" | "interrupted";
  stoppedAt?: string;
  clips?: ScreenClip[];
};
export function taskFor(i: Interview) {
  return i.guide.questions[i.current]?.task;
}
export function clipAt(clips: ScreenClip[], ms: number) {
  return clips.find((c) => ms >= c.offsetMs && ms < c.offsetMs + c.durationMs);
}
export function screenMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return (
    ["video/webm;codecs=vp8,opus", "video/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    ) || null
  );
}
