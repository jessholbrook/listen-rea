import sharp from "sharp";
import {
  brandingSettingsInput,
  brandingSnapshot,
  defaultBranding,
  LOGO_MAX_BYTES,
  type BrandingSettings,
} from "./branding";
import { get, put, requireStudy, transaction, now } from "./db";
import type { Study } from "./domain";
import { actor, canLaunch, body, fail, respond } from "./http";
export async function brandingSettings(s: Study): Promise<BrandingSettings> {
  return (
    (await get<BrandingSettings>(
      "participantBranding",
      s.id,
      s.workspaceId,
    )) || {
      ...defaultBranding,
      id: s.id,
      studyId: s.id,
      workspaceId: s.workspaceId,
      version: 0,
    }
  );
}
export async function participantBranding(s: Study) {
  return brandingSnapshot(await brandingSettings(s));
}
export async function normalizeLogo(value: string | null) {
  if (!value) return null;
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail(400, "Upload a PNG, JPEG or WebP logo.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > LOGO_MAX_BYTES)
    fail(413, "The prepared logo must be at most 128 KB.");
  try {
    const image = sharp(bytes, { limitInputPixels: 4000000, failOn: "error" });
    const meta = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) !== 1 ||
      meta.format !== match[1]
    )
      throw new Error("format");
    const output = await image
      .rotate()
      .resize({
        width: 640,
        height: 160,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (output.length > LOGO_MAX_BYTES)
      fail(
        413,
        "The prepared logo must be at most 128 KB. Try a simpler image.",
      );
    return "data:image/png;base64," + output.toString("base64");
  } catch (e) {
    if ((e as { status?: number }).status === 413) throw e;
    fail(
      400,
      "The logo could not be decoded. Use a static PNG, JPEG or WebP image.",
    );
  }
}
export async function dispatchBranding(req: Request, p: string[]) {
  if (p.length !== 3 || p[0] !== "studies" || p[2] !== "branding") return null;
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (req.method === "GET")
    return respond({
      settings: await brandingSettings(s),
      canManage: a.role !== "collaborator",
    });
  if (req.method !== "PUT") fail(405, "Method not allowed.");
  canLaunch(a);
  const { version, ...input } = brandingSettingsInput.parse(await body(req));
  const logoDataUrl = await normalizeLogo(input.logoDataUrl);
  return await transaction(async () => {
    await requireStudy(s.id, a);
    const current = await brandingSettings(s);
    if (version !== current.version)
      fail(409, "Branding changed. Refresh before saving.");
    const settings: BrandingSettings = {
      ...current,
      ...input,
      logoDataUrl,
      version: current.version + 1,
      updatedAt: now(),
      updatedBy: a.id,
    };
    await put("participantBranding", settings);
    return respond({ settings, canManage: true });
  });
}
