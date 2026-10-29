import { tremendousWebhook } from "@/lib/tremendous-webhook";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    return await tremendousWebhook(req);
  } catch {
    return Response.json(
      { error: "Webhook could not be accepted. Retry later." },
      { status: 503 },
    );
  }
}
