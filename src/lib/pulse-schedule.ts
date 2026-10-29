import { z } from "zod";
export const pulseDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      v >= "2000-01-01" &&
      v <= "2100-12-31" &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a valid date from 2000 through 2100.",
  );
export const pulseTimeZone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA time zone.");
export const pulseScheduleSettings = z
  .object({
    nextDate: pulseDate,
    intervalDays: z.number().int().min(1).max(365),
    maxWaves: z.number().int().min(1).max(12),
    labelPrefix: z.string().trim().min(3).max(100),
    timeZone: pulseTimeZone,
  })
  .strict();
export type PulseSchedule = {
  id: string;
  workspaceId: string;
  studyId: string;
  creatorId: string;
  generation: string;
  version: number;
  state: "scheduled" | "paused" | "complete" | "blocked";
  nextDate: string;
  intervalDays: number;
  maxWaves: number;
  labelPrefix: string;
  timeZone: string;
  createdCount: number;
  createdAt: string;
  updatedAt: string;
  baselineFingerprint: string;
  error?: "permission" | "source" | "chronology" | "capacity";
  lastRequest: { id: string; hash: string };
  runs: { studyId: string; date: string; at: string }[];
};
export function pulseToday(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function nextPulseDate(date: string, days: number) {
  const at = new Date(date + "T12:00:00Z");
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
export function pulseScheduleView(s: PulseSchedule) {
  const {
    workspaceId,
    creatorId,
    generation,
    baselineFingerprint,
    lastRequest,
    ...v
  } = s;
  void workspaceId;
  void creatorId;
  void generation;
  void baselineFingerprint;
  void lastRequest;
  return v;
}
