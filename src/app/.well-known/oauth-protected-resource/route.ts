import { oauthMetadata } from "@/lib/oauth-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  return oauthMetadata(req, true);
}
