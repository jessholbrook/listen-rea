import { externalApi } from "@/lib/external-api-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(
  req: Request,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  return externalApi(req, (await ctx.params).path || []);
}
export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as HEAD,
  handle as OPTIONS,
};
