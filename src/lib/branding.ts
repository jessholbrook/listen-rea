import { z } from "zod";
export const LOGO_MAX_BYTES = 128 * 1024;
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color.");
export function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((n) => parseInt(hex.slice(n, n + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export const brandingInput = z
  .object({
    enabled: z.boolean(),
    name: z.string().trim().max(80),
    logoDataUrl: z.string().max(180000).nullable(),
    logoAlt: z.string().trim().max(120),
    accent: hex,
    background: hex,
    text: hex,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (contrast(v.text, v.background) < 4.5)
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "Text and background need a contrast ratio of at least 4.5:1.",
      });
    if (v.logoDataUrl && !v.logoAlt)
      ctx.addIssue({
        code: "custom",
        path: ["logoAlt"],
        message: "Add a description for the logo.",
      });
  });
export type ParticipantBranding = z.infer<typeof brandingInput>;
export const brandingSettingsInput = brandingInput.safeExtend({
  version: z.number().int().min(0),
});
export type BrandingSettings = ParticipantBranding & {
  id: string;
  studyId: string;
  workspaceId: string;
  version: number;
  updatedAt?: string;
  updatedBy?: string;
};
export const defaultBranding: ParticipantBranding = {
  enabled: false,
  name: "",
  logoDataUrl: null,
  logoAlt: "",
  accent: "#385a40",
  background: "#f7f8f2",
  text: "#232e28",
};
export function brandingSnapshot(s: BrandingSettings): ParticipantBranding {
  const { enabled, name, logoDataUrl, logoAlt, accent, background, text } = s;
  return {
    enabled,
    name,
    logoDataUrl: enabled ? logoDataUrl : null,
    logoAlt: enabled ? logoAlt : "",
    accent,
    background,
    text,
  };
}
export function brandingStyle(b?: ParticipantBranding) {
  if (!b?.enabled) return undefined;
  const buttonText =
    contrast(b.accent, "#ffffff") >= 4.5 ? "#ffffff" : "#000000";
  const highlight = contrast(b.accent, b.background) >= 4.5 ? b.accent : b.text;
  return {
    "--brand-accent": b.accent,
    "--brand-button-text": buttonText,
    "--brand-background": b.background,
    "--brand-text": b.text,
    "--brand-highlight": highlight,
  };
}
