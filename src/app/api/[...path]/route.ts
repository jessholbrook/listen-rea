import { dispatch, HttpError, respond } from "@/lib/server";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
async function handle(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    return await dispatch(req, (await ctx.params).path);
  } catch (e) {
    if (e instanceof HttpError) return respond({ error: e.message }, e.status);
    if (e instanceof ZodError)
      return respond(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n"),
        },
        400,
      );
    const message = e instanceof Error ? e.message : "";
    if (message === "DEPLOYMENT_STORAGE_REQUIRED")
      return respond(
        {
          error:
            "Hosted storage is not fully configured. Configure the database and private Blob store; the product walkthrough remains available at /demo.",
        },
        503,
      );
    if (
      e instanceof Error &&
      (e.name === "TimeoutError" ||
        (e.name === "AbortError" && !req.signal.aborted))
    )
      return respond(
        {
          error:
            "The AI provider took too long. Your saved recording and answers are safe; try again or continue in text.",
        },
        504,
      );
    if (e instanceof Error && e.name === "AbortError")
      return respond(
        { error: "Request canceled. Your saved work is preserved." },
        499,
      );
    if (message === "INVALID_STRUCTURED_ANSWER")
      return respond(
        {
          error:
            "Complete this question using the available options and scale.",
        },
        400,
      );
    if (message === "NOT_FOUND")
      return respond({ error: "Study not found." }, 404);
    if (message === "AI_NOT_CONFIGURED")
      return respond(
        {
          error:
            "AI is not connected. Configure RESEARCH_AI_KEY on the server to use this feature.",
        },
        503,
      );
    if (
      message === "INVALID_CITATION" ||
      message === "INVALID_VISUAL_EVIDENCE" ||
      message === "INVALID_MODEL_OUTPUT"
    )
      return respond(
        {
          error:
            "The model returned unverified evidence. Nothing was saved; try again or code the responses manually.",
        },
        502,
      );
    if (message === "PROVIDER_AUTH")
      return respond(
        {
          error:
            "The model provider rejected authentication. Ask your workspace admin to check the server configuration.",
        },
        502,
      );
    if (message === "PROVIDER_UNAVAILABLE")
      return respond(
        {
          error:
            "The model provider is unavailable. Your work is saved; try again shortly.",
        },
        502,
      );
    console.error(
      "Research request failed:",
      e instanceof Error ? e.name : "UnknownError",
    );
    return respond(
      { error: "The request could not be completed. Please try again." },
      500,
    );
  }
}
export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
