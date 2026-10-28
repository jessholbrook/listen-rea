import { oauthEndpoint } from "@/lib/oauth-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(
  req: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  return oauthEndpoint(req, (await ctx.params).action);
}
export {
  handle as GET,
  handle as POST,
  handle as OPTIONS,
  handle as DELETE,
  handle as PUT,
  handle as PATCH,
};
