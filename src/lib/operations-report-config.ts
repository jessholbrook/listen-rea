import { unifiedViewConfig } from "./unified-view-config";
import { z } from "zod";
import { languageSchema } from "./localization";
import { followUpViewConfig } from "./follow-up-view-config";
import {
  calendarViewConfig,
  viewTimeZone as timeZone,
} from "./calendar-view-config";
export const operationsReportConfig = z.union([
  z
    .object({
      kind: z.literal("workload"),
      filters: z
        .object({
          collectionId: z.union([z.uuid(), z.literal("")]),
          query: z.string().max(160),
          show: z.enum(["all", "active", "overdue"]),
        })
        .strict(),
      language: languageSchema,
      timeZone,
    })
    .strict(),
  followUpViewConfig.options[1].extend({ language: languageSchema, timeZone }),
  calendarViewConfig,
  unifiedViewConfig,
]);
export type OperationsReportConfig = z.infer<typeof operationsReportConfig>;
