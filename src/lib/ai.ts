import { strictOutputSchema } from "./output-schema";
import { providerFetch, providerTimeout } from "./provider-transport";
import { db, uid, now } from "./db";

export const model = () => process.env.RESEARCH_MODEL || "gpt-4.1-mini";
export const aiReady = () => Boolean(process.env.RESEARCH_AI_KEY);
export async function recordUsage(
  workspaceId: string,
  studyId: string,
  operation: string,
  modelName: string,
  input = 0,
  output = 0,
  audio = 0,
) {
  await db
    .prepare(
      "INSERT INTO usage(id,workspace_id,study_id,operation,model,input_tokens,output_tokens,audio_seconds,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      uid(),
      workspaceId,
      studyId,
      operation,
      modelName,
      input,
      output,
      audio,
      now(),
    );
}
export async function providerRequest(
  route: string,
  body: unknown,
  multipart = false,
  signal?: AbortSignal,
) {
  if (!aiReady()) throw new Error("AI_NOT_CONFIGURED");
  const res = await providerFetch(
    "https://api.openai.com/v1/" + route,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEARCH_AI_KEY,
        ...(!multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: (multipart ? body : JSON.stringify(body)) as never,
    },
    { timeoutMs: providerTimeout(route), signal },
  );
  if (!res.ok) {
    // Fixed numeric status only: never log provider bodies, prompts, research text or credentials.
    console.warn("AI_PROVIDER_HTTP_STATUS", res.status);
    await res.body?.cancel();
    throw new Error(
      res.status === 401 ? "PROVIDER_AUTH" : "PROVIDER_UNAVAILABLE",
    );
  }
  return res;
}
export function generationBody(
  system: string,
  input: unknown,
  schema?: unknown,
  options?: {
    image?: Buffer;
    imageDetail?: "low" | "high";
    maxTokens?: number;
    signal?: AbortSignal;
  },
) {
  return {
    model: model(),
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: options?.image
          ? [
              { type: "text", text: JSON.stringify(input) },
              {
                type: "image_url",
                image_url: {
                  url:
                    "data:image/png;base64," + options.image.toString("base64"),
                  detail: options.imageDetail || "low",
                },
              },
            ]
          : JSON.stringify(input),
      },
    ],
    response_format: schema
      ? {
          type: "json_schema",
          json_schema: {
            name: "research_output",
            strict: true,
            schema: strictOutputSchema(schema),
          },
        }
      : { type: "json_object" },
    max_completion_tokens: options?.maxTokens || 6000,
    ...(options ? { store: false } : {}),
  };
}
export async function generate(
  system: string,
  input: unknown,
  workspaceId: string,
  studyId: string,
  operation: string,
  schema?: unknown,
  options?: {
    image?: Buffer;
    imageDetail?: "low" | "high";
    maxTokens?: number;
    signal?: AbortSignal;
  },
) {
  const response = await providerRequest(
    "chat/completions",
    generationBody(system, input, schema, options),
    false,
    options?.signal,
  );
  const result = (await response.json()) as {
    choices: {
      message: {
        content: string;
      };
    }[];
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
    };
  };
  await recordUsage(
    workspaceId,
    studyId,
    operation,
    model(),
    result.usage?.prompt_tokens || 0,
    result.usage?.completion_tokens || 0,
  );
  try {
    return JSON.parse(result.choices[0].message.content);
  } catch {
    throw new Error("INVALID_MODEL_OUTPUT");
  }
}
