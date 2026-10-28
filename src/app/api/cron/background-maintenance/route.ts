import {
  backgroundMaintenance,
  maintenanceAuthorized,
} from "@/lib/background-maintenance";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(req: Request) {
  if (!maintenanceAuthorized(req.headers.get("authorization")))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await backgroundMaintenance(), {
    headers: { "Cache-Control": "no-store" },
  });
}
