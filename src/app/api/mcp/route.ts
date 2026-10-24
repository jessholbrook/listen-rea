import { handleMcp } from "@/lib/mcp-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export {
  handleMcp as POST,
  handleMcp as GET,
  handleMcp as DELETE,
  handleMcp as PUT,
  handleMcp as PATCH,
  handleMcp as HEAD,
  handleMcp as OPTIONS,
};
