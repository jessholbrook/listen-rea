import { randomUUID } from "node:crypto";
import { emotionInterview } from "./emotion-fixture";
import { guideSchema } from "../src/lib/domain";
export const screenerGuide = () =>
  guideSchema.parse({
    ...emotionInterview().guide,
    title: "Quota screening",
    limit: 20,
    questions: [
      {
        id: "role",
        type: "choice",
        text: "Which role applies?",
        options: [
          { id: "customer", text: "Customer" },
          { id: "prospect", text: "Prospect" },
          { id: "ineligible", text: "None of these", rejects: true },
        ],
      },
      {
        id: "tools",
        type: "multiple",
        text: "Which tools do you use?",
        options: [
          { id: "web", text: "Web" },
          { id: "app", text: "Mobile app" },
        ],
        selection: { min: 1, max: 2 },
      },
      ...emotionInterview().guide.questions,
    ],
  });
export const screenerRule = (key = "role", value = "customer", limit = 1) => ({
  id: randomUUID(),
  source: "screener" as const,
  label: value,
  enabled: true,
  limit,
  conditions: [{ key, value }],
});
