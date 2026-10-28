import { z } from "zod";
import { planDate } from "./review-plans";
import { taskActivityActions, taskActivityFields } from "./task-activity";
const idOrEmpty = z.union([z.uuid(), z.literal("")]);
const text = z.string().max(160);
export const followUpViewConfig = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tasks"),
      filters: z
        .object({
          collectionId: idOrEmpty,
          assignee: z.union([idOrEmpty, z.enum(["mine", "unassigned"])]),
          status: z.enum(["active", "all", "open", "in_progress", "completed"]),
          due: z.enum(["", "overdue", "today", "week", "undated"]),
          query: text,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("task_activity"),
      filters: z
        .object({
          collectionId: idOrEmpty,
          taskId: idOrEmpty,
          personId: z.union([idOrEmpty, z.literal("system")]),
          action: z.union([z.enum(taskActivityActions), z.literal("")]),
          field: z.union([z.enum(taskActivityFields), z.literal("")]),
          from: z.union([planDate, z.literal("")]),
          to: z.union([planDate, z.literal("")]),
        })
        .strict()
        .refine(
          (v) => !v.from || !v.to || v.to >= v.from,
          "Choose an end date on or after the start date.",
        ),
    })
    .strict(),
]);
