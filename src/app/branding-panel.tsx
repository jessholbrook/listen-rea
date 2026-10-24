"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { api } from "@/lib/client";
import {
  brandingStyle,
  brandingInput,
  contrast,
  defaultBranding,
  LOGO_MAX_BYTES,
  type BrandingSettings,
} from "@/lib/branding";
import ParticipantBrand from "./participant-brand";
async function prepareLogo(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 2 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG or WebP image up to 2 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 640 / bitmap.width, 160 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Image preparation is unavailable. Try another browser.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/png");
    if (atob(result.split(",")[1]).length > LOGO_MAX_BYTES)
      throw new Error(
        "The prepared logo exceeds 128 KB. Try a smaller or simpler image.",
      );
    return result;
  } finally {
    bitmap.close();
  }
}
export default function BrandingPanel({ studyId }: { studyId: string }) {
  const [settings, setSettings] = useState<BrandingSettings | null>(null),
    [canManage, setCanManage] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const path = "studies/" + studyId + "/branding";
  useEffect(() => {
    let current = true;
    api(path)
      .then((r) => {
        if (current) {
          setSettings(r.settings);
          setCanManage(r.canManage);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [path]);
  const patch = (value: Partial<BrandingSettings>) => {
    setSettings((s) => s && { ...s, ...value });
    setNotice("");
  };
  return (
    <section className="panel branding-panel">
      <h3>Participant branding</h3>
      <p>
        Add your study’s name, logo and colors. Saved changes apply to new
        interviews and previews. Existing interviews keep their original
        appearance.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {settings && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const {
                id,
                studyId,
                workspaceId,
                updatedAt,
                updatedBy,
                version,
                ...fields
              } = settings;
              const parsed = brandingInput.safeParse(fields);
              if (!parsed.success)
                throw new Error(
                  parsed.error.issues.map((i) => i.message).join(" "),
                );
              const r = await api(path, "PUT", { version, ...parsed.data });
              setSettings(r.settings);
              setNotice("Participant branding saved.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={!canManage || busy}>
            <label className="handoff-check">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              Use custom participant branding
            </label>
            <label>
              Study brand name
              <input
                maxLength={80}
                value={settings.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              Study logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setBusy(true);
                  setError("");
                  setNotice("");
                  try {
                    patch({
                      logoDataUrl: await prepareLogo(file),
                      logoAlt:
                        settings.logoAlt || settings.name || "Study logo",
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
            <p className="small muted">
              PNG, JPEG or WebP up to 2 MB. Logos are resized to fit 640 × 160
              pixels and stored as a static image.
            </p>
            {settings.logoDataUrl && (
              <>
                <label>
                  Logo description
                  <input
                    maxLength={120}
                    required
                    value={settings.logoAlt}
                    onChange={(e) => patch({ logoAlt: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => patch({ logoDataUrl: null, logoAlt: "" })}
                >
                  Remove logo
                </button>
              </>
            )}
            <div className="branding-colors">
              {(["accent", "background", "text"] as const).map((key) => (
                <label key={key}>
                  {key === "accent"
                    ? "Button color"
                    : key === "background"
                      ? "Background color"
                      : "Text color"}
                  <input
                    type="color"
                    value={settings[key]}
                    onChange={(e) => patch({ [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <p className="small" role="status">
              Text contrast:{" "}
              {contrast(settings.text, settings.background).toFixed(2)}:1 ·
              Minimum 4.5:1. Button text adjusts automatically.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => patch({ ...defaultBranding })}
            >
              Reset to Echo Lab defaults
            </button>
          </fieldset>
          <div
            className={
              "branding-preview participant-shell" +
              (settings.enabled ? " participant-themed" : "")
            }
            style={brandingStyle(settings) as CSSProperties}
            aria-label="Participant branding preview"
          >
            <ParticipantBrand branding={settings} />
            <h4>Your perspective makes a difference.</h4>
            <p>A preview of your participant colors.</p>
            <span className="button primary">Continue</span>
          </div>
          <p className="small muted">
            Preview shows unsaved choices. Echo Lab attribution remains visible.
            Branding can influence responses; use neutral styling when testing
            brand perceptions.
          </p>
          <div className="branding-actions">
            {canManage && (
              <button className="button primary" disabled={busy}>
                Save participant branding
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  const r = await api(path);
                  setSettings(r.settings);
                  setNotice("Participant branding refreshed.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh participant branding
            </button>
          </div>
          {!canManage && (
            <p className="small muted">
              A researcher or admin can change participant branding.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
