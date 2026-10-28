import { z } from "zod";
import { calendarFilters, viewTimeZone } from "./calendar-view-config";
import { languageSchema } from "./localization";
export const unifiedFilters = z
  .object({
    month: calendarFilters.shape.month,
    day: calendarFilters.shape.day,
    window: calendarFilters.shape.window,
    collectionId: calendarFilters.shape.collectionId,
    query: calendarFilters.shape.query,
    kind: z.enum(["all", "tasks", "reviews"]),
    person: calendarFilters.shape.assignee,
    includeFinished: z.boolean(),
  })
  .strict()
  .refine(
    (v) => !v.day || (v.window === "month" && v.day.startsWith(v.month + "-")),
    "Choose a day in the selected month, or clear the selected day.",
  )
  .refine(
    (v) => v.window === "month" || !v.includeFinished,
    "Priority queues include unfinished work only.",
  );
export const unifiedViewConfig = z
  .object({
    kind: z.literal("unified"),
    filters: unifiedFilters,
    language: languageSchema,
    timeZone: viewTimeZone,
  })
  .strict();
export type UnifiedViewConfig = z.infer<typeof unifiedViewConfig>;
