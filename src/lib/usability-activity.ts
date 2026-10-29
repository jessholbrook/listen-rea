import { z } from "zod";
export const taskActivityVersion = "explicit-task-controls-v1";
export const taskOutcome = z.enum(["completed", "not_completed", "skipped"]);
export type TaskAttempt = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  questionId: string;
  revisionId: string;
  turnVersion: number;
  turnIndex: number;
  version: number;
  state: "running" | "paused" | "ended";
  startedAt: string;
  endedAt?: string;
  outcome?: z.infer<typeof taskOutcome>;
  intervals: { start: string; end?: string }[];
  requests: Record<string, string>;
};
// Only closed server-timestamped intervals count; an open timer is not a completed observation.
export function taskTiming(a: TaskAttempt) {
  const activeMs = a.intervals.reduce(
    (sum, v) =>
      sum + (v.end ? Math.max(0, Date.parse(v.end) - Date.parse(v.start)) : 0),
    0,
  );
  const wallMs = a.endedAt
    ? Math.max(0, Date.parse(a.endedAt) - Date.parse(a.startedAt))
    : null;
  return {
    activeMs: a.state === "ended" ? activeMs : null,
    wallMs,
    pausedMs: wallMs === null ? null : Math.max(0, wallMs - activeMs),
  };
}
export function taskAttemptView(a: TaskAttempt) {
  const { workspaceId, requests, ...v } = a;
  return { ...v, timing: taskTiming(a) };
}
