import { z } from "zod";
import { planDate } from "./review-plans";
import { languageSchema } from "./localization";
export const viewTimeZone = z
  .string()
  .max(100)
  .refine((s) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: s });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");
export const calendarFilters = z
  .object({
    month: z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/),
    day: z.union([planDate, z.literal("")]),
    window: z.enum(["month", "overdue", "week", "undated"]),
    collectionId: z.union([z.uuid(), z.literal("")]),
    assignee: z.union([z.uuid(), z.enum(["", "mine", "unassigned"])]),
    status: z.enum(["active", "all", "open", "in_progress", "completed"]),
    query: z.string().max(160),
  })
  .strict()
  .refine(
    (v) => !v.day || (v.window === "month" && v.day.startsWith(v.month + "-")),
    "Choose a day in the selected month, or clear the selected day.",
  );
export const calendarViewConfig = z
  .object({
    kind: z.literal("calendar"),
    filters: calendarFilters,
    language: languageSchema,
    timeZone: viewTimeZone,
  })
  .strict();
export type CalendarViewConfig = z.infer<typeof calendarViewConfig>;
