import { z } from "zod";
import type { Interview } from "./domain";
export type HandoffProvider = "qualtrics" | "rally" | "forsta";
export const responseIdInput = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{1,128}$/,
    "Use opaque participant identifiers, not contact details or unexpanded merge fields.",
  );
export const handoffAdmissionInput = z
  .object({
    responseId: responseIdInput,
    secret: z.string().regex(/^[0-9a-f]{64}$/),
    provider: z.enum(["qualtrics", "rally", "forsta"]).default("qualtrics"),
    externalStudyId: responseIdInput.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.provider === "rally"
        ? !!v.externalStudyId
        : v.externalStudyId === undefined,
    "Rally requires studyID; other providers do not accept a Rally study ID.",
  );
export const handoffStatuses = [
  "complete",
  "screened_out",
  "withdrawn",
] as const;
export type HandoffStatus = (typeof handoffStatuses)[number];
export type HandoffRoutes = Record<HandoffStatus, string>;
export function validHandoffUrl(value: string) {
  if (!value) return true;
  try {
    const u = new URL(value),
      host = u.hostname;
    return (
      value.length <= 2048 &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      host.includes(".") &&
      !host.includes(":") &&
      !/^[\d.]+$/.test(host) &&
      !/(^|\.)(localhost|local|internal)$/.test(host) &&
      ![...u.searchParams.keys()].some((k) =>
        [
          "responseid",
          "echo_status",
          "token",
          "access_token",
          "api_key",
          "authorization",
          "x-vercel-protection-bypass",
        ].includes(k.toLowerCase()),
      )
    );
  } catch {
    return false;
  }
}
function expandRally(value: string, pid: string, studyID: string) {
  return value
    .replace(/\{pid\}|%7Bpid%7D/gi, encodeURIComponent(pid))
    .replace(/\{studyID\}|%7BstudyID%7D/gi, encodeURIComponent(studyID));
}
export function validRallyUrl(value: string) {
  if (!value) return true;
  if (/\$\{|%24%7B/i.test(value)) return false;
  if (!validHandoffUrl(value)) return false;
  try {
    const u = new URL(value),
      expanded = new URL(expandRally(value, "participant", "study"));
    if (
      u.origin !== expanded.origin ||
      /[{}]|%7[BD]/i.test(expanded.toString())
    )
      return false;
    for (const [key, val] of u.searchParams) {
      if (/[{}]/.test(key)) return false;
      if (key.toLowerCase() === "pid" && val !== "{pid}") return false;
      if (
        key.toLowerCase() === "studyid" &&
        val !== "{studyID}" &&
        !responseIdInput.safeParse(val).success
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
// rid is the documented default Decipher participant key. Reject saved values
// so every return uses the admitted participant's ID, never a fixed person's.
export function validForstaUrl(value: string) {
  if (!value) return true;
  return (
    validHandoffUrl(value) &&
    !/[{}]|%7[BD]|\$uuid/i.test(value) &&
    ![...new URL(value).searchParams.keys()].some(
      (k) => k.toLowerCase() === "rid",
    )
  );
}
const forstaDestination = z
  .string()
  .max(2048)
  .refine(
    validForstaUrl,
    "Use an approved HTTPS survey address without rid or merge fields. Echo Lab appends the participant rid.",
  );
const destination = z
  .string()
  .max(2048)
  .refine(
    validHandoffUrl,
    "Use an HTTPS destination without credentials, fragments or reserved ResponseID/echo_status parameters.",
  );
const rallyDestination = z
  .string()
  .max(2048)
  .refine(
    validRallyUrl,
    "Use an approved HTTPS return URL. Only {pid} and {studyID} placeholders are supported in its path or query values. Do not hard-code a pid query value.",
  );
const fields = {
  version: z.number().int().min(0),
  enabled: z.boolean(),
  reviewed: z.boolean(),
};
export const handoffSettingsInput = z
  .object({
    ...fields,
    routes: z
      .object({
        complete: destination,
        screened_out: destination,
        withdrawn: destination,
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) => !v.enabled || v.reviewed,
    "Review the destination addresses before enabling the connection.",
  );
export const rallySettingsInput = z
  .object({
    ...fields,
    externalStudyId: z.union([responseIdInput, z.literal("")]),
    routes: z
      .object({
        complete: rallyDestination,
        screened_out: rallyDestination,
        withdrawn: rallyDestination,
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) => !v.enabled || (v.reviewed && !!v.externalStudyId),
    "Review the return URLs and set the expected Rally studyID before enabling.",
  )
  .superRefine((v, ctx) => {
    for (const [status, value] of Object.entries(v.routes)) {
      if (!value || !validRallyUrl(value)) continue;
      for (const [key, id] of new URL(value).searchParams) {
        if (
          key.toLowerCase() === "studyid" &&
          id !== "{studyID}" &&
          id !== v.externalStudyId
        )
          ctx.addIssue({
            code: "custom",
            path: ["routes", status],
            message:
              "The saved Rally studyID query value must match the configured studyID, or use {studyID}.",
          });
      }
    }
  });
export const forstaSettingsInput = z
  .object({
    ...fields,
    routes: z
      .object({
        complete: forstaDestination,
        screened_out: forstaDestination,
        withdrawn: forstaDestination,
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) => !v.enabled || v.reviewed,
    "Review the Decipher return addresses and rid sharing before enabling.",
  );
export type HandoffSettings = {
  id: string;
  workspaceId: string;
  studyId: string;
  version: number;
  enabled: boolean;
  routes: HandoffRoutes;
  provider?: HandoffProvider;
  externalStudyId?: string;
  updatedAt?: string;
  updatedBy?: string;
};
export type SurveyHandoff = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId?: string;
  responseId: string;
  provider?: HandoffProvider;
  externalStudyId?: string;
  secretHash?: string;
  fingerprint?: string;
  configVersion: number;
  routes: HandoffRoutes;
  createdAt: string;
  responseDeletedAt?: string;
};
export function handoffUrl(claim: SurveyHandoff, status: Interview["status"]) {
  if (status === "active" || !claim.responseId || claim.responseDeletedAt)
    return null;
  const saved = claim.routes[status];
  if (claim.provider === "forsta") {
    if (!saved || !validForstaUrl(saved)) return null;
    const url = new URL(saved);
    url.searchParams.set("rid", claim.responseId);
    return {
      url: url.toString(),
      origin: url.origin,
      provider: "forsta" as const,
    };
  }
  if (claim.provider === "rally") {
    if (!saved || !claim.externalStudyId || !validRallyUrl(saved)) return null;
    const url = new URL(
      expandRally(saved, claim.responseId, claim.externalStudyId),
    );
    if (url.origin !== new URL(saved).origin) return null;
    return {
      url: url.toString(),
      origin: url.origin,
      provider: "rally" as const,
    };
  }
  if (!saved || !validHandoffUrl(saved)) return null;
  const url = new URL(saved);
  url.searchParams.set("ResponseID", claim.responseId);
  url.searchParams.set("echo_status", status);
  return { url: url.toString(), origin: url.origin };
}
export const qualtricsTemplate = (origin: string, studyId: string) =>
  origin + "/s/" + studyId + "?ResponseID=${e://Field/ResponseID}";
export const rallyTestUrl = (origin: string, studyId: string) =>
  origin + "/s/" + studyId + "?handoff=rally";

export const forstaTestUrl = (origin: string, studyId: string) =>
  origin + "/s/" + studyId + "?handoff=forsta";
